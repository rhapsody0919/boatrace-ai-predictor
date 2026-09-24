/**
 * K/Bアーカイブ（kb-day/v1、scripts/lib/kbFileParser.js）から race_results の欠損行を
 * 埋めるための、行の分類・組み立て（純関数。DB・ファイルシステムに接続しない）
 *
 * 背景: BOA-403（docs/design/scraping-vercel-consolidation/tasks.md N32参照）。2025-12-03〜
 * 2026-03-31の一部レースで races 行はあるのに race_results 行が無い（欠損）。対応するK/Bは
 * 既にダウンロード・パース済み（data/kb-archive/parsed/、scripts/maintenance/kb-backfill.js parse）
 * のため、再取得せずこの中間JSONから直接埋める。
 *
 * 【重要な調査結果・スコープ限定】実データ調査（2026-09-24）の結果、欠損のうち機械的に埋められる
 * のは一部のみと判明した。残りは以下の理由で本モジュール・対応CLIの対象外とする（無理に埋めない。
 * 詳細はtasks.md N32・PR説明を参照）:
 *   - races.race_number が、その日その会場のK-file内の実際の最大レース番号を超えている場合
 *     （K-fileが「そのレースは開催されなかった」ことを示している。中止・打ち切りの疑いが強く、
 *     本体テーブル側の races.cancellation_status 未設定が真因の可能性が高い。K/Bには元々データが
 *     無いため「埋める」対象ではない）
 *   - 該当日のK-fileにその会場のブロック自体が無い場合。前日・翌日のK-fileに同じ会場・レース番号
 *     のレースが見つかるケースが一定数あり、race_id の日付ズレの疑いがある。race_id自体の訂正が
 *     必要でありK/B単純投入では直せない
 *
 * 【既存の一次情報源を再利用する】着順・進入コース・払戻金額の抽出は、日次照合ジョブ
 * （scripts/lib/dailyReconcile.js）・誤り監査CLI（scripts/maintenance/audit-race-result-anomalies.js）
 * が既に使っている scripts/lib/raceResultAudit.js の kVenuesToRaceFacts()・PAYOUT_COLUMNS_BY_KIND を
 * そのまま使う（本体テーブルの列名の逆転＝payout_trifecta=3連複・payout_trio=3連単の再現を含め、
 * 同じロジックを二重実装しない）。本ファイルが追加するのは、そこには無い人気（popularity_*）の
 * 抽出と、「欠損行をそもそも挿入してよいか」の判定・行の組み立てのみ。
 *
 * 【意図的にNULLのままにする列】
 *   - course_1〜6（進入コースの旧カラム）: scripts/lib/kfileParser.js の冒頭コメント（BOA-257）の
 *     とおり、公式raceresultページのHTML由来で常に艇番と一致する退化した列と判明済み。加えて実データ
 *     確認で「全レースNULL」の行も存在し歴史的に一貫して埋まっているわけでもない。K/Bには対応する
 *     情報源が無く、fabricateすると既存の（不完全な）慣行と余計な差異を生むため触らない
 *   - result_at: 本来のスクレイピング取得時刻を表す列。バックフィルで実際の取得時刻を偽装しない
 *     （data-acquisition.md、kbArchiveRows.jsのcreated_at:null方針と同じ考え方）ため常にnull
 *   - race_time_1〜6: 本番全体でも約7%しか埋まっておらず（2026-09-24時点 3,151/45,223件）、
 *     艇番索引かどうかを裏付ける実例が見つからなかった。誤ったインデックス規則で埋めるリスクを
 *     避けるため触らない
 */

import {
  kVenuesToRaceFacts,
  PAYOUT_COLUMNS_BY_KIND,
} from "./raceResultAudit.js";

export const MISSING_STATUS = Object.freeze({
  FOUND: "found",
  VENUE_NOT_IN_K: "venue_not_in_k",
  RACE_NOT_IN_K_VENUE: "race_not_in_k_venue",
  VENUE_PENDING: "venue_pending",
  NO_K_DAY: "no_k_day",
});

/**
 * 欠損中の1レース（race_id）が、パース済みのkb-day（1日分）から埋められるかを分類する。
 * @param {{k?: {venues: object[]}}|null} day scripts/lib/kbFileParser.js buildKbDay() の戻り値
 * @param {number} venueCode
 * @param {number} raceNumber
 * @returns {{status: string, race?: object, maxRaceNumberInVenue?: number}}
 */
export function classifyMissingResult(day, venueCode, raceNumber) {
  if (!day || !day.k) return { status: MISSING_STATUS.NO_K_DAY };
  const venue = day.k.venues.find((v) => v.venue_code === venueCode);
  if (!venue) return { status: MISSING_STATUS.VENUE_NOT_IN_K };
  if (venue.status === "pending")
    return { status: MISSING_STATUS.VENUE_PENDING };
  const race = venue.races.find((r) => r.race_number === raceNumber);
  if (!race) {
    const maxRaceNumberInVenue = venue.races.reduce(
      (max, r) => Math.max(max, r.race_number),
      0,
    );
    return { status: MISSING_STATUS.RACE_NOT_IN_K_VENUE, maxRaceNumberInVenue };
  }
  return { status: MISSING_STATUS.FOUND, race };
}

