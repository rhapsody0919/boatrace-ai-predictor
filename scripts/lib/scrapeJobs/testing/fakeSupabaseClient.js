/**
 * テスト用のインメモリの Supabase クライアント（PostgREST の、検証に必要な部分だけ）。DB・取得先に接続しない。
 * 検証スクリプト（scripts/maintenance/verify-*.js）専用。
 *
 * 対応: select / insert / upsert（onConflict・ignoreDuplicates）/ update / delete、
 *   eq・neq・in・like・gte・lt・is・not(is null)、JSON の項目の条件（`last_report->>hash`）、order・range・limit・maybeSingle、
 *   update・delete・upsert の select()（返り値の取得）。
 * rpc(name, args): rpcs に渡した関数を呼ぶ（呼び出しは rpcCalls に記録）。
 * 失敗の注入: failOn に {"テーブル:操作": "エラーメッセージ"} を渡すと、その操作がエラーを返す（操作は select・insert・upsert・
 *   update・delete）。値が関数なら、呼び出しごとに評価し、文字列を返したときだけ失敗にする（一時的な失敗の再現用）。
 */
const clone = (v) => JSON.parse(JSON.stringify(v));

const likeRe = (pattern) =>
  new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
  );

/** "a->>b" のような JSON の項目の条件に対応した、行からの値の取り出し */
const valueOf = (row, column) => {
  const m = /^(\w+)->>(\w+)$/.exec(column);
  if (!m) return row[column];
  const inner = row[m[1]];
  const v = inner === null || inner === undefined ? undefined : inner[m[2]];
  return v === undefined ? null : v;
};

export function createFakeSupabaseClient({
  tables = {},
  failOn = {},
  rpcs = {},
} = {}) {
  const rpcCalls = [];
  const data = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map(clone)]),
  );
  const writes = [];
  const calls = [];

  function from(table) {
    const q = {
      op: "select",
      filters: [],
      orders: [],
      range: null,
      limitN: null,
      single: false,
      returning: false,
      payload: null,
      opts: null,
    };
    const b = {
      select() {
        if (q.op !== "select") q.returning = true;
        return b;
      },
      eq(c, v) {
        q.filters.push((r) => valueOf(r, c) === v);
        return b;
      },
      neq(c, v) {
        q.filters.push((r) => valueOf(r, c) !== v);
        return b;
      },
      in(c, vs) {
        q.filters.push((r) => vs.includes(valueOf(r, c)));
        return b;
      },
      like(c, p) {
        const re = likeRe(p);
        q.filters.push((r) => re.test(String(valueOf(r, c))));
        return b;
      },
      gte(c, v) {
        q.filters.push((r) => valueOf(r, c) >= v);
        return b;
      },
      lt(c, v) {
        q.filters.push((r) => valueOf(r, c) < v);
        return b;
      },
      is(c, v) {
        if (v !== null) throw new Error(`fake: is(${c}, ${v}) は未対応`);
        q.filters.push(
          (r) => valueOf(r, c) === null || valueOf(r, c) === undefined,
        );
        return b;
      },
      not(c, op, v) {
        if (op === "is" && v === null)
          q.filters.push((r) => valueOf(r, c) != null);
        else throw new Error(`fake: not(${c}, ${op}) は未対応`);
        return b;
      },
      // PostgREST の .or("col.is.null,col.lt.X")。条件は is.null・lt・gt・eq・neq のみ（値は文字列の比較）
      or(expr) {
        const conds = String(expr)
          .split(",")
          .map((part) => {
            const [c, op, ...rest] = part.split(".");
            const v = rest.join(".");
            return (r) => {
              const x = valueOf(r, c);
              if (op === "is" && v === "null") return x === null || x === undefined;
              if (op === "lt") return x !== null && x !== undefined && x < v;
              if (op === "gt") return x !== null && x !== undefined && x > v;
              if (op === "eq") return String(x) === v;
              if (op === "neq") return String(x) !== v;
              throw new Error(`fake: or(${part}) は未対応`);
            };
          });
        q.filters.push((r) => conds.some((f) => f(r)));
        return b;
      },
      order(c, { ascending = true } = {}) {
        q.orders.push([c, ascending]);
        return b;
      },
      range(a, z) {
        q.range = [a, z];
        return b;
      },
      limit(n) {
        q.limitN = n;
        return b;
      },
      maybeSingle() {
        q.single = true;
        return b;
      },
      insert(rows) {
        q.op = "insert";
        q.payload = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      upsert(rows, opts) {
        q.op = "upsert";
        q.payload = Array.isArray(rows) ? rows : [rows];
        q.opts = opts ?? {};
        return b;
      },
      update(patch) {
        q.op = "update";
        q.payload = patch;
        return b;
      },
      delete() {
        q.op = "delete";
        return b;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      calls.push({ table, op: q.op });
      const failure = failOn[`${table}:${q.op}`];
      const message = typeof failure === "function" ? failure() : failure;
      if (message) return { data: null, error: { message } };
      const rows = (data[table] ??= []);
      const matched = () => rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === "select") {
        let found = matched();
        for (const [c, asc] of [...q.orders].reverse()) {
          found = [...found].sort(
            (x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1),
          );
        }
        if (q.range) found = found.slice(q.range[0], q.range[1] + 1);
        if (q.limitN !== null) found = found.slice(0, q.limitN);
        const copies = found.map(clone);
        return { data: q.single ? (copies[0] ?? null) : copies, error: null };
      }
      if (q.op === "insert") {
        for (const r of q.payload) rows.push(clone(r));
        writes.push({ table, op: "insert", count: q.payload.length });
        return { data: q.returning ? q.payload.map(clone) : null, error: null };
      }
      if (q.op === "upsert") {
        const keys = String(q.opts.onConflict ?? "")
          .split(",")
          .filter(Boolean);
        const touched = [];
        for (const r of q.payload) {
          const existing = rows.find((e) => keys.every((k) => e[k] === r[k]));
          if (existing) {
            if (!q.opts.ignoreDuplicates) {
              Object.assign(existing, clone(r));
              touched.push(existing);
            }
          } else {
            const created = clone(r);
            rows.push(created);
            touched.push(created);
          }
        }
        writes.push({ table, op: "upsert", count: q.payload.length });
        return { data: q.returning ? touched.map(clone) : null, error: null };
      }
      if (q.op === "delete") {
        const hit = matched();
        data[table] = rows.filter((r) => !hit.includes(r));
        writes.push({ table, op: "delete", count: hit.length });
        return { data: q.returning ? hit.map(clone) : null, error: null };
      }
      // update
      const hit = matched();
      for (const r of hit) Object.assign(r, clone(q.payload));
      writes.push({ table, op: "update", count: hit.length });
      return { data: q.returning ? hit.map(clone) : null, error: null };
    }
    return b;
  }

  /** rpcs に渡した関数（名前 → (args) => 返り値）を呼ぶ。無い関数はエラーを返す */
  async function rpc(name, args) {
    rpcCalls.push({ name, args });
    const fn = rpcs[name];
    if (!fn) return { data: null, error: { message: `fake: rpc ${name} は未定義` } };
    return { data: await fn(args), error: null };
  }

  return {
    from,
    rpc,
    rpcCalls,
    data,
    writes,
    calls,
    writesTo: (table) => writes.filter((w) => w.table === table),
  };
}
