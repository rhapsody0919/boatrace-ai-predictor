#!/usr/bin/env node
/**
 * verify-jsx-japanese.js — 翻訳対象のページに、t() を通らない日本語が新しく直書きされていないかを検査する。
 *
 * ## なぜ機械検査にするか
 *
 * verify-i18n-consistency.js が見るのはロケール（common.json）の中だけで、JSX に直書きした文字は
 * 見ていない。2026-10-01 の本番巡回（en/zh-TW/ko × 25ページ）で、パンくずの aria-label
 * 「パンくずリスト」、分析ツールの注記、「・」での連結などが見つかった（BOA-653〜656）。
 * どれも ja の画面では正しく見えるので、ja だけ見て通してしまう。
 *
 * ## 何を検査するか
 *
 * 翻訳対象ルート（ROOTS）から import を辿れる .jsx だけを見る。barrel（index.js）からは、
 * 実際に import した名前の再エクスポート先だけを辿る（barrel 全体を辿ると ja 専用の部品まで入る）。
 * そのうえで、画面に出る文字だけを拾う。
 *
 * 1. JSX のテキストと、JSX の子として出す文字列式（`{title || "読み込み中"}` 等）
 * 2. 表示用の属性（aria-label / title / placeholder / alt と、名前が Label で終わる props）の文字列
 * 3. `.join("・")` のような、表示文字列を連結する join の引数
 *
 * オブジェクトのキー、t() の引数（翻訳が無いときの既定値）、console・Error のメッセージは見ない。
 * これらは画面に出ないか、出る前に翻訳される。
 *
 * 「日本語」は、かな（U+3040-30FF）か漢字。繁體中文のページ（ZH_FILES）は漢字を使うので、かなだけを見る。
 *
 * ## 意図的なもの
 *
 * 同じ行か直前の行に `i18n-allow: <理由>` のコメントを書くと許可する（JSX の中なら
 * `{/* i18n-allow: ... *\/}`）。範囲なら `i18n-allow-start: <理由>` 〜 `i18n-allow-end`、
 * ファイル全体（ja のときだけ描画する部品）なら `i18n-allow-file: <理由>`。ファイル全体を
 * 許可すると、そのファイルからの import も辿らない。理由が空なら失敗にする。用途は2つ:
 * - ja のときだけ描画する分岐の中（`i18n.language === "ja" &&` 等）
 * - 日本語の用語・会場名を併記する欄（ガイドの .eg-kanji 等）
 *
 * ## 既存の違反（台帳）
 *
 * 導入時点の違反は jsx-japanese-baseline.json に、所属チケット付きで固定する（ratchet）。
 * 台帳に無い違反が増えたら失敗する。直した違反が台帳に残っていても失敗する（消し忘れ防止）。
 * 照合はファイルと文字列で行い、行番号は見ない（周りを編集しても台帳がずれないように）。
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as espree from "espree";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BASELINE_PATH = "scripts/maintenance/jsx-japanese-baseline.json";

// 翻訳対象パス（src/config/languages.js の TRANSLATED_PATHS・LANGUAGE_ONLY_PATHS）の画面と、
// 全ページに出る共通の枠。AppRouter.jsx は ja 専用ページも import するので起点にしない
export const ROOTS = [
  "src/pages/VenueGridPage.jsx",
  "src/pages/VenueRaceListPage.jsx",
  "src/pages/RaceDetailPage.jsx",
  "src/pages/WinningTechniqueAnalysis.jsx",
  "src/pages/EnglishGuide.jsx",
  "src/pages/ZhTwGuide.jsx",
  "src/pages/KoGuide.jsx",
  "src/pages/EnglishVenueGuide.jsx",
  "src/pages/ZhTwVenueGuide.jsx",
  "src/pages/KoVenueGuide.jsx",
  "src/components/Header.jsx",
  "src/components/Footer.jsx",
  "src/components/CookieConsent.jsx",
];

// 繁體中文の本文を直書きしているファイル。漢字は正当なので、かなだけを見る
const ZH_FILES = new Set([
  "src/pages/ZhTwGuide.jsx",
  "src/pages/ZhTwVenueGuide.jsx",
]);

const KANA = /[぀-ヿ]/;
const KANA_OR_KANJI = /[぀-ヿ一-鿿]/;
const DISPLAY_ATTR = /^(aria-label|title|placeholder|alt)$|Label$/;
const ALLOW = /i18n-allow:(.*)/;
const ALLOW_FILE = /i18n-allow-file:(.*)/;
const ALLOW_START = /i18n-allow-start:(.*)/;
const ALLOW_END = /i18n-allow-end/;

const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

function parse(rel) {
  try {
    return espree.parse(read(rel), {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
      loc: true,
      comment: true,
    });
  } catch (error) {
    throw new Error(
      `${rel}:${error.lineNumber ?? "?"} を構文解析できません: ${error.message}`,
      { cause: error },
    );
  }
}

function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.normalize(path.join(path.dirname(from), spec));
  for (const c of [
    base,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.jsx`,
    `${base}/index.js`,
  ]) {
    if (existsSync(path.join(repoRoot, c)) && /\.jsx?$/.test(c)) return c;
  }
  return null;
}

// barrel（他ファイルの再エクスポートだけで成るファイル）の「名前 → 再エクスポート元」
function barrelMap(rel, ast) {
  const map = new Map();
  let starTargets = [];
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.source) {
      const target = resolveImport(rel, node.source.value);
      for (const s of node.specifiers) map.set(s.exported.name, target);
    } else if (node.type === "ExportAllDeclaration") {
      starTargets.push(resolveImport(rel, node.source.value));
    } else if (node.type !== "ImportDeclaration") {
      return null; // 自前の実装を持つ = barrel ではない
    }
  }
  return { map, starTargets: starTargets.filter(Boolean) };
}

/** ROOTS から辿れるファイル。barrel は import した名前の再エクスポート先だけ辿る */
export function reachableFiles() {
  const asts = new Map();
  const getAst = (rel) => {
    if (!asts.has(rel)) asts.set(rel, parse(rel));
    return asts.get(rel);
  };
  const seen = new Set();
  const queue = [...ROOTS];
  const enqueue = (from, spec, names) => {
    const target = resolveImport(from, spec);
    if (!target || target.includes("/locales/")) return;
    const ast = getAst(target);
    const barrel = barrelMap(target, ast);
    if (!barrel || names === null) {
      queue.push(target);
      return;
    }
    for (const name of names) {
      const t = barrel.map.get(name);
      if (t) queue.push(t);
      else barrel.starTargets.forEach((s) => queue.push(s));
    }
  };
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const ast = getAst(rel);
    // ja のときだけ描画する部品は、その先の import も辿らない
    if (fileAllowReason(ast) !== null) continue;
    for (const node of ast.body) {
      if (node.type === "ImportDeclaration") {
        const named = node.specifiers.filter(
          (s) => s.type === "ImportSpecifier",
        );
        const whole = node.specifiers.some((s) => s.type !== "ImportSpecifier");
        enqueue(
          rel,
          node.source.value,
          whole ? null : named.map((s) => s.imported.name),
        );
      } else if (
        (node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        node.source
      ) {
        enqueue(rel, node.source.value, null);
      }
    }
    // React.lazy(() => import("./X")) 等の動的 import
    walk(ast, (n) => {
      if (n.type === "ImportExpression" && n.source.type === "Literal")
        enqueue(rel, n.source.value, null);
    });
  }
  return [...seen].filter((f) => f.endsWith(".jsx")).sort();
}

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "parent") continue;
    const v = node[key];
    if (Array.isArray(v))
      v.forEach((c) => c && typeof c.type === "string" && walk(c, visit, node));
    else if (v && typeof v.type === "string") walk(v, visit, node);
  }
}

