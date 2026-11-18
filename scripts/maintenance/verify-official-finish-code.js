/**
 * verify-official-finish-code.js - 公式の成績コード（race_start_timings.official_finish_code、BOA-553）の取り込みの検証。
 * DBにも取得先にも接続しない（Kファイルのフィクスチャと偽クライアント）。
 *
 *   (a) Kファイルのテキストから、艇ごとの成績コードを表記のまま取る（フィクスチャ 2026-03-15: 144艇、徳山12R 2号艇が S1）
 *   (b) 日次の同期（syncOfficialFinishCodeFromKFile）: 既存の行のうち値が変わるものだけを書く。行の無い艇は挿入しない
 *       （読み手の7箇所が「行がある＝出走した」と見るため）。書く列は race_id・boat_number・official_finish_code・updated_at
 *       だけ。成績コードが全部入っていれば K を取得しない。列が未適用なら何も書かずに column_missing。dry-run は書かない
 *   (c) 過去分（kbGapFill の buildFinishCodeRows）: 既存の行の NULL だけ。日次の同期と同じ値になる（同じ K から）
 *   (d) 変異検証: 行の無い艇を挿入する版・既存の値を上書きする版で、検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-official-finish-code.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DATE, K_TEXT, S1_RACE, show } from "./verifyData/official-finish-code-fixtures.js";
import { evaluateSync } from "./verifyData/official-finish-code-sync.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

function evaluateBackfill(g, kb) {
  const failed = [];
  const day = kb.buildKbDay({ date: DATE, kText: K_TEXT, bText: "" });
  const rows = g.buildFinishCodeRows(
    day,
    // 既存の行の3列（BOA-582 で着欄・着も同じ回に埋めるようになった）。1号艇は3列とも値あり（K の 01 と食い違う値。
    // 既存の値を上書きしないことを、値が変わるかで確かめるため）、2号艇は全部 NULL
    new Map([
      [
        `${S1_RACE}|1`,
        { official_finish_code: "06", finish_mark: "6", finish_rank: 6 },
      ],
      [
        `${S1_RACE}|2`,
        { official_finish_code: null, finish_mark: null, finish_rank: null },
      ],
    ]),
  );
  // 2号艇は失格（S1）なので、着欄・着は K から決まらず NULL のまま
  if (
    show(rows) !==
    show([
      {
        race_id: S1_RACE,
        boat_number: 2,
        official_finish_code: "S1",
        finish_mark: null,
        finish_rank: null,
      },
    ])
  )
    failed.push(
      `(c) 既存の行の NULL だけ（行の無い艇・値のある行は作らない） ${show(rows)}`,
    );
  return failed;
}

const off = await import("../lib/officialFinishCode.js");
const scrape = await import("../daily/scrape-results.js");
const g = await import("../lib/kbGapFill.js");
const kb = await import("../lib/kbFileParser.js");

{
  const rows = off.buildOfficialFinishCodeRows(K_TEXT, DATE);
  const codes = {};
  for (const r of rows)
    codes[r.official_finish_code] = (codes[r.official_finish_code] ?? 0) + 1;
  check(
    "(a) フィクスチャ 2026-03-15: 144艇、徳山12R 2号艇は S1（表記のまま）",
    rows.length === 144 &&
      codes.S1 === 1 &&
      rows.find((r) => r.race_id === S1_RACE && r.boat_number === 2)
        ?.official_finish_code === "S1",
    show(codes),
  );
  // 日次（テキスト）と過去分（kb-day）が同じ値を返す
  const day = kb.buildKbDay({ date: DATE, kText: K_TEXT, bText: "" });
  const all = new Map(
    rows.map((r) => [
      `${r.race_id}|${r.boat_number}`,
      { official_finish_code: null, finish_mark: null, finish_rank: null },
    ]),
  );
  const back = g.buildFinishCodeRows(day, all);
  check(
    "(c) 過去分の経路（kb-day）と日次の経路（テキスト）は、144艇とも同じ値",
    back.length === 144 &&
      back.every(
        (b) =>
          rows.find(
            (r) => r.race_id === b.race_id && r.boat_number === b.boat_number,
          )?.official_finish_code === b.official_finish_code,
      ),
  );
}
const s = await evaluateSync(scrape.syncOfficialFinishCodeFromKFile);
check("(b) 日次の同期", s.length === 0, s.join(" / "));
const b = evaluateBackfill(g, kb);
check("(c) 過去分の組み立て", b.length === 0, b.join(" / "));

// (d) 変異検証
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前はファイル名に Date.now() を使っていたが、
 * 同じミリ秒に2回呼ばれると同じファイル名になり、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する。プロセス間（verify:ci の並列実行）での衝突も避けるため process.pid も含める
 */
let mutantSeq = 0;
async function withMutant(rel, from, to, run) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) return [`置き換え元が見つからない: ${from}`];
  const mutant = file.replace(
    /\.js$/,
    `.__mutant-${process.pid}-${++mutantSeq}.js`,
  );
  fs.writeFileSync(mutant, src.replace(from, to));
  try {
    return await run(await import(pathToFileURL(mutant).href));
  } catch (e) {
    return [`例外: ${e.message}`];
  } finally {
    fs.rmSync(mutant, { force: true });
  }
}
for (const [label, rel, from, to, run] of [
  [
    "日次: 行の無い艇も書く",
    "scripts/daily/scrape-results.js",
    "return current.has(key) && current.get(key) !== r[column];",
    "return current.get(key) !== r[column];",
    (m) => evaluateSync(m.syncOfficialFinishCodeFromKFile),
  ],
  [
    "日次: 1000行で読むのをやめる（ページングしない）",
    "scripts/daily/scrape-results.js",
    "if ((data ?? []).length < 1000) break;",
    "break;",
    (m) => evaluateSync(m.syncOfficialFinishCodeFromKFile),
  ],
  [
    "過去分: 既存の値を上書きする",
    "scripts/lib/kbGapFill.js",
    "official_finish_code: before.official_finish_code ?? code,",
    "official_finish_code: code,",
    (m) => evaluateBackfill(m, kb),
  ],
]) {
  const failed = await withMutant(rel, from, to, run);
  check(
    `(d) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
