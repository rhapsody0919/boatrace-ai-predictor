#!/usr/bin/env node
/**
 * 基本情報タブの勝率バーの物差し（今日出走する選手の勝率の最小〜最大と真ん中の線） src/pure/dayEntrantStats.js の回帰テスト。
 * 意味づけ（2026-11-28 オーナー「表には不要、グラフには入れるのはアリ」）。DB 接続は不要。
 *
 * 守ること:
 *   - 同じ日に2走する選手を2回数えない。racerId が無い・勝率が空・0 の選手は外す
 *   - 200人未満（朝の取り込みの途中など）は物差しを作らない
 *   - 真ん中は中央値（偶数人は真ん中2人の平均、小数2桁）
 *   - 棒は 5〜100%（最低の選手でも見える）、範囲の外は端に寄せる。線は真ん中の位置
 *   - 置き換えるのは勝率・全国・公式の値のときだけ（当地・今期・グレード・他の指標は元の尺度のまま）
 */
import {
  DAY_MIN_RACERS,
  collectDayEntrantValues,
  dayDistribution,
  withDayScale,
} from "../../src/pure/dayEntrantStats.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.log(`✗ ${name} ${detail}`);
  }
};

const races = [
  {
    players: [
      { racerId: 1, winRate: "6.50" },
      { racerId: 2, winRate: 5.1 },
      { racerId: null, winRate: 7 },
    ],
  },
  {
    players: [
      { racerId: 1, winRate: "6.50" },
      { racerId: 3, winRate: "0.00" },
      { racerId: 4, winRate: "" },
    ],
  },
  { players: [{ racerId: 5, winRate: 4.2 }] },
];
const vals = collectDayEntrantValues(races, "winRate").sort((a, b) => a - b);
check(
  "2走の選手は1回、racerId なし・0・空は外す",
  JSON.stringify(vals) === "[4.2,5.1,6.5]",
  JSON.stringify(vals),
);
check(
  "races が無くても空",
  collectDayEntrantValues(undefined, "winRate").length === 0,
);

const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
check(
  `${DAY_MIN_RACERS - 1}人は作らない`,
  dayDistribution(many(DAY_MIN_RACERS - 1, (i) => i + 1)) === null,
);
const odd = dayDistribution(many(201, (i) => 2 + i * 0.03));
check(
  "奇数人の真ん中は真ん中の1人",
  odd && odd.n === 201 && odd.min === 2 && odd.median === 5,
  JSON.stringify(odd),
);
const even = dayDistribution(many(200, (i) => (i < 100 ? 4 : 6)));
check(
  "偶数人の真ん中は2人の平均",
  even && even.median === 5,
  JSON.stringify(even),
);

const base = {
  barWidthPercent: () => 50,
  isRelativeScaleMetric: true,
  valueDigits: 2,
};
const day = { n: 584, min: 2, max: 8, median: 5 };
const on = { metric: "winRate", scope: "national", needsOwnAggregation: false };
const s = withDayScale(base, day, on);
check("最低は 5%", s.barWidthPercent(2) === 5, String(s.barWidthPercent(2)));
check(
  "最高は 100%",
  s.barWidthPercent(8) === 100,
  String(s.barWidthPercent(8)),
);
check(
  "範囲の外は端に寄せる",
  s.barWidthPercent(9) === 100 && s.barWidthPercent(1) === 5,
);
check("線は真ん中の位置", s.refLinePercent === 52.5, String(s.refLinePercent));
check("値なしは 0", s.barWidthPercent(null) === 0);
check(
  "6艇の中の比べの注記は出さない",
  s.isRelativeScaleMetric === false && s.day === day,
);
check(
  "最小と最大が同じでも NaN にしない",
  Number.isFinite(
    withDayScale(base, { ...day, min: 5, max: 5 }, on).barWidthPercent(5),
  ),
);
for (const [name, view] of [
  ["当地", { ...on, scope: "local" }],
  ["自前の集計（今期・グレード）", { ...on, needsOwnAggregation: true }],
  ["平均ST", { ...on, metric: "avgSt" }],
]) {
  const k = withDayScale(base, day, view);
  check(
    `${name}は元の尺度のまま`,
    k.barWidthPercent(2) === 50 &&
      k.refLinePercent === null &&
      k.isRelativeScaleMetric === true,
  );
}
check(
  "分布が無ければ元の尺度のまま",
  withDayScale(base, null, on).refLinePercent === null,
);

if (failed > 0) {
  console.log(`\n❌ verify-day-entrant-stats: ${failed}件失敗`);
  process.exit(1);
}
console.log("\n✅ verify-day-entrant-stats: 全件合格");
