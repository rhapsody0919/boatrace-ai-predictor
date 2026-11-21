/**
 * レース前オッズの行の組み立て（scrape-odds.js から分けた純粋関数）: 取得の対象・全通り系の補い・ウィンドウの行・1件の結果。
 * DB には触れない（読み書きは scrape-odds.js）。呼び出し元はこれまでどおり scrape-odds.js から import できる
 */
import { getRacesInWindow } from "./raceSchedule.js";
import { latestByRaceId } from "./latestByRaceId.js";
import { computeOddsDigest } from "./scrapeJobs/oddsDigest.js";
import {
  FULL_ODDS_KEYS,
  buildBaseRow,
  fullOddsPatchOf,
} from "./oddsPageParse.js";

// 発走前の取得ウィンドウ（分）: 各ウィンドウで ±3分
// 0分（締切時点）はADR-0057で追加。オーケストレーターでも参照するため export
export const ODDS_WINDOWS = [60, 30, 15, 10, 5, 0];

// 全通り（3連単/3連複/2連単/2連複/拡連複）を捕捉するウィンドウ。
// ADR-0057により全窓を対象に拡大（旧: 発走直前の1窓のみ）
export const FULL_ODDS_WINDOWS = ODDS_WINDOWS;

/** race_odds.source に書く、Vercel（api/cron/odds.js）の識別子。GitHub Actions 側の行は既定値 'gha' */
export const ODDS_SOURCE_VERCEL = "vercel";

export const MAX_FALLBACK_AGE_MINUTES = 75;

/**
 * 0分窓（締切時点）で全通り系の一部が欠けたレースについて、直近の成功スナップショットの行から、
 * 該当列を補完するパッチを選ぶ（純粋関数。ADR-0057のフォールバック設計）。
 * 取得できなかった券種をエラーとして握りつぶさず、直前の値を実質的な最終値として扱う。
 *
 * @param {Map<string, Object>} patchesByRaceId - race_id -> 今回のスナップショット行（欠けている全通り系キーは未設定）
 * @param {Array<Object>} snapshotRows - race_odds の行（captured_at の降順。race_id, captured_at と全通り系列を持つ）
 * @returns {Map<string, Object>} race_id -> 補完できた列のみを持つオブジェクト
 */
export function pickFallbackPatches(patchesByRaceId, snapshotRows) {
  const latestSnapshotByRaceId = latestByRaceId(snapshotRows);

  const result = new Map();
  for (const { raceId, missingKeys } of missingFullKeysByRace(
    patchesByRaceId,
  )) {
    const latest = latestSnapshotByRaceId.get(raceId);
    if (!latest) continue;
    const fallback = {};
    for (const key of missingKeys) {
      if (latest[key]) fallback[key] = latest[key];
    }
    if (Object.keys(fallback).length > 0) result.set(raceId, fallback);
  }

  return result;
}

/** 全通り系が1つでも欠けているレースと、欠けている列名 */
export function missingFullKeysByRace(patchesByRaceId) {
  return [...patchesByRaceId.entries()]
    .map(([raceId, row]) => ({
      raceId,
      missingKeys: FULL_ODDS_KEYS.filter((k) => !(k in row)),
    }))
    .filter((t) => t.missingKeys.length > 0);
}

/** run() の対象: 各ウィンドウの未確定のレース（重複なし）と、全通りを取るレース */
export function collectOddsTargets(schedule, finishedIds) {
  // 各ウィンドウで対象レースを収集（重複なし）
  const targetRaces = new Map();
  for (const minutes of ODDS_WINDOWS) {
    const inWindow = getRacesInWindow(schedule, minutes);
    for (const r of inWindow) {
      if (!finishedIds.has(r.race_id) && !targetRaces.has(r.race_id)) {
        targetRaces.set(r.race_id, r);
      }
    }
  }

  // 全窓（60/30/15/10/5/0分前）で全券種の全通りを保存する（ADR-0057）
  const fullOddsIds = new Set();
  for (const minutes of FULL_ODDS_WINDOWS) {
    getRacesInWindow(schedule, minutes).forEach((r) =>
      fullOddsIds.add(r.race_id),
    );
  }
  return { targetRaces, fullOddsIds };
}

/** 単勝のログの文字列 */
export const winOddsSummary = (winOdds) =>
  winOdds
    .map((o, i) => (o !== null ? `${i + 1}号艇:${o}` : null))
    .filter(Boolean)
    .join(", ") || "単勝は票0（他券種のみ）";

/** 全通り系の行（フォールバックで補った列を含む。列が1つも無いレースは書かない） */
export function buildFullOddsRows(
  pendingFullOdds,
  fallbackByRaceId,
  capturedAt,
) {
  const fullOddsRows = [];
  for (const { raceId, patch } of pendingFullOdds) {
    const fallback = fallbackByRaceId.get(raceId);
    const finalPatch = fallback ? { ...patch, ...fallback } : patch;
    if (Object.keys(finalPatch).length > 0) {
      fullOddsRows.push({
        race_id: raceId,
        captured_at: capturedAt,
        ...finalPatch,
      });
    }
  }
  return fullOddsRows;
}

