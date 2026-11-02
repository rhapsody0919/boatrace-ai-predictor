#!/usr/bin/env node
/**
 * /today 型 b の言い切り（claim）の判定で、正規近似の z と正確な二項の上側確率がどれだけ違うかを出す（data-scientist の審査 P2-2、2026-10-27）。
 * 全国の級の1コースの1着率（data/analysis/today-course-win-prior.json の grade_baselines_all_runs）を p0 にし、
 * K=30・60・100、n=30〜150 で、z が線 Φ⁻¹(1−0.025/K) を初めて越える1着数での正確な上側確率 ÷ 名目（0.025/K）を求める。
 * 1 を超えると正規近似は名目より甘い。DB は読まない（純計算）
 *
 *   node scripts/analysis/today-course-win/check-exact-tail.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  binomialUpperTail,
  bonferroniLine,
  zScore,
} from "../../../src/utils/todayCourseWin.js";

const root = new URL("../../../", import.meta.url);
const prior = JSON.parse(
  readFileSync(new URL("data/analysis/today-course-win-prior.json", root)),
);
const rows = [];
for (const [grade, frac] of Object.entries(prior.grade_baselines_all_runs.c1)) {
  const [wins, runs] = frac.split("/").map(Number);
  const p0 = wins / runs;
  for (const k of [30, 60, 100]) {
    const line = bonferroniLine(k);
    const ratios = [];
    for (let n = 30; n <= 150; n += 10) {
      let w = 0;
      while (w <= n && zScore(w, n, p0) < line) w += 1;
      if (w > n) continue;
      ratios.push({
        n,
        wins_needed: w,
        exact_over_nominal: Number(
          (binomialUpperTail(w, n, p0) / (0.025 / k)).toFixed(3),
        ),
      });
    }
    const r = ratios.map((x) => x.exact_over_nominal);
    rows.push({
      grade,
      p0: Number(p0.toFixed(4)),
      k,
      min: Math.min(...r),
      max: Math.max(...r),
      by_n: ratios,
    });
  }
}
const out = {
  purpose:
    "/today 型 b の言い切りを正規近似の z で判定すると、線上の正確な二項の上側確率が名目の何倍になるか。1 を超える級は甘い",
  computed_at: "2026-10-27",
  source:
    "data/analysis/today-course-win-prior.json の grade_baselines_all_runs.c1（各走の級で数えた全国の1コースの1着率、2025-12-02〜2026-10-25）",
  conclusion:
    "A1・A2 は 1 未満（安全側）、B1・B2 は最大で約2倍（甘い）。claim は正確な二項の上側確率 ≤ 0.025/K で判定する（src/utils/todayCourseWin.js）",
  rows,
};
mkdirSync(new URL("data/analysis/today-course-win/", root), {
  recursive: true,
});
writeFileSync(
  new URL("data/analysis/today-course-win/exact-vs-normal-tail.json", root),
  `${JSON.stringify(out, null, 2)}\n`,
);
for (const r of rows)
  console.log(`${r.grade} K=${r.k}: ${r.min}〜${r.max} 倍`);
