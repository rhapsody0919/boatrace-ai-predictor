/**
 * verify-sns-setsu-kiryoku-x.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-x.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { SETSU_TYPE, checkResearchBundle } from "../../sns/push-research-image.js";
import { HQ_KIND } from "../../sns/x-slots-check.js";
import { SLOT_KINDS } from "../../lib/snsXSlots.js";

let BASE_FILES, MIGRATION, MD5_193, sqlOf, forTest, guardedForTest, GUARDS, db, first, riskRules, DAY, at, bundle, setClock, push, transition;

function scene1() {
  test("本番の取り置き（2026-11-02: digest1・finals3・research1 月水金・today_thinking6、上限11）: setsu の行なしだと月水金の 21:30 は kind_slot_full。オーナーの SQL（上限12・setsu 1）の後は送れる", async () => {
    // 2037-11-04 は水曜（JST）
    const WED = "2037-11-04";
    const reserves = async (limit, withSetsu) => {
      await db.exec(`DELETE FROM sns_x_kind_reserves;
      INSERT INTO sns_x_kind_reserves(kind, daily_count, weekdays) VALUES ('digest',1,NULL),('finals_image',3,NULL),('full_picture',0,NULL),
        ('research_image',1,'{1,3,5}'),('today_thinking',6,NULL)${withSetsu ? ",('setsu_kiryoku',1,NULL)" : ""};
      UPDATE sns_x_send_control SET daily_limit_x=${limit};`);
    };
    const run = async () => {
      await db.exec(
        "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;",
      );
      await db.exec(
        "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
      );
      await setClock(at("21:05:00", WED));
      const result = await push(
        bundle({ date: WED, source_observed_at: `${WED} 11R まで` }),
        {
          now: at("21:05:00", WED),
        },
      );
      assert.ok(result.job_id, JSON.stringify(result));
      await setClock(at("21:30:00", WED));
      return transition(result.job_id, "claim");
    };
    await reserves(11, false);
    const held = await run();
    assert.deepEqual([held.state, held.error_code], ["held", "kind_slot_full"]);
    await reserves(12, true);
    assert.equal((await run()).state, "sending");
    // 月水金以外（木曜）の取り置きの合計は11で、上限12に1の空きが残る
    const room = await first(
      "SELECT public.sns_x_slot_room('setsu_kiryoku', 1, true, NULL, NULL) r",
    );
    assert.equal(room.r.reserved_total, 12);
    await setClock(at("21:05:00", "2037-11-05"));
    const thu = await first(
      "SELECT public.sns_x_slot_room('setsu_kiryoku', 1, true, NULL, NULL) r",
    );
    assert.equal(thu.r.reserved_total, 11);
  });
  test("X の日の枠: hq の出し物の名前 setsu_kiryoku と取り込みの出し物は kind setsu_kiryoku", () => {
    assert.equal(HQ_KIND.setsu_kiryoku, "setsu_kiryoku");
    assert.equal(SLOT_KINDS.setsuKiryoku, "setsu_kiryoku");
    assert.equal(SETSU_TYPE.kind, "setsu_kiryoku");
  });
  test("hq 33bd771 の形: source_observed_at は時差つき ISO、as_of は別の欄。ISO の時刻で鮮度を見る（古ければ拒む）、as_of は下書きに残す", async () => {
    const b = bundle({
      source_observed_at: at("21:02:00").toISOString().replace("Z", "+00:00"),
      as_of: `${DAY} 11R まで`,
    });
    assert.deepEqual(checkResearchBundle(b, riskRules, SETSU_TYPE), []);
    const result = await push(b);
    assert.ok(result.job_id, JSON.stringify(result));
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.setsu_kiryoku.as_of, `${DAY} 11R まで`);
    assert.equal(
      Date.parse(draft.source_data.deadline_queue.source_observed_at),
      at("21:02:00").getTime(),
    );
    // 集計の時刻が送る時刻の期限（22:30）より24時間以上前なら拒む（前の日の 22:00 に作った束）
    const stale = await push(
      bundle({
        slug: "v04-motor-gap",
        images: ["v04-motor-gap.png"],
        source_observed_at: "2037-11-02T22:00:00+09:00",
        as_of: `${DAY} 11R まで`,
      }),
    );
    assert.match(stale.reasons.join(), /source_observed_at が古い/);
    // 集計の時刻が今より後なら拒む
    const future = await push(
      bundle({ source_observed_at: "2037-11-03T21:10:00+09:00" }),
    );
    assert.match(future.reasons.join(), /今より後/);
  });
}

function scene2() {
  test("当てる順: 193 の前に 194 を当てると先頭の照合で止まり、全体が戻る（kind・列・索引は増えない）", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(
        "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
      );
      await pg.exec(
        "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
      );
      await pg.exec(
        "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
      );
      await pg.exec(`
      CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
      CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);`);
      const upTo189 = BASE_FILES.slice(0, -1);
      for (const [i, file] of upTo189.entries()) {
        const guard = GUARDS[file];
        await pg.exec(
          guard
            ? await guardedForTest(file, upTo189.slice(0, i), guard[0], guard[1])
            : forTest(await sqlOf(file)),
        );
      }
      // 194 の照合は試験の 193 の本文の md5 に差し替える（本番と同じく、189 の本文では一致しない）
      await assert.rejects(
        pg.exec(
          await guardedForTest(
            MIGRATION,
            BASE_FILES,
            "transition_sns_send_139",
            MD5_193,
          ),
        ),
        /194: transition_sns_send_139 の本文が 193 でない/,
      );
      await pg.exec("ROLLBACK").catch(() => {});
      const one = async (sql) => (await pg.query(sql)).rows[0];
      assert.equal(
        (
          await one(
            "SELECT count(*)::int n FROM pg_attribute WHERE attrelid='public.sns_auto_send_control'::regclass AND attname='setsu_kiryoku_enabled' AND NOT attisdropped",
          )
        ).n,
        0,
      );
      assert.equal(
        (
          await one(
            "SELECT count(*)::int n FROM pg_indexes WHERE indexname='sns_auto_send_items_setsu_x_day'",
          )
        ).n,
        0,
      );
      assert.doesNotMatch(
        (
          await one(
            "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='sns_auto_send_items_kind_check'",
          )
        ).d,
        /setsu_kiryoku/,
      );
    } finally {
      await pg.close();
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MD5_193・sqlOf・forTest・guardedForTest・GUARDS・db・first・riskRules・DAY・at・bundle・setClock・push・transition） */
export function runSnsSetsuKiryokuXScenes3(env) {
  ({ BASE_FILES, MIGRATION, MD5_193, sqlOf, forTest, guardedForTest, GUARDS, db, first, riskRules, DAY, at, bundle, setClock, push, transition } = env);
  scene1();
  scene2();
}
