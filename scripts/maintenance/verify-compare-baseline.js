#!/usr/bin/env node
/**
 * 基準との比べ（偶然の幅を超えたときだけ向きを返す）と6艇の上位2・下位2の3段の判定 src/pure/compareBaseline.js の回帰テスト。
 * 意味づけ（2026-11-26 オーナー承認）。DB 接続は不要。
 *
 * 守ること:
 *   - 差が偶然の幅（|z|≥1.96、24会場は 3.08）を超えたときだけ high/low、超えなければ unclear
 *   - 走数が minN 未満は few（色を付けない）
 *   - 期待の件数が小さい率は正確な二項で判定する（正規近似だと 2% の6コースで 70走中4勝が「高い」になる）
 *   - 大きい率（98%）でも正確な二項が下へ溢れない
 *   - 3段は同じ値を同じ順位にする（展示タイム 6.48 が2艇なら上位が3艇）。全艇同値・値が4艇以下は空
 *
 * 値の例は本番の常滑 2026-11-25 3R の枠別情報・直前情報の画面の値。
 * 末尾の変異検証で、要を1つずつ壊したコピーでは検証が落ちることを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "../../src/pure/compareBaseline.js");

const c = (...values) => values.map((value, i) => ({ boat: i + 1, value }));
const tiers = (m) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]));

function cases(m) {
  const rate = (args) => m.judgeRateVsBaseline(args)?.dir ?? null;
  const mean = (args) => m.judgeMeanVsBaseline(args)?.dir ?? null;
  return [
    ["1コース 82.7 対 55.0（81走）は高い", () => rate({ rate: 82.7, baseline: 55.0, n: 81 }), "high"],
    ["2コース 13.3 対 13.5（60走）は差を確認できない", () => rate({ rate: 13.3, baseline: 13.5, n: 60 }), "unclear"],
    ["3コース 21.2 対 13.1（52走）は差を確認できない", () => rate({ rate: 21.2, baseline: 13.1, n: 52 }), "unclear"],
    ["5コース 20.3 対 6.2（59走）は高い", () => rate({ rate: 20.3, baseline: 6.2, n: 59 }), "high"],
    ["6コース 18走（下限67）は few", () => rate({ rate: 0, baseline: 2.0, n: 18, minN: 67 }), "few"],
    ["6コース 2% で70走中4勝は正確な二項で差を確認できない", () => rate({ rate: (4 / 70) * 100, baseline: 2.0, n: 70 }), "unclear"],
    ["98% の基準で300走 90% は低い", () => rate({ rate: 90, baseline: 98, n: 300 }), "low"],
    ["98% の基準で300走 97% は差を確認できない（下へ溢れない）", () => rate({ rate: 97, baseline: 98, n: 300 }), "unclear"],
    ["会場 1コース 58.2 対 55.5（2,560R）は 1.96 なら高い", () => rate({ rate: 58.2, baseline: 55.5, n: 2560 }), "high"],
    ["同じ値を 24会場の線 3.08 では差を確認できない", () => rate({ rate: 58.2, baseline: 55.5, n: 2560, zLine: m.Z_LINE_VENUES }), "unclear"],
    ["会場 3コース 10.4 対 12.9（2,560R）は 3.08 でも低い", () => rate({ rate: 10.4, baseline: 12.9, n: 2560, zLine: m.Z_LINE_VENUES }), "low"],
    ["値が無ければ null", () => rate({ rate: null, baseline: 55, n: 80 }), null],
    ["平均ST 0.14 対 0.16（30走）は差を確認できない", () => mean({ mean: 0.14, baseline: 0.16, n: 30, sd: 0.066 }), "unclear"],
    ["平均ST 0.14 対 0.16（100走）は低い", () => mean({ mean: 0.14, baseline: 0.16, n: 100, sd: 0.066 }), "low"],
    ["ST が低いのは良い", () => m.toneOf("low", "low"), "good"],
    ["1着率が低いのは悪い", () => m.toneOf("low", "high"), "bad"],
    ["差を確認できないは色なし", () => m.toneOf("unclear", "high"), null],
    ["展示T は同タイムを同順位（上位3艇）", () => tiers(m.rankTiers(c(6.5, 6.52, 6.48, 6.49, 6.46, 6.48), "min")), { 1: "bottom", 2: "bottom", 3: "top", 5: "top", 6: "top" }],
    ["一周（低いほど良い）", () => tiers(m.rankTiers(c(36.1, 36.4, 36.83, 36.7, 36.7, 36.93), "min")), { 1: "top", 2: "top", 3: "bottom", 6: "bottom" }],
    ["高いほど良い", () => tiers(m.rankTiers(c(1, 2, 3, 4, 5, 6), "max")), { 1: "bottom", 2: "bottom", 5: "top", 6: "top" }],
    ["全艇同値は空", () => tiers(m.rankTiers(c(6.5, 6.5, 6.5, 6.5, 6.5, 6.5), "min")), {}],
    ["値が4艇以下は空", () => tiers(m.rankTiers(c(6.5, null, 6.48, null, 6.46, 6.49), "min")), {}],
    ["表示の桁で丸めて同順位", () => tiers(m.rankTiers(c(6.501, 6.504, 6.502, 6.7, 6.8, 6.9), "min", { digits: 2 })), { 1: "top", 2: "top", 3: "top", 5: "bottom", 6: "bottom" }],
  ];
}

function run(m) {
  const failures = [];
  for (const [name, fn, expected] of cases(m)) {
    const got = fn();
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${name}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(got)}`);
    }
  }
  return failures;
}

const failures = run(await import(pathToFileURL(SRC).href));

const source = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["線を見ない", "if (z >= zLine) return { diff, dir: \"high\" };\n  if (z <= -zLine) return { diff, dir: \"low\" };\n  return { diff, dir: \"unclear\" };\n}\n\n/**\n * 平均", "if (z >= 0) return { diff, dir: \"high\" };\n  if (z < 0) return { diff, dir: \"low\" };\n  return { diff, dir: \"unclear\" };\n}\n\n/**\n * 平均"],
  ["走数の下限を見ない", "if (n < minN || n <= 0) return { diff, dir: \"few\" };\n  const p", "if (n <= 0) return { diff, dir: \"few\" };\n  const p"],
  ["正確な二項を使わない", "if (n * p < EXACT_MIN_EXPECTED", "if (false && n * p < EXACT_MIN_EXPECTED"],
  ["大きい率を裏返さない", "if (p > 0.5) {", "if (false) {"],
  ["同値を同順位にしない", "if (betterCount < size) tiers.set", "if (values.indexOf(c) < size && betterCount < size + 1) tiers.set"],
  ["丸めない", "(digits === undefined ? v : Number(v.toFixed(digits)))", "v"],
];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-compare-baseline-"));
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
  console.error("verify-compare-baseline: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-compare-baseline: OK（${cases({}).length}件、変異${MUTANTS.length}件）`);
