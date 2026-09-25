/**
 * 「本日のデータ一覧」（BOA-402、/today）の抽出結果を書き込む Vercel Cron。
 *
 * ページもSNS下書き生成も morning_digest_days / morning_digest_rows の2表だけを読む（ADR-0070）。
 * 外部サイトへの通信は一切しない。重い処理はSQL側で、実測の実行時間は約5秒。
 *
 * ## なぜ GitHub Actions から移したか（ADR-0066 §改訂1）
 *
 * ADR-0066 は「取得済みデータのDB内集計は GitHub Actions のまま」としていたが、その理由は
 * 「長時間のCPU処理を含むため」で、このジョブには当てはまらない（約5秒、重い処理はPostgres側）。
 * 一方で **GitHub Actions の定時実行は実測で2.5〜4.5時間遅れるのが常態**で、
 * JST 05:30 を狙っても実際の公開は 08:00〜12:30 になっていた（plan.md §2.4）。
 * 朝に出ることがこのページの価値の中心なので、定刻性のある Vercel Cron へ移した。
 *
 * ## 完全性チェックと再試行
 *
 * 当日の出走表が揃っていない等で完全性チェックを満たさない場合、ジョブは **書き込まずに
 * `incomplete` を返す**。共通ラッパは対象日を処理済みにしないため、補足のスロットが
 * 同じ対象日をもう一度処理する。
 *
 * モード（scrape_job_state.mode の job='morning_digest'。DBの更新のみで切り替える。再デプロイ不要）:
 *   off（または行なし）  何もしない
 *   shadow              集計のみ（morning_digest_* へ書かない）
 *   live                書き込む
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `30 20 * * *`  05:30 JST（races-init が 05:00 開始・約15分で終わるため、その直後）
 *   `30 21 * * *`  06:30 JST（補足。1回目が incomplete だった場合のみ処理する）
 *   `0 23 * * *`   08:00 JST（補足。最後の砦）
 *
 * 手動実行・バックフィルは CLI で行う:
 *   node scripts/daily/generate-morning-digest.js --date=2026-09-25
 *
 * maxDuration は、レジストリ（morning_digest.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runMorningDigest } from "../../scripts/daily/generate-morning-digest.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "morning_digest",
  run: async (ctx) =>
    runMorningDigest({
      date: ctx.targetDate,
      dryRun: ctx.mode !== "live",
    }),
});
