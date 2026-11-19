/**
 * サービス層（src/services）を偽の supabase クライアントの上で呼ぶ verify の共通の部品（BOA-1675）。verify ではない。
 *
 * 使い方（verify 側）:
 *   import { registerFakeServiceSupabase, createFakeSupabase, setFakeSupabase, installLocalStorage }
 *     from "./verifyData/fakeServiceSupabase.js";
 *   registerFakeServiceSupabase();           // サービス層を import する前に1回
 *   installLocalStorage();                   // サービス層のキャッシュは localStorage にも書く（Node には無い）
 *   const fake = setFakeSupabase(createFakeSupabase(tables, { scramble: true }));
 *   const { getXxx } = await import("../../src/services/xxxQueries.js");
 *
 * 記録（fake.calls）の 1 件: { table, select, filters: [[op, col, val]], orders: [col], desc: Set, range, limit, single }
 * 偽が扱う絞り: eq・neq・gt・gte・lt・lte・in・like・is。それ以外は throw する。
 * rpc(name, args): opts.rpcs[name](args) の返す行を order・range（・maxRows）で切って返す。記録は fake.rpcCalls の
 *   { name, args, orders, range }。opts.rpcs に無い名前は、関数の無い本番と同じ PGRST202 の例外にする。
 */
import { register } from "node:module";

const HOLDER_KEY = "__fakeServiceSupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${HOLDER_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;

let current = null;

/**
 * src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので renderJsx の module hooks で読み、
 * その上に supabaseClient.js を偽へ差し替える hook を重ねる。サービス層を import する前に呼ぶ
 */
export function registerFakeServiceSupabase() {
  register(new URL("../../lib/renderJsx.js", import.meta.url));
  register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);
  globalThis[HOLDER_KEY] = {
    from: (table) => {
      if (!current)
        throw new Error("setFakeSupabase(fake) を先に呼ぶこと（偽が未設定）");
      return current.from(table);
    },
    rpc: (name, args) => {
      if (!current)
        throw new Error("setFakeSupabase(fake) を先に呼ぶこと（偽が未設定）");
      return current.rpc(name, args);
    },
  };
}

/** 差し替え先の偽を設定する（何度でも替えられる。サービス層の supabase は import の時点で固定のため、中継を通す） */
export function setFakeSupabase(fake) {
  current = fake;
  return fake;
}

/**
 * localStorage の代わりを置く。inspectable なら中身を見られる物（Object のキーが保存の中身）、
 * でなければ何も残さない物。既に有れば inspectable のときだけ置き換える
 */
export function installLocalStorage({ inspectable = false } = {}) {
  if (!inspectable) {
    globalThis.localStorage ??= {
      getItem: () => null,
      setItem() {},
      removeItem() {},
      key: () => null,
      length: 0,
    };
    return globalThis.localStorage;
  }
  const store = {};
  Object.defineProperties(store, {
    getItem: { value: (k) => (k in store ? store[k] : null) },
    setItem: { value: (k, v) => void (store[k] = String(v)) },
    removeItem: { value: (k) => void delete store[k] },
    key: { value: (i) => Object.keys(store)[i] ?? null },
    length: { get: () => Object.keys(store).length },
  });
  globalThis.localStorage = store;
  return store;
}

// "a.b" は入れ子の行（races!inner の結合）の値
const at = (row, col) => col.split(".").reduce((v, k) => v?.[k], row);
const likeToRe = (pat) =>
  new RegExp(
    `^${pat
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".")}$`,
  );
const MATCHERS = {
  eq: (v, val) => v === val,
  neq: (v, val) => v !== val,
  gt: (v, val) => v > val,
  gte: (v, val) => v >= val,
  lt: (v, val) => v < val,
  lte: (v, val) => v <= val,
  in: (v, val) => val.includes(v),
  like: (v, val) => likeToRe(val).test(v),
  is: (v, val) => v === val || (val === null && v == null),
};
const matches = (row, [op, col, val]) => {
  const matcher = MATCHERS[op];
  if (!matcher) throw new Error(`偽のクライアントに無い絞り: ${op}`);
  return matcher(at(row, col), val);
};

// 並びの決まらない行の順を問い合わせごとに変える（実 DB は同じ並びを約束しない。ページ境界で欠落・重複が出る）
const scrambleOf = (salt) => (row) =>
  [...JSON.stringify(row)].reduce(
    (h, c) => (h * 31 + c.charCodeAt(0) + salt) | 0,
    salt,
  );

function sortRows(rows, q, { scramble, salt, sortByOrder }) {
  const tie = scramble ? scrambleOf(salt) : () => 0;
  const cols = sortByOrder ? q.orders : [];
  if (cols.length === 0 && !scramble) return rows;
  return [...rows].sort((a, b) => {
    for (const col of cols) {
      const [x, y] = [at(a, col), at(b, col)];
      if (x !== y) return (x < y ? -1 : 1) * (q.desc.has(col) ? -1 : 1);
    }
    return tie(a) - tie(b);
  });
}

