/**
 * BOA-822 イン崩れ注意度の監視のうち、夜の表（in_caution_gap_band_daily）の鮮度・最初の日・合計の件数（tasks 12、plan §9）。
 * cron（vercel.json）は UTC `30 19 * * *` = JST 04:30（夜のジョブ JST 2:30 の後、races-init 05:00 の前）。
 * 今日の unified の確認は別のジョブ（api/cron/in-caution-today-health.js）。同じジョブに載せると、05:45 の成功が
 * 04:30 の失敗の記録を消し、scrape-monitor（JST 07:00〜）に届かない。
 * 本体は scripts/lib/inCautionHealth.js。問題があれば実行の失敗にし、failureAlertAfter: 1 で Slack に出す。
 * モード（scrape_job_state.mode の job='in_caution_health'）が off（または行なし）なら何もしない。
 *
 * maxDuration は、レジストリ（in_caution_health.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runInCautionHealth } from "../../scripts/lib/inCautionHealth.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "in_caution_health",
  run: (ctx) => runInCautionHealth(ctx, "table"),
  modeGated: true,
});
