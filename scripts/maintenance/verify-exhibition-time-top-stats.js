/**
 * verify-exhibition-time-top-stats.js - 展示タイム1位率の集計（update-exhibition-time-top-stats.js）の検証（BOA-520）
 *
 * PR #917 のレビューで、exhibition_data に展示タイムが NULL の行（展示STが先に公開される会場=BOA-356、
 * 展示航走の前に当日体重・調整重量だけを書いた行=BOA-500、展示が行われずに終わったレース）が混ざると、
 * race_count（分母）だけが増え、Math.min が NULL を 0 とみなして最速艇を決められず fastest_count（分子）が
 * 増えないため、「展示1位率」が薄まることが分かった（2026-09-28 の実測で直近90日に355レース）。
 *
 * DBにも取得先にも接続しない（集計の純粋関数だけ）。
 *
 * 確認すること:
 *   (a) NULL の行が混ざっても、NULL を除いた入力と同じ結果になる（分母が増えない・最速艇が決まる）
 *   (b) 展示タイムが全艇 NULL のレースは、集計に入らない
 *   (c) 同タイムの最速（同着）は、最速の回数に数えず、参加数には数える（既存の仕様）
 *   (d) 最速の艇が1着なら、最速時の1着の回数に数える
 *   (e) 変異検証: NULL を除かない版（修正前の集計）では、(a)(b) が失敗する
 */
import { aggregateExhibitionTimeTop } from "../daily/update-exhibition-time-top-stats.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const TODAY = "2026-09-29";

// 会場12（住之江）の3レース
//   R1: 1号艇が最速（6.70）で1着
//   R2: 3号艇が最速（6.72）、1着は1号艇
//   R3: 1・2号艇が同タイム（6.75）＝同着
const race = (raceNo, times) =>
  times.map((t, i) => ({
    race_id: `2026-09-20-12-${String(raceNo).padStart(2, "0")}`,
    boat_number: i + 1,
    exhibition_time: t,
  }));
const CLEAN = [
  ...race(1, [6.7, 6.8, 6.81, 6.82, 6.83, 6.84]),
  ...race(2, [6.8, 6.81, 6.72, 6.83, 6.84, 6.85]),
  ...race(3, [6.75, 6.75, 6.8, 6.81, 6.82, 6.83]),
];
// NULL の行: R2 の6号艇だけ NULL（展示STだけ先に出た等）、R4 は全艇 NULL（展示前の当日体重だけの行）
const WITH_NULLS = [
  ...CLEAN.map((r) =>
    r.race_id.endsWith("-02") && r.boat_number === 6
      ? { ...r, exhibition_time: null }
      : r,
  ),
  ...race(4, [null, null, null, null, null, null]),
];
// R2 の6号艇が NULL になった分、正しい入力は「R2 の6号艇の行が無い」ものと同じ
const CLEAN_EQUIVALENT = CLEAN.filter(
  (r) => !(r.race_id.endsWith("-02") && r.boat_number === 6),
);
const RESULTS = [
  { race_id: "2026-09-20-12-01", rank1: 1 },
  { race_id: "2026-09-20-12-02", rank1: 1 },
  { race_id: "2026-09-20-12-03", rank1: 2 },
  { race_id: "2026-09-20-12-04", rank1: 4 },
];

const byBoat = (records) =>
  Object.fromEntries(records.map((r) => [r.boat_number, r]));
const sorted = (records) =>
  [...records].sort((a, b) => a.boat_number - b.boat_number);

/** 観測: NULL の行が混ざっても、NULL を除いた入力と同じ集計になる */
function nullRowsIgnored(aggregate = aggregateExhibitionTimeTop) {
  const a = sorted(aggregate(WITH_NULLS, RESULTS, { today: TODAY }));
  const b = sorted(
    aggregateExhibitionTimeTop(CLEAN_EQUIVALENT, RESULTS, { today: TODAY }),
  );
  return show(a) === show(b);
}
/** 観測: 全艇 NULL のレース（R4）は、参加数にも入らない（1号艇の参加は R1〜R3 の3） */
function allNullRaceExcluded(aggregate = aggregateExhibitionTimeTop) {
  const boats = byBoat(aggregate(WITH_NULLS, RESULTS, { today: TODAY }));
  return boats[1]?.race_count === 3 && boats[4]?.race_count === 3;
}

{
  const boats = byBoat(
    aggregateExhibitionTimeTop(CLEAN, RESULTS, { today: TODAY }),
  );
  check(
    "(c)(d) 基本: 1号艇は参加3・最速1（R1。R3 は同着で数えない）・最速時1着1。3号艇は参加3・最速1（R2）・最速時1着0。2号艇は最速0（同着のみ）",
    boats[1].race_count === 3 &&
      boats[1].fastest_count === 1 &&
      boats[1].win_count_when_fastest === 1 &&
      boats[1].fastest_rate === 33.33 &&
      boats[1].win_rate_when_fastest === 100 &&
      boats[3].race_count === 3 &&
      boats[3].fastest_count === 1 &&
      boats[3].win_count_when_fastest === 0 &&
      boats[2].fastest_count === 0 &&
      boats[2].win_rate_when_fastest === 0 &&
      boats[1].last_updated === TODAY &&
      boats[1].venue_code === 12,
    show(boats),
  );
  check(
    "(a) NULL の行が混ざっても、NULL を除いた入力と同じ集計になる（分母が増えず、R2 の最速艇（3号艇）も決まる）",
    nullRowsIgnored(),
    show(
      sorted(aggregateExhibitionTimeTop(WITH_NULLS, RESULTS, { today: TODAY })),
    ),
  );
  check(
    "(b) 展示タイムが全艇 NULL のレース（R4）は、参加数に入らない",
    allNullRaceExcluded(),
  );
}

{
  // (e) 変異検証: 修正前の集計（NULL の行を除かない）を、集計の中で NULL を 0 以外で残して再現する。
  // 集計は NULL を除くため、NULL を「数値のふり」（Number(null)=0 にならない NaN）で渡し、除外をすり抜けさせる
  const withoutNullGuard = (rows, results, options) => {
    const leaked = rows.map((r) =>
      r.exhibition_time == null ? { ...r, exhibition_time: Number.NaN } : r,
    );
    return aggregateExhibitionTimeTop(leaked, results, options);
  };
  check(
    "変異検証の前提: 正しい実装は (a)(b) に合格する",
    nullRowsIgnored() && allNullRaceExcluded(),
  );
  check(
    "変異検証: 「NULL の行を除かない」版（修正前）では、分母が増え最速艇が決まらず、(a)(b) が失敗する",
    !nullRowsIgnored(withoutNullGuard) &&
      !allNullRaceExcluded(withoutNullGuard),
    show(
      sorted(withoutNullGuard(WITH_NULLS, RESULTS, { today: TODAY })).map(
        (r) => [r.boat_number, r.race_count, r.fastest_count],
      ),
    ),
  );
}

console.log("");
if (failures > 0) {
  console.error(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}
console.log("✅ すべての検証に成功しました");
