#!/usr/bin/env node
/**
 * 共通ロジックの索引を、ソースから機械生成する。
 *
 * ## なぜ要るか
 *
 * 2026-08-15以降のfixコミット147件を分類したところ、「既存実装を知らずに再実装した」が
 * 26件あった。うち何件かは、同じ問題を解いた関数が**同一ファイルの別の場所**にあった。
 * `scripts/lib/` は163ファイル・321のexport関数があるのに索引が無く、
 * 「この処理をするヘルパーは既にあるか」を調べる導線が grep しかない。
 * worktree が数十本ある状態では grep 自体も重く、探すより書く方が早くなってしまう。
 *
 * 手で書いた索引は必ず陳腐化するので、ER図（ADR-0065）と同じく**ソースから生成し、
 * 最新かどうかをCIで検査する**方式にする（verify-lib-index.js）。
 *
 * ## 何を載せるか
 *
 * ファイル単位の「パス / 役割 / 主なexport」。関数ごとの詳細は載せない。
 * 全関数を説明付きで並べると4万字を超えて、実装前に読める大きさでなくなるため。
 * 名前で当たりをつけてファイルを開く、という使い方を想定している。
 *
 * 使い方: node scripts/maintenance/generate-lib-index.js [--check]
 *   --check: 書き込まず、既存ファイルと一致するかだけを見る（verify-lib-index.js が使う）
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const OUTPUT_PATH = "docs/reference/shared-logic-index.md";

/** 索引の対象。実装時に「既にあるか」を探す場所だけを載せる。 */
const TARGETS = [
  {
    dir: "scripts/lib",
    title: "scripts/lib — バッチ・取得・集計の共通ロジック",
    note: "日次バッチ・スクレイピング・Vercel Cron から使う。DBに触れるものと純粋な計算が混在する。",
  },
  {
    dir: "src/utils",
    title: "src/utils — 画面の純粋なユーティリティ",
    note: "表示の整形・判定。DBアクセスは持たない。",
  },
  {
    dir: "src/services",
    title: "src/services — 画面のデータ取得",
    note: "Supabaseへのクエリ。クライアントの生成は supabaseClient.js に一本化されている（ADR-0069）。",
  },
];

const SKIP_DIRS = new Set(["node_modules", "__fixtures__", "__tests__"]);

function listFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(path.join(repoRoot, dir));
  } catch {
    return acc;
  }
  for (const entry of entries.sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = path.join(dir, entry);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) listFiles(rel, acc);
    else if (entry.endsWith(".js") || entry.endsWith(".jsx")) acc.push(rel);
  }
  return acc;
}

/**
 * ファイル冒頭のブロックコメントから、モジュールの役割を1行で取る。
 * 先頭が `#!/usr/bin/env node` でも拾えるようにしてある。
 */
export function extractModuleSummary(source) {
  const match = source.match(/^(?:#![^\n]*\n)?\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  for (const raw of match[1].split("\n")) {
    const line = raw.replace(/^\s*\*?\s?/, "").trim();
    if (!line || line.startsWith("@")) continue;
    return line;
  }
  return null;
}

/** そのファイルが公開している名前（関数・定数・クラス）。 */
export function extractExports(source) {
  const names = [];
  const patterns = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+(?:const|let|class)\s+([A-Za-z0-9_$]+)/gm,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** 索引に載せる1行。exportが多い場合は先頭を出して残りは件数で示す。 */
export function formatRow(file, summary, exports, maxExports = 5) {
  const shown = exports.slice(0, maxExports).join(", ");
  const rest = exports.length - maxExports;
  const exportCell =
    exports.length === 0 ? "—" : rest > 0 ? `${shown} ほか${rest}件` : shown;
  // 表のセルを壊さないよう、パイプと改行を落とす。
  // 役割は当たりをつけるための1行なので、長いものは切る（詳細はソースのJSDoc）。
  const clean = (s, limit) => {
    const t = (s ?? "—").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
    return limit && t.length > limit ? `${t.slice(0, limit)}…` : t;
  };
  return `| \`${file}\` | ${clean(summary, 80)} | ${clean(exportCell)} |`;
}

function build() {
  const lines = [
    "# 共通ロジックの索引",
    "",
    "**このファイルは `scripts/maintenance/generate-lib-index.js` が生成する。手で編集しない。**",
    "内容がソースとずれていると `npm run verify:lib-index` がCIで落ちる。",
    "",
    "## 使い方",
    "",
    "新しいヘルパー・ユーティリティを書く前にここを引く。",
    "同じ問題を解く関数が既にある場合が多く、実測では「既存実装を知らずに再実装した」",
    "fixが2026-08-15以降で26件あった（うち何件かは同一ファイル内に既にあった）。",
    "",
    "名前で当たりをつけてファイルを開く、という使い方を想定している。",
    "関数ごとの引数・戻り値はソースのJSDocを見ること。",
    "",
  ];

  let totalFiles = 0;
  let totalExports = 0;

  for (const target of TARGETS) {
    const files = listFiles(target.dir);
    if (files.length === 0) continue;
    lines.push(`## ${target.title}`, "", target.note, "");
    lines.push("| ファイル | 役割 | 主なexport |", "| --- | --- | --- |");
    for (const file of files) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      const summary = extractModuleSummary(source);
      const exports = extractExports(source);
      totalFiles += 1;
      totalExports += exports.length;
      lines.push(formatRow(file, summary, exports));
    }
    lines.push("");
  }

  lines.push("---", "");
  lines.push(`対象 ${totalFiles} ファイル / export ${totalExports} 件。`);
  lines.push("");
  return lines.join("\n");
}

function main() {
  const content = build();
  const outFile = path.join(repoRoot, OUTPUT_PATH);

  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outFile, "utf8");
    } catch {
      console.error(`NG: ${OUTPUT_PATH} がありません。次で生成してください:`);
      console.error("  node scripts/maintenance/generate-lib-index.js");
      process.exit(1);
    }
    if (current !== content) {
      console.error(
        `NG: ${OUTPUT_PATH} がソースと一致しません。次で作り直してください:`,
      );
      console.error("  node scripts/maintenance/generate-lib-index.js");
      process.exit(1);
    }
    console.log(`OK: ${OUTPUT_PATH} はソースと一致している`);
  } else {
    writeFileSync(outFile, content, "utf8");
    console.log(`生成: ${OUTPUT_PATH}`);
  }
}

// 抽出のロジックは verify-lib-index.js から import して検証するため、
// import しただけで索引を書き換えないようガードする。
const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
