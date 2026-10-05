/**
 * アナロジー・ファインダー v16 の展示後の段（BOA-271 tasks T4-3）を作る Vercel Cron。
 * 中身は scripts/lib/analogyV16Exhibition.js。外部サイトへは通信しない（DB と Storage だけ）。
 *
 * モード（scrape_job_state.mode の job='analogy_v16_exhibition'。DB の更新のみで切り替える）:
 *   off（または行なし）  何もしない
 *   shadow              並べ直しの計算だけ（Storage・snapshot へ書かない）
 *   live                書く
 *
 * cron式（vercel.json）は UTC。`*\/2 23,0-12 * * *` ＝ JST 8:00〜21:58 の2分ごと（最終レースの締切は 21 時前後）
 *
 * maxDuration は、レジストリ（analogy_v16_exhibition.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runAnalogyV16Exhibition } from "../../scripts/lib/analogyV16Exhibition.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "analogy_v16_exhibition",
  run: runAnalogyV16Exhibition,
});
