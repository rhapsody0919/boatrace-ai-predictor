// verify-prediction-refresh.js のインメモリの偽クライアント（PostgREST の最小限の再現。1リクエストの上限行数も再現する。越えの単位を分けるため移した。verify ではない）
export function createFakeClient({
  tables = {},
  maxRows = 1000,
  fail = {},
} = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const calls = [];
  let nextId = 1;

  const execute = (q) => {
    const key = `${q.table}:${q.op}`;
    calls.push({
      table: q.table,
      op: q.op,
      filters: q.filters,
      rows: q.payload,
      opts: q.opts,
    });
    if (fail[key]) return { data: null, error: { message: fail[key] } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      const found = rows.filter((row) => matches(row, q.filters));
      // PostgREST は、1リクエストで max_rows（既定1000）を超える行を返さない（エラーにもならない）
      return {
        data: found.slice(0, maxRows).map((row) => ({ ...row })),
        error: null,
      };
    }
    if (q.op === "delete") {
      state[q.table] = rows.filter((row) => !matches(row, q.filters));
      return { data: null, error: null };
    }
    if (q.op === "update") {
      for (const row of rows) {
        if (matches(row, q.filters)) Object.assign(row, q.payload);
      }
      return { data: null, error: null };
    }
    // insert / upsert: predictions の一意制約 (race_id, model_id) を再現する
    const uniqueKeys =
      q.table === "predictions" ? ["race_id", "model_id"] : null;
    const sameKey = (a, b) => uniqueKeys.every((k) => a[k] === b[k]);
    const batch = q.payload.map((row) => ({ ...row }));
    if (q.op === "insert") {
      if (
        uniqueKeys &&
        batch.some((row) => rows.some((existing) => sameKey(existing, row)))
      ) {
        // 1行でも一意制約に違反すると、バッチ全体が失敗する（PostgreSQL の1文の原子性）
        return {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "predictions_race_id_model_id_key"',
          },
        };
      }
      for (const row of batch) rows.push({ prediction_id: nextId++, ...row });
      return { data: null, error: null };
    }
    // upsert
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    for (const row of batch) {
      const existing = keys.length
        ? rows.find((r) => keys.every((k) => r[k] === row[k]))
        : null;
      if (existing) Object.assign(existing, row);
      else rows.push({ prediction_id: nextId++, ...row });
    }
    return { data: null, error: null };
  };

  const from = (table) => makeBuilder(table, execute);
  return { from, state, calls };
}

const matches = (row, filters) =>
  filters.every(([kind, column, value]) => {
    if (kind === "in") return value.includes(row[column]);
    if (kind === "eq") return row[column] === value;
    if (kind === "gte") return row[column] >= value;
    if (kind === "lt") return row[column] < value;
    if (kind === "like")
      return String(row[column]).startsWith(value.replace(/%$/, ""));
    if (kind === "not-null")
      return row[column] !== null && row[column] !== undefined;
    return true;
  });

function makeBuilder(table, execute) {
  const q = { table, op: "select", filters: [], payload: null, opts: null };
  const builder = {
    select: () => builder,
    insert: (rows) => ((q.op = "insert"), (q.payload = rows), builder),
    upsert: (rows, opts) => (
      (q.op = "upsert"),
      (q.payload = rows),
      (q.opts = opts),
      builder
    ),
    update: (values) => ((q.op = "update"), (q.payload = values), builder),
    delete: () => ((q.op = "delete"), builder),
    in: (column, values) => (q.filters.push(["in", column, values]), builder),
    eq: (column, value) => (q.filters.push(["eq", column, value]), builder),
    gte: (column, value) => (q.filters.push(["gte", column, value]), builder),
    lt: (column, value) => (q.filters.push(["lt", column, value]), builder),
    like: (column, value) => (q.filters.push(["like", column, value]), builder),
    not: (column, operator) => (
      operator === "is" && q.filters.push(["not-null", column]),
      builder
    ),
    order: () => builder,
    then: (resolve, reject) =>
      Promise.resolve(execute(q)).then(resolve, reject),
  };
  return builder;
}

// 会場コード1〜24 × レース1〜12 = 288通りのレースID（1日の最大規模を超える）
export const raceIdsOf = (count, date = "2026-09-20") =>
  Array.from({ length: count }, (_, i) => {
    const venue = String(Math.floor(i / 12) + 1).padStart(2, "0");
    const race = String((i % 12) + 1).padStart(2, "0");
    return `${date}-${venue}-${race}`;
  });
