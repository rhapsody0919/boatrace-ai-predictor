/**
 * verify-motor-pretest.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-motor-pretest.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { parseMotorPretestHtml } from "../../lib/motorPretestParser.js";
import {
  buildMotorPretestRows,
  writeMotorPretestRows,
  MOTOR_PRETEST_TABLE,
  loadExpectedRacers,
  summarizeVenueCoverage,
} from "../../lib/motorPretestRows.js";
import { runMotorPretestJob } from "../../lib/motorPretestJob.js";

let check, show, same, jst, TODA, TOKUYAMA, NO_DATA;

// ===========================================================================
// (c) 日次ジョブ
// ===========================================================================
export const JOB = "motor_pretest";

export const liveRow = (mode = "live") => ({
  job: JOB,
  mode,
  consecutive_failures: 0,
});

export const createFakeFetch = (resolve) => {
  const log = [];
  const f = async (url) => {
    log.push(String(url));
    const r = await resolve(String(url));
    if (r instanceof Error) throw r;
    if (r instanceof Response) return r;
    return new Response(r, { status: 200 });
  };
  f.log = log;
  return f;
};

export const throwingFetch = () => {
  const f = async () => {
    f.count++;
    throw new Error("取得してはいけません");
  };
  f.count = 0;
  return f;
};

export const strictClient = () => ({
  from() {
    throw new Error("DBへアクセスしてはいけません");
  },
});

export const DATE = "2026-09-21";

export const at = (time) => jst(`${DATE}T${time}`);

export const pageByVenue = (venueCode) =>
  venueCode === "02" ? TODA : venueCode === "18" ? TOKUYAMA : NO_DATA;

export const jobTables = ({ initState = null, extraEntries = [] } = {}) => ({
  races: [
    {
      race_id: `${DATE}-02-01`,
      race_date: DATE,
      venue_code: 2,
      cancellation_status: null,
    },
    {
      race_id: `${DATE}-18-01`,
      race_date: DATE,
      venue_code: 18,
      cancellation_status: null,
    },
  ],
  race_entries: [
    { race_id: `${DATE}-02-01`, racer_id: 4608 },
    { race_id: `${DATE}-02-01`, racer_id: 3647 },
    { race_id: `${DATE}-18-01`, racer_id: 4529 },
    ...extraEntries,
  ],
  scrape_job_state: initState ? [initState] : [],
  race_series: [2, 18].map((venue_code) => ({
    venue_code,
    start_date: DATE,
    end_date: "2026-09-28",
  })),
  motor_pretest_stats: [],
});

export const runJob = ({ store, client, politeFetch, when, deps }) =>
  runScrapeJob({
    job: JOB,
    run: (ctx) => runMotorPretestJob(ctx, deps),
    store,
    client,
    politeFetch,
    now: typeof when === "function" ? when : () => when,
    worker: "verify",
  });

export const jcdOf = (url) => new URL(url).searchParams.get("jcd");

export const hdOf = (url) => new URL(url).searchParams.get("hd");

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const parsed = parseMotorPretestHtml(TODA);
  const rows = buildMotorPretestRows({
    venueCode: 2,
    date: "2026-09-21",
    parsed,
  });
  check(
    "行の組み立て: 46行・キー(race_date, venue_code, racer_id)・開催名・created_at/updated_at は持たない",
    rows.length === 46 &&
      rows[0].race_date === "2026-09-21" &&
      rows[0].venue_code === 2 &&
      rows[0].racer_id === 4608 &&
      rows[0].series_title === "BOATBoyカップ" &&
      !("created_at" in rows[0]) &&
      !("updated_at" in rows[0]),
    show(rows[0]),
  );
  const client = createFakeSupabaseClient({
    tables: { motor_pretest_stats: [] },
  });
  const n1 = await writeMotorPretestRows(client, rows, {
    now: new Date("2026-09-21T20:30:00Z"),
  });
  const stored = client.data.motor_pretest_stats;
  check(
    "書き込み: 初回は46行を書き、変更のある（新規の）行に updated_at を設定する",
    n1 === 46 &&
      stored.length === 46 &&
      stored.every((r) => r.updated_at === "2026-09-21T20:30:00.000Z"),
    show({ n1, len: stored.length }),
  );
  const upsertsBefore = client.writesTo("motor_pretest_stats").length;
  const n2 = await writeMotorPretestRows(client, rows);
  check(
    "書き込み: 同じ内容の2回目は0行（変更の無い行は書かない。upsert を呼ばない）",
    n2 === 0 && client.writesTo("motor_pretest_stats").length === upsertsBefore,
    show({ n2 }),
  );
  // 本番のDBは numeric を文字列（"6.65"・"66.6"）で返す。文字列と数値の差で、永久に「変更あり」にならない
  for (const r of stored) {
    r.pretest_time = r.pretest_time.toFixed(2);
    r.motor_2rate = r.motor_2rate.toFixed(1);
    r.boat_2rate = r.boat_2rate.toFixed(1);
  }
  const n3 = await writeMotorPretestRows(client, rows);
  check(
    "書き込み: DBが numeric を文字列で返しても、同じ値なら0行（NUMERIC_SCALES の scale で正規化）",
    n3 === 0,
    show({ n3 }),
  );
  const changed = rows.map((r, i) =>
    i === 0 ? { ...r, pretest_time: 6.7, pretest_rank: 30 } : r,
  );
  const n4 = await writeMotorPretestRows(client, changed, {
    now: new Date("2026-09-21T21:00:00Z"),
  });
  const updated = client.data.motor_pretest_stats.find(
    (r) => r.racer_id === 4608,
  );
  check(
    "書き込み: 1人の前検タイムが変わったら、その1行だけを書き、updated_at を更新する（他の行は変えない）",
    n4 === 1 &&
      updated.pretest_time === 6.7 &&
      updated.updated_at === "2026-09-21T21:00:00.000Z" &&
      client.data.motor_pretest_stats.filter(
        (r) => r.updated_at === "2026-09-21T20:30:00.000Z",
      ).length === 45,
    show({ n4, updated }),
  );
  return { parsed, rows };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ parsed, rows }) {
  const dry = await writeMotorPretestRows(
    createFakeSupabaseClient({ tables: { motor_pretest_stats: [] } }),
    rows,
    { dryRun: true },
  );
  check("書き込み: dryRun は書かず、書くはずの行数を返す", dry === 46);
  const failing = createFakeSupabaseClient({
    tables: { motor_pretest_stats: [] },
    failOn: {
      "motor_pretest_stats:select":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      "motor_pretest_stats:upsert":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
    },
  });
  let thrown = null;
  try {
    await writeMotorPretestRows(failing, rows);
  } catch (error) {
    thrown = error;
  }
  check(
    "書き込み: テーブルが無い（マイグレーション090が未適用）は、成功にせず、理由の分かる例外にする",
    thrown !== null && /090が未適用/.test(thrown.message),
    thrown?.message,
  );
  check(
    "テーブル定義: 主キーの列と、既存行の取得の単位",
    MOTOR_PRETEST_TABLE.onConflict === "race_date,venue_code,racer_id" &&
      same(MOTOR_PRETEST_TABLE.keyColumns, [
        "race_date",
        "venue_code",
        "racer_id",
      ]),
  );
  // 期待件数（races・race_entries から）
  const c2 = createFakeSupabaseClient({
    tables: {
      races: [
        {
          race_id: "2026-09-21-02-01",
          race_date: "2026-09-21",
          venue_code: 2,
          cancellation_status: null,
        },
        {
          race_id: "2026-09-21-02-02",
          race_date: "2026-09-21",
          venue_code: 2,
          cancellation_status: "confirmed",
        },
        {
          race_id: "2026-09-21-18-01",
          race_date: "2026-09-21",
          venue_code: 18,
          cancellation_status: null,
        },
        {
          race_id: "2026-09-20-02-01",
          race_date: "2026-09-20",
          venue_code: 2,
          cancellation_status: null,
        },
      ],
      race_entries: [
        { race_id: "2026-09-21-02-01", racer_id: 4608 },
        { race_id: "2026-09-21-02-01", racer_id: 3647 },
        { race_id: "2026-09-21-02-02", racer_id: 5322 }, // 確定中止のレース: 期待から除く
        { race_id: "2026-09-21-18-01", racer_id: 4529 },
        { race_id: "2026-09-21-18-01", racer_id: null },
        { race_id: "2026-09-20-02-01", racer_id: 9999 }, // 別の日
      ],
    },
  });
  const e = await loadExpectedRacers(c2, "2026-09-21");
  return { parsed, e };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ parsed, e }) {
  check(
    "期待件数: その日の会場（races）と、確定中止を除いたレースの選手（race_entries）だけ。除外した件数を返す（別の日・racer_id無しは数えない）",
    same(
      e.venues.map((v) => v.venueCode),
      [2, 18],
    ) &&
      same([...e.expectedByVenue.get(2)].sort(), [3647, 4608]) &&
      same([...e.expectedByVenue.get(18)], [4529]) &&
      e.raceCount === 3 &&
      e.excludedCancelledRaces === 1,
    show({ v: e.venues, r: e.raceCount, x: e.excludedCancelledRaces }),
  );
  let raceReadError = null;
  try {
    await loadExpectedRacers(
      createFakeSupabaseClient({ failOn: { "races:select": "接続エラー" } }),
      "2026-09-21",
    );
  } catch (error) {
    raceReadError = error;
  }
  check(
    "期待件数: races の読み取り失敗は例外（「レースが無い」と誤判定しない）",
    raceReadError !== null && /接続エラー/.test(raceReadError.message),
  );
  const cov = summarizeVenueCoverage(parsed.rows, new Set([4608, 3647, 99999]));
  check(
    "充足の集計: 期待した選手のうちページに載っていない選手・前検タイムの数",
    cov.expected === 3 &&
      same(cov.missing, [99999]) &&
      cov.pageRows === 46 &&
      cov.pretestFilled === 46 &&
      cov.expectedWithTime === 2,
    show(cov),
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・TODA・TOKUYAMA・NO_DATA） */
export async function runMotorPretestScenes2(env) {
  ({ check, show, same, jst, TODA, TOKUYAMA, NO_DATA } = env);
  await scene4();
}
