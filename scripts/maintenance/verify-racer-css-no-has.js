// 選手ページの PC の並びの CSS が :has() を使わないことを守る（recharts が文字を測るたびの再計算が重くなり、描画が約1.5倍に延びた。2026-11-26）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 図（recharts）のある選手ページに効く CSS。:has() の代わりに JSX で付けたクラス（--bars・--chart 等）で条件を書く
const FILES = [
  "src/pages/RacerProfile.css",
  "src/components/racer/RacerPerformanceStatsPc.css",
];

/** 注釈を除いた CSS の中の :has( の数 */
export function countHas(css) {
  return (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/:has\(/g) ?? []).length;
}

assert.equal(countHas("a:has(> b){x:1}/* :has( */ c{}"), 1);
assert.equal(countHas("/* :has( は使わない */ a.b{}"), 0);

for (const file of FILES) {
  assert.equal(
    countHas(readFileSync(file, "utf-8")),
    0,
    `${file} に :has() がある`,
  );
}

console.log("verify-racer-css-no-has: OK");
