/**
 * BOA-822 イン崩れ注意度の監視のうち、今日の unified（inCaution がある割合・出さない理由の内訳・through の遅れ）。
 * cron（vercel.json）は UTC `45 20 * * *` = JST 05:45（races-init の後始末の後）。中止のレースは分母から除く。
 * 夜の表の確認（api/cron/in-caution-health.js）とジョブを分けている理由は、そちらの冒頭を参照。
 * 本体は scripts/lib/inCautionHealth.js。問題があれば実行の失敗にし、failureAlertAfter: 1 で Slack に出す。
 * モード（scrape_job_state.mode の job='in_caution_today_health'）が off（または行なし）なら何もしない。
 *
 * maxDuration は、レジストリ（in_caution_today_health.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runInCautionHealth } from "../../scripts/lib/inCautionHealth.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "in_caution_today_health",
  run: (ctx) => runInCautionHealth(ctx, "today"),
  modeGated: true,
});
