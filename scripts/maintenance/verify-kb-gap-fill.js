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
 *
 * 実行: node scripts/maintenance/verify-kb-gap-fill.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);

const DATE = "2026-02-10";
const R1 = `${DATE}-01-01`;
const R2 = `${DATE}-01-02`;
const R3 = `${DATE}-01-03`;
const kRow = (boat, extra = {}) => ({
  boat_number: boat,
  racer_id: 4000 + boat,
  course: boat,
  start_timing: 0.15,
  is_flying: false,
  is_late_start: false,
  exhibition_time: 6.7,
  ...extra,
});
const DAY = {
  date: DATE,
  k: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            weather: "晴",
            wind_direction: "南西",
            wind_speed: 3,
            wave_height: 2,
            stage: "予選",
            stage_raw: "予選　　　　  進入固定",
            rows: [
              kRow(1),
              kRow(2, { start_timing: -0.03, is_flying: true }), // パーサーは F を負の値で返す
              kRow(3, {
                course: null,
                start_timing: null,
                exhibition_time: null,
              }), // 欠場
            ],
          },
          {
            race_number: 2,
            weather: "雨",
            wind_direction: "北",
            wind_speed: 5,
            wave_height: 4,
            stage: "優勝戦",
            stage_raw: "優勝戦",
            rows: [kRow(1)],
          },
          {
            race_number: 3,
            weather: "晴",
            wind_direction: null,
            wind_speed: 0,
            wave_height: 1,
            stage: "一般",
            stage_raw: "一般",
            rows: [kRow(1)],
          },
        ],
      },
    ],
  },
  b: {
    venues: [
      {
        venue_code: 1,
        races: [
          {
            race_number: 1,
            entries: [
              {
                boat_number: 1,
                racer_id: 4001,
                national_2rate: 40.5,
                local_2rate: 38.2,
              },
              {
                boat_number: 2,
                racer_id: 9999,
                national_2rate: 30.0,
                local_2rate: 29.0,
              }, // 登録番号が違う
              {
                boat_number: 3,
                racer_id: 4003,
                national_2rate: 20.0,
                local_2rate: 21.0,
              },
            ],
          },
        ],
      },
    ],
  },
};

function evaluateBuilders(g) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  // (a) R2 は既に行がある、R3 は races に無い
  const st = g.buildStartTimingRows(DAY, {
    raceIds: new Set([R1, R2]),
    withRows: new Set([R2]),
  });
  expect(
    "(a) スタート: R1 の進入のある2艇だけ（欠場艇・行のある R2・races に無い R3 は作らない）",
    same(
      st.map((r) => `${r.race_id}#${r.boat_number}`),
      [`${R1}#1`, `${R1}#2`],
    ),
    show(st),
  );
  const f = st.find((r) => r.boat_number === 2);
  expect(
    "(a) フライングの ST は正の値（0.03）で is_flying=true",
    f?.start_timing === 0.03 && f?.is_flying === true,
    show(f),
  );
  expect(
    "(a) 列は race_id・boat_number・start_timing・is_flying・is_late_start・entry_course だけ",
    st.every(
      (r) =>
        Object.keys(r).sort().join() ===
        "boat_number,entry_course,is_flying,is_late_start,race_id,start_timing",
    ),
  );
  // (b) R1 は行なし、R2 は1号艇に展示タイムあり（上書きしない）、R3 は行があるが展示タイム NULL（展示STだけの行）
  const ex = g.buildExhibitionRows(DAY, {
    raceIds: new Set([R1, R2, R3]),
    timeByKey: new Map([
      [`${R2}|1`, 6.81],
      [`${R3}|1`, null],
    ]),
  });
  expect(
    "(b) 展示タイム: 行の無い R1・NULL の R3 は書き、既存の値のある R2 は書かない。欠場艇は作らない。列は exhibition_time だけ",
    same(
      ex.map((r) => `${r.race_id}#${r.boat_number}`),
      [`${R1}#1`, `${R1}#2`, `${R3}#1`],
    ) &&
      ex.every(
        (r) =>
          Object.keys(r).sort().join() ===
          "boat_number,exhibition_time,race_id",
      ),
    show(ex),
  );
  // (c) R1 は全部 NULL、R2 は天候だけ既存（"曇り"）、R3 は全部埋まっている
  const cond = g.buildConditionsRows(
    DAY,
    new Map([
      [
        R1,
        {
          race_id: R1,
          weather: null,
          wind_direction: null,
          wind_speed: null,
          wave_height: null,
          race_stage: null,
        },
      ],
      [
        R2,
        {
          race_id: R2,
          weather: "曇り",
          wind_direction: null,
          wind_speed: null,
          wave_height: null,
          race_stage: null,
        },
      ],
      [
        R3,
        {
          race_id: R3,
          weather: "晴",
          wind_direction: "東",
          wind_speed: 1,
          wave_height: 1,
          race_stage: "一般",
        },
      ],
    ]),
  );
  const c2 = cond.find((r) => r.race_id === R2);
  expect(
    "(c) 気象: 変化の無い R3 は書かず、R2 の既存の天候（曇り）は上書きしない",
    same(
      cond.map((r) => r.race_id),
      [R1, R2],
    ) &&
      c2?.weather === "曇り" &&
      c2?.wind_speed === 5,
    show(cond),
  );
  const c1 = cond.find((r) => r.race_id === R1);
  expect(
    "(c) ステージは付記（進入固定）を落とした原文。風向は書かない（K と DB で方位の基準が違う）",
    c1?.race_stage === "予選" &&
      !("wind_direction" in (c1 ?? {})) &&
      g.normalizeKStage({ stage_raw: "ドラドキ３" }) === "ドラドキ３" &&
      g.normalizeKStage({ stage_raw: "" }) === null,
    show(c1),
  );
  // (d) 1号艇は NULL、2号艇は登録番号違い、3号艇は全国2連率だけ既存
  const rate = g.buildRate2Rows(
    DAY,
    new Map([
      [`${R1}|1`, { racer_id: 4001, global_2rate: null, local_2rate: null }],
      [`${R1}|2`, { racer_id: 4002, global_2rate: null, local_2rate: null }],
      [`${R1}|3`, { racer_id: 4003, global_2rate: 55.5, local_2rate: null }],
    ]),
  );
  expect(
    "(d) 2連率: 登録番号が一致する艇だけ。既存の値（3号艇の全国 55.5）は上書きしない",
    same(rate, [
      { race_id: R1, boat_number: 1, global_2rate: 40.5, local_2rate: 38.2 },
      { race_id: R1, boat_number: 3, global_2rate: 55.5, local_2rate: 21.0 },
    ]),
    show(rate),
  );
  // assertColumnSet
  let threw = false;
  try {
    g.assertColumnSet(
      [{ race_id: R1, a: 1 }, { race_id: R1 }],
      ["race_id", "a"],
    );
  } catch {
    threw = true;
  }
  expect("(e) 列の集合が違う行があれば例外", threw);
  return failed;
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
async function withMutant(rel, from, to, run) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) return [`置き換え元が見つからない: ${from}`];
  const mutant = file.replace(/\.js$/, `.__mutant${Date.now()}.js`);
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

