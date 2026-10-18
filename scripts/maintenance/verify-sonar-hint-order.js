#!/usr/bin/env node
/**
 * 龍神ソナーの展開シナリオ STEP2 の形のカードの並び（BOA-890、2026-10-17 オーナー決定 案A）。
 * 「なりやすい」→「はっきりしない」→「むしろなりにくい」の順、同じ区分の中は当てはまったときの率の高い順。
 * 以前は条件の定義の順（HINTS）のままで、1号艇の平均STが6艇で最速の日に、むしろなりにくいイン凹みが先頭に来ていた。
 * 値は本番の facts・scenario API（2026-10-17 取得、既定の範囲）の今日の当てはまりと、当てはまる・当てはまらないの件数。DBには接続しない。
 *   node scripts/maintenance/verify-sonar-hint-order.js
 */
import assert from "node:assert/strict";
import { hintCardGroups, hintRows } from "../../src/utils/analogyScenario.js";
import { wilsonInterval } from "../../src/utils/wilson.js";

const RACES = [
  {
    name: "鳴門 2026-10-16 10R（このコース、全国・級の並びが同じ）",
    version: "course",
    today: { in_fastest: true, d2_slow01: true },
    hints: {
      in_fastest: { d1: { hit: [60, 1074], miss: [177, 1857] } },
      d2_slow01: { d2: { hit: [96, 904], miss: [112, 2027] } },
    },
    first: "d2",
  },
  {
    name: "住之江 2026-10-15 12R（このコース、全国・級の並びが同じ）",
    version: "course",
    today: { in_fastest: true, d2_slow01: true },
    hints: {
      in_fastest: { d1: { hit: [5, 71], miss: [14, 113] } },
      d2_slow01: { d2: { hit: [7, 60], miss: [7, 124] } },
    },
    first: "d2",
  },
  {
    name: "丸亀 2026-10-15 10R（全体の平均ST、丸亀・級の並びが同じ）",
    version: "overall",
    today: { in_fastest: true, d2_slow01: true },
    hints: {
      in_fastest: { d1: { hit: [3, 35], miss: [43, 243] } },
      d2_slow01: { d2: { hit: [6, 47], miss: [19, 231] } },
    },
    first: "d2",
  },
  {
    name: "丸亀 2026-10-15 10R（このコース。1号艇は最速でなく、カドが当てはまる）",
    version: "course",
    today: { kado4: true, kado4_02: true, d2_slow01: true },
    hints: {
      kado4: { kado: { hit: [23, 72], miss: [31, 206] } },
      kado4_02: { kado: { hit: [7, 28], miss: [47, 250] } },
      d2_slow01: { d2: { hit: [12, 65], miss: [13, 213] } },
    },
    first: "kado",
  },
];

const ORDER = { up: 0, unclear: 1, down: 2 };
const cardKind = (rows) => Math.min(...rows.map((r) => ORDER[r.kind]));

const cases = [];
for (const race of RACES) {
  const rows = hintRows(
    { [race.version]: race.hints },
    race.today,
    race.version,
    wilsonInterval,
  );
  const groups = hintCardGroups(rows);
  cases.push([
    `${race.name}: 先頭は ${race.first}、「むしろなりにくい」形を先頭にしない`,
    () => {
      assert.equal(groups[0].form, race.first, JSON.stringify(groups));
      assert.notEqual(cardKind(groups[0].rows), ORDER.down);
    },
  ]);
  cases.push([
    `${race.name}: 区分の順（なりやすい→はっきりしない→むしろなりにくい）、同じ区分は率の高い順`,
    () => {
      for (let i = 1; i < groups.length; i += 1) {
        const a = groups[i - 1];
        const b = groups[i];
        const ka = cardKind(a.rows);
        const kb = cardKind(b.rows);
        assert.ok(ka <= kb, `${a.form}(${ka}) → ${b.form}(${kb})`);
        if (ka === kb) {
          const pa = Math.max(...a.rows.map((r) => r.ph));
          const pb = Math.max(...b.rows.map((r) => r.ph));
          assert.ok(pa >= pb, `${a.form} ${pa} → ${b.form} ${pb}`);
        }
      }
    },
  ]);
}
cases.push([
  "鳴門10R: 1号艇が最速の条件はイン凹みに「むしろなりにくい」（5.6% 対 9.5%）。以前の定義の順ではこれが先頭だった",
  () => {
    const race = RACES[0];
    const rows = hintRows(
      { course: race.hints },
      race.today,
      "course",
      wilsonInterval,
    );
    assert.equal(rows[0].id, "in_fastest");
    assert.equal(rows[0].kind, "down");
  },
]);
cases.push([
  "同じ形の条件は1枚にまとめる（カドの2条件で1枚）",
  () => {
    const race = RACES[3];
    const groups = hintCardGroups(
      hintRows({ course: race.hints }, race.today, "course", wilsonInterval),
    );
    assert.deepEqual(
      groups.map((g) => [g.form, g.rows.length]),
      [
        ["kado", 2],
        ["d2", 1],
      ],
    );
  },
]);

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
