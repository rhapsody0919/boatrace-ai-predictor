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
    /await query\.range\(/.test(fnMatch[1]),
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
