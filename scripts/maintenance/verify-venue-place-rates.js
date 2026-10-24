#!/usr/bin/env node
/**
 * BOA-1067: 会場の枠番別着率と決まり手内訳を手書き入力で固定する。
 * 仕様: venuePlaceRates.js の JSDoc・コメントと依頼124の期待値。
 * assert は仕様と指定 base の実装が一致する入力だけ。未定義の入力は下に残す。
 * ネットワーク・DB・実時刻・鍵は使わない。
 */
import assert from "node:assert/strict";
import {
  TECHNIQUE_ORDER,
  placeRatesByBoat,
  techniqueBreakdown,
} from "../../src/utils/venuePlaceRates.js";

const KNOWN_GAPS = [
  {
    input: { total_races: 1, data: { "7": [{ second_boat: 2, third_boat: 3, count: 1 }] } },
    specification: "未定: 1〜6以外の艇番の扱いはコメントにない",
    current: "7号艇の1着は加算されない。2号艇の2連率・3連率と3号艇の3連率は100%、他は0%",
  },
];

let passed = 0;
let failed = 0;
function check(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}\n${error.message}`);
  }
}

for (const [name, input] of [
  ["total_races=0", { total_races: 0, data: {} }],
  ["total_races=null", { total_races: null, data: {} }],
  ["入力null", null],
]) {
  check(`placeRatesByBoat: ${name}はnull`, () => {
    assert.equal(placeRatesByBoat(input), null);
  });
}

const outcome = {
  total_races: 2,
  data: {
    "1": [{ second_boat: 2, third_boat: 3, count: 1 }],
    "4": [{ second_boat: 1, third_boat: 2, count: 1 }],
  },
};
check("placeRatesByBoat: 2組の手計算と6艇の順序", () => {
  assert.deepEqual(placeRatesByBoat(outcome), [
    { boat: 1, winRate: 50, top2Rate: 100, top3Rate: 100 },
    { boat: 2, winRate: 0, top2Rate: 50, top3Rate: 100 },
    { boat: 3, winRate: 0, top2Rate: 0, top3Rate: 50 },
    { boat: 4, winRate: 50, top2Rate: 50, top3Rate: 50 },
    { boat: 5, winRate: 0, top2Rate: 0, top3Rate: 0 },
    { boat: 6, winRate: 0, top2Rate: 0, top3Rate: 0 },
  ]);
});

// 件数が1以外の組と5・6号艇も含む。合計件数が分母と等しい入力だけで検証。
const weighted = {
  total_races: 4,
  data: {
    "6": [{ second_boat: 5, third_boat: 1, count: 3 }],
    "2": [{ second_boat: 3, third_boat: 4, count: 1 }],
  },
};
check("placeRatesByBoat: 件数による重み付け", () => {
  assert.deepEqual(placeRatesByBoat(weighted).map((x) => [x.winRate, x.top2Rate, x.top3Rate]), [
    [0, 0, 75], [25, 25, 25], [0, 25, 25],
    [0, 0, 25], [0, 75, 75], [75, 75, 75],
  ]);
});
check("placeRatesByBoat: 着率の包含と1着率合計100", () => {
  for (const input of [outcome, weighted]) {
    const rows = placeRatesByBoat(input);
    for (const row of rows) {
      assert.ok(row.winRate <= row.top2Rate && row.top2Rate <= row.top3Rate);
    }
    assert.equal(rows.reduce((sum, row) => sum + row.winRate, 0), 100);
  }
});

check("techniqueBreakdown: 未入力は空", () => {
  assert.deepEqual(techniqueBreakdown(undefined), { total: 0, items: [] });
});
check("techniqueBreakdown: 0件を除外し手計算の割合と固定順", () => {
  const result = techniqueBreakdown({ techniques: [
    { technique: "抜き", count: 1 },
    { technique: "謎", count: 1 },
    { technique: "逃げ", count: 2 },
    { technique: "差し", count: 0 },
  ] });
  assert.equal(result.total, 4);
  const shares = { "逃げ": 50, "抜き": 25, "謎": 25 };
  assert.equal(result.items.length, 3);
  for (const [technique, share] of Object.entries(shares)) {
    assert.deepEqual(result.items.find((x) => x.technique === technique), {
      technique, count: share / 25, share,
    });
  }
  const known = result.items.filter((x) => TECHNIQUE_ORDER.includes(x.technique));
  assert.deepEqual(known.map((x) => x.technique), ["抜き", "逃げ"].sort(
    (a, b) => TECHNIQUE_ORDER.indexOf(a) - TECHNIQUE_ORDER.indexOf(b),
  ));
  assert.equal(result.items.at(-1).technique, "謎");
});
check("techniqueBreakdown: 全既知名はexportの順で未知名は末尾", () => {
  const techniques = [
    { technique: "謎", count: 1 },
    ...[...TECHNIQUE_ORDER].reverse().map((technique) => ({ technique, count: 1 })),
  ];
  const result = techniqueBreakdown({ techniques });
  assert.deepEqual(result.items.map((x) => x.technique), [...TECHNIQUE_ORDER, "謎"]);
});

console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`venuePlaceRates: ${passed}件通過 / ${failed}件失敗`);
if (failed > 0) process.exitCode = 1;
