/**
 * 節（race_series、マイグレーション084）の定期取得。共通ラッパ向けハンドラー（api/cron/race-series.js）。
 *
 * race_series は、過去分の一括（monthly-schedule-backfill.js、2019-04〜2026-09）で入れたきりで、定期取得が無く、
 * 2026-10 以降の節が0件だった（節の日目のフォールバック・長期データのグレードの補完が、10月以降に効かない）。
 *
 * 毎日1回、対象日の月（JST）を当月として、前月・当月・翌月の月間スケジュール（3リクエスト）を取得し、
 * 開始日が当月・翌月の節を書く（値の違う行だけ。変わらなければ書き込み0件）。
 *   - 前月のページは、当月の左端に接する節の開始日の確定に使う。翌々月のページは、まだ公開されていない
 *     （2026-10-02 の実測で 202612 は表なし）ため取らない。翌月の右端に接する節は確定できないので、翌月の取得で書く
 *   - 翌月の節は、日程と色分けだけが先に載り、節名のリンクは後から付く（2026-10-02 の実測で 202611 に30件）。
 *     この要確認だけは許し、節名を NULL で書く。節名が載った後の取得で書き直す。毎日取るのはこのため
 *   - それ以外の要確認（未知の色分け・節の範囲の矛盾等）や会場数の違いは、構造の変更とみなして何も書かない（error）
 *
 * mode: shadow は取得・解析のみ（race_series へ書かない）。off は何もしない（共通ラッパ）。
 */
import {
  buildMonthlyScheduleUrl,
  parseMonthlySchedule,
} from "./monthlyScheduleParser.js";
import {
  UNTITLED_SEGMENT_RE,
  planRaceSeriesRows,
  shiftYm,
  writeRaceSeriesRows,
  ymOf,
} from "./raceSeriesSync.js";

/** 月間スケジュールの会場数（全24会場）。違えば構造の変更とみなす */
export const RACE_SERIES_EXPECTED_VENUES = 24;

/**
 * @param {Object} ctx 共通ラッパの文脈（targetDate・mode・politeFetch・client）
 * @param {{expectedVenues?: number, sleepMs?: number}} [options] テスト用の差し替え
 */
export async function runRaceSeriesJob(
  ctx,
  { expectedVenues = RACE_SERIES_EXPECTED_VENUES, sleepMs = 200 } = {},
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const month = ymOf(date);
  const yms = [shiftYm(month, -1), month, shiftYm(month, 1)];

  const pages = [];
  const problems = [];
  let untitled = 0;
  for (const ym of yms) {
    const res = await ctx.politeFetch(buildMonthlyScheduleUrl(ym));
    if (!res.ok) {
      problems.push(`${ym}: HTTP ${res.status}`);
      continue;
    }
    let page;
    try {
      page = parseMonthlySchedule(await res.text(), ym);
    } catch (e) {
      problems.push(`${ym}: ${e.message}`);
      continue;
    }
    if (page.venues.length !== expectedVenues)
      problems.push(
        `${ym}: 会場が${page.venues.length}件（${expectedVenues}件のはず。構造の変更の疑い）`,
      );
    for (const a of page.anomalies) {
      if (UNTITLED_SEGMENT_RE.test(a.problem)) untitled++;
      else problems.push(`${ym} 会場${a.venue_code}: ${a.problem}`);
    }
    pages.push(page);
  }

  const plan =
    problems.length === 0
      ? planRaceSeriesRows(pages, month, shiftYm(month, 1))
      : { rows: [], unresolved: [], anomalies: [] };
  for (const a of plan.anomalies)
    problems.push(`会場${a.venue_code}: ${a.problem}`);
  for (const u of plan.unresolved)
    problems.push(
      `確定できない節: 会場${u.venue_code} ${u.seen_from}〜${u.seen_to}（${u.reason}）`,
    );

  const report = {
    date,
    mode: ctx.mode,
    months: yms,
    series: plan.rows.length,
    untitledSegments: untitled,
    problems: problems.slice(0, 10),
  };
  if (problems.length > 0)
    return {
      outcome: "error",
      error: `月間スケジュールを節にできません（${problems.length}件）: ${problems.slice(0, 3).join(" / ")}`,
      rowsParsed: 0,
      report,
    };
  if (plan.rows.length === 0)
    return {
      outcome: "error",
      error: `当月・翌月（${month}〜${shiftYm(month, 1)}）に始まる節が0件です`,
      rowsParsed: 0,
      report,
    };

  if (ctx.mode === "shadow")
    return { rowsWritten: 0, rowsParsed: plan.rows.length, report };

  const summary = await writeRaceSeriesRows(ctx.client, plan.rows, {
    sleepMs,
  });
  const fullReport = {
    ...report,
    written: summary.written,
    unchanged: summary.unchanged,
  };
  if (summary.failedMonths > 0)
    return {
      outcome: "error",
      error: summary.errors.join(" / "),
      rowsWritten: summary.written,
      rowsParsed: plan.rows.length,
      report: fullReport,
    };
  return {
    rowsWritten: summary.written,
    rowsParsed: plan.rows.length,
    report: fullReport,
    body: {
      months: yms,
      series: plan.rows.length,
      written: summary.written,
      unchanged: summary.unchanged,
      untitledSegments: untitled,
    },
  };
}
