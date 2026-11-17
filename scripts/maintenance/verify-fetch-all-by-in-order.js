/**
 * verify-fetch-all-by-in-order.js - src/services/core.js の fetchAllByIn が、テーブルごとの一意な並び
 * （主キー）でページングしていることの検査（BOA-595）。DBには接続しない。
 *
 * ORDER BY の無い .range() のページングは、PostgreSQL が行の順序を保証しないため、ページの境目で行が
 * 重複・欠落しうる（races では BOA-301 で実際に起きた）。新しいテーブルを fetchAllByIn に渡したのに
 * FETCH_ALL_BY_IN_ORDER へ並びを足し忘れると、実行時に例外になる。それを CI の段階で止める。
 *
 * 確認すること（RA42: 本文の正規表現から、偽の PostgREST の上で fetchAllByIn を呼ぶ振る舞いの試験へ置き換えた）:
 *   - 並びの無いテーブルは例外にする。FETCH_ALL_BY_IN_ORDER の全テーブルで、.order() を主キーの各列で付け、.range() で
 *     1000行ずつ読み切る。同じ値の行の並びを問い合わせごとにばらつかせる偽の上で、重複・欠落が無く主キーの昇順になる
 *   - in() の値を並べて重複を除き、分けて読む（URL の長さの上限、BOA-1051）。1回の in() は 1〜800 件、
 *     つないだ結果は分けずに読んだときと同じ。値が無ければ要求を送らない
 *   - 呼び出し箇所の静的検査（本文の字でしか言えず残した。下の末尾）: fetchAllByIn に渡すテーブルが
 *     すべて FETCH_ALL_BY_IN_ORDER にある・in() の列がテーブルの並びの先頭の列・テーブルは文字列リテラル
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFakeSupabase,
  registerFakeServiceSupabase,
  useFakeSupabase as setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// race_id（YYYY-MM-DD-VV-RR）の昇順に N 個。行は主キーの昇順に作る（期待の並び）
const RACE_COUNT = 450; // 300 件ごとに分けて 2 組・6 艇なら 1 組が 1000 行を超える
const raceIds = Array.from({ length: RACE_COUNT }, (_, i) => {
  const day = String(1 + Math.floor(i / 12)).padStart(2, "0");
  return `2026-01-${day}-${String(1 + Math.floor(i / 12)).padStart(2, "0")}-${String(1 + (i % 12)).padStart(2, "0")}`;
});
// 主キーの各列の値（race_id 以外）。順に並べると主キーの昇順
const KEY_VALUES = {
  boat_number: [1, 2, 3, 4, 5, 6],
  kind: ["a", "b", "c"],
};
function rowsInKeyOrder(orderKeys) {
  let rows = raceIds.map((race_id) => ({ race_id }));
  for (const key of orderKeys.slice(1)) {
    const values = KEY_VALUES[key];
    if (!values) throw new Error(`この verify が知らない主キーの列: ${key}`);
    rows = rows.flatMap((row) => values.map((v) => ({ ...row, [key]: v })));
  }
  return rows.map((row, i) => ({ ...row, payload: i }));
}
const shuffled = (rows) =>
  [...rows].sort(
    (a, b) => ((a.payload * 7919) % 1013) - ((b.payload * 7919) % 1013),
  );

// 同じ値の行の並びは問い合わせごとに変え、1回の返す行は 1000 行まで（PostgREST の既定の上限）
const fake = setFakeSupabase(
  createFakeSupabase({}, { scramble: true, maxRows: 1000 }),
);
const { FETCH_ALL_BY_IN_ORDER, fetchAllByIn } =
  await import("../../src/services/core.js");
const orderedTables = Object.keys(FETCH_ALL_BY_IN_ORDER);
check(
  "FETCH_ALL_BY_IN_ORDER が定義されている",
  orderedTables.length > 0,
  "定義が見つからない",
);

// 並びの無いテーブルは、問い合わせの前に例外にする
{
  fake.reset({});
  let message = null;
  try {
    await fetchAllByIn("no_such_table", "race_id", "race_id", ["x"]);
  } catch (err) {
    message = err.message;
  }
  check(
    "fetchAllByIn が並びの無いテーブルを例外にする（問い合わせは送らない）",
    message !== null &&
      message.includes("no_such_table") &&
      fake.calls.length === 0,
    `message=${message} queries=${fake.calls.length}`,
  );
}

for (const table of orderedTables) {
  const orderKeys = FETCH_ALL_BY_IN_ORDER[table];
  const expectedRows = rowsInKeyOrder(orderKeys);
  fake.reset({ [table]: shuffled(expectedRows) });
  // 順を乱し、重複も入れた値（並べて重複を除いて読む）
  const values = [...raceIds].reverse().concat(raceIds.slice(0, 20));
  const rows = await fetchAllByIn(table, "race_id, payload", "race_id", values);

  // 取った行が、主キーの昇順で、重複・欠落が無い（同じ値の行の並びを乱す偽でも）
  check(
    `fetchAllByIn(${table}): 主キー（${orderKeys.join(", ")}）の昇順で重複・欠落なく全 ${expectedRows.length} 行を読み切る`,
    rows.length === expectedRows.length &&
      rows.every((row, i) => row.payload === expectedRows[i].payload),
    `rows=${rows.length}/${expectedRows.length}`,
  );

  const queries = fake.calls;
  check(
    `fetchAllByIn(${table}): どの問い合わせも ${table} を、主キーの各列の順で .order() して .range() で読む`,
    queries.length > 0 &&
      queries.every(
        (q) =>
          q.table === table &&
          q.select === "race_id, payload" &&
          JSON.stringify(q.orders) === JSON.stringify(orderKeys) &&
          q.range !== null,
      ),
    JSON.stringify(queries[0]),
  );

  // ページは 0 始まりで切れ目なく進む（組ごとに [0,999] [1000,1999] …）
  const inQueries = queries.filter((q) => q.filters.length === 1);
  const byChunk = new Map();
  for (const q of queries) {
    const key = JSON.stringify(q.filters[0][2]);
    byChunk.set(key, [...(byChunk.get(key) ?? []), q.range]);
  }
  check(
    `fetchAllByIn(${table}): ページは切れ目なく 1000 行ずつ進む`,
    inQueries.length === queries.length &&
      [...byChunk.values()].every((ranges) =>
        ranges.every(([a, b], i) => a === i * 1000 && b === i * 1000 + 999),
      ),
  );

  // in() は 1 回に 1〜800 件（URL の長さの上限、BOA-1051）。値を並べて重複を除き、分けた順につなぐ
  const chunkSizes = [...byChunk.keys()].map((k) => JSON.parse(k).length);
  check(
    `fetchAllByIn(${table}): in() の値（${new Set(values).size} 件）は並べて重複を除き、1回 1〜800 件に分けて読む（${chunkSizes.join("+")}）`,
    chunkSizes.every((n) => n >= 1 && n <= 800) &&
      chunkSizes.length >= 2 &&
      JSON.stringify([...byChunk.keys()].flatMap((k) => JSON.parse(k))) ===
        JSON.stringify(raceIds) &&
      queries.every((q) => q.filters[0][1] === "race_id"),
  );
}

// 値が無ければ要求を送らず空配列
{
  fake.reset({ races: [{ race_id: "2026-01-01-01-01" }] });
  const rows = await fetchAllByIn("races", "race_id", "race_id", []);
  check(
    "fetchAllByIn: 値が無ければ要求を送らず空配列",
    Array.isArray(rows) && rows.length === 0 && fake.calls.length === 0,
  );
}

// ---- 呼び出し箇所の静的検査（本文の字でしか言えない物。RA42 で振る舞いへ移せず残した）----
// fetchAllByIn を呼ぶ関数は領域ごとの Queries に散っていて、呼び出しの引数（テーブル・in() の列）は
// 実行しないと分からない（全部の入口を偽の上で走らせるには、各関数の入力と表を揃える必要がある）。
// 並びの先頭の列は、分けて読んでつないだ結果が、分けずに読んだときと同じ並びになる条件。
const servicesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/services",
);
const source = readdirSync(servicesDir)
  .filter((n) => /^core\d*\.js$/.test(n) || /^[A-Za-z]+Queries\d*\.js$/.test(n))
  .sort()
  .map((n) => readFileSync(path.join(servicesDir, n), "utf8"))
  .join("\n");

const calledTables = [...source.matchAll(/fetchAllByIn\(\s*"([a-z_]+)"/g)].map(
  (m) => m[1],
);
const missing = [...new Set(calledTables)].filter(
  (t) => !orderedTables.includes(t),
);
check(
  `fetchAllByIn に渡すテーブル（${new Set(calledTables).size}種・${calledTables.length}箇所）が、すべて FETCH_ALL_BY_IN_ORDER にある`,
  calledTables.length > 0 && missing.length === 0,
  `並びが無い: ${missing.join(", ")}`,
);
// in() の列が、そのテーブルの並びの先頭の列であること
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
  ({ table, col }) => !col || col !== FETCH_ALL_BY_IN_ORDER[table]?.[0],
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
