/**
 * series-points-hypotheses-fake-supabase.js - scripts/lib/supabaseClient.js の写し（series-points-hypotheses-run.js が
 * 分析の本 scripts/analysis/series-points-scoring-hypotheses.mjs からの import だけをここへ向ける）。DB・鍵には繋がない。
 * from(表).select(列).gt/order/limit の連なりを、場面の表の行に当て、select の列だけを返す（列を読み忘れると値が無い）。
 */
export const SCENE_KEY = Symbol.for(
  "verify-series-points-hypotheses.fake-db-scene",
);
const scene = () => globalThis[SCENE_KEY] ?? { tables: {}, selects: [] };

const pickColumns = (row, select) =>
  Object.fromEntries(
    select
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => [c, row[c]]),
  );

function query(table, select, rows) {
  const then = (ok, ng) =>
    Promise.resolve({
      data: rows.map((r) => pickColumns(r, select)),
      error: null,
    }).then(ok, ng);
  return {
    gt: (col, v) =>
      query(
        table,
        select,
        rows.filter((r) => String(r[col]) > String(v)),
      ),
    order: (col) =>
      query(
        table,
        select,
        [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col]))),
      ),
    limit: (n) => query(table, select, rows.slice(0, n)),
    then,
  };
}

export const supabase = {
  from(table) {
    return {
      select(select) {
        const s = scene();
        s.selects.push({ table, select });
        return query(table, select, s.tables[table] ?? []);
      },
    };
  },
};
export { VENUE_NAMES } from "../../lib/venueNames.js";
