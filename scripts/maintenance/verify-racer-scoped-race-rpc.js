// マイグレーション 203 の RPC 2本の再現テスト。
//   get_racer_scoped_race_rows: 選手の走を1走1行で返す。行を6表の形へ戻す src/pure/racerScopedRunTables.js と、
//     呼び手 getRacerScopedRaceStats（src/services/racerQueries2.js）
//   get_racer_front_taking_counts: 「イン屋」の札の、前付けの走の件数。呼び手 getRaceFrontTakingByRacer（racerQueries6.js）
// PGlite に本番と同じ型の縮約の6表（RLS 有効・匿名に SELECT）を作り、203 を当てて確かめる。
//   - 同じ表から、今までの道（6表の生の行を読む → buildRacerScopedRaceRows）と、新しい道（RPC → 戻す → 同じ整形）の
//     返す行が完全に同じ（不成立・結果なし・rank4〜6 なし・F・出遅れ・欠場・自艇だけ ST の行なし・ST なし・展示なし・
//     展示の同タイム・条件の行なし・同じレースに同じ選手が2艇・窓の外・別の選手、を混ぜた走）
//   - RPC が有れば6表を1行も読まない。要求は選手ごとに1本（1000行までは1ページ）
//   - 1500走の選手を1000行で切らずに取り切る（race_id・boat_number の順の .range()）
//   - 関数が無い（PGRST202・42883）・呼ぶ権限が無いときだけ今までの読みに落ちる。ほかの失敗は例外のまま
//   - 前付けの件数（母数・前付けの走）が、6表の読みの行を summarizeFrontTaking で数えた値と同じ（表示中のレースの前後・
//     窓・不成立・実進入コースなし・1号艇を除く）。RPC が有れば6選手で要求1本・6表を読まない。無ければ今までの読みに落ちる
//   - STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が RLS の下で呼べる、2回当てても失敗しない
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();
installLocalStorage();
const { getRacerScopedRaceStats } =
  await import("../../src/services/racerQueries2.js");
const { getRaceFrontTakingByRacer } =
  await import("../../src/services/racerQueries6.js");
const { summarizeFrontTaking } = await import("../../src/utils/frontTaking.js");
const { clearCache } = await import("../../src/services/core.js");
const { racerHistoryCutoff } =
  await import("../../src/utils/racerVenueBoatStats.js");

const db = new PGlite();
const migration = await readFile(
  new URL(
    "../../docs/db-migration/203_racer_scoped_race_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);
const RPC = "get_racer_scoped_race_rows";
const COUNTS_RPC = "get_racer_front_taking_counts";
const TABLES = [
  "race_entries",
  "races",
  "race_results",
  "race_start_timings",
  "exhibition_data",
  "race_conditions",
];

const RACER = 4001; // いろいろな走を混ぜた選手
const OTHER = 4002; // 同じレースに出る別の選手（混ざらないこと）
const MANY = 4003; // 1500走（ページの境目）
const INYA = 4004; // 4号艇で2コースに入る走が30（札が付く）
const EMPTY = 4999; // 走の無い選手

const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);
const rid = (daysAgo, venue, no) =>
  `${addDays(today, -daysAgo)}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;

// 決まった乱数（同じ種から同じ走。Math.random は使わない）
function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}
const rand = rng(20261119);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const shuffled = (xs) =>
  xs
    .map((x) => [rand(), x])
    .sort((a, b) => a[0] - b[0])
    .map(([, x]) => x);

async function insert(table, row) {
  const cols = Object.keys(row);
  await db.query(
    `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
    cols.map((c) => row[c]),
  );
}

/**
 * 1レース。opts で欠けや印を足す:
 *   boats: この選手（RACER）の艇番の配列（2つなら同じレースに2艇）
 *   result: false＝結果の行なし / { race_status, lowRanks: false＝rank4〜6 が null, noCourses: true, courses: [艇番1..6 の進入] }
 *   st: false＝本番 ST の行なし / { [艇番]: null＝その艇の行なし | 上書きの列 }
 *   ex: false＝展示の行なし / { [艇番]: null＝行なし | タイム（null も可） }
 *   cond: false＝条件の行なし / 上書きの列
 */
