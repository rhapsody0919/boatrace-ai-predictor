/**
 * レース前オッズ取得スクリプト
 *
 * 発走60/30/15/10/5分前のウィンドウで単勝・複勝・3連単オッズを取得し、
 * Supabase race_odds テーブルに upsert する。単勝・複勝オッズは同一ページ
 * （oddstf）に掲載されており、.oddsPoint の7〜12番目が複勝オッズ
 * （下限-上限のレンジ形式）（2026-08-14追加）。
 *
 * scrape-scheduled.yml から5分毎に実行される。
 * 実装パターン: scrape-exhibition-data.js に準拠
 * レース単位の runForRaces は scripts/lib/oddsRunForRaces.js（ハンドラー scrapeJobs/oddsHandlers.js も読む。ここは run・main と再 export）
 */

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
  fetchAll,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
// ページの読みは oddsPageParse.js、取得は oddsPageFetch.js に置く（呼び出し元はこれまでどおりここから import できる）
import {
  FULL_ODDS_KEYS,
  buildBaseRow,
  fullOddsPatchOf,
  isWinOddsUnpublished,
  scrapePlaceOdds,
  scrapeWinOdds,
  topTrifectaByOdds,
} from "../lib/oddsPageParse.js";
import { parseTrifectaAll } from "../lib/oddsParser.js";
import {
  FULL_ODDS_WINDOWS,
  ODDS_SOURCE_VERCEL,
  ODDS_WINDOWS,
  MAX_FALLBACK_AGE_MINUTES,
  buildFullOddsRows,
  collectOddsTargets,
  groupFullOddsBySignature,
  isOddsRowComplete,
  missingFullKeysByRace,
  pickFallbackPatches,
  winOddsSummary,
} from "../lib/oddsRows.js";
import { fetchOddsDetailed, fetchOddsForRace } from "../lib/oddsPageFetch.js";

export {
  FULL_ODDS_KEYS,
  FULL_ODDS_WINDOWS,
  ODDS_SOURCE_VERCEL,
  ODDS_WINDOWS,
  isOddsRowComplete,
  pickFallbackPatches,
  buildBaseRow,
  fetchOddsDetailed,
  fullOddsPatchOf,
  isWinOddsUnpublished,
  scrapePlaceOdds,
  scrapeWinOdds,
  topTrifectaByOdds,
};

/**
 * 結果取得済みレースの race_id セットを取得（スキップ判定用）
 */
async function getFinishedRaceIds(date) {
  if (!isSupabaseEnabled()) return new Set();
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id")
    .gte("race_id", date)
    .lt("race_id", `${date}~`)
    .not("payout_win", "is", null);
  if (error) {
    console.error("⚠️ 結果済みレースの確認に失敗:", error.message);
    return new Set();
  }
  return new Set((data || []).map((r) => r.race_id));
}

/**
 * 3連単人気上位3つを、odds3t の全通りの表から求める。
 *
 * 公式の odds3t ページに「人気順」の表は無い（2026-09-21に実ページとフィクスチャで確認。ページの表は、
 * 1着艇ごとに6セクションを横に並べた120通りの組番順のグリッド1つだけ）。旧実装は `.is-p3-0 tbody tr` を
 * 探していたが、`is-p3-0` はそのグリッドの <tbody> 自身のクラスで、内側に <tbody> は無いため、常に0件に
 * なり、trifecta_popular_*・trifecta_odds_* が全行で NULL だった。全通りのグリッド
 * （oddsParser.parseTrifectaAll）から、オッズの低い順に3件選ぶ。
 *
 * @param {CheerioAPI} $ - odds3t ページの cheerio インスタンス
 * @returns {Array<{combination: string|null, odds: number|null}>} 最大3件（グリッドが取れなければ空）
 */
export function scrapeTrifectaOdds($) {
  return topTrifectaByOdds(parseTrifectaAll($));
}

// フォールバックとして許容する最古のスナップショット年齢（分）。ODDS_WINDOWSの
// 最大値（60分前）に運用上のマージンを加えた値。レース延期等で発走が大幅に
// ずれた場合、何時間も前のスナップショットを「実質最終値」として扱うのは
// 締切間際の市場変動を無視することになり危険なため、上限を設ける

