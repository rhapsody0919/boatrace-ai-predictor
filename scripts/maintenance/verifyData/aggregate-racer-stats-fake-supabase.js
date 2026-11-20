/**
 * aggregate-racer-stats-fake-supabase.js - scripts/lib/supabaseClient.js の写し（aggregate-racer-stats-fake-db.js が
 * 製品2本からの import をここへ向ける）。from(表).メソッド(…)… の連なりを記録し、await で場面の表の行を返す。
 * upsert は書きとして記録し、DB には繋がない。fetchAll は本物と同じページング（1000行ずつ range）を偽の client で回す
 * （本物を import すると鍵の無い環境の案内が verify の出力に混ざるため、ここに同じ形で持つ）。
 */

export const SCENE_KEY = Symbol.for("verify-aggregate-racer-stats.fake-db-scene");
const scene = () => globalThis[SCENE_KEY] ?? { tables: {}, fail: new Set(), queries: [], writes: [] };

/** 列の値。"json列->>鍵" は JSON の中の値を字で返す（PostgREST と同じ） */
function valueOf(row, column) {
  if (!column.includes("->>")) return row[column];
  const [col, key] = column.split("->>");
  const v = row[col]?.[key];
  return v == null ? null : String(v);
}

/** PostgREST の絞りのうち、集計 CLI が使う物だけを行に当てる */
function applyFilter(rows, method, args) {
  const [k, a, b] = args;
  switch (method) {
    case "eq":
      return rows.filter((r) => valueOf(r, k) === a);
    case "neq":
      return rows.filter((r) => valueOf(r, k) !== a);
    case "in":
      return rows.filter((r) => a.includes(valueOf(r, k)));
    case "gte":
      return rows.filter((r) => valueOf(r, k) >= a);
    case "lte":
      return rows.filter((r) => valueOf(r, k) <= a);
    case "gt":
      return rows.filter((r) => valueOf(r, k) > a);
    case "lt":
      return rows.filter((r) => valueOf(r, k) < a);
    case "not":
      return a === "is" && b === null ? rows.filter((r) => valueOf(r, k) != null) : rows;
    case "range":
      return rows.slice(k, a + 1);
    default:
      return rows; // select・order・limit は行を変えない
  }
}

function chain(table, rows, write) {
  const s = scene();
  const q = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          return (ok, ng) => {
            const out = s.fail.has(table)
              ? { data: null, error: { message: `fake ${table} read failed`, code: "FAKE" } }
              : { data: write ?? rows, error: null };
            return Promise.resolve(out).then(ok, ng);
          };
        }
        if (typeof prop === "symbol" || prop === "catch" || prop === "finally") return undefined;
        return (...args) => {
          s.queries.push({ table, method: prop, args });
          if (prop === "upsert") {
            s.writes.push({ table, rows: args[0], options: args[1] });
            return chain(table, rows, args[0]);
          }
          return chain(table, applyFilter(rows, prop, args), write);
        };
      },
    },
  );
  return q;
}

export const supabase = {
  from(table) {
    const s = scene();
    s.queries.push({ table, method: "from", args: [] });
    return chain(table, s.tables[table] ?? [], null);
  },
  async rpc(name, args) {
    scene().queries.push({ table: null, method: "rpc", args: [name, args] });
    return { data: null, error: null };
  },
};
export const isSupabaseEnabled = () => true;
export async function fetchAll(table, select, buildQuery, { throwOnError = true } = {}) {
  const allData = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (buildQuery) q = buildQuery(q);
    const { data, error } = await q;
    if (error) {
      if (throwOnError) throw new Error(`${table}取得エラー: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}
export { VENUE_NAMES } from "../../lib/venueNames.js";
export const VENUE_CODES = {};
