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
 * 4. 各サブスクリプトの失敗は後続処理をブロックしない（try-catch でフォールバック）
 * 5. 予測買い目オッズは予測リフレッシュとは独立して、発走前レースに対して毎回実行
 */

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  getRaceSchedule,
  getRacesInWindow,
  getRacesAfterStart,
  getRacesBeforeStart,
} from "../lib/raceSchedule.js";

import { run as runOdds, ODDS_WINDOWS } from "./scrape-odds.js";
import { run as runUpdateInfo } from "./update-race-info.js";
import { run as runExhibition } from "./scrape-exhibition-data.js";
import { run as runResults } from "./scrape-results.js";
import { mainRefresh } from "./generate-predictions.js";
import { run as runPredictionOdds } from "./scrape-prediction-odds.js";
import {
  collectGhaRefreshRaceIds,
  isOddsRefreshSkippedOnGha,
  isOddsSkippedOnGha,
} from "../lib/predictionRefresh.js";
import { shouldSkipOnGha } from "../lib/ghaSkipGate.js";

/**
 * SKIP_<JOB>_ON_GHA=true のとき、Vercel が健全な場合に限りスキップする（フェイルセーフ付きSKIP）。
 * 変数が true でない場合は、この関数は呼ばれない（呼び出し側が先に確認する。DB を読まず、現行と同じ動作）。
 * Vercel が live でない・止まっている・状態を読めない場合は false（実行）を返す。判定と理由はログに出る。
 * 判定の定義: scripts/lib/ghaSkipGate.js、docs/design/scraping-vercel-consolidation/verification-runbook.md P
 */
