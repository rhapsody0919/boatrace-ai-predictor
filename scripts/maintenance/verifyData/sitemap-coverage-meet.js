// verify-sitemap-coverage.js の /meet の固定データと getMeetPages の実行（越えの単位を分けるため移した。verify ではない）
// fn（generate-sitemap.js から切り出した getMeetPages の字）・model・languages は verify の側の物を受け取る
import assert from "node:assert/strict";
import vm from "node:vm";

export const meetSeries = (start, venue = 1, title = "固定の節") => ({
  venue_code: venue,
  start_date: start,
  end_date: "2026-11-05",
  grade: "G1",
  title,
});

export function makeMeetRun({ fn, model, languages }) {
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
    const client = {
      supabase: {},
      isSupabaseEnabled: () => true,
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
    };
    const code = fn
      .replace(/await import\("\.\/lib\/supabaseClient\.js"\)/g, "client")
      .replace(
        /await import\("\.\.\/src\/utils\/meetPageModel\.js"\)/g,
        "model",
      );
    class FixedDate extends Date {
      static now() {
        return Date.parse("2026-10-30T15:30:00Z");
      }
    }
    return vm.runInNewContext(
      `(async () => { ${code}; return getMeetPages(latest); })()`,
      {
        client,
        model,
        ...languages,
        Date: FixedDate,
        console,
        MEET_PAGE_DATA_FROM: "2025-12-02",
        latest: { byVenue: new Map([[1, "2026-10-31"]]) },
      },
    );
  };
}
