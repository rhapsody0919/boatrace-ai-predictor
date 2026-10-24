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
 *   - ファイル内の設定コメント（eslint-disable・global 等）は noInlineConfig で効かせない（違反は消えずに落ちる）。
 *     コメント自体は落とさない（「global な…」で始まる説明のコメントも ESLint は設定コメントと読むため）
 *
 * 根の中に置けるのは .js の通常のファイルだけ（.json・.mjs・.jsx・シンボリックリンク等は失敗）。
 * 外から import される JSON や検査されない拡張子を根の中に置いて、自動マージの範囲を広げさせないため。
 * 一覧は git ls-files（追跡済み＋未追跡で無視されないもの）から取る。根そのものがリンクでも落ちる。
 *
 * 毎回、自己テスト（変異）で禁止の形を1つずつ流し、落ちることを確かめる。入力は lintText と仮のパスで
 * メモリの上で作り、ディスクに一時ファイルを書かない（verify:ci は並行で走り、一時ファイルを他の verify に
 * 拾われるため。PR #1819 と同じ流儀）。
 *
 * 組み込みの書き換え（JSON.stringify=・Date.prototype.toJSON=・Object.defineProperty(Object.prototype, …)
 * 等）も落とす。読み込んだ job の中の supabase-js 等の動きが変わり、DB に書く値を誤らせるため
 * （no-global-assign・no-extend-native と自前の判定）。
 *
 * 限界（静的な検査で塞がないもの）: ({}).constructor.constructor のように組み込みのプロトタイプを辿って
 * Function に届く形、組み込みを別名に入れてから書き換える形（const P = Array.prototype; P.x = 1）、
 * 実行する機械の時間帯・言語で値が変わる計算（new Date().getHours()・toLocale*。dateUtils を移せなく
 * なるので止めない）、無限ループ、根の中の .js が実在するかどうか（実行時に落ちる）。誤りを誘う意図の
 * 無い PR の取り違え（根の外の import・グローバル・組み込みの書き換え）を落とすのが目的。
 *
 * 使い方: node scripts/maintenance/verify-pure-imports.js
 */
