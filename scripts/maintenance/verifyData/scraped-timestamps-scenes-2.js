/**
 * verify-scraped-timestamps.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-scraped-timestamps.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let check, runReport;

async function scene1() {
  {
    const timingColumns = [
      "exhibition_data",
      "race_entries",
      "race_start_timings",
    ].flatMap((table_name) =>
      ["created_at", "updated_at"].map((column_name) => ({
        table_name,
        column_name,
        data_type: "timestamp with time zone",
      })),
    );
    const exhibitionRowResult = {
      races_in_period: "1000",
      races_with_rows: "990",
      races_with_created_at: "200",
      saved_after_start: "3",
      lead_min_p10: "8.4",
      lead_min_p50: "17.26",
      lead_min_p90: "26.0",
      hit_60: "5",
      hit_30: "20",
      hit_15: "120",
      hit_10: "196",
      races_with_value_filled: "198",
      filled_lead_min_p10: "7.0",
      filled_lead_min_p50: "15.0",
      filled_lead_min_p90: "24.0",
    };
    const { markdown, json, sqlLog } = await runReport({
      timingColumns,
      scrapedRows: {
        exhibition_data: exhibitionRowResult,
        race_entries: {
          races_in_period: "1000",
          races_with_rows: "990",
          races_with_created_at: "200",
          saved_after_start: "0",
          lead_min_p10: "55",
          lead_min_p50: "60",
          lead_min_p90: "63",
          hit_60: "150",
        },
        race_start_timings: {
          races_in_period: "1000",
          races_with_rows: "900",
          races_with_created_at: "150",
          saved_after_start: "150",
          lead_min_p10: "-70",
          lead_min_p50: "-30",
          lead_min_p90: "-15",
        },
      },
    });
    const exhibition = json.scrapedTimestamps.tables.find(
      (t) => t.table === "exhibition_data",
    );
    check(
      "data-health-report: 適用後は、分布(p10/p50/p90)と発走m分前までの累積割合を、非NULLのレースを分母に出す",
      sqlLog.filter((q) => q.includes("first_created_at")).length === 3 &&
        exhibition.leadMinutes.p50 === 17.3 &&
        exhibition.savedBy
          .map((w) => `${w.minutesBefore}:${w.hit}/${w.denominator}`)
          .join() === "60:5/200,30:20/200,15:120/200,10:196/200" &&
        markdown.includes("10分前: 98.0% (196/200)") &&
        markdown.includes("8.4 / 17.3 / 26") &&
        markdown.includes("値が揃った時刻"),
      JSON.stringify(exhibition),
    );
    check(
      "data-health-report: 適用後の3テーブルは、タイミング計測不能のアラートに出ない",
      !json.alerts.some(
        (a) =>
          a.kind === "timing_unmeasurable" &&
          /exhibition_data|race_entries|race_start_timings/.test(a.item),
      ),
      JSON.stringify(
        json.alerts
          .filter((a) => a.kind === "timing_unmeasurable")
          .map((a) => a.item),
      ),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・runReport） */
export async function runScrapedTimestampsScenes3(env) {
  ({ check, runReport } = env);
  await scene1();
}
