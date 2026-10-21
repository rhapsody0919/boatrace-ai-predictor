/**
 * 定期の job の鍵のカナリア（key-canary.yml、BOA-917）の起動。cron（vercel.json）は UTC `7,37 * * * *`
 * = 30分ごと（JST も同じ。workflow の予備の schedule と同じ時刻）。schedule が新設の日から来なかったための迂回。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='key_canary_dispatch'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（学習の起動と同じ）。
 *
 * maxDuration は、レジストリ（key_canary_dispatch.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createAnalogyDispatchRun } from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "key_canary_dispatch",
  run: createAnalogyDispatchRun("key_canary"),
  modeGated: true,
});
