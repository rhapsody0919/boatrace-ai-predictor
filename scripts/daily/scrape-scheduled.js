/**
 * スクレイピングオーケストレーター
 *
 * 発走時刻ベースで必要な処理のみを実行する。
 * cron-job.org から scrape-scheduled.yml 経由で5分毎に呼ばれる。
 * morning-init.js（races テーブルの初期化）が先行ステップとして完了していることを前提とする。
 *
 * 設計方針:
 * 1. getRaceSchedule() を1回だけ呼ぶ（5スクリプト個別呼び出しを廃止）
 * 2. 全ウィンドウに対象レースがなければ即終了（追加 DB 呼び出しゼロ）
 * 3. データが更新された場合のみ generate-predictions を実行
 * 4. 予測が更新された場合のみ Vercel Deploy Hook をトリガー
 * 5. 各サブスクリプトの失敗は後続処理をブロックしない（try-catch でフォールバック）
 */

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  getRaceSchedule,
  getRacesInWindow,
  getRacesAfterStart,
} from "../lib/raceSchedule.js";

import { run as runOdds, ODDS_WINDOWS } from "./scrape-odds.js";
import { run as runUpdateInfo } from "./update-race-info.js";
import { run as runExhibition } from "./scrape-exhibition-data.js";
import { run as runResults } from "./scrape-results.js";
import { mainRefresh } from "./generate-predictions.js";

async function main() {
  console.log("🎯 スクレイピングオーケストレーター開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  // 1. スケジュール取得（全スクリプト共通、1回のみ）
  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）。終了。");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  // 2. 各ウィンドウの対象レースを事前評価
  // ★ 各スクリプト内部の getRacesInWindow 呼び出しと同じ窓幅で判定する（不整合防止）
  const hasOddsRaces = ODDS_WINDOWS.some(
    (w) => getRacesInWindow(schedule, w, 3).length > 0,
  );
  // update-race-info 内部: getRacesInWindow(schedule, 60) → デフォルト ±3分 = 57-63分前
  const hasUpdateRaces = getRacesInWindow(schedule, 60).length > 0;
  // exhibition 内部: EXHIBITION_WINDOWS=[30,15,10] 各 ±3分
  const hasExhibitionRaces = [30, 15, 10].some(
    (w) => getRacesInWindow(schedule, w, 3).length > 0,
  );
  const finishedRaces = getRacesAfterStart(schedule, 5);

  if (
    !hasOddsRaces &&
    !hasUpdateRaces &&
    !hasExhibitionRaces &&
    finishedRaces.length === 0
  ) {
    console.log("📭 全ウィンドウ対象レースなし。終了。");
    return;
  }

  // 3. 対象レースごとに必要な処理のみ実行
  let anyUpdated = false;
  const updatedRaceIds = new Set();

  // レース情報更新（発走60分前ウィンドウ）
  if (hasUpdateRaces) {
    const { updated, count } = await runUpdateInfo(schedule, date).catch((e) => {
      console.error("⚠️ レース情報更新失敗:", e.message);
      return { updated: false, count: 0 };
    });
    if (updated) {
      anyUpdated = true;
      getRacesInWindow(schedule, 60).forEach((r) =>
        updatedRaceIds.add(r.race_id),
      );
      console.log(`  → レース情報更新: ${count}件`);
    }
  }

  // オッズ取得（複数ウィンドウ）
  if (hasOddsRaces) {
    const { updated, count } = await runOdds(schedule, date).catch((e) => {
      console.error("⚠️ オッズ取得失敗:", e.message);
      return { updated: false, count: 0 };
    });
    if (updated) {
      anyUpdated = true;
      ODDS_WINDOWS.forEach((w) =>
        getRacesInWindow(schedule, w, 3).forEach((r) =>
          updatedRaceIds.add(r.race_id),
        ),
      );
      console.log(`  → オッズ更新: ${count}件`);
    }
  }

  // 展示データ取得（発走30/15/10分前ウィンドウ）
  if (hasExhibitionRaces) {
    const { updated, count } = await runExhibition(schedule, date).catch((e) => {
      console.error("⚠️ 展示データ取得失敗:", e.message);
      return { updated: false, count: 0 };
    });
    if (updated) {
      anyUpdated = true;
      [30, 15, 10].forEach((w) =>
        getRacesInWindow(schedule, w, 3).forEach((r) =>
          updatedRaceIds.add(r.race_id),
        ),
      );
      console.log(`  → 展示データ更新: ${count}件`);
    }
  }

  // 結果取得（発走後5分以上）
  if (finishedRaces.length > 0) {
    const { updated, count } = await runResults(schedule, date).catch((e) => {
      console.error("⚠️ 結果取得失敗:", e.message);
      return { updated: false, count: 0 };
    });
    if (updated) {
      anyUpdated = true;
      // 結果更新は予測リフレッシュ不要（結果は変わらない）
      console.log(`  → 結果取得: ${count}件`);
    }
  }

  // 4. データが更新された場合のみ予測リフレッシュ
  if (anyUpdated && updatedRaceIds.size > 0) {
    console.log(`\n🤖 予測リフレッシュ対象: ${updatedRaceIds.size}レース`);
    await mainRefresh({
      isDryRun: false,
      specificRaceIds: [...updatedRaceIds],
    }).catch((e) => {
      console.error("⚠️ 予測リフレッシュ失敗:", e.message);
    });
  } else if (!anyUpdated) {
    console.log("\n📭 新規データなし → 予測リフレッシュスキップ");
  }

  console.log("\n🏁 オーケストレーター完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