/**
 * PostgRESTの一括upsertは全行同一キーが必要。全通り系5列は個別URL取得のため
 * 行ごとに含まれる列の組み合わせが異なりうる（一部だけ欠ける場合を含む）ため、
 * 実際に含まれる全通り系キーの組み合わせ（シグネチャ）ごとにグループ化する
 */
export function groupFullOddsBySignature(fullOddsRows) {
  const groupBySignature = new Map();
  for (const row of fullOddsRows) {
    const signature = FULL_ODDS_KEYS.filter((k) => k in row).join(",");
    if (!groupBySignature.has(signature)) groupBySignature.set(signature, []);
    groupBySignature.get(signature).push(row);
  }
  return groupBySignature;
}

/**
 * race_odds の行が、この窓の取得として完了しているか（単勝が1つ以上あり、全通り系5列がそろう）。
 *
 * 単勝が全て null（票0。BOA-486）の行は「未完了」のままにしてある。この窓の中の再試行で、票が入って
 * 実際の単勝オッズが取れる余地を残すため（outcome は ok なので再試行そのものは起きず、他の理由で
 * 再試行するときだけ再取得する）。行は既に書かれているので、画面が空になることはない
 */
export function isOddsRowComplete(row) {
  if (!row) return false;
  const hasWin = [1, 2, 3, 4, 5, 6].some(
    (b) => row[`odds_win_${b}`] !== null && row[`odds_win_${b}`] !== undefined,
  );
  return hasWin && FULL_ODDS_KEYS.every((k) => row[k]);
}

/**
 * 既存の行の値を、新しい行の null を埋めるために引き継ぐ（COALESCE。新しい値が非nullなら新しい値）。
 * 窓内の再試行で、一部のページの取得に失敗した場合に、前回の試行で取れていた値を null で
 * 上書きして失うのを避ける（同じ行を更新するため）
 */
function coalesceRow(fresh, existing) {
  if (!existing) return fresh;
  const merged = { ...fresh };
  for (const [key, value] of Object.entries(fresh)) {
    if ((value === null || value === undefined) && existing[key] != null) {
      merged[key] = existing[key];
    }
  }
  return merged;
}

/** runForRaces の引数の検査（mode・date・window_min） */
export function validateOddsRunArgs(races, mode, date) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  for (const race of races) {
    if (!Number.isInteger(race.window_min)) {
      throw new Error(
        `window_min（整数）が必要です: ${race.race_id} ${String(race.window_min)}`,
      );
    }
  }
}

export const oddsKeyOf = (race) => `${race.race_id}|${race.window_min}`;

/** live の再試行で、この窓の行が既に完了しているレースを skipped_have_data にする */
export function markCompletedRetries(
  retryRaces,
  existing,
  { live, outcomes, base },
) {
  for (const race of retryRaces) {
    if (live && isOddsRowComplete(existing.get(oddsKeyOf(race)))) {
      outcomes.set(oddsKeyOf(race), { ...base, outcome: "skipped_have_data" });
    }
  }
}

/** runForRaces の 3): 基本オッズ＋全通り系を1行に組み立てる（再試行は既存の値を引き継ぐ） */
export function buildOddsWindowRows(fetched, existing, capturedAt) {
  const rows = new Map();
  for (const { race, detail } of fetched) {
    const fresh = {
      ...buildBaseRow(race.race_id, capturedAt, detail.data),
      // 取得できなかった全通り系は null（一様なキーで upsert する。既存の値は下で引き継ぐ）
      ...Object.fromEntries(FULL_ODDS_KEYS.map((k) => [k, null])),
      ...fullOddsPatchOf(detail.data),
      window_min: race.window_min,
      source: ODDS_SOURCE_VERCEL,
    };
    rows.set(
      oddsKeyOf(race),
      coalesceRow(fresh, existing.get(oddsKeyOf(race))),
    );
  }
  return rows;
}

/** 取得できた1レースの outcome（書き込みの失敗なら error、他は ok / partial） */
export function fetchedOddsOutcome(row, { base, writeError, live }) {
  const missing = FULL_ODDS_KEYS.filter((k) => !row[k]);
  const common = {
    ...base,
    rowsParsed: 1,
    resultDigest: computeOddsDigest(row),
    missing,
  };
  if (writeError) {
    return {
      ...common,
      outcome: "error",
      error: `オッズの書き込みに失敗しました: ${writeError}`,
    };
  }
  return {
    ...common,
    rowsWritten: live ? 1 : 0,
    outcome: missing.length === 0 ? "ok" : "partial",
    ...(missing.length > 0
      ? { error: `全通り系が未取得です: ${missing.join(",")}` }
      : {}),
  };
}
