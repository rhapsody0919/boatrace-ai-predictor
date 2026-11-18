/**
 * MotorConditionChart の本文を字で読む verify（verify-motor-*・verifyData）が、整形の関数が
 * 画面の部品（src/components/analysis/MotorConditionChart.jsx）にあっても、src/pure/motorChart*.js
 * へ移した後でも、同じ判定をするための読み（RA21）。画面の本文の後ろに src/pure/motorChart*.js の本文を
 * 名前の順に足す。判定（includes・正規表現）は呼ぶ側のまま変えない。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pureDir = path.join(root, "src", "pure");
const PURE_NAME = /^motorChart[A-Za-z0-9]*\.js$/;

export function withMotorChartPure(chartJsx) {
  const pure = readdirSync(pureDir)
    .filter((name) => PURE_NAME.test(name))
    .sort()
    .map((name) => readFileSync(path.join(pureDir, name), "utf8"));
  return [chartJsx, ...pure].join("\n");
}
