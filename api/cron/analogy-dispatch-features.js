/**
 * BOA-271 アナロジー・ファインダー: 日次の特徴量（analogy-daily-features.yml）。cron（vercel.json）はUTC: `40 21,0,4 * * *` = 06:40・09:40・13:40 JST（無条件に起動）、`20 22 * * *` = 07:20 JST（拾い直し。今日の対象レースに行の無いものがあるときだけ起動）。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='analogy_dispatch_features'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（fine-grained PAT、Actions: write）。
 *
 * maxDuration は、レジストリ（analogy_dispatch_features.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createAnalogyDispatchRun } from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "analogy_dispatch_features",
  run: createAnalogyDispatchRun("dailyFeatures"),
  modeGated: true,
});
