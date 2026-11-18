/**
 * scripts/daily/scrape-results.js の行の組み立て・判定のうち、DB に触らない純粋な部分。
 * buildRaceResultRow の払戻・人気・進入の列と、Kファイル同期の rank4〜6 の照合・成績コードの書く行の選び出し。
 * 書き込み（表・onConflict・列）は呼び出し元のまま。ここは値を作るだけ。
 */

const sortedPairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");
const amountOf = (entry) => entry?.amount ?? null;
const popularityOf = (entry) => entry?.popularity ?? null;

/**
 * scrapePayouts() の構造（combo 単位で {amount, popularity}）から、実際の着順に対応するコンボを引き当てる。
 * 特払は組番が無く、キー「特払」で入る（raceResultRows.js buildLegacyPayouts）。着順の組番で引けなければ、
 * その額を使う（旧列にも特払は70を入れる。plan.md「race-result-full-fields」。BOA-383）。
 * 引けない組番が2つ以上ある勝式は、どれが特払か区別できないので使わない。例: 単勝が特払のレースでは、
 * 1着艇の複勝の払戻が空欄（no_amount）で旧形式に入らず、組番で引けない
 */
export function resultPayoutEntries(result) {
  const payouts = result.payouts || {};
  const entriesByCombo = (kind, combos) => {
    const map = payouts[kind] ?? {};
    const missing = combos.filter((c) => !map[c]).length;
    return combos.map(
      (c) => map[c] ?? (missing === 1 ? map["特払"] : undefined),
    );
  };
  const win = payouts.win ? Object.values(payouts.win)[0] : null;
  const [place1, place2] = entriesByCombo("place", [
    String(result.rank1),
    String(result.rank2),
  ]);
  const trio = payouts.trio ? Object.values(payouts.trio)[0] : null;
  const trifecta = payouts.trifecta
    ? Object.values(payouts.trifecta)[0]
    : null;
  const [exacta] = entriesByCombo("exacta", [
    `${result.rank1}-${result.rank2}`,
  ]);
  const [quinella] = entriesByCombo("quinella", [
    sortedPairKey(result.rank1, result.rank2),
  ]);
  const [wide1, wide2, wide3] = entriesByCombo("wide", [
    sortedPairKey(result.rank1, result.rank2),
    sortedPairKey(result.rank1, result.rank3),
    sortedPairKey(result.rank2, result.rank3),
  ]);
  return { win, place1, place2, trio, trifecta, exacta, quinella, wide1, wide2, wide3 };
}

/** race_results の払戻の列（payout_*） */
export function payoutColumns(e) {
  return {
    payout_win: amountOf(e.win),
    payout_place_1: amountOf(e.place1),
    payout_place_2: amountOf(e.place2),
    payout_trifecta: amountOf(e.trifecta),
    payout_trio: amountOf(e.trio),
    payout_exacta: amountOf(e.exacta),
    payout_quinella: amountOf(e.quinella),
    payout_wide_1: amountOf(e.wide1),
    payout_wide_2: amountOf(e.wide2),
    payout_wide_3: amountOf(e.wide3),
  };
}

/** race_results の人気の列（popularity_*） */
export function popularityColumns(e) {
  return {
    popularity_trifecta: popularityOf(e.trifecta),
    popularity_trio: popularityOf(e.trio),
    popularity_exacta: popularityOf(e.exacta),
    popularity_quinella: popularityOf(e.quinella),
    popularity_wide_1: popularityOf(e.wide1),
    popularity_wide_2: popularityOf(e.wide2),
    popularity_wide_3: popularityOf(e.wide3),
  };
}

/** race_results の進入の列（course_1〜6） */
export function courseColumns(courseInfo) {
  return {
    course_1: courseInfo?.course_1 || null,
    course_2: courseInfo?.course_2 || null,
    course_3: courseInfo?.course_3 || null,
    course_4: courseInfo?.course_4 || null,
    course_5: courseInfo?.course_5 || null,
    course_6: courseInfo?.course_6 || null,
  };
}

/**
 * rank4〜6 の同期で、Kファイルの行 k を使えない理由（使えるなら null）。
 * 使うのは、Kファイルに有り・重複艇番が無く・1〜3着が既存の rank1〜3 と完全一致するときだけ
 */
export function rank456SkipReason(race, k) {
  if (
    !k ||
    !k.valid ||
    k.rank1 !== race.rank1 ||
    k.rank2 !== race.rank2 ||
    k.rank3 !== race.rank3
  ) {
    return !k
      ? "not_in_kfile"
      : !k.valid
        ? "duplicate_boat_in_kfile"
        : "rank1_3_mismatch";
  }
  return null;
}

/** rank4〜6 のスキップのログの行（race_id・理由・両側の値） */
export function rank456SkipLine(race, k, reason) {
  return (
    `  ⚠️ rank456スキップ(${race.race_id}): ${reason}` +
    (k
      ? ` db=[${race.rank1},${race.rank2},${race.rank3}] kfile=[${k.rank1},${k.rank2},${k.rank3}]`
      : "")
  );
}

/** Kファイルにも4〜6着が無いか */
export const hasNoRank456 = (k) =>
  k.rank4 == null && k.rank5 == null && k.rank6 == null;

/** 成績コードの今の値（race_id|艇番 → 値）と、値の無い行の数 */
export function startTimingCodeState(timings, column) {
  const current = new Map(
    timings.map((t) => [`${t.race_id}|${t.boat_number}`, t[column] ?? null]),
  );
  const pending = timings.filter((t) => (t[column] ?? null) === null).length;
  return { current, pending };
}
