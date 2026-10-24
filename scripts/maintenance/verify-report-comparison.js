/** BOA-1034: 前回比較の5関数を一時ディレクトリと固定入力で検証する。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findPreviousReport,
  findRecentReports,
  detectTrend,
  perDay,
  formatDelta,
} from "../lib/reportComparison.js";

// 仕様の値は各関数の JSDoc・コメントと依頼の期待値による。
// 今の実装の値は固定入力で照合。一致するケースだけ assert する。
const KNOWN_GAPS = [
  {
    input: "formatDelta(0)",
    specification: "±0.0（JSDoc の例）",
    current: "±0",
  },
  {
    input: "formatDelta(-1.55)",
    specification: "丸め境界のため固定しない（浮動小数点の表現に依存）",
    current: "-1.6",
  },
  {
    input: "formatDelta(2.5)",
    specification: "丸め境界の値は assert しない（依頼の指定）",
    current: "+2.5",
  },
];

let checked = 0;
function check(label, actual, specification, current) {
  assert.deepEqual(current, specification, `${label}: 仕様と今の値の一致`);
  assert.deepEqual(actual, specification, label);
  checked++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "report-comparison-"));
try {
  // 書く順も日付順にせず、名前による並べ替えを検証する。
  const dates = ["2026-10-15", "2026-10-01", "2026-10-08"];
  for (const date of dates) {
    fs.writeFileSync(
      path.join(tmp, `report-${date}.json`),
      JSON.stringify({ date, total: date === "2026-10-08" ? 8 : 1 }),
    );
  }
  fs.writeFileSync(path.join(tmp, "notes.json"), "{}");
  const first = {
    file: "report-2026-10-01.json",
    date: "2026-10-01",
    data: { date: "2026-10-01", total: 1 },
  };
  const previous = {
    file: "report-2026-10-08.json",
    date: "2026-10-08",
    data: { date: "2026-10-08", total: 8 },
  };
  check("findPreviousReport: 今回分を除く直近", findPreviousReport(tmp, dates[0]), previous, previous);
  const missing = path.join(tmp, "missing");
  check("findPreviousReport: 無いディレクトリ", findPreviousReport(missing, dates[0]), null, null);
  check("findRecentReports: 古い順・最大5件", findRecentReports(tmp, dates[0], 5), [first, previous], [first, previous]);
  check("findRecentReports: 直近1件", findRecentReports(tmp, dates[0], 1), [previous], [previous]);
  check("findRecentReports: 無いディレクトリ", findRecentReports(missing, dates[0], 5), [], []);
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, "notes.json"), "{}");
  check("findPreviousReport: 対象0件", findPreviousReport(empty, dates[0]), null, null);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// [入力, 仕様の値, 今の実装の値]。方向と末尾の連続回数を両方検証する。
const trends = [
  [[1, 2], { direction: "insufficient-data", consecutiveMoves: 0 }, { direction: "insufficient-data", consecutiveMoves: 0 }],
  [[1, 2, 3, 4], { direction: "improving", consecutiveMoves: 3 }, { direction: "improving", consecutiveMoves: 3 }],
  [[5, 3, 4, 2, 1], { direction: "worsening", consecutiveMoves: 2 }, { direction: "worsening", consecutiveMoves: 2 }],
  [[1, 2, 2], { direction: "flat", consecutiveMoves: 0 }, { direction: "flat", consecutiveMoves: 0 }],
  [[1, NaN, "x", 2, 3], { direction: "improving", consecutiveMoves: 2 }, { direction: "improving", consecutiveMoves: 2 }],
];
for (const [input, specification, current] of trends) {
  check(`detectTrend: ${String(input)}`, detectTrend(input), specification, current);
}
for (const [total, days, specification, current] of [[10, 4, 2.5, 2.5], [10, 0, 0, 0]]) {
  check(`perDay: ${total}/${days}`, perDay(total, days), specification, current);
}
const deltas = [
  [2.34, undefined, "+2.3", "+2.3"],
  [0.04, undefined, "±0", "±0"],
  [-0.04, undefined, "±0", "±0"],
  // ゼロの文書との食い違いは上の KNOWN_GAPS で出す。
  [1.234, 2, "+1.23", "+1.23"],
];
for (const [input, digits, specification, current] of deltas) {
  check(`formatDelta: ${input}, ${digits}`, formatDelta(input, digits), specification, current);
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, KNOWN_GAPS);
console.log(`✅ verify-report-comparison: ${checked}件を確認`);
