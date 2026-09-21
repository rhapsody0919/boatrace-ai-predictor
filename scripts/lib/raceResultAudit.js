/**
 * 既存の race_results の誤り（Q6: 返還・不成立の払戻¥100、非完走艇の着順）を特定する純関数群。
 * DB・取得先に接続しない（入力は、読み取った行・Kファイルのテキスト）。CLI は
 * scripts/maintenance/audit-race-result-anomalies.js。
 *
 * 2段階で判定する:
 *   1. DBの行だけで分かる範囲（analyzeRaceFromDb）: フライング（race_start_timings.is_flying）と
 *      欠場（Kファイル同期済みで actual_course_N が NULL の艇）を非完走艇とみなし、着順の位置・払戻の¥100を調べる。
 *      出遅れ（L）・落水・転覆・沈没・妨害・エンストの艇は、DBの行からは分からない（下限値）。
 *      払戻の¥100は、正しい払戻（100円=1.0倍）と区別できないため、「疑い」までしか言えない
 *   2. Kファイル（1日=全会場の確定値）との突合（compareRaceWithKDay）: 着欄・不成立の表記から確定できる。
 *      1リクエストで1日分（全会場）
 */

import { parseKText } from "./kbFileParser.js";

const RANK_COLUMNS = ["rank1", "rank2", "rank3", "rank4", "rank5", "rank6"];

/** race_results の払戻の列（旧列名。payout_trifecta=3連複、payout_trio=3連単） */
export const PAYOUT_COLUMNS_BY_KIND = Object.freeze({
  win: ["payout_win"],
  place: ["payout_place_1", "payout_place_2"],
  "2tan": ["payout_exacta"],
  "2fuku": ["payout_quinella"],
  wide: ["payout_wide_1", "payout_wide_2", "payout_wide_3"],
  "3tan": ["payout_trio"],
  "3fuku": ["payout_trifecta"],
});

/**
 * 1レース分の、DBの行だけで分かる誤りの判定。
 *
 * @param {Record<string, unknown>} race race_results の行（race_id・rank1〜6・payout_*・actual_course_1〜6）に、
 *   fBoats（race_start_timings で is_flying の枠番の配列）を足したもの
 */
export function analyzeRaceFromDb(race) {
  const courses = [1, 2, 3, 4, 5, 6].map((n) => race[`actual_course_${n}`]);
  const kSynced = courses.some((c) => c !== null && c !== undefined);
  const absentBoats = kSynced
    ? [1, 2, 3, 4, 5, 6].filter(
        (n) => courses[n - 1] === null || courses[n - 1] === undefined,
      )
    : [];
  const fBoats = [...(race.fBoats ?? [])].sort((a, b) => a - b);
  const nonFinishers = [...new Set([...fBoats, ...absentBoats])].sort(
    (a, b) => a - b,
  );
  const finishers = 6 - nonFinishers.length;
  const ranks = RANK_COLUMNS.map((c) => race[c] ?? null);
  const pollutedSlots = ranks
    .map((boat, i) =>
      boat !== null && nonFinishers.includes(boat) ? i + 1 : null,
    )
    .filter((slot) => slot !== null);
  const rank456Polluted = pollutedSlots.filter((slot) => slot >= 4);
  // 完走が3艇未満のレースは、rank1〜3（NOT NULL）が非完走艇で埋まる。構造上、当面残る
  const rank123Polluted = pollutedSlots.filter((slot) => slot <= 3);

  // 払戻の¥100。完走が2艇以下（不成立の勝式がある）レースで、3連単・3連複が100なら、返還の¥100が
  // 払戻として入っている可能性が高い（100円=1.0倍の正しい払戻とは、この列だけでは区別できない）
  const suspectColumns = [];
  if (nonFinishers.length > 0 && finishers <= 2) {
    for (const column of [
      ...PAYOUT_COLUMNS_BY_KIND["3tan"],
      ...PAYOUT_COLUMNS_BY_KIND["3fuku"],
    ]) {
      if (race[column] === 100) suspectColumns.push(column);
    }
  }
  return {
    race_id: race.race_id,
    kSynced,
    fBoats,
    absentBoats,
    nonFinishers,
    finishers,
    rank456Polluted,
    rank123Polluted,
    suspectPayoutColumns: suspectColumns,
    // 3連単が100円になることは無い（120通りの組から1通り。1.0倍は成立しない）。100なら、不成立の返還額が払戻に入っている
    trio100: race.payout_trio === 100,
    // 3連複の100円は、1.0倍の正しい払戻（低配当）のことがある。非完走艇があるレースで100なら疑い
    trifecta100: race.payout_trifecta === 100,
    // 欠場艇が着順の位置に入っている（BOA-362の型）
    absentInRanks: pollutedSlots.filter((slot) =>
      absentBoats.includes(ranks[slot - 1]),
    ),
  };
}

