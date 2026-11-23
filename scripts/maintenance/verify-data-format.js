#!/usr/bin/env node
/**
 * 表とグラフの数字の書き方（src/pure/dataFormat.js、design-system.md「表とグラフ」決まり5・6）の回帰テスト。
 * DB 接続は不要。
 *
 * 守ること:
 *   - 勝率は小数2桁、率は小数1桁で、% は数字と分けて返す（見出しと値で % を二重にしない）
 *   - 件数は桁区切り、空（null・undefined・NaN）は「—」
 *   - 丸めて 0 になる負の値を「-0.0」にしない。差は正だけ「+」を付ける
 *   - 上下の向きは表示の桁で決める（0.04 は向き無し）
 *   - 少ない母数は6件未満（6件は少なくない）
 *
 * 末尾の変異検証で、要を1つずつ壊したコピーに同じ検証をかけ、検証が落ちることを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../../src/pure/dataFormat.js");

const CASES = [
  ["勝率は小数2桁", (m) => m.formatWinRate(7.8), "7.80"],
  ["勝率の空は —", (m) => m.formatWinRate(null), "—"],
  ["率は数字と単位を分ける", (m) => m.rateParts(58.26), { text: "58.3", unit: "%" }],
  ["率の空は単位も空", (m) => m.rateParts(undefined), { text: "—", unit: "" }],
  ["率の NaN は空", (m) => m.rateParts(Number.NaN), { text: "—", unit: "" }],
  ["率の桁を変えられる", (m) => m.rateParts(100, 0), { text: "100", unit: "%" }],
  ["率を1つの字で", (m) => m.formatRate(8.14), "8.1%"],
  ["率の空を1つの字で", (m) => m.formatRate(null), "—"],
  ["件数は桁区切り", (m) => m.formatCount(1204), "1,204"],
  ["件数の 0 は 0", (m) => m.formatCount(0), "0"],
  ["件数の空は —", (m) => m.formatCount(null), "—"],
  ["丸めて 0 の負は 0.0", (m) => m.fixed(-0.04, 1), "0.0"],
  ["差の正は +", (m) => m.formatSigned(1.24), "+1.2"],
  ["差の負は -", (m) => m.formatSigned(-0.44), "-0.4"],
  ["差の 0 は符号なし", (m) => m.formatSigned(0.04), "0.0"],
  ["上は up", (m) => m.trendOf(0.06), "up"],
  ["下は down", (m) => m.trendOf(-0.3), "down"],
  ["表示の桁で 0 は向き無し", (m) => m.trendOf(0.04), null],
  ["空は向き無し", (m) => m.trendOf(null), null],
  ["5件は少ない", (m) => m.isSmallN(5), true],
  ["6件は少なくない", (m) => m.isSmallN(6), false],
  ["母数不明は少ないとしない", (m) => m.isSmallN(null), false],
];

function run(mod) {
  const failures = [];
  for (const [name, fn, expected] of CASES) {
    let got;
    try {
      got = fn(mod);
    } catch (e) {
      failures.push(`${name}: 例外 ${e.message}`);
      continue;
    }
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(got)}`);
    }
  }
  return failures;
}

const failures = run(await import(pathToFileURL(SRC).href));

const source = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["勝率を1桁にする", "export const formatWinRate = (v) => fixed(v, 2);", "export const formatWinRate = (v) => fixed(v, 1);"],
  ["率に % を混ぜる", "{ text: fixed(v, digits), unit: \"%\" }", "{ text: `${fixed(v, digits)}%`, unit: \"%\" }"],
  ["桁区切りしない", "Math.round(n).toLocaleString(\"ja-JP\")", "String(Math.round(n))"],
  ["-0.0 を直さない", "return Number(s) === 0 ? (0).toFixed(digits) : s;", "return s;"],
  ["向きを生の値で決める", "const r = Number(v.toFixed(digits));", "const r = v;"],
  ["6件を少ないにする", "n < SMALL_SAMPLE_N", "n <= SMALL_SAMPLE_N"],
];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-data-format-"));
for (const [name, from, to] of MUTANTS) {
  if (!source.includes(from)) {
    failures.push(`変異「${name}」の置換元がソースに無い（ソースが変わったら MUTANTS を直す）`);
    continue;
  }
  const file = path.join(tmpDir, `${name.replace(/\s/g, "_")}.mjs`);
  fs.writeFileSync(file, source.replace(from, to));
  if (run(await import(pathToFileURL(file).href)).length === 0) {
    failures.push(`変異「${name}」で検証が落ちない（テストに歯が無い）`);
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("verify-data-format: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-data-format: OK（${CASES.length}件、変異${MUTANTS.length}件）`);