async function addRace(raceId, opts = {}) {
  const boats = opts.boats ?? [pick([1, 2, 3, 4, 5, 6])];
  await insert("races", {
    race_id: raceId,
    race_date: raceId.slice(0, 10),
    venue_code: Number(raceId.slice(11, 13)),
    race_number: Number(raceId.slice(14, 16)),
    race_grade:
      "race_grade" in opts ? opts.race_grade : pick(["一般", "G3", "SG", null]),
  });
  for (const boat of boats) {
    await insert("race_entries", {
      race_id: raceId,
      boat_number: boat,
      racer_id: opts.racer ?? RACER,
      grade: "grade" in opts ? opts.grade : pick(["A1", "A2", "B1", "B2"]),
      f_count: "f_count" in opts ? opts.f_count : pick([0, 0, 0, 1, 2, null]),
    });
  }
  // 別の選手が同じレースの別の艇に出る
  const otherBoat = [1, 2, 3, 4, 5, 6].find((b) => !boats.includes(b));
  await insert("race_entries", {
    race_id: raceId,
    boat_number: otherBoat,
    racer_id: OTHER,
    grade: "B1",
    f_count: 0,
  });
  if (opts.result !== false) {
    const order = shuffled([1, 2, 3, 4, 5, 6]);
    const courses = opts.result?.noCourses
      ? [null, null, null, null, null, null]
      : (opts.result?.courses ?? shuffled([1, 2, 3, 4, 5, 6]));
    const low = opts.result?.lowRanks === false;
    await insert("race_results", {
      race_id: raceId,
      rank1: order[0],
      rank2: order[1],
      rank3: order[2],
      rank4: low ? null : order[3],
      rank5: low ? null : order[4],
      rank6: low ? null : order[5],
      race_status:
        opts.result && "race_status" in opts.result
          ? opts.result.race_status
          : pick(["normal", "normal", "partial_refund", null]),
      ...Object.fromEntries(
        courses.map((c, i) => [`actual_course_${i + 1}`, c]),
      ),
      winning_technique: pick(["逃げ", "差し", "まくり", "まくり差し", null]),
      payout_win: pick([120, 350, 1280, null]),
    });
  }
  if (opts.st !== false) {
    for (const boat of [1, 2, 3, 4, 5, 6]) {
      const over = opts.st?.[boat];
      if (over === null) continue;
      await insert("race_start_timings", {
        race_id: raceId,
        boat_number: boat,
        // 0.01 刻みの同タイムが出るよう粗く散らす
        start_timing: pick([0.08, 0.1, 0.12, 0.15, 0.15, 0.2, 0.25]),
        is_flying: pick([false, false, false, false, null]),
        is_late_start: pick([false, false, null]),
        finish_mark: pick([null, null, null, "1", "３", "転", ""]),
        entry_course: pick([boat, boat, null]),
        ...over,
      });
    }
  }
  if (opts.ex !== false) {
    for (const boat of [1, 2, 3, 4, 5, 6]) {
      const over = opts.ex?.[boat];
      if (over === null) continue;
      await insert("exhibition_data", {
        race_id: raceId,
        boat_number: boat,
        exhibition_time: over
          ? over.time
          : pick([6.7, 6.75, 6.78, 6.78, 6.8, 6.85, 6.9]),
      });
    }
  }
  if (opts.cond !== false) {
    await insert("race_conditions", {
      race_id: raceId,
      race_stage: pick(["予選", "準優勝戦", "優勝戦", null]),
      race_title: pick(["第10回龍神杯", "ヴィーナスシリーズ第5戦", null]),
      wave_height: pick([0, 2, 5, 8, null]),
      series_day: pick([1, 2, 3, 6, null]),
      is_final_day: pick([true, false, null]),
      ...opts.cond,
    });
  }
}

