/**
 * BOA-822 イン崩れ注意度の夜の表（in-caution-nightly.yml、ADR-0095）の起動。cron（vercel.json）は UTC: `30 17 * * *` = JST 2:30。
 * 前日の結果の確定（最終レース 21時頃＋訂正）より後、races-init（05:00〜）より前。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='in_caution_dispatch'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（学習の起動と同じ）。
 *
 * maxDuration は、レジストリ（in_caution_dispatch.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createAnalogyDispatchRun } from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "in_caution_dispatch",
  run: createAnalogyDispatchRun("in_caution_nightly"),
  modeGated: true,
});
