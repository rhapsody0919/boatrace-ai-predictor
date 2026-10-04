/**
 * verify-disqualified-finish-marks.js - 失格（K の S0〜S2）の艇の着欄を結果ページから埋める処理（BOA-582(2)）の検証。
 * DBにも取得先にも接続しない（実ページの fixtures と偽クライアント）。
 *
 *   (a) 行の組み立て: 失格の表記（転・落・沈・妨・エ・失）だけを書く。F・欠・着など失格でない表記や、
 *       着順表に無い艇は書かずに異常とする
 *   (b) 計画: レースごとに1回だけ取得し、間隔を空ける。429・503で即中止（そこまでの計画を返す）。
 *       着順表を読めないページは異常とする
 *   (c) 書き込み: 1行ずつ update（挿入しない）、着欄が NULL の行だけ（既存の値を上書きしない）。書く列は
 *       finish_mark・updated_at だけ。失敗は握りつぶさず例外
 *   (d) 変異検証: 上を壊した版で、検証が失敗する
 *   (e) BOA-667: 公式の行の順（official_row）を同じ取得で写し、NULL の行だけ書く
 *
 * 実行: node scripts/maintenance/verify-disqualified-finish-marks.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/raceresult");
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
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

// 実ページ（fixtures）。着欄: 多摩川9/10 12R=4号艇「落」・5号艇「転」・6号艇「F」、
// 若松9/11 1R=5号艇「落」・6号艇「妨」、芦屋4/3 10R=1号艇「エ」・4号艇「沈」・5号艇「欠」
const PAGES = {
  "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=12&jcd=05&hd=20260910":
    "raceresult-2026-09-10-05-12-fall-capsize-f.html",
  "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=1&jcd=20&hd=20260911":
    "raceresult-2026-09-11-20-01-fall-obstruct.html",
  "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=10&jcd=21&hd=20260403":
    "raceresult-2026-04-03-21-10-engine-sink-absent.html",
  "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=1&jcd=05&hd=20260925":
    "raceresult-unpublished-2026-09-25-05-01.html",
};
const TAMA = "2026-09-10-05-12";
const WAKA = "2026-09-11-20-01";
const ASHI = "2026-04-03-21-10";
const UNPUB = "2026-09-25-05-01";
const t = (raceId, boat, code) => ({
  race_id: raceId,
  boat_number: boat,
  official_finish_code: code,
  finish_mark: null,
});
const TARGETS = [
  t(TAMA, 4, "S1"),
  t(TAMA, 5, "S0"),
  t(WAKA, 5, "S1"),
  t(WAKA, 6, "S2"),
  t(ASHI, 1, "S1"),
  t(ASHI, 4, "S1"),
];

function evaluateRows(lib, parser) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const tama = parser.parseRaceResultPage(
    fixture("raceresult-2026-09-10-05-12-fall-capsize-f.html"),
  ).boats;
  const ok = lib.buildDisqualifiedMarkRows(TAMA, tama, [
    t(TAMA, 4, "S1"),
    t(TAMA, 5, "S0"),
  ]);
  expect(
    "(a) 失格の艇の着欄を書く（多摩川12R: 4号艇=落、5号艇=転）",
    same(ok, {
      rows: [
        { race_id: TAMA, boat_number: 4, finish_mark: "落" },
        { race_id: TAMA, boat_number: 5, finish_mark: "転" },
      ],
      anomalies: [],
    }),
    show(ok),
  );
  // 6号艇は「F」、1号艇は「3」着、7号艇は存在しない: どれも書かない
  const ng = lib.buildDisqualifiedMarkRows(TAMA, tama, [
    t(TAMA, 6, "S1"),
    t(TAMA, 1, "S0"),
    t(TAMA, 7, "S2"),
  ]);
  expect(
    "(a) 失格でない表記（F・着）・着順表に無い艇は書かず、異常に数える",
    ng.rows.length === 0 && ng.anomalies.length === 3,
    show(ng),
  );
  const absent = lib.buildDisqualifiedMarkRows(
    ASHI,
    parser.parseRaceResultPage(
      fixture("raceresult-2026-04-03-21-10-engine-sink-absent.html"),
    ).boats,
    [t(ASHI, 5, "S1")],
  );
  expect(
    "(a) 欠場（欠）は失格と合わないので書かない",
    absent.rows.length === 0 && absent.anomalies.length === 1,
    show(absent),
  );
  expect(
    "(a) 失格コードの判定は S0〜S2 だけ",
    ["S0", "S1", "S2"].every(lib.isDisqualifiedCode) &&
      !["S3", "F", "01", "K1", null].some(lib.isDisqualifiedCode),
  );
  return failed;
}

async function evaluatePlan(cli) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const fetched = [];
  const waits = [];
  const fetchHtml = async (url) => {
    fetched.push(url);
    if (!PAGES[url]) throw new Error(`想定外のURL ${url}`);
    return fixture(PAGES[url]);
  };
  const plan = await cli.buildPlan([...TARGETS, t(UNPUB, 3, "S1")], {
    fetchHtml,
    wait: async (ms) => waits.push(ms),
    log: () => {},
  });
  expect(
    "(b) 計画: 4レースを1回ずつ取得し、2件目から間隔（3秒以上）を空ける",
    fetched.length === 4 &&
      new Set(fetched).size === 4 &&
      waits.length === 3 &&
      waits.every((ms) => ms >= 3000),
    show({ fetched, waits }),
  );
  expect(
    "(b) 計画の行: 落・転・落・妨・エ・沈。未公開のページは異常",
    same(
      plan.rows.map((r) => [r.race_id, r.boat_number, r.finish_mark]),
      [
        [TAMA, 4, "落"],
        [TAMA, 5, "転"],
        [WAKA, 5, "落"],
        [WAKA, 6, "妨"],
        [ASHI, 1, "エ"],
        [ASHI, 4, "沈"],
      ],
    ) &&
      plan.anomalies.length === 1 &&
      plan.anomalies[0].startsWith(UNPUB) &&
      plan.stopped === null,
    show(plan),
  );
  const stopFetched = [];
  const stopped = await cli.buildPlan(TARGETS, {
    fetchHtml: async (url) => {
      stopFetched.push(url);
      if (url.includes("jcd=20")) {
        const e = new Error("429");
        e.status = 429;
        throw e;
      }
      return fixture(PAGES[url]);
    },
    wait: async () => {},
    log: () => {},
  });
  expect(
    "(b) 429で即中止し、そこまでの計画を返す（3件目を取得しない）",
    stopFetched.length === 2 &&
      stopped.rows.length === 2 &&
      stopped.stopped?.includes("429"),
    show({ stopFetched, stopped }),
  );
  return failed;
}

/** update().eq().eq().is().select() の偽クライアント。is(finish_mark, null) を守る行だけ更新する */
function fakeClient(table) {
  const calls = [];
  return {
    calls,
    from: (name) => ({
      update: (values) => {
        const filters = [];
        const q = {
          eq: (col, v) => (filters.push(["eq", col, v]), q),
          is: (col, v) => (filters.push(["is", col, v]), q),
          select: async () => {
            calls.push({ name, values, filters });
            const hit = table.filter((row) =>
              filters.every(([op, col, v]) =>
                op === "eq" ? row[col] === v : row[col] === v,
              ),
            );
            for (const row of hit) Object.assign(row, values);
            return {
              data: hit.map((r) => ({ race_id: r.race_id })),
              error: null,
            };
          },
        };
        return q;
      },
    }),
  };
}

