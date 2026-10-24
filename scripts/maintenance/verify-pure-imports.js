#!/usr/bin/env node
/**
 * verify-pure-imports.js - pure の根（src/pure・scripts/lib/pure）の中のファイルが、根の外の部品・
 * ES の組み込みの外のグローバルを使っていないことを、ESLint のパーサの AST で機械検査する。
 *
 * 決定の正本: docs/design/codex-direct-pr/design.md §4.2 と「追記（2026-10-24）: 共有の根」、
 * docs/design/dev-efficiency/plan.md の段1b。pure の根は「鍵・DB・送信に触れない純粋な処理だけ」を置き、
 * 段2 の自動マージ（Codex の PR）はその中だけにする。根の外を読めないことをここで強制する。
 *
 * 許す向き（片方向）:
 *   - src/pure/ の中のファイル        → 行き先は src/pure/ の中の .js だけ
 *   - scripts/lib/pure/ の中のファイル → 行き先は scripts/lib/pure/ か src/pure/ の中の .js だけ
 *   （src/pure → scripts/lib/pure は禁止。画面の束に Node の側の部品が入らないため）
 *
 * 行き先を見る形（どれも同じ判定）:
 *   - import 宣言、export … from・export * from（再 export）、import()、require()
 *   - コメントの中の型の import: JSDoc の import("…")・@import … from "…"・/// <reference …>
 *     （tsc はこれらも解決して根の外のファイル・lib をプログラムに入れる。段4 の型の検査の範囲を閉じるため）
 *   - 文字列でない import()・require() は不合格（行き先を決められない）
 *   - 不合格: ../ で根の外へ出るもの、.js 以外（JSON・.mjs・拡張子なし・?raw 付き等）、npm の部品・node: の部品、
 *     絶対パス・URL、% \ ? # を含むもの（URL として解決され、パスの判定とずれる）、
 *     /// <reference types=…>・<reference lib=…>
 *
 * グローバル:
 *   - eslint.config.js を使わず、自分の設定（overrideConfigFile: true）で ES の組み込み（globals.builtin）だけを
 *     グローバルにし、no-undef を当てる。flat config の globals は上から重ねて合わさり、後のブロックで
 *     browser・node の名前を消せないため（design §4.2 追記の審査 P2）
 *   - 組み込みでも抜け道になるもの（globalThis・eval・Function）と、window・self・process・fetch・
 *     XMLHttpRequest・WebSocket・import.meta は名指しで禁止する（同じ名前を自分で宣言した変数は対象外）
 *   - ファイル内の設定コメント（eslint-disable・global 等）は noInlineConfig で効かせず、あれば失敗にする
 *
 * 根の中に置けるのは .js の通常のファイルだけ（.json・.mjs・.jsx・シンボリックリンク等は失敗）。
 * 外から import される JSON や検査されない拡張子を根の中に置いて、自動マージの範囲を広げさせないため。
 *
 * 毎回、自己テスト（変異）で禁止の形を1つずつ流し、落ちることを確かめる。入力は lintText と仮のパスで
 * メモリの上で作り、ディスクに一時ファイルを書かない（verify:ci は並行で走り、一時ファイルを他の verify に
 * 拾われるため。PR #1819 と同じ流儀）。
 *
 * 限界（静的な検査で塞がないもの）: ({}).constructor.constructor のように組み込みのプロトタイプを辿って
 * Function に届く形、根の中の .js が実在するかどうか（実行時に落ちる）。誤りを誘う意図の無い PR の
 * 取り違え（根の外の import・グローバル）を落とすのが目的。
 *
 * 使い方: node scripts/maintenance/verify-pure-imports.js
 */
import { ESLint } from "eslint";
import globals from "globals";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

/** 根と、その根の中のファイルが読んでよい根。src/pure → scripts/lib/pure は無い（片方向） */
const PURE_ROOTS = {
  "src/pure": ["src/pure"],
  "scripts/lib/pure": ["scripts/lib/pure", "src/pure"],
};

/** 組み込みでも抜け道になるもの・環境の口。名指しで禁止する */
const BANNED_GLOBALS = [
  "globalThis",
  "window",
  "self",
  "process",
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
];