// 返す列は select で頼んだ列だけ（"*" は全列。頼んでいない列を読む本体は、実 DB では値が無い）
const projectRow = (row, select) => {
  if (select === null || select.trim() === "*") return { ...row };
  const cols = select.split(",").map((c) => c.trim());
  return Object.fromEntries(
    cols.filter((c) => c in row).map((c) => [c, row[c]]),
  );
};

// 失敗の値: Error ならそのまま reject（呼び側が同一性を見られる）。それ以外は項目を足した Error にする
const failureOf = (table, value) =>
  value instanceof Error
    ? value
    : Object.assign(new Error(`fake failure: ${table}`), value);

/**
 * 偽の supabase クライアント（メモリ上の表）。select・eq・neq・gt・gte・lt・lte・in・like・is・order（ascending）・
 * limit・range・single・maybeSingle と await を扱い、呼ばれた問い合わせを calls に残す。
 * @param {Record<string, object[]>} tables 表名 → 行
 * @param {object} [opts]
 * @param {Map<string, unknown>} [opts.failTables] 表 → 失敗の値。有れば await が例外になる（実クライアントの throwOnError と同じ）
 * @param {boolean} [opts.scramble] order で決まらない行の並びを問い合わせごとに変える
 * @param {boolean} [opts.project] select で頼んだ列だけ返す
 * @param {number|null} [opts.maxRows] 1回の返す行の上限（PostgREST は 1000）。range が無ければ先頭から
 * @param {boolean} [opts.sortByOrder] order で並べ替える（既定 true。false なら記録だけで表の順で返す）
 * @param {Record<string, (args: object) => object[]>} [opts.rpcs] RPC の名前 → 行を返す関数（投げれば呼び出しが例外になる）
 * 戻り値: { calls, rpcCalls, tables, failTables, from, rpc, reset(tables, fails), queriesOn(table), fail(table, value) }
 */
export function createFakeSupabase(tables = {}, opts = {}) {
  const {
    failTables = new Map(),
    scramble = false,
    project = false,
    maxRows = null,
    sortByOrder = true,
    rpcs = {},
  } = opts;
  const calls = [];
  const rpcCalls = [];
  const fake = {
    calls,
    rpcCalls,
    rpc(name, args) {
      const q = { ...newQuery(null), name, args };
      rpcCalls.push(q);
      const run = async () => {
        if (!rpcs[name])
          throw Object.assign(
            new Error(
              `Could not find the function public.${name} in the schema cache`,
            ),
            { code: "PGRST202" },
          );
        const rows = await rpcs[name](args);
        const sorted = sortRows(rows, q, {
          scramble,
          salt: rpcCalls.length,
          sortByOrder,
        });
        return { data: pageOf(sorted, q, maxRows), error: null };
      };
      return buildChain(q, run);
    },
    tables,
    failTables,
    reset(newTables, fails = {}) {
      fake.tables = newTables;
      failTables.clear();
      for (const [t, v] of Object.entries(fails)) failTables.set(t, v);
      calls.length = 0;
    },
    fail: (table, value = {}) => failTables.set(table, value),
    queriesOn: (table) => calls.filter((c) => c.table === table),
    from(table) {
      const q = newQuery(table);
      calls.push(q);
      const salt = calls.length;
      const run = () => {
        if (failTables.has(table))
          return Promise.reject(failureOf(table, failTables.get(table)));
        const found = (fake.tables[table] ?? []).filter((row) =>
          q.filters.every((f) => matches(row, f)),
        );
        const sorted = sortRows(found, q, { scramble, salt, sortByOrder });
        const out = pageOf(sorted, q, maxRows).map((r) =>
          projectRow(r, project ? q.select : null),
        );
        return Promise.resolve({
          data: q.single ? (out[0] ?? null) : out,
          error: null,
        });
      };
      return buildChain(q, run);
    },
  };
  return fake;
}

const newQuery = (table) => ({
  table,
  select: null,
  filters: [],
  orders: [],
  desc: new Set(),
  range: null,
  limit: null,
  single: false,
});

// range → limit の順に切る。maxRows が有れば range の幅が広くても 1 回の返す行数で切る
function pageOf(rows, q, maxRows) {
  let page = rows;
  if (q.range) {
    const [a, b] = q.range;
    const end = maxRows === null ? b + 1 : Math.min(b + 1, a + maxRows);
    page = rows.slice(a, end);
  } else if (maxRows !== null) page = rows.slice(0, maxRows);
  return q.limit === null ? page : page.slice(0, q.limit);
}

function buildChain(q, run) {
  const filter = (op) => (col, val) => (q.filters.push([op, col, val]), chain);
  const chain = {
    select: (cols) => ((q.select = cols), chain),
    ...Object.fromEntries(Object.keys(MATCHERS).map((op) => [op, filter(op)])),
    order: (col, { ascending = true } = {}) => (
      q.orders.push(col),
      ascending || q.desc.add(col),
      chain
    ),
    limit: (n) => ((q.limit = n), chain),
    range: (a, b) => ((q.range = [a, b]), chain),
    single: () => ((q.single = true), chain),
    maybeSingle: () => ((q.single = true), chain),
    then: (res, rej) => run().then(res, rej),
  };
  return chain;
}
