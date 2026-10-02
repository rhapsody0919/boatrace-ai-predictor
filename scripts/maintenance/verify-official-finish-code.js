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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const K_TEXT = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/kbfile/k260315.txt"),
  "utf8",
);
const DATE = "2026-03-15";
const S1_RACE = "2026-03-15-18-12";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

/** race_start_timings の select（gte・lt・order・range）と upsert だけの偽クライアント。1回の range は最大1000行 */
function fakeClient(rows, { missingColumn = false } = {}) {
  const upserts = [];
  return {
    upserts,
    from: () => {
      const q = {
        select: () => q,
        gte: () => q,
        lt: () => q,
        order: () => q,
        range: async (from, to) =>
          missingColumn
            ? {
                data: null,
                error: {
                  code: "42703",
                  message:
                    "column race_start_timings.official_finish_code does not exist",
                },
              }
            : {
                data: rows
                  .slice(from, Math.min(to + 1, from + 1000))
                  .map((r) => ({ ...r })),
                error: null,
              },
        upsert: async (batch, opts) => {
          upserts.push({ batch, opts });
          return { error: null };
        },
      };
      return q;
    },
  };
}

async function evaluateSync(sync) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const quietLog = console.log;
  console.log = () => {};
  try {
    // S1 のレースは 1・2号艇の行だけある（3〜6号艇は行が無い）。2号艇は NULL、1号艇は既に正しい値
    const client = fakeClient([
      { race_id: S1_RACE, boat_number: 1, official_finish_code: "01" },
      { race_id: S1_RACE, boat_number: 2, official_finish_code: null },
      { race_id: `${DATE}-18-11`, boat_number: 1, official_finish_code: "99" }, // 古い値（K と違う）は直す
    ]);
    let loads = 0;
    const r = await sync(DATE, {
      client,
      loadText: async () => (loads++, K_TEXT),
      now: () => new Date("2026-10-02T00:00:00Z"),
    });
    const written = client.upserts.flatMap((u) => u.batch);
    expect(
      "(b) 値が変わる既存の行だけ（S1 の2号艇と、値の違う 18-11 の1号艇）。行の無い艇・同じ値の行は書かない",
      r.status === "synced" &&
        show(
          written
            .map(
              (w) => `${w.race_id}#${w.boat_number}=${w.official_finish_code}`,
            )
            .sort(),
        ) ===
          show(
            [
              `${DATE}-18-11#1=${written.find((w) => w.race_id === `${DATE}-18-11`)?.official_finish_code}`,
              `${S1_RACE}#2=S1`,
            ].sort(),
          ) &&
        written.length === 2 &&
        written.find((w) => w.race_id === `${DATE}-18-11`)
          ?.official_finish_code !== "99",
      show(written),
    );
    expect(
      "(b) 書く列は race_id・boat_number・official_finish_code・updated_at だけ",
      written.every(
        (w) =>
          Object.keys(w).sort().join() ===
          "boat_number,official_finish_code,race_id,updated_at",
      ) &&
        client.upserts.every(
          (u) => u.opts.onConflict === "race_id,boat_number",
        ),
    );
    // 1日で1000行を超える日（2026-01-02 は192レース）: 1000行目より後ろの行も読んで書く
    const many = Array.from({ length: 1100 }, (_, i) => ({
      race_id: `${DATE}-01-${String(Math.floor(i / 6) + 1).padStart(3, "0")}`,
      boat_number: (i % 6) + 1,
      official_finish_code: "01",
    }));
    many.push({ race_id: S1_RACE, boat_number: 2, official_finish_code: null });
    const big = fakeClient(many);
    const br = await sync(DATE, { client: big, loadText: async () => K_TEXT });
    expect(
      "(b) 1000行を超える日も、1001行目以降の行（S1 の2号艇）を読んで書く",
      br.pending === 1 &&
        big.upserts
          .flatMap((u) => u.batch)
          .some((w) => w.race_id === S1_RACE && w.boat_number === 2),
      show(br),
    );
    // 全部入っていれば K を取得しない
    let loads2 = 0;
    const full = await sync(DATE, {
      client: fakeClient([
        { race_id: S1_RACE, boat_number: 2, official_finish_code: "S1" },
      ]),
      loadText: async () => (loads2++, K_TEXT),
    });
    expect(
      "(b) 成績コードが全部入っていれば K を取得しない",
      full.status === "nothing_pending" && loads2 === 0,
      show(full),
    );
    const missing = fakeClient([], { missingColumn: true });
    const mr = await sync(DATE, {
      client: missing,
      loadText: async () => K_TEXT,
    });
    expect(
      "(b) 列が未適用なら何も書かずに column_missing",
      mr.status === "column_missing" && missing.upserts.length === 0,
      show(mr),
    );
    const dry = fakeClient([
      { race_id: S1_RACE, boat_number: 2, official_finish_code: null },
    ]);
    const dr = await sync(DATE, {
      client: dry,
      dryRun: true,
      loadText: async () => K_TEXT,
    });
    expect(
      "(b) dry-run は書かない",
      dr.updated === 1 && dry.upserts.length === 0,
      show(dr),
    );
    if (loads !== 1) failed.push("(b) K は1回だけ読む");
  } finally {
    console.log = quietLog;
  }
  return failed;
}

function evaluateBackfill(g, kb) {
  const failed = [];
  const day = kb.buildKbDay({ date: DATE, kText: K_TEXT, bText: "" });
  const rows = g.buildFinishCodeRows(
    day,
    new Map([
      [`${S1_RACE}|1`, "01"],
      [`${S1_RACE}|2`, null],
    ]),
  );
  if (
    show(rows) !==
    show([{ race_id: S1_RACE, boat_number: 2, official_finish_code: "S1" }])
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
  const all = new Map(rows.map((r) => [`${r.race_id}|${r.boat_number}`, null]));
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
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
async function withMutant(rel, from, to, run) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) return [`置き換え元が見つからない: ${from}`];
  const mutant = file.replace(/\.js$/, `.__mutant-${++mutantSeq}.js`);
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
    "if (!codeByKey.has(key) || codeByKey.get(key) !== null) continue;",
    "if (!codeByKey.has(key)) continue;",
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
