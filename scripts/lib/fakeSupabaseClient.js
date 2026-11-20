/**
 * 検証用の偽のSupabaseクライアント（メモリ上のテーブル。DB・ネットワークに接続しない）。
 * select().eq().gte().lte().order().limit().range()・upsert・update().eq().select() を扱う。
 * missing: 存在しない扱いのテーブル名、または "テーブル.列名"（未適用DDLの再現）。failUpsert: upsertを失敗させる。
 */
const columnMissing = (env, cols) =>
  Boolean(cols) &&
  cols.split(",").some((c) => env.missing.has(`${env.table}.${c.trim()}`));

function runSelect(env, q, rows, a, b) {
  const { table, calls } = env;
  calls.selects.push({ table, cols: q.cols, filters: [...q.filters] });
  if (columnMissing(env, q.cols))
    return {
      data: null,
      error: { message: `column ${q.cols} does not exist` },
    };
  const list = rows.filter(
    (r) =>
      q.filters.every(([c, v]) => r[c] === v) &&
      q.ranges.every(([c, o, v]) => (o === ">=" ? r[c] >= v : r[c] <= v)),
  );
  return {
    data: list.slice(a, b + 1).map((r) => ({ ...r })),
    error: null,
  };
}

function runUpsert(env, q, rows) {
  if (env.failUpsert) return { data: null, error: { message: "boom" } };
  const { payload } = q;
  env.calls.upserts.push({ table: env.table, n: payload.rows.length });
  const keys = payload.o.onConflict.split(",");
  for (const r of payload.rows) {
    const i = rows.findIndex((x) => keys.every((k) => x[k] === r[k]));
    if (i >= 0) rows[i] = { ...rows[i], ...r };
    else rows.push({ ...r });
  }
  return { data: null, error: null };
}

function runUpdate(env, q, rows) {
  const { payload } = q;
  const targets = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
  env.calls.updates.push({
    table: env.table,
    filters: [...q.filters],
    values: payload,
    matched: targets.length,
  });
  for (const r of targets) Object.assign(r, payload);
  return {
    data: targets.map((r) => ({ racer_id: r.racer_id })),
    error: null,
  };
}

// 組み立てたクエリ q（filters・ranges・cols・op・payload）を、メモリ上のテーブルに対して実行する
async function runQuery(env, q, a = 0, b = 9999) {
  const { table, tables, missing } = env;
  if (missing.has(table))
    return {
      data: null,
      error: { message: `relation "${table}" does not exist` },
    };
  const rows = tables[table] ?? (tables[table] = []);
  if (q.op === "select") return runSelect(env, q, rows, a, b);
  if (q.op === "upsert") return runUpsert(env, q, rows);
  if (q.op === "update") return runUpdate(env, q, rows);
  return { data: null, error: { message: "unsupported" } };
}

export function fakeClient(
  tables,
  { missing = new Set(), failUpsert = false } = {},
) {
  const calls = { upserts: [], updates: [], selects: [] };
  const client = {
    calls,
    tables,
    from(table) {
      const env = { table, tables, missing, failUpsert, calls };
      const q = {
        filters: [],
        ranges: [],
        cols: null,
        op: null,
        payload: null,
      };
      const chain = {
        select(c) {
          if (q.op === "update") return chain;
          q.cols = c;
          q.op = q.op ?? "select";
          return chain;
        },
        eq(col, val) {
          q.filters.push([col, val]);
          return chain;
        },
        gte(col, val) {
          q.ranges.push([col, ">=", val]);
          return chain;
        },
        lte(col, val) {
          q.ranges.push([col, "<=", val]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        async range(a, b) {
          return runQuery(env, q, a, b);
        },
        upsert(rows, o) {
          q.op = "upsert";
          q.payload = { rows, o };
          return chain;
        },
        update(values) {
          q.op = "update";
          q.payload = values;
          return chain;
        },
        then(res, rej) {
          return runQuery(env, q).then(res, rej);
        },
      };
      return chain;
    },
  };
  return client;
}
