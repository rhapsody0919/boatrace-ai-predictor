/**
 * verify-kb-gap-fill.js - K/Bファイルからの欠落の補完（Phase 1 項目3〜6、backfill-kb-gaps.js・kbGapFill.js）の検証。
 * DBにも取得先にも接続しない（合成の kb-day と偽クライアント）。
 *
 *   (a) スタート: 行の無いレースだけ・races にあるレースだけ・進入のある艇だけ。フライングの ST は正の値（本番の全期間がそう）
 *   (b) 展示タイム: 行の無いレースだけ・展示タイムのある艇だけ・列は exhibition_time だけ（展示ST を入れない）
 *   (c) 気象・ステージ: NULL の列だけ埋め、既存の値は持ち回る（上書きしない）。変化の無いレースは書かない
 *   (d) 2連率: 登録番号が一致する艇だけ・NULL だけ埋める
 *   (e) 書き込み: すべての行の列の集合がそろう（そろわなければ書かずに例外）。upsert に送る行の列は項目の列（＋updated_at）
 *       だけ。挿入は既存の行に触れない（ignoreDuplicates）。1文200行以下
 *   (f) 変異検証: 上を壊した版で、検証が失敗する
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
            rows: [kRow(1)],
          },
          {
            race_number: 3,
            weather: "晴",
            wind_direction: null,
            wind_speed: 0,
            wave_height: 1,
            stage: "一般",
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
  // (b)
  const ex = g.buildExhibitionRows(DAY, {
    raceIds: new Set([R1, R2, R3]),
    withRows: new Set([R2]),
  });
  expect(
    "(b) 展示タイム: 行の無い R1・R3 の、展示タイムのある艇だけ。列は exhibition_time だけ",
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
    exhibition_time: 6.7,
  }));
  const written = await cli.writeRows("exhibition", rows, {
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
        c.table === "exhibition_data" &&
        c.opts.ignoreDuplicates === true &&
        c.opts.onConflict === "race_id,boat_number" &&
        c.rows.every(
          (r) =>
            Object.keys(r).sort().join() ===
            "boat_number,exhibition_time,race_id,updated_at",
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
        wind_direction: "北",
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

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
