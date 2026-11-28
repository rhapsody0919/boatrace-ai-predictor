#!/usr/bin/env node
/**
 * 選手の推移の線の下の段（RacerMotorBand.css）が、節の位置（上・中・下）で色を分けないことの検査（plan.md §14、オーナー 2026-11-28）。
 * 1つの節の上下は偶然の幅を超えたと言えないので、色は付けない。2連率の無い節の点線（--none）だけは残す
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/components/race/basic-info/RacerMotorBand.css", import.meta.url), "utf8");
const failures = [];
for (const tier of ["high", "mid", "low"]) {
  if (css.includes(`.rmb-seg--${tier}`)) failures.push(`.rmb-seg--${tier} の見た目の規則が残っている（位置で色を分けない）`);
}
if (!/\.rmb-seg--none \.rmb-box\s*\{[^}]*stroke-dasharray/.test(css)) failures.push("2連率の無い節（--none）の点線が無い");
if (failures.length > 0) {
  console.error(`verify-racer-motor-band-no-tier-color: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-racer-motor-band-no-tier-color: OK");
