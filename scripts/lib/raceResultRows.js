/**
 * 結果ページの全項目（scripts/lib/raceResultParser.js）から、DBへ書く行・旧形式の解析結果を作る（純関数）。
 *
 * 旧形式（scripts/daily/scrape-results.js の parseRaceResultHtml が返していた形）との互換を保つ:
 *   rank1〜3・race_time・払戻・人気・course_1〜6・startTimings は、旧実装と同じ値になる。変わるのは、
 *     (a) 欠場・フライング等の非完走艇が rank4〜6 に入らない（BOA-362。旧: 表の行順で埋めていた）
 *     (b) 「不成立」の払戻¥100が払戻に入らない（旧: payout_trifecta 等に100が入っていた）
 *   の2点だけ（docs/design/race-result-full-fields/plan.md「互換」）。
 *   rank1〜3 は、完走が3艇未満のレース（不成立）では、NOT NULL制約と既存の読み手のため、旧実装どおり
 *   表の行順（非完走艇を含む）で埋める。そのレースは race_status で区別する。
 */

import { classifyRaceStatus } from "./raceResultParser.js";

/** legacy の払戻構造のキー（旧列名の逆転: trifecta=3連複、trio=3連単）と、bet_type の対応 */
const LEGACY_PAYOUT_KEY = Object.freeze({
  win: "win",
  place: "place",
  "2tan": "exacta",
  "2fuku": "quinella",
  wide: "wide",
  "3tan": "trio",
  "3fuku": "trifecta",
});

/**
 * 旧形式の払戻構造（{win:{組番:{amount,popularity}}, ...}）を作る。
 * 払われる額があるもの（通常・特払）だけを入れる。不成立・金額なしは入れない（旧実装は、不成立の
 * 「¥100」を金額として入れていた）。特払は、組番が無いため、旧実装と同じキー「特払」で入れる。
 */
function buildLegacyPayouts(payoutRows) {
  const payouts = {
    win: {},
    place: {},
    trifecta: {},
    trio: {},
    exacta: {},
    quinella: {},
    wide: {},
  };
  for (const row of payoutRows) {
    if (row.payout_status !== "paid" && row.payout_status !== "special") {
      continue;
    }
    if (row.payout === null || row.payout <= 0) continue;
    payouts[LEGACY_PAYOUT_KEY[row.bet_type]][row.combination ?? "特払"] = {
      amount: row.payout,
      popularity: row.popularity,
    };
  }
  return payouts;
}

/**
 * 全項目の解析結果を、旧形式（parseRaceResultHtml の戻り値）＋新しい項目にする。
 * 着順を取れない（着順表が無い・3艇未満・艇番の重複）場合は、3連単の払戻の組番から上位3着を復元する。
 * 復元もできなければ null（未公開・構造の違い）。
 *
 * @param {ReturnType<import("./raceResultParser.js").parseRaceResultPage>} full
 * @param {{log?: (message: string) => void}} [options]
 */
