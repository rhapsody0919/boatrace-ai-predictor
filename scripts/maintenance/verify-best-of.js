#!/usr/bin/env node
/**
 * 6艇の中の最良値の判定 `bestOf`（src/utils/bestOf.js）の回帰テスト。
 * docs/design/race-detail-ui-unify spec R1。DB 接続は不要。
 *
 * 守ること:
 *   - 同じ値で並んだ最良は全部返す（以前は艇番の若い方1つだけで、並んだ艇が劣って見えた）
 *   - 値のある艇が無い・全艇同値なら空（差が無いものは強調しない）
 *   - 表示の桁で丸めてから比べる（54.84 と 54.80 は両方「54.8」、
 *     JS で平均した 6.710000000000001 と 6.71 は同じ値）
 *   - null / undefined / NaN は候補から外す
 *
 * 末尾の変異検証で、要（同値の全返し・全艇同値の除外・丸め）を1つずつ壊したコピーに
 * 同じ検証をかけ、検証が落ちる（＝歯がある）ことを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../../src/utils/bestOf.js");

const c = (...values) => values.map((value, i) => ({ boat: i + 1, value }));
const sorted = (set) => [...set].sort((a, b) => a - b);

const CASES = [
  ["最大が1艇", () => [c(1, 3, 2), "max", {}], [2]],
  ["最小が1艇", () => [c(1, 3, 2), "min", {}], [1]],
  ["同値の最大は全部", () => [c(6.71, 6.79, 6.71), "min", {}], [1, 3]],
  ["全艇同値は空", () => [c(5, 5, 5), "max", {}], []],
  ["値なしは空", () => [c(null, undefined, null), "max", {}], []],
  ["null を除いて判定", () => [c(null, 2, 4), "max", {}], [3]],
  ["null を除くと全艇同値なら空", () => [c(null, 2, 2), "max", {}], []],
  ["NaN を除く", () => [c(Number.NaN, 2, 1), "max", {}], [2]],
  ["表示桁で同値（54.84 と 54.80 は 54.8）", () => [c(54.84, 54.8, 41.9), "max", { digits: 1 }], [1, 2]],
  ["平均の誤差（6.710000000000001 と 6.71）", () => [c((6.71 + 6.69 + 6.73) / 3, 6.71, 6.8), "min", { digits: 2 }], [1, 2]],
  ["表示桁で全艇同値なら空", () => [c(54.84, 54.8, 54.81), "max", { digits: 1 }], []],
  ["digits 0（回収率）", () => [c(99.6, 100.4, 87), "max", { digits: 0 }], [1, 2]],
  ["候補が null でも空", () => [null, "max", {}], []],
  // 走数が少ない値（hidden）は比べるが返さない。次の艇へ繰り下げない（PR #1187 ファン評価1周目）
  ["hidden の最良は返さず繰り下げない", () => [[{ boat: 1, value: 10, hidden: true }, { boat: 2, value: 7 }, { boat: 3, value: 5 }], "max", {}], []],
  ["hidden と同値の最良は hidden 以外だけ返す", () => [[{ boat: 1, value: 8, hidden: true }, { boat: 2, value: 8 }, { boat: 3, value: 5 }], "max", {}], [2]],
];

function run(bestOf) {
  const failures = [];
  for (const [name, args, expected] of CASES) {
    const [cand, dir, opts] = args();
    const got = sorted(bestOf(cand, dir, opts));
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(got)}`);
    }
  }
  return failures;
}

const { bestOf } = await import(pathToFileURL(SRC).href);
const failures = run(bestOf);

// 変異検証: 要を壊したコピーでは検証が落ちること
const source = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["同値を1艇だけ返す", ".map((c) => c.boat),\n  );", ".slice(0, 1).map((c) => c.boat),\n  );"],
  ["全艇同値を除かない", "if (min === max) return new Set();", ""],
  ["丸めない", "(digits === undefined ? v : Number(v.toFixed(digits)))", "v"],
  ["hidden を返す", "c.value === target && !c.hidden", "c.value === target"],
];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-best-of-"));
for (const [name, from, to] of MUTANTS) {
  if (!source.includes(from)) {
    failures.push(`変異「${name}」の置換元がソースに無い（ソースが変わったら MUTANTS を直す）`);
    continue;
  }
  const file = path.join(tmpDir, `${name.replace(/\s/g, "_")}.mjs`);
  fs.writeFileSync(file, source.replace(from, to));
  const mutated = await import(pathToFileURL(file).href);
  if (run(mutated.bestOf).length === 0) {
    failures.push(`変異「${name}」で検証が落ちない（テストに歯が無い）`);
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("verify-best-of: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-best-of: OK（${CASES.length}件、変異${MUTANTS.length}件）`);
