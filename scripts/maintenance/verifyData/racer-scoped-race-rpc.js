/**
 * マイグレーション 203 の RPC 2本の verify（verify-racer-scoped-race-rpc.js・verify-racer-front-taking-rpc.js）の共通の部品。
 * verify ではない。PGlite に本番と同じ型の縮約の6表（RLS 有効・匿名に SELECT）を作って 203 を当て、場面を混ぜた走を入れ、
 * サービス層（src/services）を偽の supabase の上で呼ぶ。偽の表は PGlite の中身そのもの、偽の rpc は PGlite の 203 を呼ぶ。
 * 外部接続なし
 */
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./fakeServiceSupabase.js";

export const RPC = "get_racer_scoped_race_rows";
export const COUNTS_RPC = "get_racer_front_taking_counts";
const TABLES = [
  "race_entries",
  "races",
  "race_results",
  "race_start_timings",
  "exhibition_data",
  "race_conditions",
];

export const RACER = 4001; // いろいろな走を混ぜた選手
export const OTHER = 4002; // 同じレースに出る別の選手（混ざらないこと）
export const MANY = 4003; // 1500走（ページの境目）。全部そろった枠なりの走
export const INYA = 4004; // 4号艇で2コースに入る走が30（札が付く）
export const EMPTY = 4999; // 走の無い選手

const BOATS = [1, 2, 3, 4, 5, 6];
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
// opts にキーが有ればその値（null も）、無ければ乱数の値
const given = (opts, key, fallback) => (key in opts ? opts[key] : fallback());

