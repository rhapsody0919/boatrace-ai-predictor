/**
 * 本番のデプロイをまとめて出す（ADR-0106、scripts/lib/releaseDispatch.js）。cron（vercel.json）は UTC `45 2,8,20 * * *`
 * = JST 11:45・17:45・05:45。今の本番の版と master の先を比べ、サイトに関わる差分があり master の検査が通っていれば
 * Deploy Hook（Vercel の環境変数 RELEASE_DEPLOY_HOOK_URL）を叩く。
 * モード（scrape_job_state.mode の job='release_dispatch'）が off（または行なし）なら何もしない。shadow は叩かず、
 * 叩くはずだったかだけを返す。live で叩く。
 *
 * maxDuration は、レジストリ（release_dispatch.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createReleaseDispatchRun } from "../../scripts/lib/releaseDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "release_dispatch",
  run: createReleaseDispatchRun(),
  modeGated: true,
});
