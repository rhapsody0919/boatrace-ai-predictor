/**
 * verify-racer-career-tables.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-career-tables.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMainEra, runRacerCareerMainJob, runKbEra } from "../../lib/racerCareerJob.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { parseArgs } from "../racer-career-backfill.js";
import { rowsOf, fakeClient } from "./racer-career-tables-scenes-1.js";

let read, quiet;

/** test("main 層: 全選手の計算・境目・race_series の補い・未着の走・毎晩の対象（直近の出走と着の書き換え）", asy の中身を割った 1/2 */
async function careerMainLayer1() {
  const client = await fakeClient();
  const full = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    all: true,
    log: quiet,
  });
  assert.equal(full.complete, true);
  // 本体の 2025-12-02 は数えない（801 の main は 12-06 の優勝戦だけ）
  const v801 = rowsOf(client, "racer_venue_stats", (r) => r.racer_id === 801);
  assert.deepEqual(
    v801.map((r) => [r.era, r.race_grade, r.is_final, r.p1]),
    [["main", "G2", true, 1]],
  );
  const c = rowsOf(
    client,
    "racer_championships",
    (r) => r.race_id === "2025-12-06-05-12" && r.racer_id === 801,
  )[0];
  assert.deepEqual(
    [c.series_title, c.course, c.race_grade],
    ["ＸＸ記念", 2, "G2"],
  );
  // グレードが races にも race_series.grade にも無い節は class_code から（Lady は G3、Rookie は ippan）
  const gradeOf = (racer) => [
    ...new Set(
      rowsOf(client, "racer_venue_stats", (r) => r.racer_id === racer).map(
        (r) => r.race_grade,
      ),
    ),
  ];
  assert.deepEqual([gradeOf(951), gradeOf(961)], [["G3"], ["ippan"]]);
  // QC（本体）: シリーズは G3 に直る
  assert.deepEqual(
    [
      ...new Set(
        rowsOf(
          client,
          "racer_venue_stats",
          (r) => r.racer_id === 201 && r.era === "main",
        ).map((r) => r.race_grade),
      ),
    ],
    ["G3"],
  );
  // 1月の走は前の年の11月の期。未着（10/28、コード NULL）の走は数えない
  assert.deepEqual(
    rowsOf(client, "racer_term_stats", (r) => r.racer_id === 901).map(
      (r) => r.term_start,
    ),
    ["2025-11-01"],
  );
  assert.equal(
    rowsOf(
      client,
      "racer_term_stats",
      (r) =>
        r.racer_id === 101 && r.era === "main" && r.term_start === "2026-05-01",
    ).length,
    0,
  );
  const meta = rowsOf(client, "racer_career_meta", (r) => r.era === "main")[0];
  assert.ok(meta.report.full_computed_at);

  // 毎晩: 直近3日（10/27〜）に出走表に載った 101〜106 と、着のコードが 10/29・10/27 01:00 JST に書き換わった 901〜906・971〜976 だけ
  client.rpcCalls.length = 0;
  const nightly = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    log: quiet,
  });
  assert.equal(nightly.racers, 18);
  const ids = client.rpcCalls
    .filter((c) => c.name === "compute_racer_career_counts")
    .flatMap((c) => c.args.p_racer_ids);
  assert.deepEqual(
    ids,
    [
      101, 102, 103, 104, 105, 106, 901, 902, 903, 904, 905, 906, 971, 972, 973,
      974, 975, 976,
    ],
  );
  // 時間切れで止まったら続きの選手を cursor に残し、同じ日の次の起動は続きから始める
  client.rpcCalls.length = 0;
  let calls = 0;
  const stopped = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    batchSize: 6,
    shouldStop: () => calls++ >= 1,
    log: quiet,
  });
  return { client, meta, stopped };
}

/** test("main 層: 全選手の計算・境目・race_series の補い・未着の走・毎晩の対象（直近の出走と着の書き換え）", asy の中身を割った 2/2 */
async function careerMainLayer2({ client, meta, stopped }) {
  assert.deepEqual(
    [stopped.complete, stopped.cursor],
    [false, { date: "2026-10-30", dryRun: false, lastRacerId: 106 }],
  );
  client.rpcCalls.length = 0;
  const resumed = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    batchSize: 6,
    resume: stopped.cursor,
    log: quiet,
  });
  assert.deepEqual(
    [resumed.complete, resumed.cursor, resumed.done],
    [true, null, 12],
  );
  assert.equal(
    client.rpcCalls
      .filter((c) => c.name === "compute_racer_career_counts")
      .flatMap((c) => c.args.p_racer_ids)[0],
    901,
  );
  // shadow（dryRun）の cursor は live の続きに使わない（書いていない選手を飛ばさない）
  const fromShadow = await runMainEra({ client, today: "2026-10-30", dryRun: false, resume: { ...stopped.cursor, dryRun: true }, log: quiet });
  assert.equal(fromShadow.done, 18);
  // 別の日の cursor は使わない
  const otherDay = await runMainEra({
    client,
    today: "2026-10-30",
    dryRun: false,
    resume: { date: "2026-10-29", lastRacerId: 106 },
    log: quiet,
  });
  assert.equal(otherDay.done, 18);
  // 部分の計算でも、全選手を計算した時刻は消さない
  assert.equal(
    rowsOf(client, "racer_career_meta", (r) => r.era === "main")[0].report
      .full_computed_at,
    meta.report.full_computed_at,
  );
  // 毎晩は、対象の選手の kb 層の行に触れない
  assert.equal(
    rowsOf(client, "racer_venue_stats", (r) => r.era === "kb").length,
    0,
  );
}

