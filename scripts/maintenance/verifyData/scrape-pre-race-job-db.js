// verify-scrape-pre-race-job.js のインメモリの Supabase クライアント（越えの単位を分けるため移した。verify ではない）
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Supabaseクライアントの差し替え（インメモリ）。select は in・not(is null)・like・eq・limit・maybeSingle に対応する。
 * failUpsert に表名を入れると、その表への upsert が失敗する。failSelect は、その表の select が失敗する。
 */
export function createDb({
  tables = {},
  failUpsert = {},
  failSelect = {},
} = {}) {
  const state = {
    tables: clone(tables),
    upserts: [],
    updates: [],
    selects: [],
  };
  const client = {
    state,
    from(table) {
      state.tables[table] ??= [];
      return tableApi(state, table, { failUpsert, failSelect });
    },
  };
  return client;
}

function tableApi(state, table, { failUpsert, failSelect }) {
  return {
    select(columns) {
      return selectQuery(state, table, columns, failSelect);
    },
    upsert(rows, { onConflict }) {
      if (failUpsert[table]) {
        return Promise.resolve({
          error: { message: `${table} への書き込みに失敗（テスト）` },
        });
      }
      state.upserts.push({ table, rows: clone(rows) });
      const keys = onConflict.split(",");
      for (const row of rows) {
        const existing = state.tables[table].find((r) =>
          keys.every((k) => r[k] === row[k]),
        );
        if (existing) Object.assign(existing, clone(row));
        else state.tables[table].push(clone(row));
      }
      return Promise.resolve({ error: null });
    },
    update(values) {
      return {
        eq(column, value) {
          state.updates.push({
            table,
            values: clone(values),
            column,
            value,
          });
          for (const r of state.tables[table]) {
            if (r[column] === value) Object.assign(r, clone(values));
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function selectQuery(state, table, columns, failSelect) {
  const cols = columns === "*" ? null : columns.split(",").map((c) => c.trim());
  const filters = [];
  let limit = null;
  let single = false;
  const exec = () => {
    state.selects.push({ table, columns });
    const failure = failSelect[table];
    if (failure) {
      return {
        data: null,
        error: {
          code: failure.code,
          message: failure.message ?? String(failure),
        },
      };
    }
    let rows = state.tables[table].filter((r) => filters.every((f) => f(r)));
    if (limit !== null) rows = rows.slice(0, limit);
    rows = rows.map((r) =>
      cols
        ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]))
        : { ...r },
    );
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const q = {
    in(c, ids) {
      filters.push((r) => ids.includes(r[c]));
      return q;
    },
    not(c, op, v) {
      if (op === "is" && v === null) {
        filters.push((r) => r[c] !== null && r[c] !== undefined);
      }
      return q;
    },
    like(c, pattern) {
      const prefix = pattern.replace(/%$/, "");
      filters.push((r) => String(r[c]).startsWith(prefix));
      return q;
    },
    eq(c, v) {
      filters.push((r) => r[c] === v);
      return q;
    },
    // 日付の範囲（race_series の start_date <= 対象日 <= end_date）。日付は YYYY-MM-DD の文字列で比較する
    lte(c, v) {
      filters.push((r) => String(r[c]) <= String(v));
      return q;
    },
    gte(c, v) {
      filters.push((r) => String(r[c]) >= String(v));
      return q;
    },
    lt(c, v) {
      filters.push((r) => String(r[c]) < String(v));
      return q;
    },
    limit(n) {
      limit = n;
      return q;
    },
    maybeSingle() {
      single = true;
      return q;
    },
    then(resolve, reject) {
      return Promise.resolve(exec()).then(resolve, reject);
    },
  };
  return q;
}
