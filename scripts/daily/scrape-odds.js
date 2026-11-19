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
  buildOddsWindowRows,
  collectOddsTargets,
  fetchedOddsOutcome,
  groupFullOddsBySignature,
  isOddsRowComplete,
  markCompletedRetries,
  missingFullKeysByRace,
  oddsKeyOf,
  pickFallbackPatches,
  validateOddsRunArgs,
  winOddsSummary,
} from "../lib/oddsRows.js";
import {
  defaultFetch,
  fetchOddsDetailed,
  fetchOddsForRace,
} from "../lib/oddsPageFetch.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";

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

/** window_min の一意索引（マイグレーション075）。窓内の再試行が、同じ行を更新する */
const ODDS_WINDOW_CONFLICT = "race_id,window_min";

/** 再試行のレースの、前回書いた同じ窓の行を読む（読むだけ）。`${race_id}|${window_min}` -> 行 */
async function loadExistingOddsRows(client, retryRaces) {
  const existing = new Map();
  const { data, error } = await client
    .from("race_odds")
    .select("*")
    .in("race_id", [...new Set(retryRaces.map((r) => r.race_id))])
    .in("window_min", [...new Set(retryRaces.map((r) => r.window_min))]);
  if (error) {
    throw new Error(`オッズの既存行の取得に失敗しました: ${error.message}`);
  }
  for (const row of data ?? []) {
    existing.set(`${row.race_id}|${row.window_min}`, row);
  }
  return existing;
}

/** runForRaces の 2) の1レースぶん: 取得・解析して fetched に足すか、outcomes に失敗を入れる */
async function fetchOneOdds(race, { date, fetchFn, outcomes, base, fetched }) {
  const detail = await fetchOddsDetailed(
    date,
    race.venue_code,
    race.race_number,
    { wantFull: true, winFirst: race.winFirst === true, fetchFn },
  );
  if (detail.status === "breaker_open") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "breaker_open",
      retryAt: detail.retryAt,
      error: detail.error,
    });
  } else if (detail.status === "error") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "error",
      error: detail.error,
    });
  } else if (detail.status === "no_values") {
    outcomes.set(oddsKeyOf(race), {
      ...base,
      outcome: "no_values",
      error: "単勝オッズを解析できませんでした（未公開・中止・順延の可能性）",
    });
  } else {
    fetched.push({ race, detail });
  }
}

/**
 * runForRaces の 4) の対象: 0分（締切時点）窓の行のうち全通り系が欠けている物（race_id → 取れている全通り系）
 */
function zeroWindowFallbackTargets(fetched, rows) {
  const fallbackTargets = new Map();
  for (const { race } of fetched) {
    if (race.window_min !== 0) continue;
    const row = rows.get(oddsKeyOf(race));
    const patch = Object.fromEntries(
      FULL_ODDS_KEYS.filter((k) => row[k]).map((k) => [k, row[k]]),
    );
    if (Object.keys(patch).length < FULL_ODDS_KEYS.length) {
      fallbackTargets.set(race.race_id, patch);
    }
  }
  return fallbackTargets;
}

/**
 * runForRaces の 4) の読み: 直近のスナップショットの問い（await するのは呼び出し側。async の殻を挟まず、
 * 書き込みの列の順を分ける前と同じにする）
 */
function fallbackSnapshotQuery(client, fallbackTargets, now) {
  const cutoffIso = new Date(
    now().getTime() - MAX_FALLBACK_AGE_MINUTES * 60000,
  ).toISOString();
  return client
    .from("race_odds")
    .select(`race_id, captured_at, window_min, ${FULL_ODDS_KEYS.join(", ")}`)
    .in("race_id", [...fallbackTargets.keys()])
    .gte("captured_at", cutoffIso)
    .order("captured_at", { ascending: false });
}

/** runForRaces の 4) の補完: スナップショットの行から欠けを埋める（rows の行をその場で書き換える） */
function applyFallbackPatches(rows, fallbackTargets, data) {
  // 自分の窓（0分）の行は、部分的な前回の試行の可能性があるため、補完元にしない
  const snapshots = (data ?? []).filter((r) => r.window_min !== 0);
  for (const [raceId, fallback] of pickFallbackPatches(
    fallbackTargets,
    snapshots,
  )) {
    Object.assign(rows.get(`${raceId}|0`), fallback);
  }
}

