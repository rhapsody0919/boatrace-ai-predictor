// 選手ページの回収率の全国の基準（docs/design/racer-return-baseline/db-draft.md）の試験データと、期待する合計。
// verify-racer-boat-return-baseline.js（SQL を PGlite で流す）と verify-racer-boat-return-baseline-pure.js（選手ページの純関数）が
// 同じ期待を確かめ、2つがそろって「SQL の合計 = 選手ページの純関数の合計」を守る。

/** 試験の走。ranks は1〜3着の艇番、marks は着順なし（F 等）の艇番→記号。status が no_race は不成立 */
export const RACES = [
  { id: "2026-10-01-01-01", venue: 1, ranks: [1, 2, 3], win: 150, p1: 110, p2: 130, trio: 1200 },
  { id: "2026-10-02-01-01", venue: 1, ranks: [4, 1, 2], win: 1800, p1: 400, p2: 120, trio: 25000 },
  { id: "2026-10-03-02-01", venue: 2, ranks: [6, 3, 1], win: 5010, p1: 900, p2: 300, trio: null },
  { id: "2026-10-04-02-01", venue: 2, ranks: [1, 6, 5], win: 120, p1: 100, p2: 220, trio: 3000, marks: { 4: "F" } },
  // 数えない走: 不成立・rank1 が NULL・会場なし・窓の外
  { id: "2026-10-05-01-01", venue: 1, ranks: [1, 2, 3], win: 999, p1: 999, p2: 999, trio: 99999, status: "no_race" },
  { id: "2026-10-06-01-01", venue: 1, ranks: [null, null, null], win: null, p1: null, p2: null, trio: null },
  { id: "2026-10-07-03-01", venue: null, ranks: [1, 2, 3], win: 999, p1: 999, p2: 999, trio: 99999 },
  { id: "2026-09-30-01-01", venue: 1, ranks: [1, 2, 3], win: 999, p1: 999, p2: 999, trio: 99999 },
];

export const WINDOW = { from: "2026-10-01", to: "2026-10-31" };

/** 艇ごとの期待（払戻金100円あたりの合計）。数える走は上の4レースだけ */
export const EXPECTED = [
  { boat: 1, runs: 4, win_sum: 270, place_sum: 330, tri_pos1_sum: 4200, tri_pos2_sum: 25000, tri_pos3_sum: 0 },
  { boat: 2, runs: 4, win_sum: 0, place_sum: 130, tri_pos1_sum: 0, tri_pos2_sum: 1200, tri_pos3_sum: 25000 },
  { boat: 3, runs: 4, win_sum: 0, place_sum: 300, tri_pos1_sum: 0, tri_pos2_sum: 0, tri_pos3_sum: 1200 },
  { boat: 4, runs: 4, win_sum: 1800, place_sum: 400, tri_pos1_sum: 25000, tri_pos2_sum: 0, tri_pos3_sum: 0 },
  { boat: 5, runs: 4, win_sum: 0, place_sum: 0, tri_pos1_sum: 0, tri_pos2_sum: 0, tri_pos3_sum: 3000 },
  { boat: 6, runs: 4, win_sum: 5010, place_sum: 1120, tri_pos1_sum: 0, tri_pos2_sum: 3000, tri_pos3_sum: 0 },
];

/** 選手ページの履歴の行（getRacerRaceHistory の除外と同じ: 会場あり・rank1 あり・不成立でない・窓の中） */
export function historyRows() {
  return RACES.filter(
    (r) => r.venue !== null && r.ranks[0] !== null && r.status !== "no_race" && r.id >= WINDOW.from && r.id <= `${WINDOW.to}~`,
  ).flatMap((r) =>
    [1, 2, 3, 4, 5, 6].map((b) => ({
      raceId: r.id,
      venueCode: r.venue,
      raceGrade: null,
      raceStage: null,
      boatNumber: b,
      rank1: r.ranks[0],
      rank2: r.ranks[1],
      rank3: r.ranks[2],
      payoutWin: r.win,
      payoutPlace1: r.p1,
      payoutPlace2: r.p2,
      unranked: Boolean(r.marks?.[b]),
    })),
  );
}