// `i18n-allow-file: <理由>` の理由（コメントが無ければ null）
function fileAllowReason(ast) {
  const c = ast.comments.find((c) => ALLOW_FILE.test(c.value));
  return c ? c.value.match(ALLOW_FILE)[1].trim() : null;
}

const stringsOf = (expr) => {
  if (!expr) return [];
  if (expr.type === "Literal" && typeof expr.value === "string")
    return [expr.value];
  if (expr.type === "TemplateLiteral")
    return expr.quasis.map((q) => q.value.cooked);
  if (expr.type === "ConditionalExpression")
    return [...stringsOf(expr.consequent), ...stringsOf(expr.alternate)];
  if (expr.type === "LogicalExpression") return stringsOf(expr.right);
  return [];
};

/** 1ファイルの違反: { file, line, kind, text } と、理由の無い i18n-allow */
export function findInFile(rel) {
  const ast = parse(rel);
  const isJa = ZH_FILES.has(rel)
    ? (s) => KANA.test(s)
    : (s) => KANA_OR_KANJI.test(s);
  const allowLines = new Map();
  const badAllows = [];
  const fileReason = fileAllowReason(ast);
  if (fileReason !== null) {
    if (fileReason === "") badAllows.push({ file: rel, line: 1 });
    return { hits: [], badAllows };
  }
  let blockStart = null;
  for (const c of ast.comments) {
    const start = c.value.match(ALLOW_START);
    if (start) {
      if (start[1].trim() === "")
        badAllows.push({ file: rel, line: c.loc.start.line });
      blockStart = c.loc.start.line;
      continue;
    }
    if (ALLOW_END.test(c.value) && blockStart !== null) {
      for (let l = blockStart; l <= c.loc.end.line; l++)
        allowLines.set(l, true);
      blockStart = null;
      continue;
    }
    const m = c.value.match(ALLOW);
    if (!m) continue;
    if (m[1].trim() === "")
      badAllows.push({ file: rel, line: c.loc.start.line });
    for (let l = c.loc.start.line; l <= c.loc.end.line + 1; l++)
      allowLines.set(l, true);
  }
  // 閉じていない i18n-allow-start は、以降を黙って許可しないよう失敗にする
  if (blockStart !== null) badAllows.push({ file: rel, line: blockStart });
  const hits = [];
  const add = (node, kind, text) => {
    const line = node.loc.start.line;
    if (allowLines.has(line)) return;
    hits.push({
      file: rel,
      line,
      kind,
      text: text.trim().replace(/\s+/g, " ").slice(0, 80),
    });
  };
  walk(ast, (node, parent) => {
    if (node.type === "JSXText" && isJa(node.value))
      add(node, "text", node.value);
    // JSX の子として出す文字列式（`{title || "読み込み中"}` 等）
    if (
      node.type === "JSXExpressionContainer" &&
      (parent?.type === "JSXElement" || parent?.type === "JSXFragment")
    ) {
      for (const v of stringsOf(node.expression))
        if (isJa(v)) add(node, "text", v);
    }
    if (
      node.type === "JSXAttribute" &&
      node.name.type === "JSXIdentifier" &&
      DISPLAY_ATTR.test(node.name.name) &&
      node.value
    ) {
      const vals =
        node.value.type === "Literal"
          ? [node.value.value]
          : stringsOf(node.value.expression);
      for (const v of vals)
        if (typeof v === "string" && isJa(v))
          add(node, `attr:${node.name.name}`, v);
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "join"
    ) {
      for (const v of stringsOf(node.arguments[0]))
        if (KANA.test(v)) add(node, "join", v);
    }
  });
  return { hits, badAllows };
}