// ---------------------------------------------------------------------------
// (g) BOA-480: race_status・refund_boats を K から導く（正解3,084件で100%一致した規則）
// ---------------------------------------------------------------------------
const kr = (codes, payouts, extra = []) => ({
  rows: codes.map((c, i) => ({ boat_number: i + 1, finish_raw: c })),
  payouts,
  extra_lines: extra,
});
const PAID = [{ special: null }, { special: null }];
function evaluateRaceStatus(g) {
  const failed = [];
  const expect = (label, got, want) => {
    if (show(got) !== show(want)) failed.push(`${label} ${show(got)}`);
  };
  const d = g.deriveRaceStatusFromK;
  expect("(g) 通常", d(kr(["01", "02", "03", "04", "05", "06"], PAID)), {
    race_status: "normal",
    refund_boats: [],
  });
  expect(
    "(g) F・欠場は返還艇で partial",
    d(kr(["01", "F", "02", "K0", "03", "04"], PAID)),
    { race_status: "partial_refund", refund_boats: [2, 4] },
  );
  expect(
    "(g) 失格（S0/S1/S2）は返還しない",
    d(kr(["01", "S0", "S1", "02", "S2", "03"], PAID)),
    { race_status: "normal", refund_boats: [] },
  );
  expect(
    "(g) 一部の勝式だけ不成立（返還艇なし）は partial",
    d(
      kr(
        ["01", "02", "S0", "S1", "S2", "S0"],
        [{ special: null }, { special: "不成立" }],
      ),
    ),
    { race_status: "partial_refund", refund_boats: [] },
  );
  expect(
    "(g) 全勝式が不成立は no_race",
    d(
      kr(
        ["00", "F", "F", "F", "F", "F"],
        [{ special: "不成立" }, { special: "不成立" }],
      ),
    ),
    { race_status: "no_race", refund_boats: [2, 3, 4, 5, 6] },
  );
  expect(
    "(g) 付記に「レース不成立」は no_race（払戻0件）",
    d(kr(["01", "02", "03", "04", "05", "06"], [], ["レース不成立"])),
    { race_status: "no_race", refund_boats: [] },
  );
  expect(
    "(g) 特払いは不成立に数えない",
    d(kr(["01", "02", "03", "04", "05", "06"], [{ special: "特払い" }])),
    { race_status: "normal", refund_boats: [] },
  );
  expect(
    "(g) 未知の成績コードは異常",
    "anomaly" in d(kr(["01", "Z9", "03", "04", "05", "06"], PAID)),
    true,
  );
  expect(
    "(g) 払戻0件で「レース不成立」も無いのは異常",
    "anomaly" in d(kr(["01", "02", "03", "04", "05", "06"], [])),
    true,
  );

  const day = {
    date: DATE,
    k: {
      venues: [
        {
          venue_code: 1,
          status: "complete",
          races: [
            {
              race_number: 1,
              ...kr(["01", "F", "02", "03", "04", "05"], PAID),
            },
            {
              race_number: 2,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
            {
              race_number: 3,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
          ],
        },
        {
          venue_code: 2,
          status: "pending",
          races: [
            {
              race_number: 1,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
          ],
        },
      ],
    },
  };
  const out = { anomalies: [] };
  const rows = g.buildRaceStatusRows(
    day,
    new Map([
      [R1, null],
      [R2, "normal"], // 既存の値は上書きしない
      [`${DATE}-02-01`, null],
    ]),
    out,
  );
  expect(
    "(g) NULL の行だけ（既存の値・race_results に行の無い R3 は作らない）",
    rows,
    [{ race_id: R1, race_status: "partial_refund", refund_boats: [2] }],
  );
  expect(
    "(g) K の会場が未完（pending）は書かずに異常",
    out.anomalies.map((a) => a.race_id),
    [`${DATE}-02-01`],
  );
  return failed;
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

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