function scene1() {
  test("main 層: 全選手の計算・境目・race_series の補い・未着の走・毎晩の対象（直近の出走と着の書き換え）", async () => {
    const { client, meta, stopped } = await careerMainLayer1();
    await careerMainLayer2({ client, meta, stopped });
  });
  test("毎晩の Cron: kb 層が未計算なら知らせるだけ、計算後に kb_archive が変われば error", async () => {
    const client = await fakeClient();
    const first = await runRacerCareerMainJob({
      client,
      today: "2026-10-30",
      dryRun: false,
      log: quiet,
    });
    assert.equal(first.outcome, "ok");
    assert.equal(first.report.kb.state, "not_computed");
    assert.equal(first.rowsExpected, 1);
    assert.equal(first.incomplete, false);

    await runKbEra({ client, dryRun: false, log: quiet });
    assert.equal(
      (
        await runRacerCareerMainJob({
          client,
          today: "2026-10-30",
          dryRun: false,
          log: quiet,
        })
      ).report.kb.state,
      "same",
    );

    client.data.kb_archive_races.push({ race_id: "2025-11-30-01-01" });
    const changed = await runRacerCareerMainJob({
      client,
      today: "2026-10-30",
      dryRun: false,
      log: quiet,
    });
    assert.equal(changed.outcome, "error");
    assert.match(changed.error, /racer-career-backfill\.js --era=kb を再実行/);

    // 時間切れ（shouldStop）なら記録を書かず、補足の起動に回す
    const stopped = await runRacerCareerMainJob({
      client: await fakeClient(),
      today: "2026-10-30",
      dryRun: false,
      shouldStop: () => true,
      log: quiet,
    });
    assert.equal(stopped.incomplete, true);
    // shadow（dryRun）は表に書かない
    const shadow = await fakeClient();
    await runRacerCareerMainJob({
      client: shadow,
      today: "2026-10-30",
      dryRun: true,
      log: quiet,
    });
    assert.equal(
      rowsOf(shadow, "racer_venue_stats").length +
        rowsOf(shadow, "racer_career_meta").length,
      0,
    );
    await assert.rejects(
      runRacerCareerMainJob({
        client,
        today: "20261030",
        dryRun: true,
        log: quiet,
      }),
      /YYYY-MM-DD/,
    );
  });
}

function scene2() {
  // ---------------------------------------------------------------------------
  // 実行の基盤・CLI
  // ---------------------------------------------------------------------------
  test("レジストリ・vercel.json・api/cron: 23:30 と 01:00 JST、maxDuration 300", async () => {
    const def = SCRAPE_JOBS.racer_career_main;
    assert.deepEqual(
      {
        kind: def.kind,
        targetTimeJst: def.targetTimeJst,
        maxDurationSec: def.maxDurationSec,
      },
      { kind: "daily", targetTimeJst: "23:30", maxDurationSec: 300 },
    );
    // api の本文の字は読まず、export（config・default）で見る
    const mod = await import("../../../api/cron/racer-career-main.js");
    assert.equal(mod.config?.maxDuration, def.maxDurationSec);
    assert.equal(typeof mod.default, "function");
    const vercel = JSON.parse(await read("../../vercel.json"));
    const schedules = vercel.crons
      .filter((c) => c.path === "/api/cron/racer-career-main")
      .map((c) => c.schedule);
    // UTC → JST: 14:30 → 23:30、16:00 → 01:00
    assert.deepEqual(schedules, ["30 14 * * *", "0 16 * * *"]);
  });
  test("CLI の引数: --era は必須、kb に --all・--today は付けない", () => {
    assert.deepEqual(parseArgs(["--era=kb", "--apply"]), {
      era: "kb",
      apply: true,
      all: false,
      today: null,
      allowMassDelete: false,
    });
    assert.deepEqual(parseArgs(["--era=main", "--all", "--today=2026-10-30"]), {
      era: "main",
      apply: false,
      all: true,
      today: "2026-10-30",
      allowMassDelete: false,
    });
    assert.throws(() => parseArgs([]), /--era=kb か --era=main/);
    assert.throws(() => parseArgs(["--era=kb", "--all"]), /--era=main だけ/);
    assert.throws(() => parseArgs(["--era=main", "--today=1030"]), /YYYY-MM-DD/);
    assert.throws(
      () => parseArgs(["--era=main", "--force"]),
      /知らないオプション/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・quiet） */
export function runRacerCareerTablesScenes3(env) {
  ({ read, quiet } = env);
  scene1();
  scene2();
}
