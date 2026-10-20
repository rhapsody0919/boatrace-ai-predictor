/**
 * E2E の録画の撮り直し（e2e-rerecord.yml、BOA-929）の起動。cron（vercel.json）は UTC:
 * `23 1`・`47 3`・`37 5`・`13 7` = JST 10:23・12:47・14:37・16:13（workflow の予備の schedule と同じ時刻）。
 * GitHub の schedule が来ない日が続いた（10/02 の録画のまま18日）ための迂回。inputs.gate=true で起動し、
 * workflow 側が「その日に採用済み・JST19時以降なら撮らない」を判定する。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='e2e_rerecord_dispatch'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（学習の起動と同じ）。
 *
 * maxDuration は、レジストリ（e2e_rerecord_dispatch.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createAnalogyDispatchRun } from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "e2e_rerecord_dispatch",
  run: createAnalogyDispatchRun("e2e_rerecord"),
  modeGated: true,
});