/** リポジトリからの相対パス（区切りは /）。根の中なら根の名前を返す */
function rootOf(rel) {
  return (
    Object.keys(PURE_ROOTS).find((r) => rel === r || rel.startsWith(`${r}/`)) ??
    null
  );
}

const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * 行き先の文字列を判定する。null なら合格、文字列なら不合格の理由。
 * fromRel はリポジトリからの相対パス（根の中のファイル）
 */
function judgeSpecifier(fromRel, spec) {
  const fromRoot = rootOf(fromRel);
  if (!fromRoot) return `根の外のファイルです: ${fromRel}`;
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    return `相対パスでない行き先（npm・node: の部品・絶対パス・URL）: "${spec}"`;
  }
  if (!spec.endsWith(".js")) {
    return `.js でない行き先（JSON・拡張子なし・.mjs・?付き等）: "${spec}"`;
  }
  // ESM の行き先は URL として解決される。%2e%2e は ..、\ は /、? # 以降は問い合わせとして扱われ、
  // パスの文字列の判定とずれる。使える文字を英数字・_・-・.・/ に限って塞ぐ
  if (!/^[A-Za-z0-9_\-./]+$/.test(spec)) {
    return `使えない文字を含む行き先（% \\ ? # 等。URL として解決され、パスの判定とずれる）: "${spec}"`;
  }
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRel), spec),
  );
  const targetRoot = rootOf(target);
  if (!targetRoot || !PURE_ROOTS[fromRoot].includes(targetRoot)) {
    return `${fromRoot}/ から読めない行き先: "${spec}"（→ ${target}。読めるのは ${PURE_ROOTS[fromRoot].map((r) => `${r}/`).join("・")} の .js だけ）`;
  }
  return null;
}

/** 文字列リテラルか、式を含まないテンプレートリテラルなら、その文字列。それ以外は null */
function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}

/**
 * コメントの本文から、tsc が解決する行き先を取り出す。
 * 戻り値: { spec } は判定にかける行き先、{ bad } はそれ自体が不合格のもの
 */
function commentImports(comment) {
  const found = [];
  const text = comment.value;
  for (const m of text.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g))
    found.push({ spec: m[2] });
  for (const m of text.matchAll(/@import\b[\s\S]*?\bfrom\s*(['"])([^'"]*)\1/g))
    found.push({ spec: m[2] });
  // /// <reference …/> は行コメント（本文は "/ <reference …"）
  if (comment.type === "Line" && /^\/\s*<reference\b/.test(text)) {
    const p = text.match(/\bpath\s*=\s*(['"])([^'"]*)\1/);
    if (p) found.push({ spec: p[2] });
    else
      found.push({
        bad: `/// <reference> は path= だけ許す: "//${text.trim()}"`,
      });
  }
  return found;
}

const pureImportsRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      badTarget: "{{reason}}",
      dynamic:
        "{{what}} の行き先が文字列ではありません（行き先を決められないので不合格）",
      banned: "{{name}} は pure の根では使えません",
      importMeta: "import.meta は pure の根では使えません",
    },
  },
  create(context) {
    const fromRel = toRel(context.filename);
    const sourceCode = context.sourceCode;
    const checkSpec = (node, spec) => {
      const reason = judgeSpecifier(fromRel, spec);
      if (reason)
        context.report({ node, messageId: "badTarget", data: { reason } });
    };
    const checkSource = (node) => {
      if (node.source) checkSpec(node.source, node.source.value);
    };
    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression(node) {
        const spec = staticString(node.source);
        if (spec === null)
          context.report({
            node,
            messageId: "dynamic",
            data: { what: "import()" },
          });
        else checkSpec(node.source, spec);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require")
          return;
        const spec = staticString(node.arguments[0]);
        if (spec === null)
          context.report({
            node,
            messageId: "dynamic",
            data: { what: "require()" },
          });
        else checkSpec(node.arguments[0], spec);
      },
      MetaProperty(node) {
        if (node.meta.name === "import" && node.property.name === "meta")
          context.report({ node, messageId: "importMeta" });
      },
      "Program:exit"(program) {
        for (const comment of sourceCode.getAllComments()) {
          for (const f of commentImports(comment)) {
            if (f.bad)
              context.report({
                loc: comment.loc,
                messageId: "badTarget",
                data: { reason: f.bad },
              });
            else {
              const reason = judgeSpecifier(fromRel, f.spec);
              if (reason)
                context.report({
                  loc: comment.loc,
                  messageId: "badTarget",
                  data: { reason: `コメントの型の import: ${reason}` },
                });
            }
          }
        }
        // グローバルに解決された参照（宣言済みの組み込み）と、解決されなかった参照（through）の両方
        const globalScope = sourceCode.getScope(program);
        for (const name of BANNED_GLOBALS) {
          const refs = [
            ...(globalScope.set.get(name)?.references ?? []),
            ...globalScope.through.filter((r) => r.identifier.name === name),
          ];
          for (const ref of refs)
            context.report({
              node: ref.identifier,
              messageId: "banned",
              data: { name },
            });
        }
      },
    };
  },
};

const JS_FILES = ["**/*.{js,jsx,mjs,cjs}"];

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: JS_FILES,
      linterOptions: {
        noInlineConfig: true,
        reportUnusedDisableDirectives: "off",
      },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: { ...globals.builtin },
      },
      plugins: { pure: { rules: { imports: pureImportsRule } } },
      rules: {
        "no-undef": ["error", { typeof: true }],
        "pure/imports": "error",
      },
    },
  ],
});

