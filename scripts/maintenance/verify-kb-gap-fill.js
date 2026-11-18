/**
 * verify-kb-gap-fill.js - K/Bファイルからの欠落の補完（Phase 1 項目3〜6、backfill-kb-gaps.js・kbGapFill.js）の検証。
 * DBにも取得先にも接続しない（合成の kb-day と偽クライアント）。
 *
 *   (a) スタート: 行の無いレースだけ・races にあるレースだけ・進入のある艇だけ。フライングの ST は正の値（本番の全期間がそう）
 *   (b) 展示タイム: 展示タイムが無い艇（行なし・NULL）だけ・既存の値は上書きしない・列は exhibition_time だけ（展示ST を入れない）
 *   (c) 気象・ステージ: NULL の列だけ埋め、既存の値は持ち回る（上書きしない）。変化の無いレースは書かない
 *   (d) 2連率: 登録番号が一致する艇だけ・NULL だけ埋める
 *   (e) 書き込み: すべての行の列の集合がそろう（そろわなければ書かずに例外）。upsert に送る行の列は項目の列（＋updated_at）
 *       だけ。挿入は既存の行に触れない（ignoreDuplicates）。1文200行以下
 *   (f) 変異検証: 上を壊した版で、検証が失敗する
 *   (g) BOA-480: race_status・refund_boats を K から導く規則（返還は F・L0/L1・K0/K1、失格は返還しない、不成立の判定、
 *       未知の表記は異常）と、書き込み（同じ値ごとに update().in()、race_status が NULL の行だけ）
 *   (h) BOA-553/582: 成績コードと、同じ行の着欄・着（K から決まるものだけ。失格 S0〜S2 は書かない）。既存の値は
 *       上書きしない・行の無い艇は作らない・変わらない艇は書かない。書き込みの列は5列＋updated_at
 *
 * 実行: node scripts/maintenance/verify-kb-gap-fill.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { show, same, DATE, R1 } from "./verifyData/kb-gap-fill-fixtures.js";
import { evaluateBuilders } from "./verifyData/kb-gap-fill-builders.js";
import { evaluateRaceStatus, evaluateFinishCode } from "./verifyData/kb-gap-fill-status-finish.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function evaluateWrite(cli) {
  const failed = [];
  const calls = [];
  const client = {
    from: (table) => ({
      upsert: async (rows, opts) => {
        calls.push({ table, rows, opts });
        return { error: null };
      },
    }),
  };
  const rows = Array.from({ length: 450 }, (_, i) => ({
    race_id: `${DATE}-01-${String((i % 12) + 1).padStart(2, "0")}`,
    boat_number: (i % 6) + 1,
    start_timing: 0.15,
    is_flying: false,
    is_late_start: false,
    entry_course: (i % 6) + 1,
  }));
  const written = await cli.writeRows("st", rows, {
    client,
    pause: async () => {},
    now: () => new Date("2026-10-02T00:00:00Z"),
  });
  if (!(
    written === 450 &&
    same(
      calls.map((c) => c.rows.length),
      [200, 200, 50],
    )
  ))
    failed.push(`(e) 200行ずつ書く ${show(calls.map((c) => c.rows.length))}`);
  if (
    !calls.every(
      (c) =>
        c.table === "race_start_timings" &&
        c.opts.ignoreDuplicates === true &&
        c.opts.onConflict === "race_id,boat_number" &&
        c.rows.every(
          (r) =>
            Object.keys(r).sort().join() ===
            "boat_number,entry_course,is_flying,is_late_start,race_id,start_timing,updated_at",
        ),
    )
  )
    failed.push(
      "(e) 挿入は ignoreDuplicates・送る列は項目の列＋updated_at だけ",
    );
  const before = calls.length;
  let threw = false;
  try {
    await cli.writeRows(
      "exhibition",
      [...rows.slice(0, 2), { race_id: R1, boat_number: 3 }],
      {
        client,
        pause: async () => {},
      },
    );
  } catch {
    threw = true;
  }
  if (!(threw && calls.length === before))
    failed.push("(e) 列がそろわない行があれば、1行も書かずに例外");
  const condCalls = [];
  await cli.writeRows(
    "conditions",
    [
      {
        race_id: R1,
        weather: "晴",
        wind_speed: 1,
        wave_height: 1,
        race_stage: "予選",
      },
    ],
    {
      client: {
        from: (table) => ({
          upsert: async (r, o) => (
            condCalls.push({ table, r, o }),
            { error: null }
          ),
        }),
      },
      pause: async () => {},
    },
  );
  if (!(
    condCalls[0]?.o.ignoreDuplicates === false &&
    condCalls[0]?.o.onConflict === "race_id" &&
    !("updated_at" in condCalls[0].r[0])
  ))
    failed.push(
      "(e) 更新（race_conditions）は ignoreDuplicates=false・updated_at を付けない（列が無い）",
    );
  return failed;
}

const g = await import("../lib/kbGapFill.js");
const cli = await import("./backfill-kb-gaps.js");
const b = evaluateBuilders(g);
check("(a)〜(d) 行の組み立て", b.length === 0, b.join(" / "));
const w = await evaluateWrite(cli);
check("(e) 書き込み", w.length === 0, w.join(" / "));

// (f) 変異検証（同じディレクトリに置き換えた版を書いて import する）
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
const LIB = "scripts/lib/kbGapFill.js";
const MUTANTS = [
  [
    "既存の展示タイムを上書きする",
    LIB,
    "if ((timeByKey.get(`${raceId}|${r.boat_number}`) ?? null) !== null)",
    "if (false)",
  ],
  [
    "フライングの ST を負の値のまま書く",
    LIB,
    "Math.abs(r.start_timing)",
    "r.start_timing",
  ],
  [
    "行のあるレースにも挿入する",
    LIB,
    "if (!raceIds.has(raceId) || withRows.has(raceId)) continue;\n    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number) || !Number.isInteger(r.course))",
    "if (!raceIds.has(raceId)) continue;\n    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number) || !Number.isInteger(r.course))",
  ],
  [
    "既存の気象を上書きする",
    LIB,
    "next[col] = before ?? value;",
    "next[col] = value ?? before;",
  ],
  [
    "登録番号を確かめない",
    LIB,
    "if (!cur || cur.racer_id !== e.racer_id) continue;",
    "if (!cur) continue;",
  ],
  ["列の集合を検査しない", LIB, "if (got !== want) {", "if (false) {"],
];
for (const [label, rel, from, to] of MUTANTS) {
  const failed = await withMutant(rel, from, to, async (m) => {
    const out = evaluateBuilders(m);
    return out;
  });
  check(
    `(f) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
{
  const failed = await withMutant(
    "scripts/maintenance/backfill-kb-gaps.js",
    'ignoreDuplicates: def.mode === "insert",',
    "ignoreDuplicates: false,",
    (m) => evaluateWrite(m),
  );
  check(
    `(f) 変異検証: 挿入で既存の行を上書きする → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}

async function evaluateGroupWrite(cli) {
  const failed = [];
  const calls = [];
  const client = {
    from: (table) => {
      const call = { table, filters: [] };
      const q = {
        update: (values) => ((call.values = values), q),
        in: (col, ids) => (
          (call.ids = ids),
          call.filters.push(["in", col, ids.length]),
          q
        ),
        is: (col, v) => (call.filters.push(["is", col, v]), q),
        // 既に値の入った行（ここでは "N0"）は、DB の条件で外れて返らない
        select: () => (
          calls.push(call),
          Promise.resolve({
            data: call.ids
              .filter((id) => id !== "N0")
              .map((id) => ({ race_id: id })),
            error: null,
          })
        ),
      };
      return q;
    },
  };
  const rows = [
    ...Array.from({ length: 450 }, (_, i) => ({
      race_id: `N${i}`,
      race_status: "normal",
      refund_boats: [],
    })),
    { race_id: "P1", race_status: "partial_refund", refund_boats: [2] },
  ];
  const written = await cli.writeRows("race_status", rows, {
    client,
    pause: async () => {},
  });
  if (written !== 450)
    failed.push(
      `(g) 書いた件数は実際に更新した行（既に値のある N0 を除く450） ${written}`,
    );
  if (show(calls.map((c) => c.filters[0][2])) !== show([200, 200, 50, 1]))
    failed.push(
      `(g) 同じ値ごとに200件ずつ ${show(calls.map((c) => c.filters))}`,
    );
  if (
    !calls.every(
      (c) =>
        c.table === "race_results" &&
        show(c.filters[1]) === show(["is", "race_status", null]),
    )
  )
    failed.push(
      "(g) race_status が NULL の行だけを更新する（既存の値を上書きしない）",
    );
  if (
    show(calls[3]?.values) !==
    show({ race_status: "partial_refund", refund_boats: [2] })
  )
    failed.push(
      `(g) 更新する値は race_status・refund_boats だけ ${show(calls[3]?.values)}`,
    );
  return failed;
}

{
  const rs = evaluateRaceStatus(g);
  check("(g) race_status の導出（BOA-480）", rs.length === 0, rs.join(" / "));
  const gw = await evaluateGroupWrite(cli);
  check(
    "(g) race_status の書き込み（同じ値ごと・NULL の行だけ）",
    gw.length === 0,
    gw.join(" / "),
  );
  for (const [label, rel, from, to, run] of [
    [
      "失格（S0）も返還に数える",
      "scripts/lib/kbGapFill.js",
      'const REFUND_CODES = new Set(["F", "L0", "L1", "K0", "K1"]);',
      'const REFUND_CODES = new Set(["F", "L0", "L1", "K0", "K1", "S0"]);',
      (m) => evaluateRaceStatus(m),
    ],
    [
      "既存の race_status を上書きする",
      "scripts/lib/kbGapFill.js",
      "if (!statusByRace.has(raceId) || statusByRace.get(raceId) !== null) continue;",
      "if (!statusByRace.has(raceId)) continue;",
      (m) => evaluateRaceStatus(m),
    ],
    [
      "NULL の行に限らず更新する",
      "scripts/maintenance/backfill-kb-gaps.js",
      ".is(def.nullGuardColumn, null);",
      ".is(def.keyColumns[0], null);",
      (m) => evaluateGroupWrite(m),
    ],
  ]) {
    const failed = await withMutant(rel, from, to, run);
    check(
      `(g) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

async function evaluateFinishCodeWrite(m) {
  const calls = [];
  const client = {
    from: (table) => ({
      upsert: async (rows, opts) => (
        calls.push({ table, rows, opts }),
        { error: null }
      ),
    }),
  };
  await m.writeRows(
    "finish_code",
    [
      {
        race_id: R1,
        boat_number: 1,
        official_finish_code: "01",
        finish_mark: "1",
        finish_rank: 1,
      },
    ],
    {
      client,
      pause: async () => {},
      now: () => new Date("2026-10-02T00:00:00Z"),
    },
  );
  const c = calls[0];
  return c &&
    c.table === "race_start_timings" &&
    c.opts.ignoreDuplicates === false &&
    c.opts.onConflict === "race_id,boat_number" &&
    Object.keys(c.rows[0]).sort().join() ===
      "boat_number,finish_mark,finish_rank,official_finish_code,race_id,updated_at"
    ? []
    : [`(h) 書き込みの列・オプション ${show(c)}`];
}

{
  const fc = evaluateFinishCode(g);
  check(
    "(h) 成績コードと着欄・着（BOA-553/582）",
    fc.length === 0,
    fc.join(" / "),
  );
  const fw = await evaluateFinishCodeWrite(cli);
  check("(h) 成績コードと着欄・着の書き込み", fw.length === 0, fw.join(" / "));
  for (const [label, from, to] of [
    ["失格（S1）を転覆と読む", '"00": "_",', '"00": "_",\n    S1: "転",'],
    [
      "既存の着欄を上書きする",
      "finish_mark: derived ? derived.finish_mark : before.finish_mark,",
      "finish_mark: finishMarkFromCode(code)?.finish_mark ?? before.finish_mark,",
    ],
    [
      "既存の成績コードを上書きする",
      "official_finish_code: before.official_finish_code ?? code,",
      "official_finish_code: code,",
    ],
    [
      "行の無い艇も作る",
      "existingByKey.get(`${raceId}|${r.boat_number}`);\n      if (!cur) continue;",
      "existingByKey.get(`${raceId}|${r.boat_number}`) ?? {};",
    ],
  ]) {
    const failed = await withMutant(LIB, from, to, (m) =>
      evaluateFinishCode(m),
    );
    check(
      `(h) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

// ---------------------------------------------------------------------------
// (i) 欠場艇等の行（missing_boats、BOA-327 の前提）: K にあって行の無い艇を、9/21 以降の結果ページの取得と同じ形で作る
// ---------------------------------------------------------------------------
const MB_R1 = `${DATE}-01-01`;
const MB_DAY = {
  date: DATE,
  k: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            rows: [
              {
                boat_number: 1,
                finish_raw: "01",
                course: 1,
                start_timing: 0.12,
              },
              {
                boat_number: 2,
                finish_raw: "K1",
                course: null,
                start_timing: null,
              },
              {
                boat_number: 3,
                finish_raw: "K0",
                course: null,
                start_timing: null,
              },
              {
                boat_number: 4,
                finish_raw: "F",
                course: 4,
                start_timing: -0.02,
                is_flying: true,
              },
              {
                boat_number: 5,
                finish_raw: "L0",
                course: null,
                start_timing: null,
                is_late_start: true,
              },
              {
                boat_number: 6,
                finish_raw: "S1",
                course: 6,
                start_timing: 0.15,
              },
            ],
          },
          // races に無いレース（作らない）
          {
            race_number: 2,
            rows: [{ boat_number: 1, finish_raw: "K0", course: null }],
          },
        ],
      },
    ],
  },
};

function evaluateMissingBoats(gm) {
  const rows = gm.buildMissingBoatRows(MB_DAY, {
    raceIds: new Set([MB_R1]),
    existingKeys: new Set([`${MB_R1}|1`]),
  });
  const row = (b, st, fly, late, course, mark, rank, code) => ({
    race_id: MB_R1,
    boat_number: b,
    start_timing: st,
    is_flying: fly,
    is_late_start: late,
    entry_course: course,
    finish_mark: mark,
    finish_rank: rank,
    official_finish_code: code,
    created_at: null,
  });
  const want = [
    row(2, null, false, false, null, "欠", null, "K1"),
    row(3, null, false, false, null, "欠", null, "K0"),
    row(4, 0.02, true, false, 4, "F", null, "F"),
    row(5, null, false, true, null, "L", null, "L0"),
    row(6, 0.15, false, false, 6, null, null, "S1"),
  ];
  return show(rows) === show(want) &&
    Object.keys(rows[0]).sort().join() ===
      [...gm.GAP_FILL_ITEMS.missing_boats.columns].sort().join()
    ? []
    : [`(i) 行 ${show(rows)}`];
}

{
  const mb = evaluateMissingBoats(g);
  check(
    "(i) 欠場艇等の行: 行の無い艇だけ（既存の1号艇は作らない）、races にあるレースだけ。欠場は「欠」・ST と進入は NULL、F は ST の絶対値、L は is_late_start、失格は着欄 NULL。成績コードは K のまま、created_at は NULL。列は GAP_FILL_ITEMS と同じ",
    mb.length === 0,
    mb.join(" / "),
  );
  for (const [label, from, to] of [
    [
      "既存の行のある艇も作る",
      "if (existingKeys.has(`${raceId}|${r.boat_number}`)) continue;",
      "",
    ],
    [
      "races に無いレースも作る",
      "    if (!raceIds.has(raceId)) continue;\n    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number)) continue;\n      if (existingKeys",
      "    for (const r of race.rows ?? []) {\n      if (!Number.isInteger(r.boat_number)) continue;\n      if (existingKeys",
    ],
    [
      "created_at に取得時刻を入れる",
      "        created_at: null,\n      });\n    }\n  }\n  return rows;\n}\n\n/**\n * 項目6",
      "        created_at: new Date().toISOString(),\n      });\n    }\n  }\n  return rows;\n}\n\n/**\n * 項目6",
    ],
  ]) {
    const failed = await withMutant(LIB, from, to, (m) =>
      evaluateMissingBoats(m),
    );
    check(
      `(i) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