/**
 * 0分窓（締切時点）で全通り系の一部が欠けたレースをまとめて、直近の成功
 * スナップショットから該当列を補完する（ADR-0057のフォールバック設計）。
 * ただしMAX_FALLBACK_AGE_MINUTESより古いスナップショットは採用しない。
 *
 * レースごとに逐次awaitでSupabaseへ問い合わせるN+1呼び出しを避けるため、
 * 対象レースIDをまとめて1回の.in()クエリで取得する（BOA-341）。
 * Supabaseの.select()はデフォルトで最大1000行しか返さず超過分は無言で
 * 切り捨てられるため（本プロジェクトで既知の落とし穴、generate-predictions.js
 * のCHUNK_SIZE運用と同じ理由）、素の.select()ではなくfetchAll()（1000件単位で
 * .range()ページネーション）を使い、.in()側もCHUNK_SIZE単位に分割する
 *
 * @param {Map<string, Object>} patchesByRaceId - race_id -> 今回のスナップショット行（欠けている全通り系キーは未設定）
 * @returns {Promise<Map<string, Object>>} race_id -> 補完できた列のみを持つオブジェクト
 */
async function fillMissingFullOddsFromLatestSnapshots(patchesByRaceId) {
  const targets = missingFullKeysByRace(patchesByRaceId);

  if (targets.length === 0) return new Map();

  const cutoffIso = new Date(
    Date.now() - MAX_FALLBACK_AGE_MINUTES * 60000,
  ).toISOString();

  // この補完は「直近のスナップショットで欠けた全通りを埋める」だけのため、取得に失敗しても、その回の基本オッズの
  // 書き込みを止めない（例外にすると、呼び出し元の run() ごと失敗し、基本オッズまで書かれなくなる）。
  // fetchAll の既定は例外（BOA-391）なので、ここだけ従来どおり「ログに出して取得済み分で続ける」を明示する
  const CHUNK_SIZE = 900; // Supabase .in() の1000件制限内（generate-predictions.js踏襲）
  const raceIds = targets.map((t) => t.raceId);
  const data = [];
  for (let i = 0; i < raceIds.length; i += CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + CHUNK_SIZE);
    const rows = await fetchAll(
      "race_odds",
      `race_id, captured_at, ${FULL_ODDS_KEYS.join(", ")}`,
      (q) =>
        q
          .in("race_id", chunk)
          .gte("captured_at", cutoffIso)
          .order("captured_at", { ascending: false }),
      // 握りつぶし可（BOA-391）: 全通りの補完だけ。失敗しても、その回の基本オッズの書き込みを止めない（上のコメント）
      { throwOnError: false },
    );
    data.push(...rows);
  }

  return pickFallbackPatches(patchesByRaceId, data);
}

/**
 * run() の取得: 会場ごとに、会場内の全レースを並列に取得する（会場間は1秒待つ）。書き込みはしない。
 * baseRows＝基本オッズの行、pendingFullOdds＝race_id ごとの全通り系（0分窓フォールバック適用前）
 */
async function fetchVenuesOdds(date, targetRaces, fullOddsIds, capturedAt) {
  const baseRows = [];
  // race_idごとのfullOddsPatch（0分窓フォールバック適用前）。フォールバックは
  // 全レース分をまとめて後段で一括取得するため、ここではまだupsert対象の
  // fullOddsRowsに確定しない（BOA-341、逐次awaitのN+1を避けるため全venue処理後に一括処理）
  const pendingFullOdds = [];

  const byVenue = new Map();
  for (const r of targetRaces.values()) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchOddsForRace(
          date,
          r.venue_code,
          r.race_no,
          fullOddsIds.has(r.race_id),
        ).then((data) => ({ r, data })),
      ),
    );

    for (const { r, data } of results) {
      if (!data) continue;
      const { winOdds } = data;

      // 基本オッズ（単勝・複勝・3連単人気3位）は既存列のみで完結するため
      // 全通り系（新規4列＋trifecta_all）とは別のupsertで書き込む。
      // こうすることで、全通り系側でエラー（マイグレーション未適用等）が
      // 起きても基本オッズの保存には影響しない（2026-09-16実装時に、
      // 全窓全通り化で全レースが同一グループに入り、新規列欠如のエラー1件で
      // 基本オッズまで含めて全件保存されない回帰を実データで確認して分離した）
      baseRows.push(buildBaseRow(r.race_id, capturedAt, data));

      pendingFullOdds.push({
        raceId: r.race_id,
        patch: fullOddsPatchOf(data),
      });

      console.log(
        `  ✅ ${venueName} ${r.race_no}R — ${winOddsSummary(winOdds)}`,
      );
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return { baseRows, pendingFullOdds };
}

