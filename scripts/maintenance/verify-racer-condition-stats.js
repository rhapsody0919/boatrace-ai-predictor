#!/usr/bin/env node
/**
 * verify-racer-condition-stats.js — 選手ページ「レース条件別の成績」（BOA-336）の集計を固定する。
 *
 * 検査すること（src/utils/racerConditionStats.js の aggregateRacerConditionStats）:
 * - 天候: 晴／曇り／雨・雪・台風（雪・台風は雨にまとめる）
 * - 風速: 5m以上／未満の境目（5m ちょうどは「以上」）
 * - 波高: 5cm以上／未満。江戸川（03）は母数から外す
 * - 全体は天候・風速・波高のいずれかが取れている走だけ（race_conditions の無い走を混ぜない）
 * - 着順の付かない走（unranked）は1走に数えるが、1着・2連対・3連対には数えない
 * - 5走未満の条件は行に出さない
 */
import {
  aggregateRacerConditionStats,
  tallyWinPlaceShow,
  RACER_CONDITION_MIN_RUNS,
} from "../../src/utils/racerConditionStats.js";

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

// 1走を作る。place は着順（1〜6）、unranked は着順の付かない走
function run({
  place = 4,
  weather = "晴",
  wind = 2,
  wave = 2,
  venue = 1,
  unranked = false,
}) {
  const boat = 1;
  const others = [2, 3, 4, 5, 6];
  const ranks = [...others];
  ranks.splice(place - 1, 0, boat);
  return {
    raceId: "2026-09-01-01-01",
    venueCode: venue,
    boatNumber: boat,
    rank1: ranks[0],
    rank2: ranks[1],
    rank3: ranks[2],
    weather,
    windSpeed: wind,
    waveHeight: wave,
    unranked,
  };
}
const times = (n, spec) => Array.from({ length: n }, () => run(spec));
const rowOf = (stats, key) => stats.rows.find((r) => r.key === key);

// 晴5走（1着2・2着1・4着2）、曇り5走（全部4着）、雨3＋雪1＋台風1（全部1着）
const weatherStats = aggregateRacerConditionStats([
  ...times(2, { place: 1 }),
  run({ place: 2 }),
  ...times(2, { place: 4 }),
  ...times(5, { weather: "曇り" }),
  ...times(3, { weather: "雨", place: 1 }),
  run({ weather: "雪", place: 1 }),
  run({ weather: "台風", place: 1 }),
]);
check(
  "天候: 晴は5走・1着率40%・2連率60%",
  rowOf(weatherStats, "sunny").n === 5 &&
    rowOf(weatherStats, "sunny").winRate === 0.4 &&
    rowOf(weatherStats, "sunny").top2Rate === 0.6,
);
check(
  "天候: 雪・台風は「雨・雪・台風」にまとめる（5走・1着率100%）",
  rowOf(weatherStats, "rainy").n === 5 &&
    rowOf(weatherStats, "rainy").winRate === 1,
);
check(
  "全体は15走で、1着7・2連対8",
  weatherStats.overall.n === 15 &&
    Math.abs(weatherStats.overall.winRate - 7 / 15) < 1e-12 &&
    Math.abs(weatherStats.overall.top2Rate - 8 / 15) < 1e-12,
);

// 風速 5m ちょうどは「以上」、4m は「未満」
const windStats = aggregateRacerConditionStats([
  ...times(5, { wind: 5, place: 1 }),
  ...times(5, { wind: 4 }),
]);
check(
  "風速: 5m ちょうどは「5m以上」、4m は「5m未満」",
  rowOf(windStats, "windStrong").n === 5 &&
    rowOf(windStats, "windStrong").winRate === 1 &&
    rowOf(windStats, "windWeak").n === 5 &&
    rowOf(windStats, "windWeak").winRate === 0,
);

// 波高: 江戸川（03）の走は波5cm以上にも未満にも数えない（全体には数える）
const waveStats = aggregateRacerConditionStats([
  ...times(5, { wave: 5 }),
  ...times(5, { wave: 3 }),
  ...times(6, { wave: 5, venue: 3, place: 1 }),
]);
check(
  "波高: 江戸川の走は波の行から外す（5cm以上は5走のまま、1着率0%）",
  rowOf(waveStats, "waveRough").n === 5 &&
    rowOf(waveStats, "waveRough").winRate === 0 &&
    rowOf(waveStats, "waveCalm").n === 5,
);
check("波高: 江戸川の走も全体には数える（16走）", waveStats.overall.n === 16);

// race_conditions の無い走は全体からも外す
const noCond = aggregateRacerConditionStats([
  ...times(5, {}),
  ...times(3, { weather: null, wind: null, wave: null, place: 1 }),
]);
check(
  "天候・風速・波高が全部無い走は全体に入れない（5走）",
  noCond.overall.n === 5,
);

// 着順の付かない走は母数に入れ、1着には数えない
const unranked = aggregateRacerConditionStats([
  ...times(4, { place: 1 }),
  run({ place: 1, unranked: true }),
]);
check(
  "着順の付かない走は1走に数え、1着には数えない（5走・1着率80%）",
  unranked.overall.n === 5 && unranked.overall.winRate === 0.8,
);