// 場面（どれも RACER の走）。番号は説明用
const SCENES = [
  ["ふつう", {}],
  ["不成立", { result: { race_status: "no_race" } }],
  ["返還", { result: { race_status: "partial_refund" } }],
  ["結果の行なし", { result: false }],
  ["rank4〜6 なし", { result: { lowRanks: false } }],
  ["実進入コースなし", { result: { noCourses: true } }],
  [
    "自艇が F",
    { boats: [3], st: { 3: { is_flying: true, start_timing: 0.01 } } },
  ],
  [
    "自艇が出遅れ",
    { boats: [4], st: { 4: { is_late_start: true, start_timing: 1.2 } } },
  ],
  [
    "自艇が欠場",
    { boats: [5], st: { 5: { finish_mark: "欠", start_timing: null } } },
  ],
  ["自艇だけ ST の行なし", { boats: [2], st: { 2: null } }],
  [
    "他の艇が F・ST なし",
    { boats: [1], st: { 2: { is_flying: true }, 3: { start_timing: null } } },
  ],
  [
    "全艇が同じ ST",
    {
      st: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((b) => [
          b,
          { start_timing: 0.15, is_flying: false },
        ]),
      ),
    },
  ],
  ["ST の行なし", { st: false }],
  ["展示の行なし", { ex: false }],
  [
    "展示の同タイムの最速",
    { boats: [1], ex: { 1: { time: 6.7 }, 2: { time: 6.7 } } },
  ],
  ["展示の単独の最速", { boats: [6], ex: { 6: { time: 6.5 } } }],
  ["自艇の展示タイムなし", { boats: [2], ex: { 2: { time: null } } }],
  ["自艇の展示の行なし", { boats: [3], ex: { 3: null } }],
  ["条件の行なし", { cond: false }],
  [
    "条件が全部 null",
    {
      cond: {
        race_stage: null,
        race_title: null,
        wave_height: null,
        series_day: null,
        is_final_day: null,
      },
    },
  ],
  ["同じレースに2艇", { boats: [2, 5] }],
  [
    "級別・F数なし・グレードなし",
    { grade: null, f_count: null, race_grade: null },
  ],
];

/** PostgREST と同じく、DB が作った JSON で行を受け取る（numeric は JSON の数になる） */
async function jsonRows(sql, params = []) {
  const { rows } = await db.query(
    `SELECT coalesce(json_agg(t), '[]'::json) AS r FROM (${sql}) t`,
    params,
  );
  return rows[0].r;
}

let tables;
const callRpc = async ({ p_racer_id, p_since }, role = null) => {
  if (role) await db.exec(`SET ROLE ${role}`);
  try {
    return await jsonRows(`SELECT * FROM public.${RPC}($1, $2)`, [
      p_racer_id,
      p_since,
    ]);
  } finally {
    if (role) await db.exec("RESET ROLE");
  }
};

const callCounts = ({ p_racer_ids, p_since, p_before_race_id }) =>
  jsonRows(`SELECT * FROM public.${COUNTS_RPC}($1::integer[], $2, $3)`, [
    p_racer_ids,
    p_since,
    p_before_race_id,
  ]);

/**
 * 偽の supabase を置く。maxRows は PostgREST の1回の上限。
 * rpc: true＝PGlite の 203 の2本 / false＝関数なし（PGRST202）/ 関数＝走の RPC の差し替え / { 名前: 関数 }＝その RPC だけ
 */
function install({ rpc }) {
  clearCache();
  const rpcs =
    typeof rpc === "function"
      ? { [RPC]: rpc }
      : rpc === true
        ? { [RPC]: callRpc, [COUNTS_RPC]: callCounts }
        : rpc || {};
  return setFakeSupabase(
    createFakeSupabase(tables, { project: true, maxRows: 1000, rpcs }),
  );
}
const quiet = async (fn) => {
  const orig = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = orig;
  }
};
const viaTables = (racerId) =>
  quiet(async () => {
    const fake = install({ rpc: false });
    return { rows: await getRacerScopedRaceStats(racerId), fake };
  });
