/**
 * verify-upset-win.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-upset-win.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  sumDays,
  screensOf,
  titleOf,
  buildBundle,
  weaknessesOf,
  pageSeconds,
} from "../../../sns-video-studio/remotion/src/upsetWin/model.js";

let BASE_FILES, MIGRATION, GUARDS, sqlOf, forTest, guardedForTest, SAMPLE, PUSHED_AT, check, clone, raceOfSample;
export let db;

export const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];

export const all = async (sql, args = []) => (await db.query(sql, args)).rows;

export const saved = [];

export const upwState = { dbRace: null };

export const setClock = async (date) => {
  await db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  await db.exec(
    "UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
};

function upw2Scene1() {
  test("直近1年の範囲: 窓の頭からデータがあれば「直近1年」。窓の中ほどに比べたレースが0の日があれば、データの欠けとして止める", () => {
    const full = clone(SAMPLE);
    for (const d of Object.keys(full.year.days))
      if (full.year.days[d][0] === 0) full.year.days[d] = [100, 10];
    const sum = sumDays(full.year.days, {
      from: full.year.window_from,
      to: full.year.to,
    });
    full.year = { ...full.year, from: full.year.window_from, n: sum.n, k: sum.k };
    full.texts = screensOf(full);
    assert.match(full.texts.year_n, /^直近1年 /);
    const gap = clone(SAMPLE);
    gap.year.days["2026-06-01"] = [0, 0];
    const s2 = sumDays(gap.year.days, {
      from: gap.year.window_from,
      to: gap.year.to,
    });
    gap.year.n = s2.n;
    gap.year.k = s2.k;
    assert.match(check(gap).join(), /2026-06-01 の比べたレースが0/);
    const early = clone(SAMPLE);
    early.year.from = early.year.window_from;
    assert.match(check(early).join(), /範囲/);
  });
  test("検査: 文・数・題・説明欄を値から作り直して照らす。値を1つ変えた・文を書き換えた・円・禁止語・日ごとの和の食い違い・尺の外は止める", () => {
    const changed = (f) => {
      const b = clone(SAMPLE);
      f(b);
      return check(b);
    };
    assert.match(changed((b) => (b.texts.year_k = "5,336回")).join(), /texts/);
    assert.match(changed((b) => (b.boats[3].odds = 9.5)).join(), /10倍以上/);
    assert.match(
      changed((b) => (b.boats[3].win_rate = 3.95)).join(),
      /弱さが値と合わない/,
    );
    assert.match(changed((b) => (b.year.k += 1)).join(), /日ごとの和/);
    assert.match(
      changed((b) => (b.year.days["2026-01-01"] = [100, 200])).join(),
      /欠けている/,
    );
    assert.match(
      changed((b) => (b.youtube.title = `${b.youtube.title}（3,470円）`)).join(),
      /題が値から作った文と違う/,
    );
    assert.match(
      changed((b) => (b.voice.result = `${b.voice.result}次も狙い目`)).join(),
      /声の文/,
    );
    assert.match(
      changed((b) => (b.primary = "win_rate")).join(),
      /3コマ目の項目/,
    );
    assert.match(changed((b) => (b.boats[2].class = "")).join(), /級/);
    assert.match(changed((b) => (b.boats[2].racer = "仲道 大輔")).join(), /空白/);
    assert.match(changed((b) => (b.race_date = "2026-11-02")).join(), /前日/);
    assert.match(changed((b) => (b.pages.result.sec = 30)).join(), /尺/);
    assert.match(changed((b) => (b.pages.hook.sec = 4.5)).join(), /1コマ目/);
    assert.match(changed((b) => delete b.pages.table).join(), /声の table/);
    // 値を変えて作り直した bundle（buildBundle）は通るが、禁止語の入った決まり手は通らない
    const b2 = clone(SAMPLE);
    b2.technique = "必ず当たる";
    assert.match(check(b2).join(), /決まり手/);
  });
  test("検査: 文の型に禁止語・射幸心・次の予想・因果の語が入れば止める（作った文は全部通る）", () => {
    const b = clone(SAMPLE);
    // 型の外の文を通さないことは上で見た。ここでは型の文そのものに禁止語が無いこと（risk-rules とこの型の語）
    assert.deepEqual(check(b), []);
    for (const w of [
      "万舟",
      "儲か",
      "稼げる",
      "狙い",
      "予想",
      "買い目",
      "だから",
      "競艇",
    ]) {
      const t = clone(SAMPLE);
      t.boats[0].racer = `岩下${w}`;
      t.texts = screensOf(t);
      t.youtube = { ...t.youtube, title: titleOf(t) };
      assert.ok(
        check(t).some((r) => /禁止/.test(r)),
        w,
      );
    }
  });
}

function upw2Scene2() {
  test("1日の数から作り直す: buildBundle は日ごとの数が欠けていれば投げ、そろえば見本と同じ bundle を作る", () => {
    const raceRow = raceOfSample();
    const rebuilt = buildBundle({
      race: raceRow,
      days: SAMPLE.year.days,
      date: SAMPLE.date,
      asOf: SAMPLE.as_of,
      sendTime: SAMPLE.send_time,
    });
    for (const k of [
      "texts",
      "voice",
      "youtube",
      "start_time",
      "series_day",
      "is_final_day",
      "race_title",
      "year",
      "weaknesses",
      "primary",
      "hook_metrics",
      "table_metrics",
    ])
      assert.deepEqual(rebuilt[k], SAMPLE[k], k);
    assert.throws(
      () =>
        buildBundle({
          race: raceRow,
          days: {},
          date: SAMPLE.date,
          asOf: SAMPLE.as_of,
        }),
      /そろっていない/,
    );
    assert.deepEqual(weaknessesOf(raceRow), ["win_rate", "exhibition_time"]);
  });
  test("章の秒: 1コマ目は3秒（声が長ければ声＋0.3秒）、合計が25秒に満たなければ2・3コマ目を延ばす", () => {
    const p = pageSeconds({ hook: 2.5, table: 5, result: 10 });
    assert.equal(p.hook, 3);
    assert.ok(Math.abs(p.hook + p.table + p.result - 25) < 0.02);
    const q = pageSeconds({ hook: 3.5, table: 7, result: 14 });
    assert.equal(q.hook, 3.8);
    assert.ok(q.hook + q.table + q.result > 25);
  });
  // ---------- 送る口（PGlite） ----------

  db = new PGlite();
  before(async () => {
    await db.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
    );
    await db.exec(
      "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
    );
    await db.exec(
      "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
    );
    await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);
    CREATE TABLE race_entries(race_id VARCHAR, is_absent BOOLEAN);
    CREATE TABLE exhibition_data(race_id VARCHAR, is_absent BOOLEAN);`);
    const sqlFiles = [...BASE_FILES, MIGRATION];
    for (const [i, sqlFile] of sqlFiles.entries()) {
      const guardOf = GUARDS[sqlFile];
      await db.exec(
        guardOf
          ? await guardedForTest(sqlFile, sqlFiles.slice(0, i), guardOf[0], guardOf[1])
          : forTest(await sqlOf(sqlFile)),
      );
    }
  });
  beforeEach(async () => {
    await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=false, research_image_enabled=false, today_thinking_enabled=false,
      setsu_kiryoku_short_enabled=false, setsu_kiryoku_enabled=false, upset_win_short_enabled=(channel='youtube');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=9, daily_limit_youtube=10,
      daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000,
      reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;
    UPDATE sns_youtube_quota_control SET verified=true, upload_limit=100, general_limit=10000, external_uploads=0, external_general=0;`);
    await setClock(PUSHED_AT);
    saved.length = 0;
    upwState.dbRace = raceOfSample();
  });
  after(() => db.close());
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・GUARDS・sqlOf・forTest・guardedForTest・SAMPLE・PUSHED_AT・check・clone・raceOfSample） */
export function runUpsetWinScenes3(env) {
  ({ BASE_FILES, MIGRATION, GUARDS, sqlOf, forTest, guardedForTest, SAMPLE, PUSHED_AT, check, clone, raceOfSample } = env);
  upw2Scene1();
  upw2Scene2();
}
