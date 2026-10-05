/**
 * BOA-271 アナロジー・ファインダー v16 の朝のバッチ（analogy-v16-morning.yml）の起動（tasks T2-5b）。
 * cron（vercel.json）は UTC: `10 22 * * *`＝7:10 JST、`40 22 * * *`＝7:40 JST（出走表の段が無いレースがあるときだけ）、
 * `40 0 * * *`＝9:40 JST、`40 4 * * *`＝13:40 JST。7:10 は K ファイルの同期（7:00）の後。
 * 起動の本体は scripts/lib/analogyDispatch.js。モード（scrape_job_state.mode の job='analogy_dispatch_morning'）が
 * off（または行なし）なら何もしない。shadow は起動せず、起動するはずだったかだけを返す。live で起動する。
 * GitHub のトークンは Vercel の環境変数 GITHUB_ACTIONS_DISPATCH_TOKEN（学習の起動と同じ）。
 *
 * maxDuration は、レジストリ（analogy_dispatch_morning.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  createAnalogyDispatchRun,
  morningShouldDispatch,
} from "../../scripts/lib/analogyDispatch.js";

export const config = {
  maxDuration: 60,
};

export default createScrapeCronHandler({
  job: "analogy_dispatch_morning",
  run: createAnalogyDispatchRun("v16_morning", {
    shouldDispatch: morningShouldDispatch,
  }),
  modeGated: true,
});