async function evaluateApply(cli) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  // 4号艇は NULL、5号艇は計画の後に値が入った、9号艇は行が無い
  const table = [
    { race_id: TAMA, boat_number: 4, finish_mark: null, start_timing: 0.12 },
    { race_id: TAMA, boat_number: 5, finish_mark: "転", start_timing: 0.15 },
  ];
  const client = fakeClient(table);
  const result = await cli.applyPlan(
    [
      { race_id: TAMA, boat_number: 4, finish_mark: "落" },
      { race_id: TAMA, boat_number: 5, finish_mark: "落" },
      { race_id: TAMA, boat_number: 9, finish_mark: "落" },
    ],
    { client, now: () => new Date("2026-10-03T00:00:00Z") },
  );
  expect(
    "(c) 着欄が NULL の行だけ書く。値の入った行・無い行は書かずに数える。行を作らない",
    same(result, { written: 1, skipped: 2 }) &&
      table.length === 2 &&
      table[0].finish_mark === "落" &&
      table[0].start_timing === 0.12 &&
      table[1].finish_mark === "転",
    show({ result, table }),
  );
  expect(
    "(c) 書く列は finish_mark・updated_at だけ、条件は race_id・boat_number・finish_mark IS NULL",
    client.calls.every(
      (c) =>
        c.name === "race_start_timings" &&
        Object.keys(c.values).sort().join() === "finish_mark,updated_at" &&
        same(
          c.filters.map(([op, col]) => `${op}:${col}`),
          ["eq:race_id", "eq:boat_number", "is:finish_mark"],
        ),
    ),
    show(client.calls),
  );
  let threw = false;
  try {
    await cli.applyPlan(
      [{ race_id: TAMA, boat_number: 4, finish_mark: "落" }],
      {
        client: {
          from: () => ({
            update: () => {
              const q = {
                eq: () => q,
                is: () => q,
                select: async () => ({
                  data: null,
                  error: { message: "boom" },
                }),
              };
              return q;
            },
          }),
        },
      },
    );
  } catch {
    threw = true;
  }
  expect("(c) 書き込みの失敗は例外にする（握りつぶさない）", threw);
  return failed;
}

/**
 * (e) BOA-667: 公式の行の順（official_row）を、取り直した結果ページから既存の行へ写す。
 * 着欄（失格）と同じ1回の取得で、両方の行を計画に入れる。書き込みは official_row が NULL の行だけ
 */