async function insert(db, table, row) {
  const cols = Object.keys(row);
  await db.query(
    `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
    cols.map((c) => row[c]),
  );
}

// result: false＝結果の行なし / { race_status, lowRanks: false＝rank4〜6 が null, courses: [艇番1..6 の進入]（null も可） }
async function insertResult(db, raceId, result) {
  if (result === false) return;
  const opts = result ?? {};
  const order = shuffled(BOATS);
  const courses = opts.courses ?? shuffled(BOATS);
  const low = opts.lowRanks === false ? () => null : (n) => order[n];
  await insert(db, "race_results", {
    race_id: raceId,
    rank1: order[0],
    rank2: order[1],
    rank3: order[2],
    rank4: low(3),
    rank5: low(4),
    rank6: low(5),
    race_status: given(opts, "race_status", () =>
      pick(["normal", "normal", "partial_refund", null]),
    ),
    ...Object.fromEntries(courses.map((c, i) => [`actual_course_${i + 1}`, c])),
    winning_technique: pick(["逃げ", "差し", "まくり", "まくり差し", null]),
    payout_win: pick([120, 350, 1280, null]),
  });
}

// st: false＝本番 ST の行なし / { [艇番]: null＝その艇の行なし | 上書きの列 }
async function insertStartTimings(db, raceId, st) {
  if (st === false) return;
  for (const boat of BOATS) {
    const over = st?.[boat];
    if (over === null) continue;
    await insert(db, "race_start_timings", {
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

// ex: false＝展示の行なし / { [艇番]: null＝行なし | { time }（null も可） }
async function insertExhibition(db, raceId, ex) {
  if (ex === false) return;
  for (const boat of BOATS) {
    const over = ex?.[boat];
    if (over === null) continue;
    await insert(db, "exhibition_data", {
      race_id: raceId,
      boat_number: boat,
      exhibition_time: over
        ? over.time
        : pick([6.7, 6.75, 6.78, 6.78, 6.8, 6.85, 6.9]),
    });
  }
}

// cond: false＝条件の行なし / 上書きの列
async function insertCondition(db, raceId, cond) {
  if (cond === false) return;
  await insert(db, "race_conditions", {
    race_id: raceId,
    race_stage: pick(["予選", "準優勝戦", "優勝戦", null]),
    race_title: pick(["第10回龍神杯", "ヴィーナスシリーズ第5戦", null]),
    wave_height: pick([0, 2, 5, 8, null]),
    series_day: pick([1, 2, 3, 6, null]),
    is_final_day: pick([true, false, null]),
    ...cond,
  });
}

/**
 * 1レース。opts.racer（既定 RACER）が opts.boats（既定は乱数の1艇。2つなら同じレースに2艇）で出る。
 * 別の選手（OTHER）が同じレースの別の艇に出る。result・st・ex・cond は上の各関数の形
 */
async function addRace(db, raceId, opts = {}) {
  const boats = opts.boats ?? [pick(BOATS)];
  await insert(db, "races", {
    race_id: raceId,
    race_date: raceId.slice(0, 10),
    venue_code: Number(raceId.slice(11, 13)),
    race_number: Number(raceId.slice(14, 16)),
    race_grade: given(opts, "race_grade", () =>
      pick(["一般", "G3", "SG", null]),
    ),
  });
  for (const boat of boats) {
    await insert(db, "race_entries", {
      race_id: raceId,
      boat_number: boat,
      racer_id: opts.racer ?? RACER,
      grade: given(opts, "grade", () => pick(["A1", "A2", "B1", "B2"])),
      f_count: given(opts, "f_count", () => pick([0, 0, 0, 1, 2, null])),
    });
  }
  await insert(db, "race_entries", {
    race_id: raceId,
    boat_number: BOATS.find((b) => !boats.includes(b)),
    racer_id: OTHER,
    grade: "B1",
    f_count: 0,
  });
  await insertResult(db, raceId, opts.result);
  await insertStartTimings(db, raceId, opts.st);
  await insertExhibition(db, raceId, opts.ex);
  await insertCondition(db, raceId, opts.cond);
}

const SAME_ST = Object.fromEntries(
  BOATS.map((b) => [b, { start_timing: 0.15, is_flying: false }]),
);
// 場面（どれも RACER の走）。名前は説明用
const SCENES = {
  ふつう: {},
  不成立: { result: { race_status: "no_race" } },
  返還: { result: { race_status: "partial_refund" } },
  結果の行なし: { result: false },
  "rank4〜6 なし": { result: { lowRanks: false } },
  実進入コースなし: { result: { courses: BOATS.map(() => null) } },
  "自艇が F": {
    boats: [3],
    st: { 3: { is_flying: true, start_timing: 0.01 } },
  },
  自艇が出遅れ: {
    boats: [4],
    st: { 4: { is_late_start: true, start_timing: 1.2 } },
  },
  自艇が欠場: {
    boats: [5],
    st: { 5: { finish_mark: "欠", start_timing: null } },
  },
  "自艇だけ ST の行なし": { boats: [2], st: { 2: null } },
  "他の艇が F・ST なし": {
    boats: [1],
    st: { 2: { is_flying: true }, 3: { start_timing: null } },
  },
  "全艇が同じ ST": { st: SAME_ST },
  "ST の行なし": { st: false },
  展示の行なし: { ex: false },
  展示の同タイムの最速: {
    boats: [1],
    ex: { 1: { time: 6.7 }, 2: { time: 6.7 } },
  },
  展示の単独の最速: { boats: [6], ex: { 6: { time: 6.5 } } },
  自艇の展示タイムなし: { boats: [2], ex: { 2: { time: null } } },
  自艇の展示の行なし: { boats: [3], ex: { 3: null } },
  条件の行なし: { cond: false },
  "条件が全部 null": {
    cond: {
      race_stage: null,
      race_title: null,
      wave_height: null,
      series_day: null,
      is_final_day: null,
    },
  },
  同じレースに2艇: { boats: [2, 5] },
  "級別・F数・グレードなし": { grade: null, f_count: null, race_grade: null },
};

// 型は本番の写し（docs/reference/schema-snapshot.json、2026-10-27）の、203 が読む列
const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
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
  ${TABLES.map(
    (t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
  CREATE POLICY ${t}_public_read ON ${t} FOR SELECT TO anon, authenticated USING (true);
  GRANT SELECT ON ${t} TO anon, authenticated, service_role;`,
  ).join("\n  ")}