/**
 * レース×窓の入口（Vercel Cron のスロット消化から呼ぶ。T4b-04-1）。
 *
 * run（GitHub Actions・CLIの入口）と、解析（fetchOddsDetailed）・行の組み立て（buildBaseRow・fullOddsPatchOf）・
 * 0分窓のフォールバック（pickFallbackPatches）を共有する。違いは次のとおり:
 *   - 取得は fetchFn（Vercel では politeFetch 経由）で行い、会場直列・会場間の待機は無い。レース単位に concurrency で
 *     並列にする（各レースの5ページは並列）
 *   - 対象は、races のうち window_min（0〜-60）が決まっているスロット。全窓で全券種の全通りを取る（ADR-0057 FR-4）
 *   - 書き込みは、基本オッズと全通り系を1行にまとめ、race_id,window_min の一意索引で upsert する
 *     （source='vercel'・window_min つき。窓内の再試行は同じ行を更新するため、行が増えない）
 *   - 再試行（attempts>1）では、前回書いた同じ窓の行を読み、取れている列を null で上書きしない。既にその窓の
 *     行が完了していれば、取得せずに skipped_have_data で終える
 *   - mode="shadow" は、取得・解析のみで、race_odds へ一切書かない（result_digest に、構造のダイジェストを返す。
 *     再試行の既存行も読まない）
 *
 * 各レースの outcome（scrape_slots.outcome と同じ語彙）:
 *   ok                完了（単勝ページが発売済みで、全通り系5券種がそろった。0分窓は直近のスナップショットからの補完を含む。
 *                     単勝の値は票0で全て null のことがある。BOA-486）
 *   partial           単勝ページは発売済みだが、全通り系の一部が未取得（live では、取れた分を書き込み済み）。再試行する
 *   no_values         単勝の行そのものが無い（未公開・中止・順延の可能性）。再試行する
 *   skipped_have_data （live のみ）この窓の行が既に完了している
 *   error             取得（HTTP・ネットワーク）・書き込みの失敗。再試行する
 *   breaker_open      サーキットブレーカーが開いていた。retryAt まで再試行を遅らせる
 *
 * @param {Array<{race_id: string, venue_code: number, race_number: number, window_min: number, attempts?: number, winFirst?: boolean}>} races
 *   winFirst: true なら、単勝ページだけを先に取得し、未公開なら他のページを取得しない（fetchOddsDetailed）
 * @param {Object} options
 * @param {string} options.date YYYY-MM-DD（オッズページの日付）
 * @param {"live"|"shadow"} [options.mode]
 * @param {(url: string) => Promise<Response>} [options.fetchFn] 既定はグローバルの fetch
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client]
 * @param {number} [options.concurrency]
 * @param {() => Date} [options.now]
 * @returns {Promise<Array<{race_id: string, outcome: string, rowsWritten: number, rowsParsed: number, rowsExpected: number, resultDigest?: string, missing?: string[], error?: string, retryAt?: Date}>>}
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchFn = defaultFetch,
    client = supabase,
    concurrency = 1,
    now = () => new Date(),
  } = {},
) {
  validateOddsRunArgs(races, mode, date);
  const live = mode === "live";
  /** @type {Map<string, Object>} */
  const outcomes = new Map();
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  // 1) live・再試行のレース: 前回書いた同じ窓の行を読む（値の引き継ぎ・完了済みの判定）
  const keyOf = oddsKeyOf;
  const retryRaces = races.filter((r) => (r.attempts ?? 1) > 1);
  const existing =
    live && retryRaces.length > 0
      ? await loadExistingOddsRows(client, retryRaces)
      : new Map(); // `${race_id}|${window_min}` -> 行
  markCompletedRetries(retryRaces, existing, { live, outcomes, base });

  // 2) 取得・解析（1つの失敗で他のレースを止めない）
  /** @type {Array<{race: Object, detail: Awaited<ReturnType<typeof fetchOddsDetailed>>}>} */
  const fetched = [];
  await mapWithConcurrency(
    races.filter((race) => !outcomes.has(keyOf(race))),
    concurrency,
    (race) => fetchOneOdds(race, { date, fetchFn, outcomes, base, fetched }),
  );

  // 3) 行の組み立て（基本オッズ＋全通り系を1行に。再試行は既存の値を引き継ぐ）
  const capturedAt = now().toISOString();
  const rows = buildOddsWindowRows(fetched, existing, capturedAt); // race_id -> 行

  // 4) 0分（締切時点）窓: 全通り系の欠けを、直近のスナップショット（同じ窓の行を除く）から補完する（ADR-0057）
  const fallbackTargets = zeroWindowFallbackTargets(fetched, rows);
  if (fallbackTargets.size > 0) {
    const { data, error } = await fallbackSnapshotQuery(
      client,
      fallbackTargets,
      now,
    );
    if (error) {
      throw new Error(
        `オッズの補完用スナップショットの取得に失敗しました: ${error.message}`,
      );
    }
    applyFallbackPatches(rows, fallbackTargets, data);
  }

  // 5) live: 書き込む。shadow: 書かない
  let writeError = null;
  if (live && rows.size > 0) {
    const { error } = await client
      .from("race_odds")
      .upsert([...rows.values()], { onConflict: ODDS_WINDOW_CONFLICT });
    if (error) writeError = error.message;
  }

  for (const { race } of fetched) {
    outcomes.set(
      keyOf(race),
      fetchedOddsOutcome(rows.get(keyOf(race)), { base, writeError, live }),
    );
  }

  return races.map((race) => ({
    race_id: race.race_id,
    ...outcomes.get(keyOf(race)),
  }));
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