import { ESLint } from "eslint";
import globals from "globals";
import { execFileSync } from "node:child_process";
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
  // 型の import() と @import を tsc が読むのは JSDoc（/** … */）だけ。説明の行コメントは見ない
  if (comment.type === "Block" && text.startsWith("*")) {
    // tsc は各行の先頭の * を飛ばして読む。改行をはさんだ import(\n * "…") も同じに扱う
    const body = text.replace(/^\s*\*/gm, " ");
    const imports = [
      ...body.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g),
    ];
    const atImports = [
      ...body.matchAll(/@import\b[\s\S]*?\bfrom\s*(['"])([^'"]*)\1/g),
    ];
    for (const m of [...imports, ...atImports]) found.push({ spec: m[2] });
    // 行き先を取り出せない import( ・@import は落とす（見落としを合格にしない向き）
    const importCount = (body.match(/\bimport\s*\(/g) ?? []).length;
    const atImportCount = (body.match(/@import\b/g) ?? []).length;
    if (importCount !== imports.length || atImportCount !== atImports.length)
      found.push({
        bad: `JSDoc の import( ・@import の行き先を取り出せません（文字列で1つずつ書く）: "${body.replace(/\s+/g, " ").trim().slice(0, 120)}"`,
      });
  }
  // /// <reference …/> は行コメント（本文は "/ <reference …"）。tsc は名前・属性の大文字小文字を区別しない。
  // 属性は path= の1つだけを許す（types=・lib=・no-default-lib= が並んでいれば、path= があっても不合格）
  if (comment.type === "Line" && /^\/\s*<reference\b/i.test(text)) {
    const attrs = [...text.matchAll(/([\w-]+)\s*=\s*(['"])([^'"]*)\2/g)].map(
      (m) => ({ name: m[1].toLowerCase(), value: m[3] }),
    );
    if (attrs.length === 1 && attrs[0].name === "path") {
      // tsc は path= の素の名前（"types.js"）もそのファイルからの相対で読む
      const p = attrs[0].value;
      found.push({ spec: /^(\.\.?\/|\/)/.test(p) ? p : `./${p}` });
    } else {
      found.push({
        bad: `/// <reference> は path= の1つだけを許す（types=・lib= 等は不可）: "//${text.trim()}"`,
      });
    }
  }
  return found;
}

/** 第1引数の物を書き換える組み込みの関数（Object.defineProperty(Array.prototype, …) 等） */
const MUTATING_CALLS = {
  Object: ["defineProperty", "defineProperties", "assign", "setPrototypeOf"],
  Reflect: ["set", "defineProperty", "deleteProperty", "setPrototypeOf"],
};

const propName = (m) =>
  m.computed ? staticString(m.property) : m.property.name;

/**
 * 組み込みのグローバルの識別子が、書き換えの先の根になっているか。
 * 対象: 組み込み（またはその先の a.b.c）への代入・++/--・delete、
 * Object.defineProperty 等・Reflect.set 等の第1引数。別名に入れてから書き換える形は塞がない（限界）
 */
function mutatesBuiltin(identifier) {
  let top = identifier;
  while (top.parent?.type === "MemberExpression" && top.parent.object === top)
    top = top.parent;
  const p = top.parent;
  if (p?.type === "AssignmentExpression" && p.left === top) return true;
  if (p?.type === "UpdateExpression") return true;
  if (p?.type === "UnaryExpression" && p.operator === "delete") return true;
  if (p?.type === "CallExpression" && p.arguments[0] === top) {
    const c = p.callee;
    if (
      c.type === "MemberExpression" &&
      c.object.type === "Identifier" &&
      MUTATING_CALLS[c.object.name]?.includes(propName(c))
    )
      return true;
  }
  return false;
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
      builtinMutation:
        "組み込みの {{name}} を書き換えています（代入・delete・defineProperty 等）。pure の根では使えません",
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
        const globalScope = sourceCode.getScope(program);
        // 組み込み（JSON・Date・Array.prototype 等）の書き換え。読み込んだ job の中の supabase-js 等の
        // 動きまで変わり、DB に書く値を誤らせるため（system-architect の審査 P2-1）
        for (const variable of globalScope.variables) {
          for (const ref of variable.references) {
            if (mutatesBuiltin(ref.identifier))
              context.report({
                node: ref.identifier,
                messageId: "builtinMutation",
                data: { name: variable.name },
              });
          }
        }
        // グローバルに解決された参照（宣言済みの組み込み）と、解決されなかった参照（through）の両方
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
        "no-global-assign": "error",
        "no-extend-native": "error",
        "pure/imports": "error",
      },
    },
  ],
});

// noInlineConfig のとき、設定コメントごとに ESLint が出す警告。効いていないので不合格にしない
// （「global な…」で始まる説明のコメントも設定コメントと読まれ、落とすと誤検出になる）
const NO_EFFECT_RE = /has no effect because you have 'noInlineConfig'/;

/** ESLint の結果を不合格の行に直す（違反・構文エラー・検査されなかったファイル） */
function problemsOf(results) {
  const problems = [];
  for (const r of results) {
    const file = toRel(r.filePath);
    for (const m of r.messages) {
      if (m.ruleId === null && !m.fatal && NO_EFFECT_RE.test(m.message))
        continue;
      // ruleId の無いもの: 構文エラー（fatal）と、無視の対象等で検査されなかったファイル
      const kind = m.ruleId ?? (m.fatal ? "parse" : "unchecked");
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

/**
 * 根の中のファイルを、git が扱うもの（追跡済み＋未追跡で .gitignore に当たらないもの）から取り、
 * lstat で .js の通常のファイルと、置いてはいけないもの（他の拡張子・シンボリックリンク）に分ける。
 * git に聞くのは、.DS_Store・node_modules 等の無視されるファイルで手元だけ落ちないため。
 * 根そのものがリンクなら git はそれを1つのファイルとして返すので、リンクとして落ちる
 */
async function listPureFiles() {
  let out;
  try {
    out = execFileSync(
      "git",
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...Object.keys(PURE_ROOTS),
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
  } catch (e) {
    throw new Error(`git ls-files で pure の根を一覧できません: ${e.message}`);
  }
  const js = [];
  const misplaced = [];
  for (const rel of [...new Set(out.split("\0").filter(Boolean))].sort()) {
    let st;
    try {
      st = await fs.lstat(path.join(ROOT, rel));
    } catch (e) {
      if (e.code === "ENOENT") continue; // 追跡済みで手元で消したもの
      throw e;
    }
    if (st.isFile() && rel.endsWith(".js")) js.push(rel);
    else misplaced.push(rel);
  }
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

  const { js, misplaced } = await listPureFiles();
  const results = js.length > 0 ? await eslint.lintFiles(js) : [];
  const problems = problemsOf(results);
  // ESLint が黙ってファイルを飛ばしたら、検査されずに 0 件で通る。数をそろえて確かめる
  if (results.length !== js.length)
    problems.push({
      file: "(全体)",
      line: 0,
      kind: "unchecked",
      messageId: null,
      message: `一覧の ${js.length} ファイルのうち ESLint の結果は ${results.length} 件`,
    });

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