`;

// 1500走の選手（1日12レース×125日。艇番は順に 1〜6、進入は枠なり、全部そろった走）
const MANY_RUNS = `
  WITH g AS (
    SELECT to_char(current_date - 1 - (i / 12), 'YYYY-MM-DD') || '-20-' || lpad(((i % 12) + 1)::text, 2, '0') AS race_id,
           current_date - 1 - (i / 12) AS race_date, (i % 12) + 1 AS no, i
    FROM generate_series(0, 1499) AS i
  ), r AS (
    INSERT INTO races SELECT race_id, race_date, 20, no, '一般' FROM g
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
`;

async function seed(db) {
  // 場面の走（1日1レース）と、ふつうの走60で、RACER は約80走
  let day = 2;
  for (const opts of Object.values(SCENES)) {
    await addRace(db, rid(day, 4, 3), opts);
    day += 1;
  }
  for (let i = 0; i < 60; i++) {
    const venue = pick([1, 12, 24]);
    await addRace(db, rid(day + Math.floor(i / 2), venue, (i % 12) + 1));
  }
  // 窓の外（730日より前）の走
  await addRace(db, rid(800, 4, 1));
  for (let i = 0; i < 30; i++) {
    await addRace(db, rid(200 + i, 7, 5), {
      racer: INYA,
      boats: [4],
      result: { race_status: "normal", courses: [1, 3, 4, 2, 5, 6] },
    });
  }
  await db.exec(MANY_RUNS);
}

const quiet = async (fn) => {
  const saved = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    [console.log, console.error] = saved;
  }
};

/**
 * PGlite を作って 203 を当て（2回。当て直しても失敗しないこと）、走を入れ、サービス層を読み込む。
 * @returns {Promise<object>} db・tables・jsonRows・callRpc・callCounts・call・REAL と、サービス層の関数
 */
export async function setupRacerScopedRpc() {
  registerFakeServiceSupabase();
  installLocalStorage();
  const services = {
    ...(await import("../../../src/services/racerQueries2.js")),
    ...(await import("../../../src/services/racerQueries6.js")),
  };
  const { clearCache } = await import("../../../src/services/core.js");
  const migration = await readFile(
    new URL(
      "../../../docs/db-migration/203_racer_scoped_race_rpcs.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  await db.exec(migration);
  await seed(db);

  /** PostgREST と同じく、DB が作った JSON で行を受け取る（numeric は JSON の数になる） */
  const jsonRows = async (sql, params = [], role = null) => {
    if (role) await db.exec(`SET ROLE ${role}`);
    try {
      const { rows } = await db.query(
        `SELECT coalesce(json_agg(t), '[]'::json) AS r FROM (${sql}) t`,
        params,
      );
      return rows[0].r;
    } finally {
      if (role) await db.exec("RESET ROLE");
    }
  };
  const callRpc = ({ p_racer_id, p_since }, role) =>
    jsonRows(
      `SELECT * FROM public.${RPC}($1, $2)`,
      [p_racer_id, p_since],
      role,
    );
  const callCounts = ({ p_racer_ids, p_since, p_before_race_id }, role) =>
    jsonRows(
      `SELECT * FROM public.${COUNTS_RPC}($1::integer[], $2, $3)`,
      [p_racer_ids, p_since, p_before_race_id],
      role,
    );
  const tables = Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => [t, await jsonRows(`SELECT * FROM ${t}`)]),
    ),
  );
  const REAL = { [RPC]: callRpc, [COUNTS_RPC]: callCounts };

  /**
   * 偽の supabase を置いて fn(fake) を呼ぶ（キャッシュは空から）。maxRows は PostgREST の1回の上限。
   * rpcs: REAL＝PGlite の 203 の2本 / {}＝関数なし（PGRST202）/ { 名前: 関数 }＝その RPC だけ
   * @returns {Promise<{ value: unknown, fake: object }>}
   */
  const call = (rpcs, fn) =>
    quiet(async () => {
      clearCache();
      const fake = setFakeSupabase(
        createFakeSupabase(tables, { project: true, maxRows: 1000, rpcs }),
      );
      return { value: await fn(fake), fake };
    });

  return { db, tables, jsonRows, callRpc, callCounts, call, REAL, ...services };
}
