#!/usr/bin/env node
// 大きさの関所の単位の取り方（sizeBaselines.js の unitsOfSource）: 宣言でない文を飛ばし、名前の無い default の関数も数え、注釈を複雑さに入れないこと
import assert from "node:assert/strict";
import { judgeTreeSize, unitsOfSource } from "./sizeBaselines.js";

const names = (src) => unitsOfSource(src).map((u) => u.name);

// 宣言でない最上位の文は単位にしない（落ちずに空を返す）
const notDecl = [
  'import { a } from "./a.js";',
  'import "./side-effect.js";',
  "console.log(1);",
  'export { a } from "./a.js";',
  'export * from "./b.js";',
  "export default 1 + 2;",
  "if (globalThis.x) globalThis.y = 1;",
  "for (const k of []) k;",
];
for (const src of notDecl) assert.deepEqual(names(src), [], src);

// 名前の無い export default の関数・アロー関数は「default」の名で単位に取る（2026-11-27 まで抜け、どれだけ大きくても線に掛からなかった）。
// 名前の無い default の class はメソッドを単位に取る
assert.deepEqual(names("export default function () {\n  return 1;\n}"), ["default"]);
assert.deepEqual(names("export default async () => {\n  return 1;\n};"), ["default"]);
assert.deepEqual(names("export default function named() {}"), ["named"]);
assert.deepEqual(names("export default class {\n  m() {\n    return 1;\n  }\n}"), ["m"]);
const bigDefault = `export default function () {\n${Array.from({ length: 100 }, (_, i) => `  const a${i} = ${i};`).join("\n")}\n}\n`;
assert.equal(judgeTreeSize({ files: { "src/d.js": bigDefault }, exceptions: { files: {} } }).errors.length, 1, "101 行の名前の無い default は赤");

// 宣言と宣言でない文が混じっても、宣言だけを単位に取る
const mixed = [
  'import { a } from "./a.js";',
  "console.log(a);",
  "export function f() {\n  return a;\n}",
  "export const g = () => 1, h = 2;",
  "let { x } = { x: 1 };",
  "const o = { m() { return 1; }, n: function () { return 2; }, k: 3 };",
  "export default { p() { return 3; } };",
  "class C {\n  get v() {\n    return 1;\n  }\n  [Symbol.iterator]() {}\n  w() {}\n}",
].join("\n");
assert.deepEqual(names(mixed), ["f", "g", "m", "n", "p", "v", "w"]);

// 注釈と位置の情報は複雑さに入らない（枝の無い関数は 1）
const commented = "export function c(a) {\n  // if (a) a();\n  /* a ? 1 : 2 && b */\n  return a; // a || b\n}\n";
assert.equal(unitsOfSource(commented)[0].complexity, 1);
assert.equal(unitsOfSource("export function d(a) {\n  // x\n  if (a) a(); // y\n}\n")[0].complexity, 2);

// import だけのファイルも判定で落ちない
const r = judgeTreeSize({ files: { "src/a.js": 'import { a } from "./a.js";\nexport { a };\n' }, exceptions: { files: {} } });
assert.deepEqual(r, { errors: [], warnings: [], skipped: [] });

console.log("verify-size-units: OK");
