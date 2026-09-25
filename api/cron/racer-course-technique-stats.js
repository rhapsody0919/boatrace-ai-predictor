/**
 * 選手×コース別の決まり手集計（BOA-402）の Vercel Cron。
 *
 * venue_course_technique_baseline（会場×レースグレード×コース）と
 * racer_course_technique_stats（選手×コース）を更新する。「本日のデータ一覧」（/today）の
 * 抽出は、この2表を材料にする。外部サイトへの通信は一切しない。
 * 重い処理は2つのSQL RPC（Postgres側）で、Node側は行のページングと upsert だけ。
 * 実測の実行時間は約27秒。
 *
 * ## なぜ 13:00 JST か（plan.md §2.4）
 *
 * 集計の材料である `race_results.actual_course_1〜6`（進入コース）は Kファイル同期
 * （api/cron/kfile-sync.js、07:00 / 12:00 JST）が書き、Kファイル自体が「開催日の夜〜翌日」
 * 公開のため、**前日ぶんが埋まるのは当日 07:00**。これより前に集計すると window_end が
 * 「前々日」までしか進まない。以前は 01:10 JST に走っており、そのせいで
 * 「本日のデータ一覧」の完全性チェック（window_end の鮮度）が構造上ぜったいに
 * 満たせず、定時実行で一度も生成できていなかった。
 *
 * ## なぜ GitHub Actions から移したか（ADR-0066 §改訂1）
 *
 * ADR-0066 は「取得済みデータのDB内集計は GitHub Actions のまま」としていたが、
 * その理由は「長時間のCPU処理を含むため」で、このジョブには当てはまらない
 * （約27秒、重い処理はPostgres側）。GitHub Actions の定時実行は実測で2.5〜4.5時間
 * 遅れるのが常態で、翌朝 05:30 の「本日のデータ一覧」に間に合う保証が無かった。
 *
 * モード（scrape_job_state.mode の job='racer_course_technique_stats'）:
 *   off（または行なし）  何もしない
 *   shadow              集計のみ（2表へ書かない）
 *   live                書き込む
 *
 * cron式（vercel.json）はUTC。JST換算:
 *   `0 4 * * *`   13:00 JST（kfile_sync の 07:00・12:00 より後）
 *   `0 8 * * *`   17:00 JST（補足。13:00 が失敗・未配信だった場合のみ処理する）
 *
 * 手動実行は CLI で行う:
 *   node scripts/daily/update-racer-course-technique-stats.js [--dry-run]
 *
 * maxDuration は、レジストリ（racer_course_technique_stats.maxDurationSec）と同じ値を
 * リテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runRacerCourseTechniqueStats } from "../../scripts/daily/update-racer-course-technique-stats.js";

export const config = {
  maxDuration: 300,
};

export default createScrapeCronHandler({
  job: "racer_course_technique_stats",
  run: async (ctx) =>
    runRacerCourseTechniqueStats({ dryRun: ctx.mode !== "live" }),
});
