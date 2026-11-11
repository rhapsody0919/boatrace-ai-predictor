/**
 * E2E の「spec → 動いた src のファイル」の表（毎晩の全件で作る。docs/design/ci-minutes-reduction/design.md 12章、ADR-0100）の純粋関数。
 * 取得は e2e/fixtures.js（E2E_COVERAGE=1 のときだけ）、組み立ては scripts/maintenance/e2e-coverage-map.js が行い、ここは変換と判定だけをする。
 *
 * ## 数え方
 * 龍神は React.lazy が main.jsx の1か所だけで、画面はほぼ1つの束になる。V8 の範囲をそのまま src へ戻すと、
 * 束の上の行（モジュールの評価）が全モジュールに当たる。そこで次の2つだけを数える。
 *   - 束の上の関数（最初の範囲が束の頭から終わりまで）は除く
 *   - 数が1以上の関数の、最初の範囲の startOffset だけを src へ戻す（関数の中の分岐の範囲は使わない）
 * CSS は数えない（選別では「共通」として全件に倒すので要らない）。
 */
import path from "node:path";
import { originalPositionFor } from "@jridgewell/trace-mapping";

/** テキストの各行の頭の offset（0 始まり）。V8 の offset も source map の column も UTF-16 の位置 */
export function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** offset → { line (1 始まり), column (0 始まり) }。二分探索 */
export function offsetToPosition(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] };
}

/**
 * source map の source を、リポジトリからの相対（posix）にする。
 * 束の外のもの（node_modules・vite の仮想モジュール・リポジトリの外）は null
 * @param {string | null} source map の sources の値（map ファイルからの相対）
 * @param {string} baseDir map ファイルのあるディレクトリ（リポジトリからの相対、posix）
 */
export function normalizeSource(source, baseDir = "dist/assets") {
  if (!source || source.startsWith("\0")) return null;
  const clean = source.replace(/[?#].*$/, "");
  const resolved = path.posix.normalize(
    path.posix.isAbsolute(clean) ? clean : path.posix.join(baseDir, clean),
  );
  // リポジトリの外（先頭が ..）・絶対パス・node_modules は外す。上の階層の指定を引用符で囲んで書かない
  // （verify-e2e-scope.js が、e2e の閉包の中の相対パスの文字列を import として読むため）
  const parts = resolved.split("/");
  if (
    parts[0] === ".." ||
    path.posix.isAbsolute(resolved) ||
    parts.includes("node_modules")
  ) {
    return null;
  }
  return resolved;
}

let lastText = null;
let lastStarts = null;
function startsFor(text) {
  // 同じ束を test ごとに引くので、直前の束の行頭は使い回す
  if (text !== lastText) {
    lastStarts = lineStartsOf(text);
    lastText = text;
  }
  return lastStarts;
}

/**
 * 1つの束の V8 coverage（page.coverage.stopJSCoverage() の1要素）から、動いた src のファイルを返す
 * @param {{ functions: { ranges: { startOffset: number, endOffset: number, count: number }[] }[] }} entry
 * @param {string} sourceText 束のテキスト（entry.source か dist の中身。offset の基準）
 * @param {import("@jridgewell/trace-mapping").TraceMap} map その束の source map
 * @param {{ baseDir?: string }} [options] baseDir は map ファイルのあるディレクトリ（既定 dist/assets）
 * @returns {Set<string>} リポジトリからの相対のファイル（例 src/App.jsx）
 */
export function coveredSources(entry, sourceText, map, options = {}) {
  const files = new Set();
  const starts = startsFor(sourceText);
  for (const fn of entry.functions) {
    const head = fn.ranges[0];
    if (!head) continue;
    // 束の上の関数（モジュールの評価）は全モジュールに当たるので数えない
    if (head.startOffset === 0 && head.endOffset >= sourceText.length - 1)
      continue;
    // 呼ばれていない関数は数えない
    if (head.count === 0) continue;
    const p = originalPositionFor(
      map,
      offsetToPosition(starts, head.startOffset),
    );
    const file = normalizeSource(p.source, options.baseDir);
    if (file) files.add(file);
  }
  return files;
}

/** jsonl（1行 1 JSON）のテキストの配列 → 行の配列。壊れた行は、どのファイルの何行目かを書いて投げる */
export function parseCoverageRows(texts) {
  const rows = [];
  texts.forEach((text, i) => {
    String(text)
      .split("\n")
      .forEach((line, n) => {
        if (line.trim() === "") return;
        let row;
        try {
          row = JSON.parse(line);
        } catch (error) {
          throw new Error(
            `coverage の jsonl が読めない（${i + 1} 個目のファイルの ${n + 1} 行目）: ${error.message}`,
          );
        }
        if (typeof row.spec !== "string" || !Array.isArray(row.files)) {
          throw new Error(
            `coverage の行の形が違う（${i + 1} 個目のファイルの ${n + 1} 行目）: spec と files が要る`,
          );
        }
        rows.push(row);
      });
  });
  return rows;
}

/** `playwright test --list --reporter=json` の結果 → spec のファイル（testDir からの相対）の一覧 */
export function specsInList(listJson) {
  const files = new Set();
  const walk = (suites) => {
    for (const s of suites ?? []) {
      if (typeof s.file === "string") files.add(s.file);
      for (const sp of s.specs ?? []) {
        if (typeof sp.file === "string") files.add(sp.file);
      }
      walk(s.suites);
    }
  };
  walk(listJson.suites);
  return [...files].sort();
}

/**
 * fixture の page・context を通らず、自分で context を作る spec か。
 * その spec は coverage の行が出ない（またはその一部しか出ない）ので、選別では常に流す
 */
export function createsOwnContext(specText) {
  return /\bbrowser\s*\.\s*(?:newContext|newPage)\s*\(/.test(String(specText));
}

/**
 * 表を組み立てる
 * - specs: spec ごとの、動いた src のファイル（行の和。project・再試行・test をまたいで足す）
 * - always: 選別で常に流す spec。自分で context を作るもの・coverage の行が無いもの・行はあるが1ファイルも出なかったもの
 *   （全 spec は list から。表に載らない spec を「何にも依らない」と読ませないため、欠けは常に流す側へ倒す）
 *
 * @param {{ rows: { spec: string, files: string[] }[], specs: string[], specTexts: Record<string, string>,
 *           generatedAt: string, sha: string }} input
 */
export function buildCoverageMap({ rows, specs, specTexts, generatedAt, sha }) {
  const union = new Map();
  for (const row of rows) {
    const set = union.get(row.spec) ?? new Set();
    for (const f of row.files) set.add(f);
    union.set(row.spec, set);
  }
  const outSpecs = {};
  const always = [];
  for (const spec of [...specs].sort()) {
    const files = union.get(spec);
    if (files && files.size > 0) outSpecs[spec] = [...files].sort();
    if (createsOwnContext(specTexts[spec]) || !files || files.size === 0)
      always.push(spec);
  }
  if (Object.keys(outSpecs).length === 0) {
    throw new Error(
      "動いた src のファイルが1つも取れていない（E2E_SOURCEMAP=1 の build と E2E_COVERAGE=1 の実行が要る）。全 spec が常に流す側になるので表を作らない",
    );
  }
  return { generatedAt, sha, specs: outSpecs, always };
}
