/**
 * 会場公式サイトのモーター成績（節数・出走回数・優出回数・優勝回数等）を
 * 日次で取得し、venue_motor_stats テーブルに保存する（BOA-264）。
 *
 * 対象は全24会場中20会場（戸田・平和島は該当データ自体が存在しないため対象外。
 * 浜名湖・宮島は会場サイトの利用規約に著作権条項があるため対象外。ADR-0067、BOA-681）。
 * 会場ごとにテンプレートが異なるため、venueConfig.jsのparser指定に従って
 * scripts/lib/venueMotorStats/parsers/ 配下の対応パーサーを呼び分ける。
 *
 * 実行時間: 会場数分のHTTPリクエスト（20件）。各会場は
 * 完全に別ドメインのため会場間の待機は不要（同一ドメインへの連続アクセスでは
 * ないため、他会場のレート制限に配慮する理由がない）。
 * 本ファイルの run() は GitHub Actions（逐次）用。Vercel の日次ジョブは、同じ取得・解析・行の組み立て
 * （createParsers・scrapeVenueMotorStats・toMotorStatsRow・writeMotorStatsRows）を
 * scripts/lib/venueMotorStatsJob.js から、同時取得・politeFetch・履歴をlast_reportへ、の形で使う。
 */
// 取得・行の組み立て・書き込みの本体は scripts/lib/venueMotorStats/scrape.js（ハンドラー venueMotorStatsJob.js も読む。ここは CLI の run と再 export）
import fs from "node:fs";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTodayDateJST } from "../lib/dateUtils.js";
import {
  VENUE_MOTOR_STATS_CONFIG,
  EXCLUDED_VENUES,
} from "../lib/venueMotorStats/venueConfig.js";
import { updateVenueHealth } from "../lib/venueMotorStats/driftHealth.js";
import {
  scrapeVenueMotorStats,
  toMotorStatsRow,
  writeMotorStatsRows,
} from "../lib/venueMotorStats/scrape.js";

const HEALTH_FILE_PATH = new URL(
  "../../data/analysis/venue-motor-stats-health.json",
  import.meta.url,
);

function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function run() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    return { updated: false, count: 0 };
  }

  const scrapedDate = getTodayDateJST();
  console.log(`🚗 会場別モーター成績スクレイピング開始 (${scrapedDate})`);
  console.log(`📭 対象外: ${Object.values(EXCLUDED_VENUES).join(" / ")}`);

  const allRows = [];
  let successCount = 0;
  const health = loadHealth();

  for (let i = 0; i < VENUE_MOTOR_STATS_CONFIG.length; i++) {
    const venue = VENUE_MOTOR_STATS_CONFIG[i];
    const { data, reason } = await scrapeVenueMotorStats(venue);
    health[venue.venueCode] = updateVenueHealth(health[venue.venueCode], {
      success: !!data,
      reason: data ? null : reason,
      date: scrapedDate,
    });
    if (!data) {
      console.log(`  ⚠️ ${venue.name}: データなし (${reason})`);
    } else {
      for (const m of data) allRows.push(toMotorStatsRow(venue, m, scrapedDate));
      console.log(`  ✅ ${venue.name}: ${data.length}件`);
      successCount++;
    }
  }

  // 会場ごとの成否履歴（構造変化の検知の入力）は、DB の書き込みが失敗して例外になっても残すため、先に書く（BOA-391）
  fs.mkdirSync(new URL(".", HEALTH_FILE_PATH), { recursive: true });
  fs.writeFileSync(HEALTH_FILE_PATH, JSON.stringify(health, null, 2) + "\n");

  if (allRows.length > 0) {
    console.log(`\n💾 venue_motor_stats: ${allRows.length}件書き込み中...`);
    await writeMotorStatsRows(supabase, allRows);
  }

  console.log(
    `📊 完了: ${successCount}/${VENUE_MOTOR_STATS_CONFIG.length}会場成功、${allRows.length}件保存`,
  );
  return { updated: allRows.length > 0, count: allRows.length };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}

export {
  createParsers,
  scrapeVenueMotorStats,
  toMotorStatsRow,
  writeMotorStatsRows,
} from "../lib/venueMotorStats/scrape.js";
