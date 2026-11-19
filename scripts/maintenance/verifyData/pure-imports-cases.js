/**
 * verify-pure-imports.js の自己テストの表（CASES）の一部と、表の置き場の名前。大きさの関所のため、本文を字のまま移した。verify ではない。
 * fs・ネットワークの語を含む件（1件目・node:fs の件）と BANNED_GLOBALS の件は verify に残し、並びは verify の CASES で元のままに組む。
 */

export const SRC = "src/pure/selftest/a.js";
export const SCR = "scripts/lib/pure/selftest/a.js";

/** CASES の 2 件目から node:fs の件の前まで */
export const CASES_A = [
  {
    name: "scripts/lib/pure: 自分の中と src/pure の .js を通す",
    file: SCR,
    code: 'import { a } from "./b.js";\nimport { s } from "../../../../src/pure/x.js";\nexport { t } from "../../../../src/pure/y/z.js";\nexport const v = [a, s];\n',
    want: "ok",
  },
  // ../ での脱出と向き
  {
    name: "src/pure → src/utils（../ で脱出）",
    file: SRC,
    code: 'import { a } from "../../utils/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "src/pure → scripts/lib/pure（逆向き）",
    file: SRC,
    code: 'import { a } from "../../../scripts/lib/pure/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "scripts/lib/pure → scripts/lib（../ で脱出）",
    file: SCR,
    code: 'import { a } from "../../hitCalculator.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "scripts/lib/pure → src/utils",
    file: SCR,
    code: 'import { a } from "../../../../src/utils/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "src/pure → 名前が似た兄弟（src/pure-x）",
    file: SRC,
    code: 'import { a } from "../../pure-x/y.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  // 再 export
  {
    name: "export { } from で根の外",
    file: SRC,
    code: 'export { a } from "../../utils/x.js";\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "export * from で根の外",
    file: SRC,
    code: 'export * from "../../utils/x.js";\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "export * as from で根の外",
    file: SCR,
    code: 'export * as n from "../../x.js";\n',
    want: "pure/imports:badTarget",
  },
  // JSON・拡張子・npm・node:・絶対パス
  {
    name: "JSON",
    file: SRC,
    code: 'import d from "./d.json" with { type: "json" };\nexport { d };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "拡張子なし",
    file: SRC,
    code: 'import { a } from "./b";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: ".mjs",
    file: SRC,
    code: 'import { a } from "./b.mjs";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "?raw 付き",
    file: SRC,
    code: 'import a from "./b.js?raw";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "%2e%2e（URL で .. になる）で脱出",
    file: SRC,
    code: 'import a from "./%2e%2e/%2e%2e/utils/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "\\ （URL で / になる）で脱出",
    file: SRC,
    code: 'import a from "./..\\\\..\\\\utils/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "?.js（問い合わせで拡張子を偽る）",
    file: SRC,
    code: 'import a from "./b?.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "npm の部品",
    file: SRC,
    code: 'import _ from "lodash";\nexport { _ };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "npm の部品の再 export",
    file: SRC,
    code: 'export { useState } from "react";\n',
    want: "pure/imports:badTarget",
  },
];

/** CASES の node:fs の件の後ろからグローバルの件の前まで */
export const CASES_B = [
  {
    name: "副作用だけの import",
    file: SCR,
    code: 'import "dotenv/config";\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "絶対パス",
    file: SRC,
    code: 'import { a } from "/etc/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "Vite の別名",
    file: SRC,
    code: 'import { a } from "@/utils/x.js";\nexport { a };\n',
    want: "pure/imports:badTarget",
  },
  // import()・require()
  {
    name: "import() で根の外",
    file: SRC,
    code: 'export const a = () => import("../../services/x.js");\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "文字列でない import()",
    file: SRC,
    code: "export const a = (p) => import(p);\n",
    want: "pure/imports:dynamic",
  },
  {
    name: "式を含むテンプレートの import()",
    file: SRC,
    code: "export const a = (p) => import(`./${p}.js`);\n",
    want: "pure/imports:dynamic",
  },
  {
    name: "require() で根の外",
    file: SCR,
    code: 'export const a = require("../../x.js");\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "require() は根の中でも require が未定義で落ちる",
    file: SCR,
    code: 'export const a = require("./x.js");\n',
    want: "no-undef:undef",
  },
  {
    name: "文字列でない require()",
    file: SCR,
    code: "export const a = (p) => require(p);\n",
    want: "pure/imports:dynamic",
  },
  // コメントの中の型の import
  {
    name: "JSDoc の import() 型で根の外",
    file: SRC,
    code: '/** @param {import("../../services/x.js").T} a */\nexport const f = (a) => a;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "JSDoc の import() 型で npm（@types）",
    file: SRC,
    code: '/** @type {import("react").FC} */\nexport const f = null;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "JSDoc の @import で根の外",
    file: SCR,
    code: '/** @import { T } from "../../x.js" */\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <reference types>",
    file: SRC,
    code: '/// <reference types="node" />\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <reference lib>",
    file: SRC,
    code: '/// <reference lib="dom" />\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <reference path> で根の外",
    file: SRC,
    code: '/// <reference path="../../types/x.d.ts" />\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <reference> に path= と types= が並ぶ",
    file: SRC,
    code: '/// <reference types="node" path="./a.js" />\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <Reference>（大文字。tsc は区別しない）",
    file: SRC,
    code: '/// <Reference LIB="dom" />\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/// <reference path> の素の名前は相対として判定する（根の中なら通す）",
    file: SRC,
    code: '/// <reference path="b.js" />\nexport const f = 1;\n',
    want: "ok",
  },
  {
    name: '説明の行コメント・/* */ の中の import("…") は見ない（tsc は JSDoc だけ読む）',
    file: SRC,
    code: '// 旧: import("../../services/x.js") から移した\n/* import("../../utils/y.js") */\n/* global な状態を持たない */\nexport const f = 1;\n',
    want: "ok",
  },
];

/** CASES のグローバルの件の後ろから最後まで */
export const CASES_C = [
  {
    name: "typeof window も落ちる",
    file: SRC,
    code: 'export const a = typeof window === "undefined";\n',
    want: "pure/imports:banned",
  },
  {
    name: "間接の eval",
    file: SRC,
    code: 'export const a = (0, eval)("1");\n',
    want: "pure/imports:banned",
  },
  {
    name: "new Function",
    file: SRC,
    code: 'export const a = new Function("return this");\n',
    want: "pure/imports:banned",
  },
  {
    name: "import.meta",
    file: SCR,
    code: "export const a = import.meta.url;\n",
    want: "pure/imports:importMeta",
  },
  {
    name: "src/pure の document（eslint.config.js の browser を使っていない）",
    file: SRC,
    code: "export const a = () => document.title;\n",
    want: "no-undef:undef",
  },
  {
    name: "scripts/lib/pure の Buffer（eslint.config.js の node を使っていない）",
    file: SCR,
    code: 'export const a = () => Buffer.from("x");\n',
    want: "no-undef:undef",
  },
  {
    name: "console",
    file: SRC,
    code: "export const a = () => console.log(1);\n",
    want: "no-undef:undef",
  },
  {
    name: "setTimeout",
    file: SCR,
    code: "export const a = () => setTimeout(() => {}, 1);\n",
    want: "no-undef:undef",
  },
  // 組み込みの書き換え（system-architect の審査 P2-1）
  ...[
    'JSON.stringify = (v) => "x";',
    "Date.prototype.toJSON = function () { return 1; };",
    'Object.defineProperty(Object.prototype, "q", { value: 1 });',
    'Object.defineProperty(Array.prototype, "q", { value: 1 });',
    "Object.assign(Math, { x: 1 });",
    'Reflect.set(JSON, "parse", () => 1);',
    "delete JSON.parse;",
    "Math.counter++;",
    'Error.prepareStackTrace = () => "";',
  ].map((code) => ({
    name: `組み込みの書き換え: ${code}`,
    file: SRC,
    code: `${code}\nexport const a = 1;\n`,
    want: "pure/imports:builtinMutation",
  })),
  {
    name: "組み込みそのものへの代入（no-global-assign）",
    file: SRC,
    code: "JSON = {};\nexport const a = 1;\n",
    want: "no-global-assign:globalShouldNotBeModified",
  },
  {
    name: "組み込みを読むだけ・自分の物への assign・defineProperty・同名の自前の変数は通す",
    file: SRC,
    code: 'const o = {};\nObject.defineProperty(o, "q", { value: 1 });\nexport const a = Object.assign({}, o, { b: JSON.parse("1"), c: Array.prototype.slice.call([1]) });\nexport const f = () => { const Math = { x: 0 }; Math.x = 1; return Math; };\n',
    want: "ok",
  },
  // 複数行の JSDoc（system-architect の審査 P2-2）
  {
    name: "改行をはさんだ JSDoc の import( で根の外",
    file: SRC,
    code: '/**\n * @typedef {import(\n *   "../../services/x.js"\n * ).T} T\n */\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "改行をはさんだ @import で根の外",
    file: SCR,
    code: '/**\n * @import { A } from\n *   "../../x.js"\n */\nexport const f = 1;\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "行き先を取り出せない JSDoc の import(",
    file: SRC,
    code: "/** @type {import(someName).T} */\nexport const f = 1;\n",
    want: "pure/imports:badTarget",
  },
  // 設定コメントは効かない・構文エラー
  {
    name: "/* global document */ は効かず、document は no-undef で落ちる",
    file: SRC,
    code: "/* global document */\nexport const a = () => document.title;\n",
    want: "no-undef:undef",
  },
  {
    name: "eslint-disable は効かず、npm の import は落ちる",
    file: SRC,
    code: '// eslint-disable-next-line pure/imports\nimport x from "lodash";\nexport { x };\n',
    want: "pure/imports:badTarget",
  },
  {
    name: "/* eslint-disable */ は効かず、window は落ちる",
    file: SRC,
    code: "/* eslint-disable */\nexport const a = () => window;\n",
    want: "pure/imports:banned",
  },
  { name: "構文エラー", file: SRC, code: "export const = ;\n", want: "parse" },
];
