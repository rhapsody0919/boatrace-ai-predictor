/**
 * verify-volatility-st-reason.js - イン崩れ指数の理由文の「1号艇の平均ST」の1行（BOA-818）。DBには接続しない。
 *
 * 守るもの: 値は racer_aggregated_stats.avg_st（当サイトに蓄積した全期間）なので、理由文がその期間どおりに
 * 書かれていること。以前は「1号艇の今節ST」と書いていて、今節の走ではない値を今節と読ませていた。
 * 予想バッチ（generate-predictions.js・generate-unified-predictions.js）の両方が同じ関数を使うことも確かめる
 */
import { readFileSync } from "node:fs";
import { boat1StReason } from "../lib/volatilityFactors.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const cases = [
  [0.23, "1号艇の平均ST（当サイトに蓄積した全期間）が非常に遅い（0.230秒）→ 出遅れリスク大"],
  [0.19, "1号艇の平均ST（当サイトに蓄積した全期間）が遅い（0.190秒）→ イン崩れリスク"],
  [0.16, "1号艇の平均ST（当サイトに蓄積した全期間）は標準（0.160秒）"],
  [0.13, "1号艇の平均ST（当サイトに蓄積した全期間）が速い（0.130秒）→ スタート安定"],
  [0.09, "1号艇の平均ST（当サイトに蓄積した全期間）が非常に速い（0.090秒）→ 逃げ鉄板"],
];
for (const [st, expected] of cases) {
  const got = boat1StReason(st);
  check(`平均ST ${st} の理由文`, got === expected, got);
}
check(
  "理由文に「今節」と書かない（値は今節の走ではない）",
  cases.every(([st]) => !boat1StReason(st).includes("今節")),
);

for (const file of [
  "scripts/daily/generate-predictions.js",
  "scripts/lib/volatilityFactors.js",
]) {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  check(`${file} に「今節ST」の理由文が残っていない`, !src.includes("の今節ST"));
}
const gp = readFileSync(
  new URL("../daily/generate-predictions.js", import.meta.url),
  "utf8",
);
check(
  "generate-predictions.js は boat1StReason を使う（文言の二重管理をしない）",
  gp.includes("boat1StReason(boat1ST)"),
);

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全て成功");
