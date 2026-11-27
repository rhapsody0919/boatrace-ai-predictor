/**
 * facts の表の main 層（race_facts・run_facts の era='main'、ADR-0113）を本体の表から組み立て直す Vercel Cron。
 * 設計: docs/design/past-data-backfill/plan.md §3。実装: scripts/lib/raceFactsMainJob.js
 * 外部サイトへの通信は無い（DB の中の組み立て。ADR-0066 改訂1）。
 *
 * モード（scrape_job_state.mode の job='race_facts_main'）:
 *   off（または行なし）  何もしない（最初の起動で off の行ができる。live にするのはオーナー）
 *   shadow              組み立てて、書く予定の数だけを出す（書かない）
 *   live                書く
 *
 * cron式（vercel.json に人が足す）はUTC。JST換算:
 *   `*\/30 * * * *`  30分ごと（毎回 前日と当日、JST 01〜05時は加えて古い半月を1つ）
 *
 * maxDuration は、レジストリ（race_facts_main.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { mainJobDeps, runRaceFactsMainJob } from "../../scripts/lib/raceFactsMainJob.js";

export const config = {
  maxDuration: 300,
};

const jst = (d) => new Date(d.getTime() + 9 * 60 * 60 * 1000);

export default createScrapeCronHandler({
  job: "race_facts_main",
  run: async (ctx) => {
    const now = jst(ctx.now());
    const res = await runRaceFactsMainJob({
      today: now.toISOString().slice(0, 10),
      hourJst: now.getUTCHours(),
      cursor: ctx.state?.cursor ?? null,
      ...mainJobDeps(ctx.client, { dryRun: ctx.mode !== "live" }),
    });
    return { rowsWritten: res.totals.written, rowsParsed: res.totals.runs, report: { ...res.totals, windows: res.windows }, cursor: res.nextCursor };
  },
});
