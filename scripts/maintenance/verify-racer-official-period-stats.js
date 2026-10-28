#!/usr/bin/env node
/**
 * src/utils/racerOfficialPeriodStats.js（選手ページの公式の期別成績・進入コース別成績）を固定の入力で検証する。
 *
 * 崩れると、期の呼び名（前期・後期）を取り違える、コース別の率を進入の少ないセルで出す、
 * 3期の合算を率の平均で出す（着回数の合計から出すのが正）、のどれかが画面に出る。
 * 期の定義は official-data-spec、出してよい範囲は data-scientist（2026-10-28、GS00）。
 */
import {
  buildPeriodRows,
  buildCourseRows,
  periodLabel,
  periodAppliedLabel,
} from "../../src/utils/racerOfficialPeriodStats.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  const same =
    typeof expected === "number" && typeof actual === "number"
      ? Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (!same) failures.push(`${label}: 期待 ${expected} / 実際 ${actual}`);
}

const course = (c, entries, p1, p2, p3, avgSt) => ({
  [`c${c}_entries`]: entries,
  [`c${c}_p1`]: p1,
  [`c${c}_p2`]: p2,
  [`c${c}_p3`]: p3,
  [`c${c}_avg_st`]: avgSt,
});
const row = (y, n, extra) => ({
  period_year: y,
  period_no: n,
  calc_from: n === 1 ? `${y - 1}-05-01` : `${y - 1}-11-01`,
  calc_to: n === 1 ? `${y - 1}-10-31` : `${y}-04-30`,
  grade: "A1",
  win_rate: "8.05",
  top2_rate: "51.4",
  starts: 105,
  first_count: 30,
  second_count: 24,
  finals: 5,
  wins: 2,
  avg_st: "0.13",
  ...course(1, 26, 20, 4, 2, "0.12"),
  ...course(2, 20, 4, 6, 3, "0.13"),
  ...course(3, 17, 3, 5, 7, "0.13"),
  ...course(4, 16, 2, 4, 4, "0.14"),
  ...course(5, 14, 1, 3, 4, "0.14"),
  ...course(6, 9, 0, 2, 2, "0.15"),
  ...extra,
});

// 期の呼び名（公式 download.html: 2026年前期=fan2510、後期=fan2604）
check("(2026,1) は前期", periodLabel(2026, 1), "2026年前期");
check("(2026,2) は後期", periodLabel(2026, 2), "2026年後期");
check("後期の級は7〜12月に使う", periodAppliedLabel(2026, 2), "2026/7〜12");

// 期別: 新しい期が先、3連対率は (1着+2着+3着)/出走
const rows = [row(2025, 2), row(2026, 2), row(2026, 1)];
const periods = buildPeriodRows(rows);
check("新しい期が先頭", periods[0].label, "2026年後期");
check("2番目は2026年前期", periods[1].label, "2026年前期");
check("集計期間の表記", periods[0].range, "2025/11/01〜2026/04/30");
check("勝率は公式の値のまま", periods[0].winRate, 8.05);
check("2連対率は公式の値のまま", periods[0].top2Rate, 51.4);
check(
  "3連対率は3着回数の合計を足して出走で割る（30+24+22）/105",
  periods[0].top3Rate,
  (76 / 105) * 100,
);
const zero = buildPeriodRows([row(2026, 2, { starts: 0, win_rate: "0.00" })]);
check("出走0の期は勝率を出さない", zero[0].winRate, null);

// コース別: 直近3期の合算。着回数の合計から出す
const summed = buildCourseRows(rows);
check("合算に使う期は3つ", summed.periods.length, 3);
const c1 = summed.courses[0];
check("1コースの進入は3期の合計", c1.entries, 78);
check("1コースの2連率は (Σ1着+Σ2着)/Σ進入", c1.top2Rate, (72 / 78) * 100);
check("30走以上はそのまま", c1.reliability, "firm");
const c6 = summed.courses[5];
check("6コース 27走は「参考」", c6.reliability, "reference");
check("平均STは進入数で重み付け", c1.avgSt, 0.12);

const single = buildCourseRows(rows, 1);
const c6single = single.courses[5];
check("1期だけの6コース 9走は率を出さない", c6single.reliability, "none");
check("9走の2連率は null", c6single.top2Rate, null);
check("9走でも進入数は出す", c6single.entries, 9);

check("行が無ければ null", buildCourseRows([]), null);

// 平均STの重みは「進入 − F − L」。公式は該当する走が無いと 0 を入れるので、0 は重みに入れない
// （data-accuracy-verifier の再現: 5313 の3コース、20走 0.15 と 1走 F の 0 で 0.1429 と出ていた）
const stRows = [
  row(2026, 2, course(3, 20, 2, 3, 3, "0.15")),
  row(2026, 1, { ...course(3, 1, 0, 0, 0, "0"), c3_f: 1 }),
];
check(
  "F だけのコースの ST 0 は平均に入れない",
  buildCourseRows(stRows).courses[2].avgSt,
  0.15,
);
const lRows = [
  row(2026, 2, { ...course(3, 12, 1, 2, 2, "0.10"), c3_l1: 2 }),
  row(2026, 1, course(3, 10, 1, 2, 2, "0.20")),
];
check(
  "L の走は重みから外す（(0.10×10+0.20×10)/20）",
  buildCourseRows(lRows).courses[2].avgSt,
  0.15,
);

// 出走0の期は合算の3期に数えない（直近3期に穴があっても、出走のある3期を使う）
const gapRows = [
  row(2026, 2),
  row(2026, 1, { starts: 0 }),
  row(2025, 2),
  row(2025, 1),
];
const gap = buildCourseRows(gapRows);
check("出走0の期を飛ばして3期を使う", gap.periods.length, 3);
check("3期の最古は2025年前期", gap.periods.at(-1).label, "2025年前期");
check("出走0の期を飛ばしたら連続していない", gap.contiguous, false);
check("穴が無ければ連続", buildCourseRows(rows).contiguous, true);

// 欠場（K）の走も ST が無いので重みから外す（(0.10×10+0.20×10)/20）
const kRows = [
  row(2026, 2, { ...course(3, 13, 1, 2, 2, "0.10"), c3_k1: 3 }),
  row(2026, 1, course(3, 10, 1, 2, 2, "0.20")),
];
check("欠場の走は重みから外す", buildCourseRows(kRows).courses[2].avgSt, 0.15);

// コース別の列が NULL の期: 3連対率を出さない・合算の期に数えない
const nullCourse = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].flatMap((c) =>
    ["entries", "p1", "p2", "p3", "avg_st"].map((k) => [`c${c}_${k}`, null]),
  ),
);
check(
  "コース別の列が NULL の期は3連対率を出さない",
  buildPeriodRows([row(2026, 2, nullCourse)])[0].top3Rate,
  null,
);
check(
  "コース別の列が NULL の期は合算に数えない",
  buildCourseRows([row(2026, 2, nullCourse), row(2026, 1), row(2025, 2)])
    .periods.length,
  2,
);

check(
  "全期が出走0なら進入コース別は出さない",
  buildCourseRows([row(2026, 2, { starts: 0 })]),
  null,
);

if (failures.length > 0) {
  console.error(`❌ ${failures.length}/${checked} 件が不一致`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ racerOfficialPeriodStats: ${checked} 件すべて一致`);
