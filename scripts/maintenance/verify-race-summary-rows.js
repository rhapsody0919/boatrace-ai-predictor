#!/usr/bin/env node
/**
 * src/utils/raceSummaryRows.js（レース詳細の6艇の要約、BOA-1189 GS01-c）を固定の入力で検証する。
 *
 * 崩れると、要約の並びが艇番でなくなる・同タイムの艇に別々の順位が付く（DB の行順で決まる）・
 * 欠場（展示タイム 0・null）の艇が順位に混ざる・確定前に着順の列が出る・着順が艇に付き違う。
 */
import { buildRaceSummaryRows } from "../../src/utils/raceSummaryRows.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// 行の順をわざと崩して渡す（並びは艇番に直す）
const players = [3, 1, 2, 6, 5, 4].map((n) => ({
  number: n,
  name: `選手 ${n}`,
  racerId: 4000 + n,
  grade: n <= 2 ? "A1" : "B1",
}));
const exh = [
  { boat_number: 1, exhibition_time: 6.7 },
  { boat_number: 2, exhibition_time: 6.72 },
  { boat_number: 3, exhibition_time: 6.7 }, // 1号艇と同タイム
  { boat_number: 4, exhibition_time: 6.8 },
  { boat_number: 5, exhibition_time: 0 }, // 欠場は 0 で入ることがある
  { boat_number: 6, exhibition_time: null },
];
const result = {
  rank1: 2,
  rank2: 1,
  rank3: 4,
  rank4: 3,
  rank5: 6,
  rank6: null,
};

const done = buildRaceSummaryRows(players, exh, result);
check(
  "並びは艇番",
  done.rows.map((r) => r.number),
  [1, 2, 3, 4, 5, 6],
);
check(
  "選手名の空白を詰める・登録番号を残す",
  [done.rows[0].name, done.rows[0].racerId],
  ["選手1", 4001],
);
check(
  "展示タイムの順位（小さいほど上、同タイムは同順位、欠場は順位なし）",
  done.rows.map((r) => r.exhRank),
  [1, 3, 1, 4, null, null],
);
check(
  "同タイムの印",
  done.rows.map((r) => r.exhTied),
  [true, false, true, false, false, false],
);
check(
  "着順は艇に付く（結果に無い艇は null）",
  done.rows.map((r) => r.finish),
  [2, 1, 4, 3, null, 5],
);
check("確定後は着順の列", done.hasResult, true);
check("展示あり", done.hasExhibition, true);

const before = buildRaceSummaryRows(players, null, null);
check(
  "展示前・確定前",
  [before.hasExhibition, before.hasResult],
  [false, false],
);
check(
  "展示前は秒数・順位なし",
  before.rows.map((r) => [r.exhTime, r.exhRank]),
  Array(6).fill([null, null]),
);

const allAbsent = buildRaceSummaryRows(
  players,
  exh.map((e) => ({ ...e, exhibition_time: null })),
  { rank1: null },
);
check(
  "展示の行はあるが値が無い・結果の1着が無い",
  [allAbsent.hasExhibition, allAbsent.hasResult],
  [false, false],
);

if (failures.length > 0) {
  console.error(
    `❌ verify-race-summary-rows: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-race-summary-rows: ${checked} 件すべて一致`);