const viaRpc = (racerId, rpc = true) =>
  quiet(async () => {
    const fake = install({ rpc });
    return { rows: await getRacerScopedRaceStats(racerId), fake };
  });

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  // 型は本番の写し（docs/reference/schema-snapshot.json、2026-10-27）の、この関数が読む列
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR(20) PRIMARY KEY, race_date DATE NOT NULL, venue_code SMALLINT NOT NULL,
      race_number SMALLINT, race_grade VARCHAR(10));
    CREATE TABLE race_entries(race_id VARCHAR(20) NOT NULL REFERENCES races(race_id), boat_number SMALLINT NOT NULL,
      racer_id INTEGER, grade VARCHAR(5), f_count SMALLINT, PRIMARY KEY (race_id, boat_number));
    CREATE INDEX idx_race_entries_racer_id_race_id ON race_entries(racer_id, race_id DESC);
    CREATE TABLE race_results(race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id),
      rank1 SMALLINT NOT NULL, rank2 SMALLINT NOT NULL, rank3 SMALLINT NOT NULL,
      rank4 SMALLINT, rank5 SMALLINT, rank6 SMALLINT, race_status TEXT,
      actual_course_1 SMALLINT, actual_course_2 SMALLINT, actual_course_3 SMALLINT,
      actual_course_4 SMALLINT, actual_course_5 SMALLINT, actual_course_6 SMALLINT,
      winning_technique VARCHAR(20), payout_win INTEGER);
    CREATE TABLE race_start_timings(race_id VARCHAR(20) NOT NULL REFERENCES races(race_id), boat_number SMALLINT NOT NULL,
      start_timing NUMERIC(4,3), is_flying BOOLEAN, is_late_start BOOLEAN, finish_mark TEXT, entry_course SMALLINT,
      PRIMARY KEY (race_id, boat_number));
    CREATE TABLE exhibition_data(race_id VARCHAR(20) NOT NULL REFERENCES races(race_id), boat_number SMALLINT NOT NULL,
      exhibition_time NUMERIC(5,2), PRIMARY KEY (race_id, boat_number));
    CREATE TABLE race_conditions(race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id),
      race_stage VARCHAR(30), race_title VARCHAR(100), wave_height SMALLINT, series_day SMALLINT, is_final_day BOOLEAN);
  `);
  for (const t of TABLES) {
    await db.exec(`
      ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_public_read ON ${t} FOR SELECT TO anon, authenticated USING (true);
      GRANT SELECT ON ${t} TO anon, authenticated, service_role;
    `);
  }
  await db.exec(migration);
  await db.exec(migration); // 2回当てても失敗しない

  // 場面の走（1日1レース、新しい順に並べる）と、ふつうの走を足して約80走
  let day = 2;
  for (const [, opts] of SCENES) await addRace(rid(day++, 4, 3), opts);
  for (let i = 0; i < 60; i++)
    await addRace(
      rid(day + Math.floor(i / 2), pick([1, 12, 24]), (i % 12) + 1),
    );
  // 窓の外（730日より前）の走は読まない
  await addRace(rid(800, 4, 1));
  // 4号艇で2コースに入る選手（30走）
  for (let i = 0; i < 30; i++)
    await addRace(rid(200 + i, 7, 5), {
      racer: INYA,
      boats: [4],
      result: { race_status: "normal", courses: [1, 3, 4, 2, 5, 6] },
    });
  // 1500走の選手（1日12レース×125日。全部そろった走）
  await db.exec(`
    WITH g AS (
      SELECT to_char(current_date - 1 - (i / 12), 'YYYY-MM-DD') || '-20-' || lpad(((i % 12) + 1)::text, 2, '0') AS race_id,
             current_date - 1 - (i / 12) AS race_date, (i % 12) + 1 AS no, i
      FROM generate_series(0, 1499) AS i
    ), r AS (
      INSERT INTO races SELECT race_id, race_date, 20, no, '一般' FROM g RETURNING race_id
    ), e AS (
      INSERT INTO race_entries SELECT race_id, (i % 6) + 1, ${MANY}, 'A1', 0 FROM g
    ), rr AS (
      INSERT INTO race_results SELECT race_id, (i % 6) + 1, ((i + 1) % 6) + 1, ((i + 2) % 6) + 1,
        ((i + 3) % 6) + 1, ((i + 4) % 6) + 1, ((i + 5) % 6) + 1, 'normal', 1, 2, 3, 4, 5, 6, '逃げ', 150 FROM g
    ), s AS (
      INSERT INTO race_start_timings SELECT race_id, b, (0.10 + ((i + b) % 9) / 100.0)::numeric(4,3), false, false, NULL, b
        FROM g, generate_series(1, 6) AS b
    ), x AS (
      INSERT INTO exhibition_data SELECT race_id, b, (6.70 + ((i * b) % 11) / 100.0)::numeric(5,2) FROM g, generate_series(1, 6) AS b
    )
    INSERT INTO race_conditions SELECT race_id, '予選', '第1回ページ杯', (i % 7), (i % 6) + 1, (i % 6) = 5 FROM g;
  `);
  tables = Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => [t, await jsonRows(`SELECT * FROM ${t}`)]),
    ),
  );
});

test("同じ表から、6表の読みと RPC の道の返す行が完全に同じ（場面を混ぜた選手）", async () => {
  const old = await viaTables(RACER);
  const neo = await viaRpc(RACER);
  assert.deepEqual(neo.rows, old.rows);
  // 比べた行が空・一様でないこと（場面が実際に行に出ている）
  const rows = old.rows;
  assert.ok(rows.length >= 70, `行が少ない: ${rows.length}`);
  const has = (label, f) =>
    assert.ok(rows.some(f), `場面が行に出ていない: ${label}`);
  has("F", (r) => r.isFlying === true && r.flyingStartTiming === 0.01);
  has("出遅れ", (r) => r.lateStartTiming === 1.2 && r.startTiming === null);
  has("欠場（欠）", (r) => r.absent === true && r.boatNumber === 5);
  has(
    "自艇だけ ST の行なしの欠場",
    (r) => r.absent === true && r.boatNumber === 2,
  );
  has("ST の順位", (r) => r.stRank !== null && r.stRank > 1);
  has("内側の最速", (r) => r.innerMinSt !== null);
  has("展示の単独の最速", (r) => r.isFastestExhibition === true);
  has(
    "展示の同タイムの最速（対象なし）",
    (r) => r.isFastestExhibition === null && r.exhibitionRank === 1,
  );
  has("展示なし", (r) => r.exhibitionTime === null);
  has("条件なし", (r) => r.seriesDay === null && r.raceTitle === null);
  has("rank4 なし", (r) => r.rank4 === null);
  has("公式の記号", (r) => r.finishMark === "転");
  has("級別なし", (r) => r.grade === null && r.fCount === null);
  // 不成立・結果なしの走は除かれ、同じレースの2艇は2行ある
  const twice = rows.filter(
    (r) => rows.filter((o) => o.raceId === r.raceId).length === 2,
  );
  assert.equal(twice.length, 2);
  assert.deepEqual(
    twice.map((r) => r.boatNumber),
    [2, 5],
  );
  // 窓の外・別の選手は入らない
  assert.ok(rows.every((r) => r.raceId >= racerHistoryCutoff()));
  const other = await viaRpc(OTHER);
  assert.deepEqual(other.rows, (await viaTables(OTHER)).rows);
  assert.notDeepEqual(other.rows, rows);
});

test("RPC が有れば6表を1行も読まず、要求は選手ごとに1本。返す行は1走1行", async () => {
  const old = await viaTables(RACER);
  const neo = await viaRpc(RACER);
  assert.equal(neo.fake.calls.length, 0);
  assert.equal(neo.fake.rpcCalls.length, 1);
  const call = neo.fake.rpcCalls[0];
  assert.equal(call.name, RPC);
  assert.deepEqual(call.args, {
    p_racer_id: RACER,
    p_since: racerHistoryCutoff(),
  });
  assert.deepEqual(call.orders, ["race_id", "boat_number"]);
  assert.deepEqual(call.range, [0, 999]);
  // 読む行の数: RPC は窓の中の race_entries の行と同じ数。6表の読みはその約16倍（1+1+1+1+6+6。欠けの分だけ少ない）
  const since = racerHistoryCutoff();
  const runs = await callRpc({ p_racer_id: RACER, p_since: since });
  const entryCount = tables.race_entries.filter(
    (e) => e.racer_id === RACER && e.race_id >= since,
  ).length;
  assert.equal(runs.length, entryCount);
  const ids = new Set(runs.map((r) => r.race_id));
  const oldRowCount =
    entryCount +
    [
      "races",
      "race_results",
      "race_start_timings",
      "exhibition_data",
      "race_conditions",
    ]
      .map((t) => tables[t].filter((r) => ids.has(r.race_id)).length)
      .reduce((a, b) => a + b, 0);
  assert.ok(old.fake.calls.length >= 6, "今までの道は6表を読む");
  assert.ok(
    oldRowCount > runs.length * 14,
    `6表 ${oldRowCount} 行・RPC ${runs.length} 行`,
  );
});

test("1500走の選手を1000行で切らずに取り切る（6表の読みと同じ行）", async () => {
  const neo = await viaRpc(MANY);
  assert.equal(neo.rows.length, 1500);
  assert.deepEqual(
    neo.fake.rpcCalls.map((c) => c.range),
    [
      [0, 999],
      [1000, 1999],
    ],
  );
  assert.equal(neo.fake.calls.length, 0);
  assert.deepEqual(neo.rows, (await viaTables(MANY)).rows);
});

test("走の無い選手は空（6表も読まない）", async () => {
  const neo = await viaRpc(EMPTY);
  assert.deepEqual(neo.rows, []);
  assert.equal(neo.fake.calls.length, 0);
});

test("関数が無い（PGRST202・42883）・呼ぶ権限が無いときだけ今までの読みに落ち、行は同じ", async () => {
  const expected = (await viaTables(RACER)).rows;
  for (const error of [
    { code: "PGRST202" },
    { code: "42883" },
    { code: "42501" },
    { message: "permission denied for function get_racer_scoped_race_rows" },
  ]) {
    const { rows, fake } = await viaRpc(RACER, () => {
      throw Object.assign(new Error(error.message ?? "rpc 失敗"), error);
    });
    assert.deepEqual(rows, expected);
    assert.equal(fake.rpcCalls.length, 1);
    assert.ok(fake.calls.length >= 6);
  }
});

test("ほかの失敗（通信・タイムアウト等）は例外のまま（黙って6表の読みに落とさない）", async () => {
  for (const error of [{ code: "57014" }, { code: "PGRST301" }, {}]) {
    const boom = Object.assign(new Error("rpc 失敗"), error);
    let fake;
    await assert.rejects(
      quiet(async () => {
        fake = install({
          rpc: () => {
            throw boom;
          },
        });
        return getRacerScopedRaceStats(RACER);
      }),
      (e) => e === boom,
    );
    assert.equal(fake.calls.length, 0);
  }
});

test("2本とも STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が RLS の下で呼べる", async () => {
  const { rows } = await db.query(
    "SELECT proname, provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = ANY($1) ORDER BY proname",
    [[RPC, COUNTS_RPC]],
  );
  assert.deepEqual(
    rows.map((r) => r.proname),
    [COUNTS_RPC, RPC],
  );
  for (const row of rows) {
    assert.equal(row.provolatile, "s");
    assert.equal(row.prosecdef, false);
    assert.deepEqual(row.proconfig, ["search_path=public, pg_temp"]);
  }
  const since = racerHistoryCutoff();
  const asRole = async (role, fn) => {
    if (role) await db.exec(`SET ROLE ${role}`);
    try {
      return await fn();
    } finally {
      if (role) await db.exec("RESET ROLE");
    }
  };
  const runsOf = () => callRpc({ p_racer_id: RACER, p_since: since });
  const countsOf = () =>
    callCounts({
      p_racer_ids: [RACER, INYA],
      p_since: since,
      p_before_race_id: "9999",
    });
  const [runs, counts] = [await runsOf(), await countsOf()];
  assert.equal(counts.length, 2);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.deepEqual(await asRole(role, runsOf), runs);
    assert.deepEqual(await asRole(role, countsOf), counts);
  }
  // PUBLIC には付けない（113 の方針）
  for (const signature of [
    `public.${RPC}(integer, text)`,
    `public.${COUNTS_RPC}(integer[], text, text)`,
  ]) {
    const pub = await db.query(
      "SELECT has_function_privilege('public', $1, 'EXECUTE') AS ok",
      [signature],
    );
    assert.equal(pub.rows[0].ok, false, signature);
  }
});

test("窓の境目: p_since と同じ race_id は入り、手前は入らない。並びは race_id・boat_number", async () => {
  const all = await callRpc({ p_racer_id: RACER, p_since: "0000" });
  const cut = all[10].race_id;
  const part = await callRpc({ p_racer_id: RACER, p_since: cut });
  assert.deepEqual(
    part,
    all.filter((r) => r.race_id >= cut),
  );
  assert.equal(part[0].race_id, cut);
  const keys = all.map((r) => `${r.race_id}-${r.boat_number}`);
  assert.deepEqual(keys, [...keys].sort());
  // 窓の外の走（800日前）は p_since が空なら入る＝切っているのは p_since だけ
  assert.ok(all.some((r) => r.race_id < racerHistoryCutoff()));
});

// --- 前付けの件数（get_racer_front_taking_counts） ---

const frontTakingVia = (rpc, racerIds, beforeRaceId) =>
  quiet(async () => {
    const fake = install({ rpc });
    const origError = console.error;
    console.error = () => {};
    try {
      return {
        byRacer: await getRaceFrontTakingByRacer(racerIds, beforeRaceId),
        fake,
      };
    } finally {
      console.error = origError;
    }
  });

test("前付けの件数: RPC の数えた件数が、6表の読みの行を summarizeFrontTaking で数えた値と同じ", async () => {
  const since = racerHistoryCutoff();
  let compared = 0;
  for (const racer of [RACER, OTHER, MANY, INYA]) {
    const rows = (await viaTables(racer)).rows;
    const ids = rows.map((r) => r.raceId);
    // 全部より前・途中の走の race_id ちょうど（その走は入らない）・途中の走の次・全部より後
    const befores = [
      "0000",
      ids[Math.floor(ids.length / 3)],
      `${ids[Math.floor(ids.length / 2)]}x`,
      "9999",
    ];
    for (const before of befores) {
      const expected = summarizeFrontTaking(rows, { beforeRaceId: before });
      const got = await callCounts({
        p_racer_ids: [racer],
        p_since: since,
        p_before_race_id: before,
      });
      // 数える走が無ければ行を返さない
      assert.deepEqual(
        got,
        expected.runs === 0
          ? []
          : [{ racer_id: racer, runs: expected.runs, taken: expected.taken }],
        `選手 ${racer}・${before} より前`,
      );
      compared += 1;
    }
  }
  assert.equal(compared, 16);
  // 比べた値が 0 ばかりでないこと。場面の選手は前付けあり・なしの両方、1500走の選手は枠なりで前付け0
  const all = async (racer) =>
    (
      await callCounts({
        p_racer_ids: [racer],
        p_since: since,
        p_before_race_id: "9999",
      })
    )[0];
  const mixed = await all(RACER);
  assert.ok(mixed.runs >= 40 && mixed.taken > 0 && mixed.taken < mixed.runs);
  assert.deepEqual(await all(INYA), { racer_id: INYA, runs: 30, taken: 30 });
  const many = await all(MANY);
  assert.equal(many.runs, 1250); // 1500走のうち1号艇の250走は母数に入らない
  assert.equal(many.taken, 0);
  // 窓の外の走（800日前）は数えない: 窓を外すと母数が増えるか同じ
  const wide = (
    await callCounts({
      p_racer_ids: [RACER],
      p_since: "0000",
      p_before_race_id: "9999",
    })
  )[0];
  assert.ok(wide.runs >= mixed.runs);
});

test("getRaceFrontTakingByRacer: RPC が有れば6選手で要求1本・6表を読まず、判定は今までの読みと同じ", async () => {
  const racerIds = [RACER, OTHER, MANY, INYA, EMPTY];
  const ids = (await viaTables(RACER)).rows.map((r) => r.raceId);
  for (const before of [ids[Math.floor(ids.length / 2)], "9999"]) {
    const neo = await frontTakingVia(true, racerIds, before);
    const old = await frontTakingVia(false, racerIds, before);
    assert.deepEqual(neo.byRacer, old.byRacer);
    assert.equal(neo.fake.calls.length, 0);
    assert.equal(neo.fake.rpcCalls.length, 1);
    assert.deepEqual(neo.fake.rpcCalls[0].args, {
      p_racer_ids: [RACER, OTHER, MANY, INYA, EMPTY],
      p_since: racerHistoryCutoff(),
      p_before_race_id: before,
    });
    // 今までの読みは、選手ごとに走の RPC を試してから6表を読む
    assert.ok(old.fake.calls.length >= 6 * 4);
  }
  const { byRacer } = await frontTakingVia(true, racerIds, "9999");
  assert.deepEqual(Object.keys(byRacer).sort(), racerIds.map(String).sort());
  assert.deepEqual(byRacer[INYA], {
    runs: 30,
    taken: 30,
    rate: 100,
    isInya: true,
  });
  assert.deepEqual(byRacer[EMPTY], {
    runs: 0,
    taken: 0,
    rate: null,
    isInya: false,
  });
  assert.equal(byRacer[MANY].isInya, false);
  // 登録番号が文字列で来ても（欄は文字列で渡す）同じ
  const asText = await frontTakingVia(true, racerIds.map(String), "9999");
  assert.deepEqual(asText.byRacer, byRacer);
  assert.deepEqual(asText.fake.rpcCalls[0].args.p_racer_ids, racerIds);
});

test("getRaceFrontTakingByRacer: 件数の RPC だけ無いときは走の RPC から数え、どちらも無ければ6表から数える（同じ値）", async () => {
  const racerIds = [RACER, INYA];
  const expected = (await frontTakingVia(true, racerIds, "9999")).byRacer;
  const viaRuns = await frontTakingVia({ [RPC]: callRpc }, racerIds, "9999");
  assert.deepEqual(viaRuns.byRacer, expected);
  assert.equal(viaRuns.fake.calls.length, 0);
  const viaSix = await frontTakingVia(false, racerIds, "9999");
  assert.deepEqual(viaSix.byRacer, expected);
});

test("getRaceFrontTakingByRacer: 件数の RPC のほかの失敗は例外のまま。落ちた先で選手の読みが失敗したら、その選手だけ外す", async () => {
  const boom = Object.assign(new Error("rpc 失敗"), { code: "57014" });
  await assert.rejects(
    frontTakingVia(
      {
        [COUNTS_RPC]: () => {
          throw boom;
        },
      },
      [RACER],
      "9999",
    ),
    (e) => e === boom,
  );
  // 関数が2本とも無く、走の RPC が INYA だけ失敗: INYA は外れ、RACER は数えられる
  const expected = (await frontTakingVia(true, [RACER], "9999")).byRacer;
  const { byRacer } = await frontTakingVia(
    {
      [RPC]: (args) => {
        if (args.p_racer_id === INYA) throw boom;
        return callRpc(args);
      },
    },
    [RACER, INYA],
    "9999",
  );
  assert.deepEqual(byRacer, expected);
});
