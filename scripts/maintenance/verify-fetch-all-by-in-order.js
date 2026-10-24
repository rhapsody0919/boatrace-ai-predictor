/**
 * verify-fetch-all-by-in-order.js - src/services/supabaseDataService.js の fetchAllByIn が、テーブルごとの一意な並び
 * （主キー）でページングしていることの静的検査（BOA-595）。DBには接続しない。
 *
 * ORDER BY の無い .range() のページングは、PostgreSQL が行の順序を保証しないため、ページの境目で行が
 * 重複・欠落しうる（races では BOA-301 で実際に起きた）。新しいテーブルを fetchAllByIn に渡したのに
 * FETCH_ALL_BY_IN_ORDER へ並びを足し忘れると、実行時に例外になる。それを CI の段階で止める。
 *
 * 確認すること:
 *   - fetchAllByIn が FETCH_ALL_BY_IN_ORDER の並びで .order() を付けている
 *   - fetchAllByIn が in() の値を並べてから分けて読む（URL の長さの上限、BOA-1051）。in() の列はテーブルの並びの先頭の列
 *   - fetchAllByIn の呼び出しで渡しているテーブルが、すべて FETCH_ALL_BY_IN_ORDER にある
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = fs.readFileSync(
  path.join(ROOT, "src/services/supabaseDataService.js"),
  "utf8",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const mapMatch =
  /export const FETCH_ALL_BY_IN_ORDER = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(
    source,
  );
const orderedTables = new Set(
  [...(mapMatch?.[1] ?? "").matchAll(/^\s*([a-z_]+):\s*\[/gm)].map((m) => m[1]),
);
check(
  "FETCH_ALL_BY_IN_ORDER が定義されている",
  orderedTables.size > 0,
  "定義が見つからない",
);

const fnMatch = /async function fetchAllByIn\([^)]*\) \{([\s\S]*?)\n\}/.exec(
  source,
);
check(
  "fetchAllByIn が並びの無いテーブルを例外にし、主キーの各列で .order() を付けてから .range() で取る",
  !!fnMatch &&
    /FETCH_ALL_BY_IN_ORDER\[table\]/.test(fnMatch[1]) &&
    /if \(!orderKeys\) \{\s*throw new Error/.test(fnMatch[1]) &&
    /for \(const key of orderKeys\) query = query\.order\(key\);/.test(
      fnMatch[1],
    ) &&
    /return query\.range\(from, to\);/.test(fnMatch[1]),
);
// 分け方・ページの読み切りそのものは verify-racer-entries-paging.js が偽の PostgREST で確かめる
check(
  "fetchAllByIn が in() の値を fetchAllInChunks で FETCH_ALL_BY_IN_CHUNK_SIZE ごとに分けて読む（URL の長さの上限、BOA-1051）",
  !!fnMatch &&
    /return fetchAllInChunks\(\s*values,\s*FETCH_ALL_BY_IN_CHUNK_SIZE,\s*\(chunk, from, to\) =>/.test(
      fnMatch[1],
    ) &&
    /\.in\(column, chunk\)/.test(fnMatch[1]),
);
const chunkSize = Number(
  /const FETCH_ALL_BY_IN_CHUNK_SIZE = (\d+);/.exec(source)?.[1],
);
// 2026-10-25 の本番の実測で、race_id 800件（URL 約15.4KB）は通り、850件で落ちた
check(
  `FETCH_ALL_BY_IN_CHUNK_SIZE（${chunkSize}）が 1〜800`,
  chunkSize >= 1 && chunkSize <= 800,
);

const calledTables = [...source.matchAll(/fetchAllByIn\(\s*"([a-z_]+)"/g)].map(
  (m) => m[1],
);
const missing = [...new Set(calledTables)].filter((t) => !orderedTables.has(t));
check(
  `fetchAllByIn に渡すテーブル（${new Set(calledTables).size}種・${calledTables.length}箇所）が、すべて FETCH_ALL_BY_IN_ORDER にある`,
  calledTables.length > 0 && missing.length === 0,
  `並びが無い: ${missing.join(", ")}`,
);
// in() の列が、そのテーブルの並びの先頭の列であること（分けて読んだ結果をつないでも、全体の並びが分けずに
// 読んだときと同じになる条件）
const firstOrderKey = (table) =>
  new RegExp(`^\\s*${table}:\\s*\\["([a-z_]+)"`, "m").exec(
    mapMatch?.[1] ?? "",
  )?.[1];
const callArgs = [...source.matchAll(/fetchAllByIn\(\s*"([a-z_]+)"/g)].map(
  (m) => {
    const rest = source
      .slice(m.index + m[0].length, m.index + m[0].length + 600)
      .replace(/\/\/[^\n]*/g, "");
    const col = /^\s*,\s*(?:"[^"]*"|`[^`]*`|[A-Za-z_]+)\s*,\s*"([a-z_]+)"/.exec(
      rest,
    )?.[1];
    return { table: m[1], col };
  },
);
const badColumn = callArgs.filter(
  ({ table, col }) => !col || col !== firstOrderKey(table),
);
check(
  `fetchAllByIn の in() の列（${callArgs.length}箇所）が、どれもテーブルの並びの先頭の列`,
  callArgs.length > 0 && badColumn.length === 0,
  badColumn.map((c) => `${c.table}.${c.col ?? "?"}`).join(", "),
);
// 文字列リテラル以外（変数）でテーブルを渡す呼び出しがあると、上の検査をすり抜けるため禁止する
const nonLiteral = [
  ...source.matchAll(/(?<!function )fetchAllByIn\(\s*(?!")([^,\s]+)\s*,/g),
].map((m) => m[1]);
check(
  "fetchAllByIn のテーブルは文字列リテラルで渡す（静的に検査できるように）",
  nonLiteral.length === 0,
  nonLiteral.join(", "),
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