const keyOf = (h) => `${h.file}\u0000${h.text}`;

function main() {
  const files = reachableFiles();
  const hits = [];
  const badAllows = [];
  for (const f of files) {
    const r = findInFile(f);
    hits.push(...r.hits);
    badAllows.push(...r.badAllows);
  }

  if (process.argv.includes("--print")) {
    for (const h of hits)
      console.log(`${h.file}:${h.line} [${h.kind}] ${h.text}`);
    console.log(`${hits.length} 件（${files.length} ファイル）`);
    return;
  }

  const baseline = JSON.parse(read(BASELINE_PATH)).entries;
  const remaining = new Map();
  for (const e of baseline) {
    if (!/^BOA-\d+$/.test(e.ticket ?? "")) {
      console.error(
        `NG: 台帳の項目に所属チケット（ticket: "BOA-123"）がありません → ${e.file} ${e.text}`,
      );
      process.exit(1);
    }
    remaining.set(keyOf(e), (remaining.get(keyOf(e)) ?? 0) + 1);
  }
  const fresh = [];
  for (const h of hits) {
    const k = keyOf(h);
    if ((remaining.get(k) ?? 0) > 0) remaining.set(k, remaining.get(k) - 1);
    else fresh.push(h);
  }
  const stale = baseline.filter((e) => {
    const k = keyOf(e);
    if ((remaining.get(k) ?? 0) > 0) {
      remaining.set(k, remaining.get(k) - 1);
      return true;
    }
    return false;
  });

  const failures = [];
  if (fresh.length > 0) {
    failures.push(
      `翻訳対象のページに、t() を通らない日本語が ${fresh.length} 件増えました:\n` +
        fresh
          .map((h) => `      ${h.file}:${h.line} [${h.kind}] ${h.text}`)
          .join("\n") +
        "\n    → 文言は4言語のロケールに足して t() で出す。ja だけで描画する分岐や、日本語の併記が意図なら、" +
        "その行か直前の行に `i18n-allow: <理由>` のコメントを書く",
    );
  }
  if (stale.length > 0) {
    failures.push(
      `直した違反が台帳（${BASELINE_PATH}）に残っています。消してください:\n` +
        stale.map((e) => `      ${e.ticket} ${e.file} ${e.text}`).join("\n"),
    );
  }
  if (badAllows.length > 0) {
    failures.push(
      "理由の無い i18n-allow があります:\n" +
        badAllows.map((b) => `      ${b.file}:${b.line}`).join("\n"),
    );
  }
  if (failures.length > 0) {
    console.error("NG: JSX の日本語の直書き");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `OK: 翻訳対象のページに新しい日本語の直書きは無い（${files.length} ファイル、台帳の既存分 ${baseline.length} 件）`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