/**
 * オーケストレーターから呼び出し可能なオッズ取得処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{updated: boolean, count: number}>}
 */
export async function run(schedule, date) {
  // 結果取得済みレースはスキップ
  const finishedIds = await getFinishedRaceIds(date);

  const { targetRaces, fullOddsIds } = collectOddsTargets(
    schedule,
    finishedIds,
  );

  if (targetRaces.size === 0) {
    console.log("📭 オッズ: 取得対象レースなし（全ウィンドウ外）");
    return { updated: false, count: 0 };
  }

  // 0分（締切時点）ウィンドウのレースID（フォールバック対象の判定用、ADR-0057）
  const cutoffWindowIds = new Set(
    getRacesInWindow(schedule, 0).map((r) => r.race_id),
  );

  console.log(
    `🎯 オッズ取得: ${targetRaces.size}レース (${ODDS_WINDOWS.map((m) => `${m}分前`).join("/")} ウィンドウ)`,
  );

  // 会場ごとにグループ化して並列取得
  const capturedAt = new Date().toISOString();
  const { baseRows, pendingFullOdds } = await fetchVenuesOdds(
    date,
    targetRaces,
    fullOddsIds,
    capturedAt,
  );

  if (baseRows.length === 0) {
    console.log("\n📭 オッズ: 書き込みデータなし");
    return { updated: false, count: 0 };
  }

  // 0分（締切時点）窓で全通り系の一部が欠けたレースをまとめてフォールバック
  // 取得する（ADR-0057）。レースごとの逐次awaitを避けるため1回の.in()クエリに
  // まとめる（BOA-341）
  const fallbackTargets = new Map();
  for (const { raceId, patch } of pendingFullOdds) {
    if (cutoffWindowIds.has(raceId)) fallbackTargets.set(raceId, patch);
  }
  const fallbackByRaceId =
    await fillMissingFullOddsFromLatestSnapshots(fallbackTargets);

  const fullOddsRows = buildFullOddsRows(
    pendingFullOdds,
    fallbackByRaceId,
    capturedAt,
  );

  console.log(`\n💾 race_odds(基本オッズ): ${baseRows.length}件書き込み中...`);
  for (let i = 0; i < baseRows.length; i += 1000) {
    const batch = baseRows.slice(i, i + 1000);
    const { error } = await supabase
      .from("race_odds")
      .upsert(batch, { onConflict: "race_id,captured_at" });
    if (error) {
      console.error("❌ race_odds(基本オッズ)書き込みエラー:", error.message);
    }
  }
  console.log(`✅ race_odds(基本オッズ): ${baseRows.length}件完了`);

  if (fullOddsRows.length > 0) {
    console.log(`💾 race_odds(全通り系): ${fullOddsRows.length}件追記中...`);
    const groupBySignature = groupFullOddsBySignature(fullOddsRows);
    for (const group of groupBySignature.values()) {
      for (let i = 0; i < group.length; i += 1000) {
        const batch = group.slice(i, i + 1000);
        const { error } = await supabase
          .from("race_odds")
          .upsert(batch, { onConflict: "race_id,captured_at" });
        if (error) {
          console.error("❌ race_odds(全通り系)書き込みエラー:", error.message);
        }
      }
    }
    console.log(`✅ race_odds(全通り系): ${fullOddsRows.length}件完了`);
  }

  return { updated: true, count: baseRows.length };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("🎰 オッズスクレイピング開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}

export { runForRaces } from "../lib/oddsRunForRaces.js";
