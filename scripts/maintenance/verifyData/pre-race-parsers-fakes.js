/**
 * verify-pre-race-parsers.js の差し替え（インメモリの Supabase クライアント・fetch）。DB にも取得先にも接続しない。
 * verify-pre-race-parsers.js の createDb を、select・upsert・update の関数へ割ったもの（振る舞いは同じ）。
 */

/** select(columns) の戻り（lte・gte・then・limit・in）。missingIn が列を返せば PostgREST と同じ形のエラー */
function selectQuery({
  state,
  table,
  cols,
  missingIn,
  selectError,
  throwOnProbe,
}) {
  // 日付の範囲（日目のフォールバックが読む race_series。BOA-501）。日付は YYYY-MM-DD の文字列で比較する。
  // 絞り込みの後は await で終える（lte・gte の順に依らない）
  const rangeFilters = [];
  const pick = (r) =>
    Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]));
  const q = {
    lte(column, value) {
      rangeFilters.push((r) => String(r[column]) <= String(value));
      return q;
    },
    gte(column, value) {
      rangeFilters.push((r) => String(r[column]) >= String(value));
      return q;
    },
    then(resolve, reject) {
      const bad = missingIn(table, cols);
      const result = bad
        ? { data: null, error: selectError(table, bad) }
        : {
            data: state.tables[table]
              .filter((r) => rangeFilters.every((f) => f(r)))
              .map(pick),
            error: null,
          };
      return Promise.resolve(result).then(resolve, reject);
    },
    limit() {
      if (throwOnProbe) throw new Error("fetch failed");
      const bad = missingIn(table, cols);
      return Promise.resolve(
        bad
          ? { data: null, error: selectError(table, bad) }
          : { data: [], error: null },
      );
    },
    in(column, ids) {
      const bad = missingIn(table, cols);
      if (bad) {
        return Promise.resolve({
          data: null,
          error: selectError(table, bad),
        });
      }
      const rows = state.tables[table].filter((r) => ids.includes(r[column]));
      return Promise.resolve({
        data: rows.map((r) =>
          Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])),
        ),
        error: null,
      });
    },
  };
  return q;
}

/** upsert(rows, { onConflict }): 未適用の列を含めば PGRST204、無ければ onConflict のキーで置き換えるか足す */
function upsertRows({ state, table, missingIn }, rows, onConflict) {
  for (const row of rows) {
    const bad = missingIn(table, Object.keys(row));
    if (bad) {
      return Promise.resolve({
        error: {
          code: "PGRST204",
          message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
        },
      });
    }
  }
  state.upserts.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
  const keys = onConflict.split(",");
  for (const row of rows) {
    const existing = state.tables[table].find((r) =>
      keys.every((k) => r[k] === row[k]),
    );
    if (existing) Object.assign(existing, JSON.parse(JSON.stringify(row)));
    else state.tables[table].push(JSON.parse(JSON.stringify(row)));
  }
  return Promise.resolve({ error: null });
}

/** update(values).eq(column, value): 記録して、一致する行を書き換える */
function updateRows(state, table, values) {
  return {
    eq(column, value) {
      state.updates.push({ table, values, column, value });
      for (const r of state.tables[table]) {
        if (r[column] === value) Object.assign(r, values);
      }
      return Promise.resolve({ error: null });
    },
  };
}

/**
 * Supabaseクライアントの差し替え（インメモリ）。missing に、テーブルごとの「未適用の列」を入れると、その列を含む
 * 書き込み・selectが、PostgRESTと同じ形のエラーで失敗する（マイグレーション未適用のDBの再現）。
 * throwOnProbe=true なら、適用状況の確認（select(...).limit(0)）が例外になる（通信エラーの再現）。
 */
export function createDb({
  tables = {},
  missing = {},
  throwOnProbe = false,
} = {}) {
  const state = {
    tables: JSON.parse(JSON.stringify(tables)),
    upserts: [],
    updates: [],
  };
  const missingIn = (table, cols) =>
    cols.find((c) => (missing[table] ?? []).includes(c));
  const selectError = (table, col) => ({
    code: "42703",
    message: `column ${table}.${col} does not exist`,
  });
  const client = {
    state,
    from(table) {
      state.tables[table] ??= [];
      return {
        select(columns) {
          const cols = columns.split(",").map((c) => c.trim());
          return selectQuery({
            state,
            table,
            cols,
            missingIn,
            selectError,
            throwOnProbe,
          });
        },
        upsert(rows, { onConflict }) {
          return upsertRows({ state, table, missingIn }, rows, onConflict);
        },
        update(values) {
          return updateRows(state, table, values);
        },
      };
    },
  };
  return client;
}

/** globalThis.fetch を、URL に応じたHTMLを返すものに差し替える（実行後に戻す） */
export async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const body = handler(String(url));
    if (body === null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    return await fn(requested);
  } finally {
    globalThis.fetch = original;
  }
}