// 5走未満の条件は出さない
const few = aggregateRacerConditionStats([
  ...times(RACER_CONDITION_MIN_RUNS, {}),
  ...times(RACER_CONDITION_MIN_RUNS - 1, { weather: "曇り" }),
]);
check(
  `${RACER_CONDITION_MIN_RUNS}走未満の条件（曇り4走）は行に出さない`,
  rowOf(few, "cloudy") === undefined && rowOf(few, "sunny") !== undefined,
);
check(
  "履歴が無い・null でも落ちない",
  aggregateRacerConditionStats(null).overall.n === 0 &&
    aggregateRacerConditionStats([]).rows.length === 0,
);

// BOA-1117: rank1〜3 は着順そのものではなく、その着の艇番。
const ranks123 = { rank1: 1, rank2: 2, rank3: 3 };
const tallyCases = [
  ["1着", { boatNumber: 1, ...ranks123 }, true, [1, 1, 1]],
  ["2着", { boatNumber: 2, ...ranks123 }, false, [0, 1, 1]],
  ["3着", { boatNumber: 3, ...ranks123 }, false, [0, 0, 1]],
  ["4着以下", { boatNumber: 4, ...ranks123 }, false, [0, 0, 0]],
  ["1着でも着順なし", { boatNumber: 1, ...ranks123, unranked: true }, false, [0, 0, 0]],
  ["3着でも着順なし", { boatNumber: 3, ...ranks123, unranked: true }, false, [0, 0, 0]],
  ["3着が欠けた行", { boatNumber: 3, ...ranks123, rank3: null }, false, [0, 0, 0]],
  ["2着・3着の欄なし", { boatNumber: 1, rank1: 1 }, true, [1, 1, 1]],
  ["結果なし", { boatNumber: 1, rank1: null, rank2: null, rank3: null }, false, [0, 0, 0]],
  ["同着で3着の欄に入る艇", { boatNumber: 2, rank1: 1, rank2: 1, rank3: 2 }, false, [0, 0, 1]],
  ["同着の1着艇", { boatNumber: 1, rank1: 1, rank2: 1, rank3: 3 }, true, [1, 1, 1]],
  ["unranked が0", { boatNumber: 1, ...ranks123, unranked: 0 }, true, [1, 1, 1]],
];
for (const [label, row, expectedWin, expectedTotals] of tallyCases) {
  const totals = { win: 0, top2: 0, top3: 0 };
  const isWin = tallyWinPlaceShow(totals, row);
  check(`1走: ${label}の戻り値`, isWin === expectedWin);
  check(
    `1走: ${label}の加算`,
    totals.win === expectedTotals[0] &&
      totals.top2 === expectedTotals[1] &&
      totals.top3 === expectedTotals[2],
  );
}
const cumulative = { win: 0, top2: 0, top3: 0 };
for (const [, row] of tallyCases.slice(0, 4)) {
  tallyWinPlaceShow(cumulative, row);
}
check(
  "1走: 1〜4着を同じ totals に加算すると1勝・2連対2・3連対3",
  cumulative.win === 1 && cumulative.top2 === 2 && cumulative.top3 === 3,
);

// 実データにない形。仕様未定なので assert せず、入力・現値を表示する。
const KNOWN_GAPS = [
  {
    label: "艇番も結果もnull",
    row: { boatNumber: null, rank1: null, rank2: null, rank3: null },
    specification: "未定。DBの艇番は整数。null同士の一致をどう扱うか",
    current: { isWin: true, totals: { win: 1, top2: 1, top3: 1 } },
  },
  {
    label: "艇番が文字列",
    row: { boatNumber: "1", ...ranks123 },
    specification: "未定。艇番の型変換の要否（現状は厳密比較）",
    current: { isWin: false, totals: { win: 0, top2: 0, top3: 0 } },
  },
  {
    label: "unranked が文字列",
    row: { boatNumber: 1, ...ranks123, unranked: "yes" },
    specification: "未定。真の値をすべて着順なしとするか",
    current: { isWin: false, totals: { win: 0, top2: 0, top3: 0 } },
  },
];
console.log(`\nKNOWN_GAPS: ${KNOWN_GAPS.length}件（判定対象外）`);
for (const gap of KNOWN_GAPS) {
  const totals = { win: 0, top2: 0, top3: 0 };
  const isWin = tallyWinPlaceShow(totals, gap.row);
  console.log(JSON.stringify({ ...gap, observed: { isWin, totals } }));
}

const sunnyTop3 = aggregateRacerConditionStats(
  [1, 2, 3, 3, 5].map((place) => run({ place })),
);
const unrankedTop3 = aggregateRacerConditionStats([
  ...times(4, { place: 3 }),
  run({ place: 3, unranked: true }),
]);
const cloudyTop3 = aggregateRacerConditionStats(
  [1, 2, 3, 4, 6].map((place) => run({ place, weather: "曇り" })),
);
for (const [label, row, winRate, top2Rate, top3Rate] of [
  ["晴1・2・3・3・5着の全体", sunnyTop3.overall, 0.2, 0.4, 0.8],
  ["晴1・2・3・3・5着の晴行", rowOf(sunnyTop3, "sunny"), 0.2, 0.4, 0.8],
  ["3着4走と着順なし1走の全体", unrankedTop3.overall, 0, 0, 0.8],
  ...["cloudy", "windWeak", "waveCalm"].map((key) => [
    `曇り1・2・3・4・6着の${key}行`, rowOf(cloudyTop3, key), 0.2, 0.4, 0.6,
  ]),
]) {
  check(
    `3連率: ${label}は5走で各率が一致`,
    row?.n === 5 && row.winRate === winRate &&
      row.top2Rate === top2Rate && row.top3Rate === top3Rate,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\n全件成功");
