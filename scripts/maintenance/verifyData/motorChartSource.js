/**
 * MotorConditionChart の本文を字で読む verify（verify-motor-*・verifyData）が、整形の関数が
 * 画面の部品（src/components/analysis/MotorConditionChart.jsx）にあっても、src/pure/motorChart*.js
 * へ移した後でも、同じ判定をするための読み（RA21）。画面の本文の後ろに src/pure/motorChart*.js の本文を
 * 名前の順に足す。判定（includes・正規表現）は呼ぶ側のまま変えない。
 * 画面の本文を区画のファイル（src/components/analysis/MotorCondition*.jsx・motorCondition*.js*）へ
 * 字のまま移した後も同じ判定をするため、殻の後ろに区画の本文を名前の順に足す。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pureDir = path.join(root, "src", "pure");
const PURE_NAME = /^motorChart[A-Za-z0-9]*\.js$/;
const partsDir = path.join(root, "src", "components", "analysis");
const PART_NAME = /^[Mm]otorCondition(?!Chart\.)[A-Za-z0-9]*\.jsx?$/;

export function withMotorChartPure(chartJsx) {
  const parts = readdirSync(partsDir)
    .filter((name) => PART_NAME.test(name))
    .sort()
    .map((name) => readFileSync(path.join(partsDir, name), "utf8"));
  const pure = readdirSync(pureDir)
    .filter((name) => PURE_NAME.test(name))
    .sort()
    .map((name) => readFileSync(path.join(pureDir, name), "utf8"));
  return [chartJsx, ...parts, ...pure].join("\n");
}
