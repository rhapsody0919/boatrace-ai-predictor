/**
 * BOA-271 アナロジー・ファインダー: 週次の学習（train-analogy.yml）。cron（vercel.json）はUTC: `0 19 * * 6` = 日曜 04:00 JST。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='analogy_dispatch_train'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（fine-grained PAT、Actions: write）。
 *
 * maxDuration は、レジストリ（analogy_dispatch_train.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { createAnalogyDispatchRun } from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "analogy_dispatch_train",
  run: createAnalogyDispatchRun("train"),
  modeGated: true,
});
