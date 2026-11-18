/**
 * RaceMeetTab 比較表の注記（RaceMeetTabCompareSide.jsx）の人数の行の文言を作る純関数（副作用なし）。
 * 値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。文言は m.t で引く。
 */

// 人数の行の文言（節の出場・順位の対象・除く人数・まだ走っていない人数）
export function countLineText(m) {
  const { t, ranking, rankedOnly, absentOnly, notYetStarted } = m;
  const { seriesSplit, entrantCount } = m;
  // 全部の走が欠場の選手も順位の対象外。数えないと「47人（対象42人・
  // 4人を除く）」と足し算が合わない（BOA-660）
  const excluded = ranking.length - rankedOnly.length + absentOnly.length;
  // まだ1走もしていない選手も順位にまだ入らない。書かないと初日に
  // 「48人（対象44人・1人を除く）」と合わなかった（BOA-690）
  // 全員がまだ走っていない（初日の1R等）なら「順位の対象は0人」と書かない。
  // 初戦を欠場した選手がいれば「全員が初戦」は誤りなので、従来の書き方に戻す
  if (rankedOnly.length === 0 && excluded === 0 && notYetStarted > 0)
    return t(`meetTab.compareSub${seriesSplit ? "Series" : ""}AllNotYet`, {
      all: entrantCount,
    });
  const variant =
    excluded > 0 && notYetStarted > 0
      ? "ExcludedNotYet"
      : excluded > 0
        ? "Excluded"
        : notYetStarted > 0
          ? "NotYet"
          : "";
  return t(`meetTab.compareSub${seriesSplit ? "Series" : ""}${variant}`, {
    all: entrantCount,
    total: variant ? rankedOnly.length : entrantCount,
    excluded,
    notYet: notYetStarted,
  });
}
