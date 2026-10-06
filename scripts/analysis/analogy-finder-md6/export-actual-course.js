/**
 * BOA-271 MD-6: 本体期間（2025-12-03〜）の実進入を race_results.actual_course_1〜6 から書き出す（読み取りのみ）
 * actual_course_{艇番} = その艇の進入コース。目的変数(c)「1着の進入コース」にだけ使う。
 * 出力: data/ml/analogy/actual_courses.csv
 * 使い方: node --env-file=.env.local scripts/analysis/analogy-finder-md6/export-actual-course.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAll } from "../../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../../../data/ml/analogy/actual_courses.csv");
const COLS = ["race_id", ...[1, 2, 3, 4, 5, 6].map((b) => `actual_course_${b}`)];
const MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
  "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const rows = [];
for (let i = 0; i < MONTHS.length - 1; i++) {
  const part = await fetchAll("race_results", COLS.join(", "),
    (q) => q.gte("race_id", MONTHS[i]).lt("race_id", MONTHS[i + 1]).order("race_id"),
    { throwOnError: true });
  console.log(`${MONTHS[i]}: ${part.length}`);
  rows.push(...part);
}
fs.writeFileSync(OUT, [COLS.join(","), ...rows.map((r) => COLS.map((c) => r[c] ?? "").join(","))].join("\n") + "\n");
console.log(`✅ ${rows.length} rows → ${OUT}`);
