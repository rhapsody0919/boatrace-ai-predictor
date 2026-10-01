#!/usr/bin/env node
/**
 * scripts/lib/ga4MeasurementBreaks.js（GA4 の計測の切れ目の判定）を固定の入力で検証する。
 *
 * 崩れると、計測修正（2026-09-29）の前後を比べた PV の増減に注記が付かず、
 * 「/ の PV が減った」「会場ページの PV が増えた」を需要の変化と誤読する。
 */
import {
  ga4PvBreaksWithin,
  formatGa4PvBreakNotice,
} from "../lib/ga4MeasurementBreaks.js";

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
const dates = (s, e) => ga4PvBreaksWithin(s, e).map((b) => b.date);

check("切れ目をまたぐ30日", dates("2026-09-01", "2026-09-30"), ["2026-09-29"]);
check("切れ目の日で終わる（前と途中の日）", dates("2026-09-01", "2026-09-29"), [
  "2026-09-29",
]);
check(
  "切れ目の日から始まる（途中の日と後）",
  dates("2026-09-29", "2026-09-30"),
  ["2026-09-29"],
);
check("切れ目より前だけ", dates("2026-08-01", "2026-09-28"), []);
check("2つの切れ目の間の1日だけ", dates("2026-09-30", "2026-09-30"), []);
check("最後の切れ目の翌日以降だけ", dates("2026-10-02", "2026-10-31"), []);
check("2つの切れ目をまたぐ", dates("2026-09-01", "2026-10-15"), [
  "2026-09-29",
  "2026-10-01",
]);
check("内部トラフィック除外の日をまたぐ", dates("2026-09-30", "2026-10-02"), [
  "2026-10-01",
]);
check(
  "切れ目の日だけ（比べる相手が無い）",
  dates("2026-09-29", "2026-09-29"),
  [],
);

let threw = false;
try {
  ga4PvBreaksWithin("2026/09/01", "2026-09-30");
} catch {
  threw = true;
}
check("日付の形式が違えば例外", threw, true);

check("該当なしは空文字", formatGa4PvBreakNotice([]), "");
const notice = formatGa4PvBreakNotice(
  ga4PvBreaksWithin("2026-09-01", "2026-09-30"),
);
check(
  "注記に比較しない旨が入る",
  notice.includes("PV を比較しないでください"),
  true,
);
check("注記に日付が入る", notice.includes("2026-09-29"), true);

if (failures.length > 0) {
  console.error(
    `❌ verify-ga4-measurement-breaks: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-ga4-measurement-breaks: ${checked} 件すべて通過`);
