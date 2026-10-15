#!/usr/bin/env node
/**
 * 「逃がしやすい選手」を当日の2号艇に絞る（2026-10-15 オーナー承認）。
 * 一覧は2号艇（過去の2コースの実績）、3号艇は画面の折りたたみの中だけ、4〜6号艇は保存しない。22pt の基準は変えない。
 * 注目レースの候補も2号艇の逃がしだけ。buildSections・pickFeatured の純関数テスト。DBには接続しない。
 *   node scripts/maintenance/verify-digest-nigashi-boat2.js
 */
import assert from "node:assert/strict";
import {
  buildSections,
  pickFeatured,
} from "../daily/generate-morning-digest.js";
import { NIGASHI_LIST_COURSE } from "../../src/utils/digestMetrics.js";

const races = [1, 2, 3, 4, 5, 6].map((n) => ({
  race_id: `2026-10-15-04-0${n}`,
  venue_code: 4,
  race_number: n,
  start_time: "12:00:00",
  race_grade: "ippan",
}));
// 各レースで、枠 n（= n号艇）の選手だけが逃がしの基準（期待 +22pt 以上）を満たす。差は枠が小さいほど大きくしない
const entries = [2, 3, 4, 5, 6].map((boat) => ({
  race_id: races[boat - 1].race_id,
  racer_id: 5000 + boat,
  player_name: `選手 ${boat}`,
  grade: "B1",
  boat_number: boat,
}));
const stat = (delta) => ({
  runs: 40,
  nige_rate: null,
  makuri_rate: 0,
  makuri_expected: 5,
  nigashi_rate: 55 + delta,
  nigashi_expected: 55,
  nigashi_count: 30,
  nigashi_rate_90d: null,
  runs_90d: 0,
});
// 4〜6号艇のほうが地力が大きい（以前なら一覧の上位に来た）
const deltas = { 2: 23, 3: 24, 4: 30, 5: 31, 6: 32 };
const statMap = new Map(
  entries.map((e) => [`${e.racer_id}|${e.boat_number}`, stat(deltas[e.boat_number])]),
);
const baselineMap = new Map();
for (const course of [1, 2, 3, 4, 5, 6])
  baselineMap.set(`4|ALL|${course}`, {
    race_grade: "ALL",
    runs: 1000,
    nige_rate: 55,
    makuri_rate: 5,
    nigashi_rate: 55,
  });
const volatilityMap = new Map(races.map((r) => [r.race_id, 10]));

const cases = [
  ["2・3号艇だけ保存し、2号艇を先に並べる（4〜6号艇は地力が大きくても保存しない）", () => {
    const s = buildSections({ races, entries, statMap, baselineMap, volatilityMap });
    assert.deepEqual(s.nigashi.map((r) => r.course), [2, 3]);
    assert.equal(NIGASHI_LIST_COURSE, 2);
  }],
  ["22pt の基準は変えない（2号艇で +21pt は入らない）", () => {
    const m = new Map(statMap);
    m.set("5002|2", stat(21));
    const s = buildSections({ races, entries, statMap: m, baselineMap, volatilityMap });
    assert.deepEqual(s.nigashi.map((r) => r.course), [3]);
  }],
  ["注目レースの候補は2号艇の逃がしだけ（3号艇は選ばない）", () => {
    const s = buildSections({ races, entries, statMap, baselineMap, volatilityMap });
    const featured = pickFeatured(s);
    assert.equal(featured.detail.from, "nigashi");
    assert.equal(featured.course, 2);
    const only3 = { ...s, nigashi: s.nigashi.filter((r) => r.course === 3) };
    assert.equal(pickFeatured(only3), null);
  }],
];
let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[NG] ${name}: ${error.message}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通りました");