async function evaluateOfficialRow(lib, parser, cli) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  // 多摩川12R の着順表は 2→3→1→4(落)→5(転)→6(F)
  const tama = parser.parseRaceResultPage(
    fixture("raceresult-2026-09-10-05-12-fall-capsize-f.html"),
  ).boats;
  const built = lib.buildOfficialRowRows(TAMA, tama, [
    { boat_number: 1 },
    { boat_number: 6 },
    { boat_number: 7 },
  ]);
  expect(
    "(e) 行の順を着順表の上からの順で書く（1号艇=3、6号艇=6）。着順表に無い艇は異常",
    JSON.stringify(built.rows) ===
      JSON.stringify([
        { race_id: TAMA, boat_number: 1, official_row: 3 },
        { race_id: TAMA, boat_number: 6, official_row: 6 },
      ]) && built.anomalies.length === 1,
    show(built),
  );
  const fetched = [];
  const plan = await cli.buildPlan(
    [
      { ...t(TAMA, 4, "S1"), kind: "mark" },
      ...[1, 2, 3, 4, 5, 6].map((b) => ({
        race_id: TAMA,
        boat_number: b,
        kind: "row",
      })),
    ],
    {
      fetchHtml: async (url) => (fetched.push(url), fixture(PAGES[url])),
      wait: async () => {},
      log: () => {},
    },
  );
  expect(
    "(e) 計画: 1レース1回の取得で、着欄（4号艇=落）と行の順（6艇）の両方を作る",
    fetched.length === 1 &&
      plan.rows.length === 1 &&
      plan.rows[0].finish_mark === "落" &&
      JSON.stringify(
        plan.officialRows.map((r) => [r.boat_number, r.official_row]),
      ) ===
        JSON.stringify([
          [1, 3],
          [2, 1],
          [3, 2],
          [4, 4],
          [5, 5],
          [6, 6],
        ]),
    show(plan),
  );
  const table = [
    { race_id: TAMA, boat_number: 1, finish_mark: "3", official_row: null },
    { race_id: TAMA, boat_number: 2, finish_mark: "1", official_row: 9 },
  ];
  const client = fakeClient(table);
  const result = await cli.applyPlan([], {
    client,
    now: () => new Date("2026-10-04T00:00:00Z"),
    officialRows: [
      { race_id: TAMA, boat_number: 1, official_row: 3 },
      { race_id: TAMA, boat_number: 2, official_row: 1 },
    ],
  });
  expect(
    "(e) 書き込み: official_row が NULL の行だけ（既存の値は上書きしない）。列は official_row・updated_at",
    JSON.stringify(result) === JSON.stringify({ written: 1, skipped: 1 }) &&
      table[0].official_row === 3 &&
      table[1].official_row === 9 &&
      client.calls.every(
        (c) =>
          Object.keys(c.values).sort().join() === "official_row,updated_at" &&
          c.filters.some(([op, col]) => op === "is" && col === "official_row"),
      ),
    show({ result, table }),
  );
  return failed;
}

const lib = await import("../lib/disqualifiedFinishMark.js");
const parser = await import("../lib/raceResultParser.js");
const cli = await import("./backfill-disqualified-finish-marks.js");
const r = evaluateRows(lib, parser);
check("(a) 行の組み立て", r.length === 0, r.join(" / "));
const p = await evaluatePlan(cli);
check("(b) 計画（取得）", p.length === 0, p.join(" / "));
const a = await evaluateApply(cli);
check("(c) 書き込み", a.length === 0, a.join(" / "));
const o = await evaluateOfficialRow(lib, parser, cli);
check("(e) 公式の行の順（BOA-667）", o.length === 0, o.join(" / "));

// (d) 変異検証
let mutantSeq = 0;
async function withMutant(rel, from, to, run) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(from)) {
    throw new Error(`変異の置き換え元が見つかりません（${rel}）: ${from}`);
  }
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
const LIB = "scripts/lib/disqualifiedFinishMark.js";
const CLI = "scripts/maintenance/backfill-disqualified-finish-marks.js";
for (const [label, rel, from, to, run] of [
  [
    "失格でない表記も書く",
    LIB,
    "if (!DISQUALIFIED_MARKS.has(boat.finish_mark)) {",
    "if (false) {",
    (m) => evaluateRows(m, parser),
  ],
  [
    "既存の着欄を上書きする（NULL の条件を外す）",
    CLI,
    '.is(column, null)\n      .select("race_id");',
    '.select("race_id");',
    (m) => evaluateApply(m),
  ],
  [
    "429で中止しない",
    CLI,
    "if (error.status === 429 || error.status === 503) {",
    "if (false) {",
    (m) => evaluatePlan(m),
  ],
  [
    "間隔を空けない",
    CLI,
    "if (index > 0) await wait(intervalMs + Math.floor(Math.random() * 1000));",
    "",
    (m) => evaluatePlan(m),
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