/** 1日分の venues から、race_id → 確定情報（raceResultAudit.js）の索引を作る（1日1回でよい） */
export function buildRaceFactsForDay(day) {
  if (!day || !day.k) return new Map();
  return kVenuesToRaceFacts(day.k.venues, day.date);
}

/**
 * Kファイルの人気（popularity）を勝式ごとに抽出する。raceResultAudit.js の fact.payouts は
 * 金額の突合にしか使わないため popularity を持たない。ここだけ kb-day の生の race.payouts
 * （kind: win/place/exacta/quinella/wide/trifecta/trio）から直接読む。
 * @param {object[]} payouts kb-day の race.payouts
 */
function popularityByKind(payouts, kind, idx = 0) {
  return payouts.filter((p) => p.kind === kind)[idx]?.popularity ?? null;
}

/**
 * race_results への挿入行を組み立てる。呼び出し側は、classifyMissingResult が FOUND を返した
 * レースにのみ使うこと。rank1〜3のNOT NULL制約があるため、有効な着順が3未満のレース
 * （通常は起こらない。全艇欠場等の異常）は呼び出し側で除外すること。
 *
 * @param {string} raceId
 * @param {ReturnType<typeof kVenuesToRaceFacts> extends Map<string, infer F> ? F : never} fact
 *   buildRaceFactsForDay(day).get(raceId)。undefinedなら組み立てない
 * @param {object} race kb-day の venue.races の1要素（technique・payoutsの人気の取得に使う）
 * @returns {{row: object|null, valid: boolean, boatsInOrder: number[]}}
 *   valid=false または boatsInOrder.length<3 の場合は row=null（呼び出し側は書き込まない）
 */
export function buildRaceResultRow(raceId, fact, race) {
  if (!fact) return { row: null, valid: false, boatsInOrder: [] };
  const boatsInOrder = fact.finisherBoats;
  const valid = new Set(boatsInOrder).size === boatsInOrder.length;
  if (!valid || boatsInOrder.length < 3) {
    return { row: null, valid, boatsInOrder };
  }

  // bet_type（raceResultAudit.jsの命名。win/place/2tan/2fuku/wide/3tan/3fuku）ごとの金額を、
  // 出現順（複勝・拡連複は2〜3件ある）で対応する列に割り当てる。列名・逆転（3tan→payout_trio、
  // 3fuku→payout_trifecta）は PAYOUT_COLUMNS_BY_KIND に一元化済みのものを使う
  const row = {
    race_id: raceId,
    rank1: boatsInOrder[0] ?? null,
    rank2: boatsInOrder[1] ?? null,
    rank3: boatsInOrder[2] ?? null,
    rank4: boatsInOrder[3] ?? null,
    rank5: boatsInOrder[4] ?? null,
    rank6: boatsInOrder[5] ?? null,
    is_cancelled: false,
    is_no_race: false,
    actual_course_1: fact.courses[1] ?? null,
    actual_course_2: fact.courses[2] ?? null,
    actual_course_3: fact.courses[3] ?? null,
    actual_course_4: fact.courses[4] ?? null,
    actual_course_5: fact.courses[5] ?? null,
    actual_course_6: fact.courses[6] ?? null,
    winning_technique: race.technique ?? null,
  };
  for (const column of Object.values(PAYOUT_COLUMNS_BY_KIND).flat()) {
    row[column] = null; // 該当が無い勝式は列を明示的にnullにする（既存値がある行は呼び出し側でupsertChangedRowsが保護する）
  }
  const seenPerBetType = {};
  for (const p of fact.payouts) {
    const columns = PAYOUT_COLUMNS_BY_KIND[p.bet_type] ?? [];
    const idx = seenPerBetType[p.bet_type] ?? 0;
    seenPerBetType[p.bet_type] = idx + 1;
    if (columns[idx] !== undefined) row[columns[idx]] = p.amount;
  }

  row.popularity_exacta = popularityByKind(race.payouts, "exacta");
  row.popularity_quinella = popularityByKind(race.payouts, "quinella");
  row.popularity_wide_1 = popularityByKind(race.payouts, "wide", 0);
  row.popularity_wide_2 = popularityByKind(race.payouts, "wide", 1);
  row.popularity_wide_3 = popularityByKind(race.payouts, "wide", 2);
  // 本体テーブルの命名逆転（PAYOUT_COLUMNS_BY_KINDと同じ向き）: kbの trio(3連複)→popularity_trifecta列、
  // kbの trifecta(3連単)→popularity_trio列
  row.popularity_trifecta = popularityByKind(race.payouts, "trio");
  row.popularity_trio = popularityByKind(race.payouts, "trifecta");

  return { row, valid, boatsInOrder };
}
