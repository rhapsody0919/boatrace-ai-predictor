#!/usr/bin/env node
/**
 * verify-size-baseline.js - 大きさの関所の部品（sizeBaselines.js）の線と例外の表の判定を固定の入力で試す（ADR-0110）。
 * 関数の行数・複雑さの境目、実質の行の数え方、例外の表の上限と減る向きだけを見る。
 */
import {
  judgeTreeSize,
  sizeExceptionsGrowth,
  substantiveLineNumbers,
  unitsOfSource,
} from "./sizeBaselines.js";

let failed = 0;
const ok = (cond, label) => {
  if (!cond) failed += 1;
  console.log(`${cond ? "OK" : "NG"}: ${label}`);
};

// total 行の関数（先頭と末尾の行を含む）
const fn = (name, total) =>
  [
    `export function ${name}() {`,
    ...Array.from({ length: total - 2 }, (_, i) => `  const a${i} = ${i};`),
    "}",
    "",
  ].join("\n");
const filler = (n) =>
  Array.from({ length: n }, (_, i) => `export const k${i} = ${i};`).join("\n");
const judge = (source) => judgeTreeSize({ files: { "src/a.js": source }, exceptions: { files: {} } });
const verdict = (r) => `${r.errors.length}赤/${r.warnings.length}警告`;

// --- 関数の線（100 行・複雑さ 15）の境目 ---
let r = judge(fn("edge", 100));
ok(r.errors.length === 0, `100行ちょうど→緑（${verdict(r)}）`);
r = judge(fn("fresh", 101));
ok(r.errors.length === 1, `101行の関数→赤（${verdict(r)}）`);
const ifs = (n) => `export function cx(a) {\n${Array.from({ length: n }, () => "  if (a) a();").join("\n")}\n}\n`;
r = judge(ifs(14));
ok(r.errors.length === 0, `複雑さ 15（if 14本）→緑（${verdict(r)}）`);
r = judge(ifs(15));
ok(r.errors.length === 1, `複雑さ 16（if 15本）→赤（${verdict(r)}）`);
// 枝の種類ごとに複雑さに数える（三項・論理・?? ・?.・for・while・catch・既定値・論理の代入）
const kinds = [
  "a ? 1 : 2;", "a && b;", "a || b;", "a ?? b;", "a?.b;", "a?.();", "for (;;) break;", "for (const k in a) k;",
  "for (const k of a) k;", "while (a) break;", "do { break; } while (a);", "try { a(); } catch { b(); }",
  "a &&= b;", "a ||= b;", "a ??= b;",
];
for (const k of kinds) {
  const src = `export function one(a, b) {\n${Array.from({ length: 15 }, () => `  ${k}`).join("\n")}\n}\n`;
  ok(unitsOfSource(src)[0].complexity === 16, `「${k}」を15個→複雑さ 16（${unitsOfSource(src)[0].complexity}）`);
}
ok(unitsOfSource("export function d(a = 1, b = 2) {\n  return a + b;\n}\n")[0].complexity === 3, "既定値の引数も枝に数える");
// 単位の取り方: class・object のメソッド・変数の関数も1つずつ
const cls = "class S {\n  async getX() {\n    return 1;\n  }\n}\nexport default {\n  getY() {\n    return 2;\n  },\n};\nconst h = async () => 1;\n";
ok(JSON.stringify(unitsOfSource(cls).map((u) => u.name).sort()) === JSON.stringify(["getX", "getY", "h"]), "class・object のメソッドと変数の関数を単位に取る");

// --- 実質の行 ---
ok(substantiveLineNumbers("const a = 1;\n\n// x\n/* y\n z */\nconst b = 2;\n").join() === "1,6", "空行・注釈だけの行は実質の行に数えない");
const spaced = `/* 頭 */\n${filler(400)}\n\n// 尾\n`;
r = judge(spaced);
ok(r.errors.length === 0, `注釈と空行を除いて 400 行ちょうど→緑（${verdict(r)}）`);

// --- 全体で0＋例外の表（2026-11-25、ADR-0110） ---
const big = filler(401); // 実質 401 行
let t = judgeTreeSize({ files: { "a.js": fn("small", 10), "b.js": filler(400) }, exceptions: { files: {} } });
ok(t.errors.length === 0 && t.warnings.length === 0, "線の内の関数と実質400行のファイルは緑");
t = judgeTreeSize({ files: { "a.js": fn("long", 101) }, exceptions: { files: {} } });
ok(t.errors.length === 1, "101 行の関数は既にある・無いに依らず赤（base の木の基準を持たない）");
t = judgeTreeSize({ files: { "a.js": big }, exceptions: { files: {} } });
ok(t.errors.length === 1, "実質 401 行で表に無いファイルは赤");
t = judgeTreeSize({ files: { "a.js": big }, exceptions: { files: { "a.js": 401 } } });
ok(t.errors.length === 0 && t.warnings.length === 0, "表の上限の内は緑");
t = judgeTreeSize({ files: { "a.js": `${big}\nexport const z = 1;` }, exceptions: { files: { "a.js": 401 } } });
ok(t.errors.length === 1, "表の上限を越えて増えたら赤");
t = judgeTreeSize({ files: { "a.js": `${big}\n\n// 注釈\n` }, exceptions: { files: { "a.js": 401 } } });
ok(t.errors.length === 0, "空行・注釈は実質の行に数えない");
t = judgeTreeSize({ files: { "a.js": filler(300) }, exceptions: { files: { "a.js": 401, "gone.js": 500 } } });
ok(t.errors.length === 2, "減った・消えたファイルが表に残ると赤（戻しても通る穴を塞ぐ）");
t = judgeTreeSize({ files: { "a.js": `${big}\nexport const z = 1;` }, exceptions: { files: { "a.js": 402 } } });
ok(t.errors.length === 0, "上限ちょうどは緑");
t = judgeTreeSize({ files: { "a.js": "export const = ;" }, exceptions: { files: {} } });
ok(t.skipped.length === 1 && t.errors.length === 0, "parse できないファイルは skipped");
ok(sizeExceptionsGrowth({ files: { "a.js": 401 } }, { files: { "a.js": 401 } }).length === 0, "表が同じなら緑");
ok(sizeExceptionsGrowth({ files: { "a.js": 401 } }, { files: { "a.js": 300 } }).length === 0, "上限を下げるのは緑");
ok(sizeExceptionsGrowth({ files: { "a.js": 401 } }, { files: { "a.js": 402 } }).length === 1, "上限を上げると赤");
ok(sizeExceptionsGrowth({ files: {} }, { files: { "b.js": 500 } }).length === 1, "行を足すと赤");

if (failed > 0) {
  console.error(`verify-size-baseline: NG（${failed} 件）`);
  process.exit(1);
}
console.log("verify-size-baseline: OK");
