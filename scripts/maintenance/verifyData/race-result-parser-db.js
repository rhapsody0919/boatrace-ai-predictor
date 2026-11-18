// verify-race-result-parser.js の (e) 書き込み経路のインメモリの Supabase クライアント（越えの単位を分けるため移した。verify ではない）
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * インメモリのSupabaseクライアント（この検証に必要な範囲）。schema に、各テーブルの「存在する列」を渡すと、
 * 存在しない列を含む select・upsert・update は、PostgRESTと同じ形のエラーを返す。
 * tableMissing のテーブルは、PGRST205（テーブルが無い）を返す。writes に書き込みを全て記録する。
 */
export function createSchemaAwareDb(
  initial,
  { columns = {}, tableMissing = [], probeError = null } = {},
) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial))
    tables[name] = clone(rows);
  const writes = [];
  const reads = [];
  const unknownColumns = (table, names) =>
    columns[table] ? names.filter((n) => !columns[table].includes(n)) : [];
  const missingTable = (table) =>
    tableMissing.includes(table)
      ? {
          error: {
            code: "PGRST205",
            message: `Could not find the table 'public.${table}' in the schema cache`,
          },
        }
      : null;
  const ctx = {
    tables,
    writes,
    reads,
    unknownColumns,
    missingTable,
    probeError,
  };
  return { tables, writes, reads, from: (table) => builder(ctx, table) };
}

function builder(ctx, table) {
  const s = {
    op: "select",
    cols: "*",
    filters: [],
    patch: null,
    rows: null,
    onConflict: null,
    limit: null,
    head: false,
  };
  return makeQuery(s, () => exec(ctx, table, s));
}

function makeQuery(s, exec) {
  const q = {
    select(cols, opts = {}) {
      s.cols = cols ?? "*";
      s.head = Boolean(opts.head);
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
    gte() {
      return q;
    },
    lt() {
      return q;
    },
    is(col, val) {
      s.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
      return q;
    },
    not() {
      return q;
    },
    or() {
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
    maybeSingle() {
      s.single = true;
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
  const { tables, writes, unknownColumns, missingTable } = ctx;
  const gone = missingTable(table);
  if (gone) return gone;
  const rows = (tables[table] ??= []);
  if (s.op === "select") return execSelect(ctx, table, s, rows);
  const written =
    s.op === "upsert"
      ? s.rows.flatMap((r) => Object.keys(r))
      : Object.keys(s.patch);
  const unknown = unknownColumns(table, [...new Set(written)]);
  if (unknown.length > 0) {
    writes.push({ table, op: s.op, failed: true, unknown });
    return {
      error: {
        code: "PGRST204",
        message: `Could not find the '${unknown[0]}' column of '${table}' in the schema cache`,
      },
    };
  }
  if (s.op === "upsert") return execUpsert(ctx, table, s, rows);
  if (s.op === "update") {
    const targets = rows.filter((r) => s.filters.every((f) => f(r)));
    for (const r of targets) Object.assign(r, clone(s.patch));
    writes.push({
      table,
      op: "update",
      count: targets.length,
      patch: clone(s.patch),
    });
    return { error: null };
  }
  return { error: { message: `未対応: ${s.op}` } };
}

function execSelect(ctx, table, s, rows) {
  const { reads, probeError, unknownColumns } = ctx;
  // 適用状況の確認は select(列).limit(0)（行を取らない）
  const isProbe = s.limit === 0;
  reads.push({ table, cols: s.cols, probe: isProbe });
  if (probeError && isProbe) return { error: { message: probeError } };
  const wanted = s.cols === "*" ? null : s.cols.split(",").map((c) => c.trim());
  const unknown = wanted ? unknownColumns(table, wanted) : [];
  if (unknown.length > 0) {
    return {
      data: null,
      error: {
        code: "42703",
        message: `column ${table}.${unknown[0]} does not exist`,
      },
    };
  }
  let out = rows.filter((r) => s.filters.every((f) => f(r)));
  if (s.limit !== null) out = out.slice(0, s.limit);
  const data = clone(out).map((r) =>
    wanted
      ? Object.fromEntries(wanted.filter((c) => c in r).map((c) => [c, r[c]]))
      : r,
  );
  return s.single
    ? { data: data[0] ?? null, error: null }
    : { data, error: null };
}

function execUpsert(ctx, table, s, rows) {
  const { writes } = ctx;
  const keys = (s.onConflict ?? "").split(",").filter(Boolean);
  for (const row of s.rows) {
    const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
    if (existing) Object.assign(existing, clone(row));
    else rows.push(clone(row));
  }
  writes.push({
    table,
    op: "upsert",
    count: s.rows.length,
    rows: clone(s.rows),
  });
  return { error: null };
}
