#!/usr/bin/env node
/**
 * 記事に関わる E2E に @blog の印が付いているかを確かめる（BOA-929）。
 *
 * 記事の中身だけの PR は、PR ゲートの e2e を軽い組（vite build と `--grep @blog` の試験）だけにする
 * （scripts/maintenance/e2e-scope.js）。記事の試験に印を付け忘れると、その試験は記事だけの PR で
 * 黙って走らなくなる。check-e2e-shard-coverage.js と同じく、`playwright test --list --reporter=json` の
 * 一覧を読んで機械で確かめる。
 *
 * 「記事に関わる」の判定: 試験の題（describe を含む）に /blog・ブログがあるか、試験の本体
 * （test( から閉じ括弧まで）に /blog・記事のデータ（blog-posts・blogPosts・blog-charts）・記事の部品の
 * class（blog-preview・blog-chart 等）があるか。広めに取り、当てはまれば印を求める（印が多い分には
 * 軽い組が少し重くなるだけで、見逃しより軽い）。
 *
 * 使い方:
 *   node scripts/maintenance/check-e2e-blog-tags.js [e2e-list.json]
 *
 * 検証: scripts/maintenance/verify-e2e-blog-tags.js
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BLOG_TAG = "@blog";
/** 印の照合。ワークフローの --grep にも同じ式を渡す（部分一致の @blog だと @blogger 等も拾ってずれる） */
export const BLOG_TAG_PATTERN = "(^|\\s)@blog(\\s|$)";
const TITLE_MARKER = /\/blog\b|ブログ/;
const BODY_MARKER =
  /\/blog\b|blog-posts|blogPosts|blog-charts|blogChart|\.blog-|"blog-|'blog-/;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * test( の呼び出しの本体を、行・桁（1始まり、Playwright の一覧の location）から括弧の対応で切り出す（純関数）。
 * 文字列・正規表現の中の括弧も数えるので、閉じなければ endLine（同じファイルの次の試験の行。無ければ末尾）の手前で打ち切る。
 */
export function testBlock(lines, line, column, endLine = lines.length + 1) {
  const text = lines.slice(line - 1, Math.max(line, endLine - 1)).join("\n");
  const start = Math.max(0, column - 1);
  const open = text.indexOf("(", start);
  if (open < 0) return text;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * @blog の印があるか。`--grep` は describe を含む題全体に当たるので、題の中の印も数える
 * （一覧の JSON の tags には describe の題の印が入らない。実測）。
 */
export const hasBlogTag = (spec) =>
  spec.tags.includes(BLOG_TAG) || new RegExp(BLOG_TAG_PATTERN).test(spec.title);

/** 記事に関わる試験か（純関数）。 */
export const isBlogRelated = (title, block) =>
  TITLE_MARKER.test(title) || BODY_MARKER.test(block);

/** 一覧（--list の JSON）から、試験ごとに題・ファイル・位置・印を平らに取り出す（純関数）。 */
export function listSpecs(report) {
  const out = [];
  const walk = (suites, trail) => {
    for (const suite of suites ?? []) {
      const titles = [...trail, suite.title].filter(Boolean);
      for (const spec of suite.specs ?? []) {
        out.push({
          title: [...titles, spec.title].join(" › "),
          file: spec.file ?? suite.file ?? "",
          line: spec.line,
          column: spec.column,
          tags: spec.tags ?? [],
        });
      }
      walk(suite.suites, titles);
    }
  };
  walk(report?.suites, []);
  return out;
}

/** 記事に関わるのに @blog の印が無い試験（純関数）。readLines(file) は spec のソースを行の配列で返す。 */
export function findUntagged(specs, readLines) {
  const linesByFile = new Map();
  for (const s of specs) {
    if (!linesByFile.has(s.file)) linesByFile.set(s.file, new Set());
    linesByFile.get(s.file).add(s.line);
  }
  const nextLine = (s) =>
    Math.min(
      ...[...linesByFile.get(s.file)].filter((l) => l > s.line),
      Infinity,
    );
  return specs.filter((s) => {
    if (hasBlogTag(s)) return false;
    const lines = readLines(s.file);
    const end = Math.min(nextLine(s), lines.length + 1);
    const block = testBlock(lines, s.line, s.column, end);
    return isBlogRelated(s.title, block);
  });
}

function main() {
  const [listFile = "e2e-list.json"] = process.argv.slice(2);
  let specs;
  try {
    specs = listSpecs(JSON.parse(readFileSync(listFile, "utf8")));
  } catch (error) {
    console.error(`NG: ${listFile} を読めません: ${error.message}`);
    process.exit(1);
  }
  if (specs.length === 0) {
    console.error(`NG: ${listFile} に試験が1件もありません`);
    process.exit(1);
  }
  const cache = new Map();
  const readLines = (file) => {
    if (!cache.has(file)) {
      cache.set(
        file,
        readFileSync(path.join(repoRoot, "e2e", file), "utf8").split("\n"),
      );
    }
    return cache.get(file);
  };
  const untagged = findUntagged(specs, readLines);
  const tagged = specs.filter(hasBlogTag).length;
  if (untagged.length > 0) {
    console.error(
      `記事に関わるのに ${BLOG_TAG} の印が無い試験（${untagged.length}件）:`,
    );
    for (const s of untagged.slice(0, 50)) {
      console.error(`  ${s.file}:${s.line} ${s.title}`);
    }
    console.error(
      `NG: 題か describe の題に「 ${BLOG_TAG}」を足してください。記事だけの PR の軽い組（--grep ${BLOG_TAG}）で走らなくなります（BOA-929）`,
    );
    process.exit(1);
  }
  if (tagged === 0) {
    console.error(`NG: ${BLOG_TAG} の印の付いた試験が1件もありません`);
    process.exit(1);
  }
  console.log(`OK: 記事に関わる試験はすべて ${BLOG_TAG}（${tagged}件）`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
