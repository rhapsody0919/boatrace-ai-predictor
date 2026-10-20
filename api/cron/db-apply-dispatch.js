/**
 * ADR-0097 db-apply の定期の突き合わせ（db-apply.yml の mode=reconcile）の起動。cron（vercel.json）は UTC: `17 * * * *` = JST も毎時17分。
 * GitHub の schedule は高頻度だとほとんど来ないため（docs/design/db-apply-automation-finish/plan.md §1）、こちらを主にし、
 * db-apply.yml の schedule（毎時47分）は予備に残す。
 * 起動の本体は scripts/lib/dbApplyDispatch.js（直近3時間に reconcile の job が成功していなければ失敗を返す見張りつき）。
 * モード（scrape_job_state.mode の job='db_apply_dispatch'）が off（または行なし）なら何もしない。shadow は起動せず、
 * 起動するはずだったかだけを返す。live で起動する。GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（学習の起動と同じ）。
 *
 * maxDuration は、レジストリ（db_apply_dispatch.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createDbApplyDispatchRun } from "../../scripts/lib/dbApplyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "db_apply_dispatch",
  run: createDbApplyDispatchRun(),
  modeGated: true,
});
