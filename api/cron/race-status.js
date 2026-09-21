/**
 * 中止・順延の早期確定（Vercel Function版、race_status）
 *
 * 開催場一覧（race/index）の告知を手がかりに、日全体または途中からの中止・順延のレースを、発走を待たずに
 * races.cancellation_status='confirmed' にする。ロジックは scripts/lib/raceStatusJob.js。
 * 設計: docs/design/scraping-vercel-consolidation/postponed-day-early-detection.md
 *
 * 起動元: Vercel Cron（vercel.json の crons、10分間隔。UTCの21〜23時・0〜14時台＝JST 06:00〜23:59）。
 *
 * 認証: Authorization: Bearer {CRON_SECRET} ヘッダーが一致しない限り拒否する（ラッパ）。
 * mode: scrape_job_state（job='race_status'）の mode を毎回DBから読む。off（または行なし）は何もしない。
 *   shadow は取得・解析のみ（races へ書かず、確定するはずのレースを report に残す）。live で書き込む。
 *   切り替えはDBの更新のみ（再デプロイ不要）。
 *
 * maxDuration は registry.js の race_status.maxDurationSec と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRaceStatusJob } from "../../scripts/lib/raceStatusJob.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "race_status",
  run: runRaceStatusJob,
});
