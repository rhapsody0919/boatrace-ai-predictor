// verify-sitemap-coverage.js の /meet の固定データと getMeetPages の実行（越えの単位を分けるため移した。verify ではない）
// gen は import した generate-sitemap.js（sitemap-generator.js の loadSitemapGenerator）。偽の DB の場面を置いて本物の getMeetPages を回す
import assert from "node:assert/strict";
import { atFixedNow, sitemapScene } from "./sitemap-generator.js";

export const meetSeries = (start, venue = 1, title = "固定の節") => ({
  venue_code: venue,
  start_date: start,
  end_date: "2026-11-05",
  grade: "G1",
  title,
});

export function makeMeetRun(gen) {
  return async (meet, dates, { fail = null, conditions = [] } = {}) => {
    const entries = dates.map((d) => ({
      race_id: `${d}-01-01`,
      boat_number: 1,
    }));
    const tables = {
      race_series: [meet],
      race_entries: entries,
      race_conditions: conditions,
      races: entries.map((r) => ({ ...r, race_grade: "G1" })),
    };
    sitemapScene({
      async fetchAll(table, columns, build) {
        if (table === fail) throw new Error("fixture meet read failed");
        let rows = tables[table];
        assert.ok(rows, `予期しない表: ${table}`);
        const q = {
          in(k, values) {
            rows = rows.filter((r) => values.includes(r[k]));
            return q;
          },
          gte(k, v) {
            rows = rows.filter((r) => r[k] >= v);
            return q;
          },
          lte(k, v) {
            rows = rows.filter((r) => r[k] <= v);
            return q;
          },
          like(k, v) {
            const pattern = new RegExp(`^${v.replaceAll("_", ".")}$`);
            rows = rows.filter((r) => pattern.test(r[k]));
            return q;
          },
          order() {
            return q;
          },
        };
        build(q);
        return rows;
      },
    });
    return atFixedNow(() =>
      gen.getMeetPages({ byVenue: new Map([[1, "2026-10-31"]]) }),
    );
  };
}