/** race_id から開催日・会場コード・レース番号 */
export function parseRaceId(raceId) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/.exec(raceId);
  if (!m) throw new Error(`race_id の形式が不正です: ${raceId}`);
  return { date: m[1], venue: Number(m[2]), race: Number(m[3]) };
}

/**
 * DBだけで分かる誤りの集計（件数・期間・月別・会場別）。
 *
 * @param {Array<ReturnType<typeof analyzeRaceFromDb>>} analyses
 * @param {number} totalRaces 対象期間の race_results の行数
 */
export function summarizeDbFindings(analyses, totalRaces) {
  const flagged = analyses.filter(
    (a) =>
      a.rank456Polluted.length > 0 ||
      a.rank123Polluted.length > 0 ||
      a.suspectPayoutColumns.length > 0 ||
      a.trio100,
  );
  const by = (list, keyFn) => {
    const counts = {};
    for (const a of list) {
      const key = keyFn(a);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.fromEntries(
      Object.entries(counts).sort(([x], [y]) => x.localeCompare(y)),
    );
  };
  const month = (a) => a.race_id.slice(0, 7);
  const venue = (a) => String(parseRaceId(a.race_id).venue).padStart(2, "0");
  const withF = analyses.filter((a) => a.fBoats.length > 0);
  const withAbsent = analyses.filter((a) => a.absentBoats.length > 0);
  return {
    totalRaces,
    withF: withF.length,
    withFByCount: by(withF, (a) => String(a.fBoats.length)),
    withAbsent: withAbsent.length,
    rank456Polluted: analyses.filter((a) => a.rank456Polluted.length > 0)
      .length,
    absentInRanks: analyses.filter((a) => a.absentInRanks.length > 0).length,
    rank123Polluted: analyses.filter((a) => a.rank123Polluted.length > 0)
      .length,
    suspectPayout: analyses.filter((a) => a.suspectPayoutColumns.length > 0)
      .length,
    trio100: analyses.filter((a) => a.trio100).length,
    trifecta100: analyses.filter((a) => a.trifecta100).length,
    trifecta100WithNonFinisher: analyses.filter(
      (a) => a.trifecta100 && a.nonFinishers.length > 0,
    ).length,
    flagged: flagged.length,
    flaggedByMonth: by(flagged, month),
    flaggedByVenue: by(flagged, venue),
    flaggedRaceIds: flagged.map((a) => a.race_id),
  };
}

// ---------------------------------------------------------------------------
// Kファイルとの突合（確定値）
// ---------------------------------------------------------------------------

/** kbFileParser の勝式名 → race_payouts の bet_type */
export const K_KIND_TO_BET_TYPE = Object.freeze({
  win: "win",
  place: "place",
  exacta: "2tan",
  quinella: "2fuku",
  wide: "wide",
  trifecta: "3tan",
  trio: "3fuku",
});

/** Kファイルの着欄コード → 返還される艇か（F・L・欠は返還、S（失格・落水・転覆・妨害等）は返還されない） */
export function isRefundedKFinish(finishRaw) {
  return /^(F|L\d?|K\d?)$/.test(finishRaw);
}

/**
 * Kファイルのテキストから、レースごとの確定情報を取り出す。
 *
 * @param {string} text
 * @param {string} date YYYY-MM-DD
 * @returns {Map<string, {race_id: string, finisherBoats: number[], refundBoats: number[], noRaceKinds: string[], marks: Record<number, string>, courses: Record<number, number|null>, payouts: Array<{bet_type: string, combination: string|null, amount: number|null, special: string|null}>, hasRows: boolean}>}
 */
export function kDayToRaceFacts(text, date) {
  return kVenuesToRaceFacts(parseKText(text).venues, date);
}

/**
 * 解析済みの会場（parseKText の venues）から、レースごとの確定情報を取り出す。確定（complete）の会場のみ。
 * 同じKファイルの解析結果を、複数の用途（rank・払戻・進入の突合と、会場ごとの状態の確認）で共有するため、
 * kDayToRaceFacts から分けている（日次の照合 scripts/lib/dailyReconcile.js が使う）。
 *
 * courses: 艇番 → Kファイルの進入コース（欠場艇・進入の欄が空の艇は null）。
 * payouts: Kファイルの払戻明細（bet_type は race_payouts と同じ命名。不成立・空欄は special に理由が入る）。
 */
export function kVenuesToRaceFacts(venues, date) {
  const facts = new Map();
  for (const venue of venues) {
    if (venue.status !== "complete") continue;
    for (const race of venue.races) {
      const raceId = `${date}-${String(venue.venue_code).padStart(2, "0")}-${String(race.race_number).padStart(2, "0")}`;
      // 着順どおり（同着は出現順）に完走した艇。着欄が「01」〜「06」の艇
      const finisherBoats = race.rows
        .filter((r) => r.rank !== null)
        .map((r) => r.boat_number);
      const refundBoats = race.rows
        .filter((r) => isRefundedKFinish(r.finish_raw))
        .map((r) => r.boat_number)
        .sort((a, b) => a - b);
      // kbFileParser の勝式名（exacta=2連単・quinella=2連複・trifecta=3連単・trio=3連複）を、本モジュールの
      // bet_type（race_payouts と同じ）に揃える
      const noRaceKinds = [
        ...new Set(
          race.payouts
            .filter((p) => p.special === "不成立")
            .map((p) => K_KIND_TO_BET_TYPE[p.kind]),
        ),
      ];
      const marks = Object.fromEntries(
        race.rows.map((r) => [r.boat_number, r.finish_raw]),
      );
      const courses = Object.fromEntries(
        race.rows.map((r) => [r.boat_number, r.course ?? null]),
      );
      const payouts = race.payouts.map((p) => ({
        bet_type: K_KIND_TO_BET_TYPE[p.kind],
        combination: p.combo ?? null,
        amount: p.amount ?? null,
        special: p.special ?? null,
      }));
      facts.set(raceId, {
        race_id: raceId,
        finisherBoats,
        refundBoats,
        noRaceKinds,
        marks,
        courses,
        payouts,
        hasRows: race.rows.length > 0,
      });
    }
  }
  return facts;
}

/**
 * DBの行とKファイルの確定情報を突合し、誤りを列挙する。
 *   rank456        DBの rank4〜6 が、Kの完走艇（4〜6着）と違う
 *   rank123        Kの完走が3艇以上なのに、DBの rank1〜3 が違う
 *   refund_payout  Kで不成立の勝式の払戻列が、100（返還額）で保存されている
 *
 * @param {Record<string, unknown>} row race_results の行
 * @param {ReturnType<typeof kDayToRaceFacts> extends Map<string, infer F> ? F : never} fact
 */
export function compareRaceWithKDay(row, fact) {
  const defects = [];
  const finishers = fact.finisherBoats;
  const dbRanks = RANK_COLUMNS.map((c) => row[c] ?? null);
  const expected456 = [3, 4, 5].map((i) => finishers[i] ?? null);
  if (dbRanks.slice(3).some((boat, i) => boat !== expected456[i])) {
    // rank4〜6が全て NULL のまま（Kファイル同期の前）は「未充填」で、非完走艇が入った誤りとは別に数える
    const unfilled = dbRanks.slice(3).every((boat) => boat === null);
    defects.push({
      kind: unfilled ? "rank456_unfilled" : "rank456",
      db: dbRanks.slice(3),
      k: expected456,
    });
  }
  if (finishers.length >= 3) {
    const expected123 = finishers.slice(0, 3);
    // 同着（Kは同じ着が複数行）でも、出現順が公式の表の行順と一致する（既存の rank456 同期と同じ前提）
    if (dbRanks.slice(0, 3).some((boat, i) => boat !== expected123[i])) {
      defects.push({
        kind: "rank123",
        db: dbRanks.slice(0, 3),
        k: expected123,
      });
    }
  }
  for (const kind of fact.noRaceKinds) {
    const columns = PAYOUT_COLUMNS_BY_KIND[kind] ?? [];
    const stored = columns.filter((c) => row[c] === 100);
    if (stored.length > 0) {
      defects.push({ kind: "refund_payout", bet: kind, columns: stored });
    }
  }
  return defects;
}