export function toLegacyResult(full, { log = () => {} } = {}) {
  const rowOrder = full.boats.map((b) => b.boat_number);
  const hasDuplicates =
    rowOrder.length > 0 && new Set(rowOrder).size !== rowOrder.length;
  const legacyPayouts = buildLegacyPayouts(full.payouts);

  let rankings;
  let raceTimes;
  let rank456;
  if (full.boats.length < 3 || hasDuplicates) {
    // 3連単（旧列名では trio）の組番は、1〜3着の艇番をそのまま表す
    const trifectaCombo = Object.keys(legacyPayouts.trio)[0];
    const trifectaBoats = trifectaCombo
      ? trifectaCombo.split("-").map((n) => parseInt(n, 10))
      : [];
    const trifectaValid =
      trifectaBoats.length === 3 &&
      trifectaBoats.every((n) => n >= 1 && n <= 6) &&
      new Set(trifectaBoats).size === 3;
    if (!trifectaValid) {
      log(
        hasDuplicates
          ? `  Incomplete data (duplicate boat numbers: ${rowOrder.join("-")})`
          : `  Incomplete data (got ${rowOrder.length} boats)`,
      );
      return null;
    }
    log(`  着順テーブル欠落、3連単払戻(${trifectaCombo})から上位3着を復元`);
    rankings = trifectaBoats;
    raceTimes = [null, null, null];
    rank456 = [null, null, null];
  } else {
    const finishers = full.boats.filter((b) => b.finish_rank !== null);
    // 完走が3艇以上なら、非完走艇は表の最後に並ぶため、先頭3行=完走した3艇。3艇未満は旧実装どおり行順
    const top3 =
      finishers.length >= 3
        ? finishers.slice(0, 3).map((b) => b.boat_number)
        : rowOrder.slice(0, 3);
    rankings = top3;
    raceTimes = full.boats.slice(0, 6).map((b) => b.race_time);
    rank456 = [3, 4, 5].map((i) => finishers[i]?.boat_number ?? null);
  }

  const courseInfo = {};
  for (const row of full.start_info) {
    if (
      row.boatLabel !== null &&
      row.boatLabel >= 1 &&
      row.boatLabel <= 6 &&
      row.boatNumber
    ) {
      courseInfo[`course_${row.boatLabel}`] = row.boatNumber;
    }
  }
  const startTimings = full.start_info
    .filter((row) => row.startTiming !== null)
    .map((row) => ({
      boat_number: row.boatNumber,
      start_timing: row.startTiming,
      is_flying: row.isFlying,
      is_late_start: row.isLateStart,
    }));

  return {
    rank1: rankings[0],
    rank2: rankings[1],
    rank3: rankings[2],
    rank4: rank456[0],
    rank5: rank456[1],
    rank6: rank456[2],
    raceTime1: raceTimes[0] || null,
    raceTime2: raceTimes[1] || null,
    raceTime3: raceTimes[2] || null,
    raceTime4: raceTimes[3] || null,
    raceTime5: raceTimes[4] || null,
    raceTime6: raceTimes[5] || null,
    payouts: legacyPayouts,
    winningTechnique: full.winning_technique,
    courseInfo,
    startTimings,
    weather: full.weather,
    // 新しい項目（マイグレーション077〜079の適用後に書く。書く側は raceResultRows の各 build 関数）
    full,
  };
}

/**
 * race_results へ追加する列（マイグレーション078）。払戻表が読めなかった（race_status が null）場合は、
 * 3列とも書かない（判定できない値を、既定値の「通常」で上書きしない）。
 *
 * @param {NonNullable<ReturnType<typeof toLegacyResult>>} result
 */
export function buildResultExtras(result) {
  const { full } = result;
  if (full.race_status === null) return {};
  return {
    race_status: full.race_status,
    refund_boats: full.refund_boats,
    remark: full.remark,
  };
}

/**
 * race_start_timings の行（艇別の結果）を作る。
 *   extended=false（マイグレーション077が未適用）: 旧実装と同じ。STを読めた艇だけの行（is_late_start・進入等は書かない）
 *   extended=true: 着順表の全艇（欠場・出遅れ等、STの無い艇を含む）の行。着欄・着・進入・レースタイムを含む
 * 行の並びは、旧実装と同じ（スタート情報の行順）。
 *
 * @param {string} raceId
 * @param {NonNullable<ReturnType<typeof toLegacyResult>>} result
 * @param {{extended: boolean}} options
 */
export function buildTimingRows(raceId, result, { extended }) {
  if (!extended) {
    return result.startTimings.map((st) => ({ race_id: raceId, ...st }));
  }
  const { full } = result;
  const boatByNumber = new Map(full.boats.map((b) => [b.boat_number, b]));
  const ordered = [
    // スタート情報の行順（旧実装と同じ並び）→ 残り（欠場等、スタート情報に行が無い艇）を艇番順
    ...full.start_info
      .map((row) => boatByNumber.get(row.boatNumber))
      .filter((b) => b !== undefined),
    ...full.boats
      .filter((b) => b.entry_course === null)
      .sort((a, b) => a.boat_number - b.boat_number),
  ];
  return ordered.map((b) => ({
    race_id: raceId,
    boat_number: b.boat_number,
    start_timing: b.start_timing,
    is_flying: b.is_flying,
    is_late_start: b.is_late_start,
    finish_mark: b.finish_mark,
    finish_rank: b.finish_rank,
    entry_course: b.entry_course,
    race_seconds: b.race_seconds,
  }));
}

/**
 * race_payouts の行（払戻明細）を作る（マイグレーション079）。
 * 不成立の行は payout=null（表示の¥100は返還額で、払戻ではない）、特払は payout=70。
 *
 * @param {string} raceId
 * @param {NonNullable<ReturnType<typeof toLegacyResult>>} result
 */
export function buildPayoutRows(raceId, result) {
  return result.full.payouts.map((p) => ({
    race_id: raceId,
    bet_type: p.bet_type,
    seq: p.seq,
    combination: p.combination,
    payout: p.payout,
    payout_status: p.payout_status,
    popularity: p.popularity,
  }));
}

export { classifyRaceStatus };
