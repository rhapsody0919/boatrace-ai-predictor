/**
 * アナロジー・ファインダー v16 の展示後の段（BOA-271 tasks T4-3）を作る Vercel Cron。
 * 中身は scripts/lib/analogyV16Exhibition.js。外部サイトへは通信しない（DB と Storage だけ）。
 *
 * モード（scrape_job_state.mode の job='analogy_v16_exhibition'。DB の更新のみで切り替える）:
 *   off（または行なし）  何もしない
 *   shadow              並べ直しの計算だけ（Storage・snapshot へ書かない）
 *   live                書く
 *
 * cron式（vercel.json）は UTC。`*\/2 21-23,0-14 * * *` ＝ JST 6:00〜23:58 の2分ごと。レースが無い時間は対象0件ですぐ終わる。
 * 死活監視（scrape-monitor、常駐型は25分）が JST 7:25〜24:00 に効くので、その帯を覆う（race_status と同じ）
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
