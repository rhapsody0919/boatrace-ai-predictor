/**
 * BOA-822 イン崩れ注意度の監視（tasks 12、plan §9）。cron（vercel.json）は UTC:
 *   `30 19 * * *` = JST 04:30  夜の表（in_caution_gap_band_daily）の鮮度・最初の日・合計の件数
 *   `45 20 * * *` = JST 05:45  今日の unified で inCaution がある割合・出さない理由の内訳・through の遅れ
 * 本体は scripts/lib/inCautionHealth.js（判定は純関数。手元は scripts/maintenance/verify-in-caution-coverage.js）。
 * 問題があれば実行の失敗にし、レジストリの failureAlertAfter: 1 で scrape-monitor が Slack に出す（JST 07:00〜）。
 * モード（scrape_job_state.mode の job='in_caution_health'）が off（または行なし）なら何もしない。
 * 155 の適用と全期間の表を作った後に live にする。
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
  run: (ctx) => runInCautionHealth(ctx),
  modeGated: true,
});