/** ESLint の結果を不合格の行に直す（違反・設定コメント・構文エラー） */
function problemsOf(results) {
  const problems = [];
  for (const r of results) {
    const file = toRel(r.filePath);
    for (const m of r.messages) {
      const kind = m.ruleId ?? (m.fatal ? "parse" : "inline-config");
      problems.push({
        file,
        line: m.line,
        kind,
        messageId: m.messageId ?? null,
        message: m.message,
      });
    }
  }
  return problems;
}

/** 根の中を lstat で辿る。.js の通常のファイルと、置いてはいけないもの（他の拡張子・リンク等）に分ける */
async function listRoot(rootRel) {
  const js = [];
  const misplaced = [];
  const visit = async (rel) => {
    let names;
    try {
      names = await fs.readdir(path.join(ROOT, rel));
    } catch (e) {
      if (e.code === "ENOENT" && rel === rootRel) return; // 根が無い
      throw new Error(`${rel} を読めません: ${e.message}`);
    }
    for (const name of names.sort()) {
      const child = `${rel}/${name}`;
      const st = await fs.lstat(path.join(ROOT, child));
      if (st.isDirectory()) await visit(child);
      else if (st.isFile() && name.endsWith(".js")) js.push(child);
      else misplaced.push(child);
    }
  };
  await visit(rootRel);
  return { js, misplaced };
}

// ---------------------------------------------------------------------------
// 自己テスト（変異）。禁止の形を1つずつ流し、落ちることを確かめる。ディスクには書かない
// ---------------------------------------------------------------------------

const SRC = "src/pure/selftest/a.js";
const SCR = "scripts/lib/pure/selftest/a.js";

/** want: "ok" か、出るべき不合格の種類（"pure/imports:badTarget" 等、ruleId:messageId） */
const CASES = [
  // 通すもの
  {
    name: "src/pure: 根の中の .js の import・再 export・import()・JSDoc・reference path と ES の組み込み",
    file: SRC,
    code: 'import { b } from "./b.js";\nimport c from "../c.js";\nexport * from "./d/e.js";\nexport { f } from "../f.js";\n/// <reference path="./types.js" />\n/** @type {import("./b.js").T} @import { G } from "../g.js" */\nexport const x = async () => [b, c, await import("./h.js"), await import(`./i.js`), Math.max(1, 2), new Map(), JSON.stringify({}), Intl.NumberFormat, typeof undefined];\nconst fetch = () => 1;\nexport const y = fetch();\n',
    want: "ok",
  },
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
  {
    name: "node: の部品",
    file: SCR,
    code: 'import fs from "node:fs";\nexport { fs };\n',
    want: "pure/imports:badTarget",
  },
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
  // グローバル
  ...BANNED_GLOBALS.map((g) => ({
    name: `グローバル ${g}`,
    file: g === "process" ? SCR : SRC,
    code: `export const a = () => ${g};\n`,
    want: "pure/imports:banned",
  })),
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
  // 設定コメント・構文エラー
  {
    name: "/* global */ は効かず、設定コメントとして落ちる",
    file: SRC,
    code: "/* global document */\nexport const a = 1;\n",
    want: "inline-config",
  },
  {
    name: "eslint-disable は効かず、設定コメントとして落ちる",
    file: SRC,
    code: '// eslint-disable-next-line pure/imports\nimport x from "lodash";\nexport { x };\n',
    want: "inline-config",
  },
  { name: "構文エラー", file: SRC, code: "export const = ;\n", want: "parse" },
];

