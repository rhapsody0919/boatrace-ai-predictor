// verify-scrape-result-job.js のインメモリの PostgREST の模型（越えの単位を分けるため移した。verify ではない）
export const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * PostgRESTの、この検証に必要な部分だけを模した、インメモリのクライアント。
 * writes に、書き込みの呼び出し（upsert・update）を全て記録する。failOn に {table, op} を入れると、その書き込みが失敗する。
 */
export function createFakeDb(
  initial = {},
  { failOn = [], readError = {} } = {},
) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial))
    tables[name] = clone(rows);
  const writes = [];
  const reads = [];
  const failing = (table, op) =>
    failOn.some((f) => f.table === table && f.op === op);
  const ctx = { tables, writes, reads, readError, failing };
  return { tables, writes, reads, from: (table) => builder(ctx, table) };
}

const orPredicate = (expression) => {
  const parts = expression.split(",").map((p) => {
    const [col, op, ...rest] = p.split(".");
    const value = rest.join(".");
    return (r) =>
      op === "is"
        ? value === "null"
          ? r[col] === null || r[col] === undefined
          : r[col] === value
        : op === "neq"
          ? r[col] !== value
          : op === "eq"
            ? r[col] === value
            : false;
  });
  return (r) => parts.some((f) => f(r));
};

function builder(ctx, table) {
  const s = {
    op: "select",
    cols: "*",
    filters: [],
    patch: null,
    rows: null,
    onConflict: null,
    limit: null,
  };
  return makeQuery(s, () => exec(ctx, table, s));
}

function makeQuery(s, exec) {
  const q = {
    select(cols) {
      s.cols = cols ?? "*";
      return q;
    },
    in(col, vals) {
      s.filters.push((r) => vals.includes(r[col]));
      return q;
    },
    eq(col, val) {
      s.filters.push((r) => r[col] === val);
      return q;
    },
    gte(col, val) {
      s.filters.push((r) => r[col] >= val);
      return q;
    },
    lt(col, val) {
      s.filters.push((r) => r[col] < val);
      return q;
    },
    lte(col, val) {
      s.filters.push((r) => r[col] <= val);
      return q;
    },
    is(col, val) {
      s.filters.push((r) =>
        val === null ? r[col] === null || r[col] === undefined : r[col] === val,
      );
      return q;
    },
    not(col, op, val) {
      s.filters.push((r) =>
        op === "is" && val === null
          ? r[col] !== null && r[col] !== undefined
          : true,
      );
      return q;
    },
    or(expression) {
      s.filters.push(orPredicate(expression));
      return q;
    },
    limit(n) {
      s.limit = n;
      return q;
    },
    range() {
      return q;
    },
    order() {
      return q;
    },
    upsert(rows, opts = {}) {
      s.op = "upsert";
      s.rows = rows;
      s.onConflict = opts.onConflict;
      return q;
    },
    update(patch) {
      s.op = "update";
      s.patch = patch;
      return q;
    },
    then(resolve, reject) {
      return Promise.resolve(exec()).then(resolve, reject);
    },
  };
  return q;
}

function exec(ctx, table, s) {
  const { writes, failing } = ctx;
  const rows = (ctx.tables[table] ??= []);
  if (s.op === "select") return execSelect(ctx, table, s, rows);
  if (failing(table, s.op)) {
    writes.push({ table, op: s.op, failed: true });
    return {
      error: { message: `${table} の${s.op}が失敗しました（テスト）` },
    };
  }
  if (s.op === "upsert") {
    const keys = (s.onConflict ?? "").split(",").filter(Boolean);
    for (const row of s.rows) {
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) Object.assign(existing, clone(row));
      else rows.push(clone(row));
    }
    writes.push({ table, op: "upsert", count: s.rows.length });
    return { error: null };
  }
  if (s.op === "update") {
    const targets = rows.filter((r) => s.filters.every((f) => f(r)));
    for (const r of targets) Object.assign(r, clone(s.patch));
    writes.push({
      table,
      op: "update",
      count: targets.length,
      patch: s.patch,
    });
    return { error: null };
  }
  return { error: { message: `未対応: ${s.op}` } };
}

function execSelect(ctx, table, s, rows) {
  const { reads, readError } = ctx;
  reads.push({ table });
  if (readError[table]) {
    return { data: null, error: { message: readError[table] } };
  }
  let out = rows.filter((r) => s.filters.every((f) => f(r)));
  if (s.limit !== null) out = out.slice(0, s.limit);
  const wanted =
    s.cols === "*" || s.cols.includes("(")
      ? null
      : s.cols.split(",").map((c) => c.trim());
  return {
    data: clone(out).map((r) =>
      wanted
        ? Object.fromEntries(wanted.filter((c) => c in r).map((c) => [c, r[c]]))
        : r,
    ),
    error: null,
  };
}