const gateSkips = async (varName) => (await shouldSkipOnGha({ varName })).skip;

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
  // オッズ取得（WS4b・T4b-04）は Vercel Function(api/cron/odds.js)へ移行する。切り替え後、GitHub Actions 側の
  // 取得を、リポジトリ変数のトグルのみで止める（コードは削除せず、切り戻しも変数のトグルだけで完結。
  // SKIP_EXHIBITION_ON_GHAと同じ方式）。既定（未設定・true以外）は従来どおり実行する。
  //   SKIP_ODDS_ON_GHA=true  オッズ取得を行わない（買い目オッズ A4 は別に動く。T4b-10 で扱う）
  // オッズ起点の予測リフレッシュのきっかけも消えるため、案1（REFRESH_ON_VERCEL・SKIP_ODDS_REFRESH_ON_GHA）が先。
  // 順序は scripts/lib/predictionRefresh.js の isOddsSkippedOnGha を参照
  // 変数が true のときだけ、対象のレースがあるときに、Vercel が健全かを確認する（健全でなければ、実行する）
  const oddsDue = ODDS_WINDOWS.some(
    (w) => getRacesInWindow(schedule, w, 3).length > 0,
  );
  const skipOdds =
    isOddsSkippedOnGha() && (!oddsDue || (await gateSkips("SKIP_ODDS_ON_GHA")));
  const hasOddsRaces = !skipOdds && oddsDue;
  // update-race-info 内部: getRacesInWindow(schedule, 60) → デフォルト ±3分 = 57-63分前
  const hasUpdateRaces = getRacesInWindow(schedule, 60).length > 0;
  // exhibition 内部: EXHIBITION_WINDOWS=[30,15,10] 各 ±3分
  const hasExhibitionRaces = [30, 15, 10].some(
    (w) => getRacesInWindow(schedule, w, 3).length > 0,
  );
  const finishedRaces = getRacesAfterStart(schedule, 5);
  // 予測買い目オッズ: 発走60分以内のレース（オッズは発走直前に最も変動する）
  const upcomingRaces = getRacesBeforeStart(schedule, 60);

  if (
    !hasOddsRaces &&
    !hasUpdateRaces &&
    !hasExhibitionRaces &&
    finishedRaces.length === 0 &&
    upcomingRaces.length === 0
  ) {
    console.log("📭 全ウィンドウ対象レースなし。終了。");
    return;
  }

  // 3. 対象レースごとに必要な処理のみ実行
  let anyUpdated = false;
  // 予測リフレッシュの対象を、起点ごとに集める（SKIP_ODDS_REFRESH_ON_GHA でオッズ起点を外せるようにするため）
  const infoRaceIds = new Set();
  const oddsRaceIds = new Set();
  const exhibitionRaceIds = new Set();

  // レース情報更新（発走60分前ウィンドウ）
  if (hasUpdateRaces) {
    const { updated, count } = await runUpdateInfo(schedule, date).catch(
      (e) => {
        console.error("⚠️ レース情報更新失敗:", e.message);
        return { updated: false, count: 0 };
      },
    );
    if (updated) {
      anyUpdated = true;
      getRacesInWindow(schedule, 60).forEach((r) => infoRaceIds.add(r.race_id));
      console.log(`  → レース情報更新: ${count}件`);
    }
  }

  // オッズ取得（複数ウィンドウ）。SKIP_ODDS_ON_GHA=true の間は hasOddsRaces が false になり、行わない
  if (skipOdds) {
    console.log(
      "⏭️ オッズ取得をスキップ（SKIP_ODDS_ON_GHA=true。Vercelが担当）",
    );
  }
  if (hasOddsRaces) {
    const { updated, count } = await runOdds(schedule, date).catch((e) => {
      console.error("⚠️ オッズ取得失敗:", e.message);
      return { updated: false, count: 0 };
    });
    if (updated) {
      anyUpdated = true;
      ODDS_WINDOWS.forEach((w) =>
        getRacesInWindow(schedule, w, 3).forEach((r) =>
          oddsRaceIds.add(r.race_id),
        ),
      );
      console.log(`  → オッズ更新: ${count}件`);
    }
  }

  // 展示データ取得（発走30/15/10分前ウィンドウ）
  // BOA-313 Step 3: Vercel Function(api/cron/exhibition.js)へ移行済みのため、
  // SKIP_EXHIBITION_ON_GHAが"true"の間はGitHub Actions側での取得をスキップする。
  // コードは削除せず、切り戻しはリポジトリ変数のトグルのみで完結させる。
  if (hasExhibitionRaces && process.env.SKIP_EXHIBITION_ON_GHA !== "true") {
    const { updated, count } = await runExhibition(schedule, date).catch(
      (e) => {
        console.error("⚠️ 展示データ取得失敗:", e.message);
        return { updated: false, count: 0 };
      },
    );
    if (updated) {
      anyUpdated = true;
      [30, 15, 10].forEach((w) =>
        getRacesInWindow(schedule, w, 3).forEach((r) =>
          exhibitionRaceIds.add(r.race_id),
        ),
      );
      console.log(`  → 展示データ更新: ${count}件`);
    }
  }

  // 結果取得（発走後5分以上）
  // WS4b（T4b-02-4・T4b-05-3）: 結果取得はVercel Function(api/cron/result.js)、Kファイル同期は
  // api/cron/kfile-sync.js へ移行する。切り替え後、GitHub Actions側の取得を、リポジトリ変数のトグルのみで止める
  // （コードは削除せず、切り戻しも変数のトグルだけで完結。SKIP_EXHIBITION_ON_GHAと同じ方式）。
  //   SKIP_RESULTS_ON_GHA=true  結果取得（と中止・順延の確定）を行わない。Kファイル同期は、下の変数で別に止める
  //   SKIP_KFILE_ON_GHA=true    Kファイル同期（進入コース・rank4〜6）を行わない
  // 既定（未設定・true以外）は、どちらも従来どおり実行する。
  // 変数が true のときだけ、対象のレースがあるときに、Vercel が健全かを確認する（健全でなければ、実行する）
  const resultsDue = finishedRaces.length > 0;
  const skipResults =
    process.env.SKIP_RESULTS_ON_GHA === "true" &&
    (!resultsDue || (await gateSkips("SKIP_RESULTS_ON_GHA")));
  const skipKFile =
    process.env.SKIP_KFILE_ON_GHA === "true" &&
    (!resultsDue || (await gateSkips("SKIP_KFILE_ON_GHA")));
  if (finishedRaces.length > 0 && !(skipResults && skipKFile)) {
    const { updated, count } = await runResults(schedule, date, {
      skipResults,
      skipKFile,
    }).catch((e) => {
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
  // 案1（BOA-353 T4b-03）: SKIP_ODDS_REFRESH_ON_GHA が "true" の間は、オッズ起点の再計算を外す
  // （オッズは予測の入力に含まれない。展示・気象の変更を起点にした再計算は、Vercel の
  // api/cron/exhibition.js が REFRESH_ON_VERCEL=true のときに行う。組み合わせの表は
  // scripts/lib/predictionRefresh.js）。既定（未設定）は従来どおりオッズ起点を含める。
  // 切り戻しはリポジトリ変数のトグルのみで完結させる（コード変更・redeployなし）
  const skipOddsRefresh = isOddsRefreshSkippedOnGha();
  if (skipOdds && !skipOddsRefresh) {
    // オッズ取得を止めたのに、オッズ起点の再計算を外していない: GitHub側の再計算のきっかけが、オッズ→レース情報のみに
    // なる。展示・気象の変更を起点にした再計算（Vercel の REFRESH_ON_VERCEL=true）が有効か、GitHub 側からは
    // Vercel の環境変数を読めず判定できないため、確実に分かる側（SKIP_ODDS_REFRESH_ON_GHA が true でない）だけ警告する
    console.warn(
      "⚠️ SKIP_ODDS_ON_GHA=true ですが SKIP_ODDS_REFRESH_ON_GHA=true ではありません。案1（Vercel の REFRESH_ON_VERCEL=true と SKIP_ODDS_REFRESH_ON_GHA=true）を先に有効化する順序です（verification-runbook.md M）",
    );
  }
  const updatedRaceIds = collectGhaRefreshRaceIds({
    infoRaceIds,
    oddsRaceIds,
    exhibitionRaceIds,
    skipOddsRefresh,
  });
  if (skipOddsRefresh && oddsRaceIds.size > 0) {
    console.log(
      `\n⏭️ オッズ起点の予測リフレッシュを除外（SKIP_ODDS_REFRESH_ON_GHA=true。オッズ更新${oddsRaceIds.size}レース）`,
    );
  }
  if (anyUpdated && updatedRaceIds.size > 0) {
    console.log(`\n🤖 予測リフレッシュ対象: ${updatedRaceIds.size}レース`);
    await mainRefresh({
      isDryRun: false,
      specificRaceIds: [...updatedRaceIds],
      // 案1の状態では、Vercel 側（upsert）と同じ書き込み方式にそろえる（削除→挿入と upsert が同じ
      // レースで交差した場合に、削除→挿入側の挿入が一意制約で失敗し、予測が空になるのを避ける）。
      // 既定（オッズ起点あり）は従来どおり削除→挿入
      writeMode: skipOddsRefresh ? "upsert" : "replace",
    }).catch((e) => {
      console.error("⚠️ 予測リフレッシュ失敗:", e.message);
    });
  } else if (!anyUpdated) {
    console.log("\n📭 新規データなし → 予測リフレッシュスキップ");
  }

  // 5. 予測買い目オッズ更新（発走前レースに対して毎回実行）
  // 予測リフレッシュの有無に関わらず、オッズは発走まで変動し続けるため独立して実行する
  if (upcomingRaces.length > 0) {
    console.log(`\n💹 予測買い目オッズ更新: ${upcomingRaces.length}レース`);
    await runPredictionOdds(
      upcomingRaces.map((r) => r.race_id),
      date,
    ).catch((e) => {
      console.error("⚠️ 予測買い目オッズ取得失敗:", e.message);
    });
  }

  console.log("\n🏁 オーケストレーター完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