async function runSelfTest() {
  const failures = [];
  await Promise.all(
    CASES.map(async (c) => {
      const problems = problemsOf(
        await eslint.lintText(c.code, { filePath: path.join(ROOT, c.file) }),
      );
      const kinds = problems.map((p) =>
        p.messageId ? `${p.kind}:${p.messageId}` : p.kind,
      );
      const pass =
        c.want === "ok" ? kinds.length === 0 : kinds.includes(c.want);
      if (!pass)
        failures.push(
          `${c.name}\n   期待: ${c.want}\n   実際: ${JSON.stringify(problems.map((p) => `${p.kind} ${p.message}`))}`,
        );
    }),
  );
  // 置き場の判定（ディスクを使わない純粋な部分）
  const units = [
    ["src/pure/a.js", "./b.js", null],
    ["src/pure/a.js", "../pure/b.js", null],
    ["src/pure/a.js", "../pure2/b.js", "x"],
    ["scripts/lib/pure/a.js", "../../../src/pure/b.js", null],
    ["src/utils/a.js", "./b.js", "x"],
  ];
  for (const [from, spec, want] of units) {
    const got = judgeSpecifier(from, spec);
    if ((got === null) !== (want === null))
      failures.push(
        `judgeSpecifier(${from}, ${spec})\n   期待: ${want === null ? "合格" : "不合格"}\n   実際: ${got ?? "合格"}`,
      );
  }
  return failures;
}

async function main() {
  const started = Date.now();
  const selfFailures = await runSelfTest();
  if (selfFailures.length > 0) {
    for (const f of selfFailures) console.error(`NG 自己テスト: ${f}`);
    console.error(
      "自己テストが失敗したため検査結果を信用できません。本スクリプトを確認してください",
    );
    process.exit(1);
  }

  const lists = await Promise.all(Object.keys(PURE_ROOTS).map(listRoot));
  const js = lists.flatMap((l) => l.js);
  const misplaced = lists.flatMap((l) => l.misplaced);
  const results = js.length > 0 ? await eslint.lintFiles(js) : [];
  const problems = problemsOf(results);

  if (misplaced.length > 0) {
    console.error(
      `NG: pure の根に .js の通常のファイル以外が ${misplaced.length} 件あります（JSON・他の拡張子・リンクは置かない）`,
    );
    for (const m of misplaced) console.error(`   ${m}`);
  }
  if (problems.length > 0) {
    console.error(
      `NG: pure の根の外を使う形・使えないグローバルが ${problems.length} 件あります`,
    );
    for (const p of problems)
      console.error(`   ${p.file}:${p.line} [${p.kind}] ${p.message}`);
    console.error(
      "   pure の根（src/pure・scripts/lib/pure）は根の中の .js と ES の組み込みだけを使う。design §4.2",
    );
  }
  if (misplaced.length > 0 || problems.length > 0) process.exit(1);

  const ms = Date.now() - started;
  if (js.length === 0) {
    console.log(
      `OK: 対象0件（${Object.keys(PURE_ROOTS).join("・")} にファイルが無い）。自己テスト ${CASES.length} 件は合格（${ms}ms）`,
    );
  } else {
    console.log(
      `OK: pure の根の ${js.length} ファイルに、根の外の参照・使えないグローバルは 0 件。自己テスト ${CASES.length} 件は合格（${ms}ms）`,
    );
  }
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`NG: ${e.message}`);
    process.exit(1);
  });
}
