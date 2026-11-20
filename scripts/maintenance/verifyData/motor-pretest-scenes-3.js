/**
 * verify-motor-pretest.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-motor-pretest.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { DATE, jobTables, JOB, liveRow, runJob, at, throwingFetch, recordingDeps, strictClient, createFakeFetch, jcdOf, pageByVenue, hdOf } from "./motor-pretest-scenes-2.js";

let check, show, same, jst;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // shadow: 取得・解析のみ。書かない・処理済みにしない
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
  const f = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  const res = await runJob({
    store,
    client,
    politeFetch: f,
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ shadow: 会場ごとに対象日のページを1回ずつ取得し、書かず、対象日を処理済みにしない",
    res.status === 200 &&
      f.log.length === 2 &&
      f.log.every((u) => hdOf(u) === "20260921") &&
      same(f.log.map(jcdOf).sort(), ["02", "18"]) &&
      client.writesTo("motor_pretest_stats").length === 0 &&
      row.last_target_date === undefined &&
      row.last_report?.summary?.pageRows === 91,
    show({ status: res.status, log: f.log, report: row.last_report?.summary }),
  );
  return { row };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ row }) {
  check(
    "日次ジョブ shadow: 期待した選手（races・race_entries）がページに全員載っている・前検タイムが全員入っている",
    row.last_report?.summary?.expectedRacers === 3 &&
      row.last_report?.summary?.expectedRacersOnPage === 3 &&
      row.last_report?.summary?.pretestFilled === 91 &&
      row.last_report?.alerts?.length === 0,
    show(row.last_report?.summary),
  );
}

async function scene3() {
  // P5a: 初日・保存済み3日目・6日窓の境界・8日目・取りこぼし。
  for (const [start, saved, shouldFetch] of [
    [DATE, DATE, true],
    ["2026-09-19", "2026-09-19", false],
    ["2026-09-15", "2026-09-15", false],
    ["2026-09-14", "2026-09-14", true],
    ["2026-09-19", null, true],
    ["2026-09-19", "2026-09-22", true], // 未来の行は使わない
    ["2026-09-19", "2026-09-10", true], // 前の節の行は使わない
  ]) {
    const tables = jobTables();
    tables.race_series[1].start_date = start;
    if (saved) tables.motor_pretest_stats.push({
      venue_code: 18,
      race_date: saved,
      racer_id: 4529,
    });
    const client = createFakeSupabaseClient({ tables });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const fetched = [];
    const res = await runJob({
      store, client, when: at("05:30:00"),
      politeFetch: throwingFetch(),
      deps: recordingDeps(fetched),
    });
    const row = store.state.get(JOB);
    check(`P5a: 初日Aと開始${start}・保存${saved}のB: B取得=${shouldFetch}`,
      res.status === 200 &&
      same(fetched.sort((a, b) => a - b), shouldFetch ? [2, 18] : [2]) &&
      row.last_target_date === DATE && row.consecutive_failures === 0 &&
      row.last_rows_written === (shouldFetch ? 2 : 1) &&
      (shouldFetch || row.last_report.health[18] === undefined), show(res));
  }
}

async function scene4() {
  {
    const tables = jobTables();
    tables.race_series.forEach((s) => { s.start_date = "2026-09-19"; });
    // 保存行はその日の出走選手を全員含む（含まなければ取り直す。下の P2-2）
    tables.motor_pretest_stats = [[2, 4608], [2, 3647], [18, 4529]].map(([venue_code, racer_id]) => ({
      venue_code, race_date: "2026-09-19", racer_id,
    }));
    const client = createFakeSupabaseClient({ tables });
    const health = { 18: { consecutiveFailDays: 1, lastReason: "timeout" } };
    const store = createMemoryStore({ rows: {
      [JOB]: { ...liveRow(), last_report: { health } },
    } });
    const f = throwingFetch();
    const res = await runJob({ store, client, politeFetch: f, when: at("05:30:00") });
    check("P5a: 全会場が保存済み途中日なら取得・書き込み0で日次成功",
      res.status === 200 && f.count === 0 &&
      client.writesTo("motor_pretest_stats").length === 0 &&
      store.state.get(JOB).last_target_date === DATE &&
      store.state.get(JOB).consecutive_failures === 0 &&
      same(store.state.get(JOB).last_report.health, health), show(res));
  }
  // 審査 P2-2: race_series の開始日（9/19）が古く、保存行が前の節の名簿のとき（順延で実際の初日が 9/21）。
  // その日の出走選手が保存行に無ければ、その会場だけ取り直す。名簿がそろっている会場（戸田）は取らない
  {
    const tables = jobTables();
    tables.race_series.forEach((s) => { s.start_date = "2026-09-19"; });
    tables.motor_pretest_stats = [
      { venue_code: 2, race_date: "2026-09-19", racer_id: 4608 },
      { venue_code: 2, race_date: "2026-09-19", racer_id: 3647 },
      { venue_code: 18, race_date: "2026-09-19", racer_id: 9999 },
    ];
    const client = createFakeSupabaseClient({ tables });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const fetched = [];
    const res = await runJob({
      store, client, when: at("05:30:00"),
      politeFetch: throwingFetch(),
      deps: recordingDeps(fetched),
    });
    check("P5a: 保存行に今日の出走選手がいない会場（前の節の名簿）だけ取り直す",
      res.status === 200 && same(fetched, [18]) &&
      store.state.get(JOB).last_target_date === DATE &&
      store.state.get(JOB).last_rows_written === 1, show(res));
  }
  for (const table of ["race_series", "motor_pretest_stats"]) {
    const tables = jobTables();
    tables.race_series.forEach((s) => { s.start_date = "2026-09-19"; });
    const client = createFakeSupabaseClient({ tables,
      failOn: { [`${table}:select`]: "stub read failure" } });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const f = throwingFetch();
    const res = await runJob({ store, client, politeFetch: f, when: at("05:30:00") });
    check(`P5a: ${table} 読取失敗は未保存とみなさず取得0で失敗`,
      res.status === 500 && f.count === 0 &&
      store.state.get(JOB).last_target_date === undefined, show(res));
  }
}

async function scene5() {
  // 審査 P2: 節が引けない会場（race_series が無い・前の節で終わっている）は、その会場だけ取る。
  // A は初日（取る）、B は節が引けない（取る）、C は3日目で保存済み（取らない）。全会場は止めない
  for (const [label, seriesB] of [
    ["race_series が無い", null],
    ["前の節が終わっている", { start_date: "2026-09-10", end_date: "2026-09-15" }],
  ]) {
    const tables = jobTables();
    tables.races.push({
      race_id: `${DATE}-05-01`,
      race_date: DATE,
      venue_code: 5,
      cancellation_status: null,
    });
    tables.race_entries.push({ race_id: `${DATE}-05-01`, racer_id: 4000 });
    tables.race_series = [
      { venue_code: 2, start_date: DATE, end_date: "2026-09-28" },
      ...(seriesB ? [{ venue_code: 18, ...seriesB }] : []),
      { venue_code: 5, start_date: "2026-09-19", end_date: "2026-09-24" },
    ];
    tables.motor_pretest_stats = [
      { venue_code: 5, race_date: "2026-09-19", racer_id: 4000 },
    ];
    const client = createFakeSupabaseClient({ tables });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const fetched = [];
    const res = await runJob({
      store, client, when: at("05:30:00"),
      politeFetch: throwingFetch(),
      deps: recordingDeps(fetched),
    });
    const row = store.state.get(JOB);
    check(`P5a: B（${label}）は B だけ取り、A は取り C は取らない（全会場を止めない）`,
      res.status === 200 && res.body?.waiting === undefined &&
      same(fetched.sort((a, b) => a - b), [2, 18]) &&
      row.last_target_date === DATE && row.consecutive_failures === 0 &&
      row.last_rows_written === 2, show(res));
  }
  {
    // off・行なし・075未適用は、何も取得せず、DBのデータテーブルにもアクセスしない（マージしても本番の挙動が変わらない）
    for (const [label, storeOptions] of [
      ["mode=off", { rows: { [JOB]: { job: JOB, mode: "off" } } }],
      ["行なし", {}],
      ["075未適用", { available: false }],
    ]) {
      const store = createMemoryStore(storeOptions);
      const f = throwingFetch();
      const res = await runJob({
        store,
        client: strictClient(),
        politeFetch: f,
        when: at("05:30:00"),
      });
      check(
        `日次ジョブ ${label}: 何も取得せず、DBにもアクセスせず、200で終わる`,
        res.status === 200 &&
          f.count === 0 &&
          !store.calls.some((c) => c.name === "acquireLease"),
        show(res),
      );
    }
  }
  {
    const s1 = await scene1();
    scene2(s1);
  }
}

async function scene6() {
  {
    // live: 書く。同じ日の2回目は何もしない
    const client = createFakeSupabaseClient({ tables: jobTables() });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const f = createFakeFetch((url) => pageByVenue(jcdOf(url)));
    const res = await runJob({
      store,
      client,
      politeFetch: f,
      when: at("05:30:00"),
    });
    const row = store.state.get(JOB);
    check(
      "日次ジョブ live: 91行を書き、対象日(2026-09-21)を処理済みにする",
      res.status === 200 &&
        client.data.motor_pretest_stats.length === 91 &&
        row.last_target_date === DATE &&
        row.last_rows_written === 91,
      show({
        status: res.status,
        n: client.data.motor_pretest_stats.length,
        row,
      }),
    );
    const f2 = createFakeFetch((url) => pageByVenue(jcdOf(url)));
    const res2 = await runJob({
      store,
      client,
      politeFetch: f2,
      when: at("06:00:00"),
    });
    check(
      "日次ジョブ live: 06:00 の補足の起動は、処理済みの対象日を再取得しない（冪等）",
      res2.body.skipped === "already_done" && f2.log.length === 0,
      show(res2.body),
    );
    // 翌日の05:30では、対象日は翌日
    const res3 = await runJob({
      store,
      client: createFakeSupabaseClient({ tables: { ...jobTables(), races: [] } }),
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: jst("2026-09-22T05:30:00"),
    });
    check(
      "日次ジョブ: 翌日 05:30 の起動の対象日は翌日（races が無ければ取得せず incomplete）",
      res3.body.targetDate === "2026-09-22" && res3.body.waiting === "races",
      show(res3.body),
    );
    // 指定時刻（05:20）の前は前日（日付を取り違えない）
    const res4 = await runJob({
      store: createMemoryStore({ rows: { [JOB]: liveRow() } }),
      client: createFakeSupabaseClient({ tables: { ...jobTables(), races: [] } }),
      politeFetch: throwingFetch(),
      when: at("05:10:00"),
    });
    check(
      "日次ジョブ: 指定時刻(05:20)より前の起動の対象日は前日",
      res4.body.targetDate === "2026-09-20",
      show(res4.body),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst） */
export async function runMotorPretestScenes3(env) {
  ({ check, show, same, jst } = env);
  await scene3();
  await scene4();
  await scene5();
  await scene6();
}
