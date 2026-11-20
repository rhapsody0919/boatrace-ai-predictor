/**
 * verify-sns-today-plan.js の後半の場面（2/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { raceDbOf, digestOf } from "./sns-today-plan-scenes-1.js";

let db, all, t, at, shooter, plan, approve;

function scene1() {
  test("一覧の読み取り: /today の投稿は選手名・枠番を足して読み、ボット向け HTML の読み取りは選手の値を取らないまま", async () => {
    const { createTodayDigestSource } =
      await import("../../../api/_lib/snsTodayDigest.js");
    const { createDigestSource } = await import("../../../api/_lib/botToday.js");
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(decodeURIComponent(String(url)));
      return Response.json(String(url).includes("morning_digest_days") ? [] : []);
    };
    const env = { SUPABASE_URL: "https://db", SUPABASE_ANON_KEY: "anon" };
    await createTodayDigestSource({ fetchImpl, env })(DATE);
    await createDigestSource({ fetchImpl, env })(DATE);
    const rows = urls.filter((u) => u.includes("morning_digest_rows"));
    assert.match(
      rows[0],
      // course は逃がしの2号艇・3号艇を分けるためにボット向けの ROW_SELECT に足した（2037-10-15）
      /select=section,rank,race_id,venue_code,race_number,start_time,course,reason:detail->>reason,racer_name,boat_number,sample_size,metric_value,metric_venue_baseline,from:detail->>from&/,
    );
    assert.ok(!rows[1].includes("racer_name"));
  });
  test("欠場・中止・締切を確かめられない候補は除き、区分の上限まで後ろの rank から補う", async () => {
    await plan({
      raceDb: raceDbOf({
        absent: [`${DATE}-04-03:1`],
        cancelled: [`${DATE}-02-05`],
        missing: [`${DATE}-04-05`],
      }),
    });
    const [draft] = await all("SELECT * FROM sns_drafts");
    for (const gone of ["逃げ 3｜", "逃げ 5｜", "まくり 1｜"])
      assert.ok(!draft.caption_text.includes(gone), gone);
    // 逃げは 2位・6位・7位（13:00）、まくりは 3位・4位
    assert.ok(
      draft.caption_text.includes(
        "［逃げ］平和島6R 17:15締切｜1号艇 逃げ 6｜全国40走",
      ),
      draft.caption_text,
    );
    assert.ok(
      draft.caption_text.includes(
        "［まくり］戸田8R 19:15締切｜2号艇 まくり 4｜全国40走",
      ),
    );
    assert.equal(draft.source_data.digest.picks.length, 6);
  });
  test("区分が1つだけの日も印の意味を書き、印を付ける（割合は一覧のしきい値）。候補が0件の日は下書きを作らず送らない", async () => {
    const onlyNige = digestOf();
    onlyNige.rows = onlyNige.rows.filter(
      (r) => r.section !== "makuri" && r.section !== "featured",
    );
    onlyNige.day.notes = { thresholds: { nige: 72, makuri: 25 } };
    await plan({ digest: onlyNige });
    const [draft] = await all("SELECT * FROM sns_drafts");
    assert.ok(
      draft.caption_text.includes(
        "\n\n［逃げ］全国で1コースに入ったとき逃げ切った割合72%以上の1号艇\n\n［逃げ］平和島3R 14:15締切｜1号艇 逃げ 3｜全国40走\n［逃げ］平和島5R 15:15締切｜1号艇 逃げ 5｜全国40走\n［逃げ］平和島2R 16:15締切｜1号艇 逃げ 2｜全国40走\n\n過去の実績は",
      ),
      draft.caption_text,
    );
    assert.ok(!draft.caption_text.includes("まくり"));

    await db.exec(
      "DELETE FROM sns_post_tracking; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
    );
    const none = digestOf();
    // 一覧の候補が全員30走未満で、注目レースも無い日
    none.rows = none.rows
      .filter((r) => r.section !== "featured")
      .map((r) => ({ ...r, sample_size: 29 }));
    const notes = [];
    const result = await plan({ digest: none, notes });
    assert.equal(result.report.items[0].reason, "no_candidates");
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    assert.equal(notes.length, 0);
  });
}

function scene2() {
  test("注目レース: 先頭に置き一覧に重ねない。逃がしからの注目・7:00 より前・欠場の注目は載せない", async () => {
    const { buildTodayPost } = await import("../../lib/snsTodayPlanner.js");
    const url = "https://www.boat-ai.jp/today";
    const build = (mutate, excluded = new Set()) => {
      const digest = digestOf();
      const featured = digest.rows.find((r) => r.section === "featured");
      mutate(featured, digest);
      return buildTodayPost(digest, { date: DATE, t, url, excluded });
    };
    // 一覧の逃げ3位と同じ選手が注目なら、一覧からは外して次の順位で補う
    const same = build((f) =>
      Object.assign(f, {
        race_id: `${DATE}-04-03`,
        race_number: 3,
        start_time: "14:15:00",
        racer_name: "逃げ\u30003",
      }),
    );
    assert.match(same.text, /注目レース：平和島3R 14:15締切｜1号艇 逃げ 3｜/);
    assert.equal(same.text.split("逃げ 3｜").length - 1, 1);
    assert.match(same.text, /［逃げ］平和島6R 17:15締切｜1号艇 逃げ 6｜/);
    // まくりからの注目は、まくりの言い方
    const makuri = build((f) =>
      Object.assign(f, {
        from: "makuri",
        course: 3,
        boat_number: 3,
        metric_value: "30.00",
      }),
    );
    assert.match(
      makuri.text,
      /｜3号艇 注目 1｜3コースでまくりで1着の割合 30%（全国63走）/,
    );
    for (const text of [
      build((f) => Object.assign(f, { from: "nigashi" })).text,
      build((f) => Object.assign(f, { start_time: "06:55:00" })).text,
      build(() => {}, new Set([`${DATE}-04-12:1`])).text,
      build((f, d) => {
        d.rows = d.rows.filter((r) => r !== f);
      }).text,
    ])
      assert.ok(!text.includes("注目レース"), text);
    // 一覧が0件でも、注目レースがあれば送る
    const onlyFeatured = build((f, d) => {
      d.rows = d.rows.filter((r) => r === f || r.section === "flying");
    });
    assert.match(
      onlyFeatured.text,
      /^本日のデータ一覧（[^\n]+）\n\n今日の一覧はこちら：[^\n]+\n\n注目レース：[^\n]+\n\n過去の実績[^\n]+$/,
    );
    assert.deepEqual(onlyFeatured.picks, [
      { race_id: `${DATE}-04-12`, boat_number: 1 },
    ]);
  });
  test("龍神ソナーの図がそろわないうちは 7:30 までやり直し、7:30 を過ぎたら撮れた分で作る", async () => {
    const saved = [];
    const notReady = [`${DATE}-02-05`];
    await assert.rejects(
      plan({ now: at("07:00"), headless: shooter({ notReady }), saved }),
      /sonar_not_ready（2037-10-17-02-05: screenshot_component_missing）/,
    );
    assert.equal(saved.length, 0);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    await plan({ now: at("07:35"), headless: shooter({ notReady }), saved });
    const [draft] = await all("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.image_paths.length, 3);
    // 本人の承認（160）は3枚の媒体で通る
    const job = await approve(draft);
    assert.equal(job.snapshot.media.length, 3);
    assert.ok(job.snapshot.media.every((m) => m.type === "image/png"));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・t・at・shooter・plan・approve） */
export function runSnsTodayPlanScenes5(env) {
  ({ db, all, t, at, shooter, plan, approve } = env);
  scene1();
  scene2();
}

function scene3() {
  test("各回の結果をその日の分だけ cursor に残す（送る時刻を過ぎても朝の経過を読める）。時間外は残さず、日付が変わったら空から、最新30件", async () => {
    const { nextTodayLog } = await import("../../lib/snsTodayPlanner.js");
    let log = nextTodayLog(
      null,
      { outcome: "error", reason: "sonar_not_ready（x）" },
      at("06:50"),
    );
    log = nextTodayLog(log, { outcome: "manual", item_id: "i1" }, at("07:35"));
    log = nextTodayLog(
      log,
      { outcome: "skipped", reason: "outside_window" },
      at("08:10"),
    );
    assert.deepEqual(log, {
      date: DATE,
      events: [
        {
          at: at("06:50").toISOString(),
          outcome: "error",
          reason: "sonar_not_ready（x）",
        },
        { at: at("07:35").toISOString(), outcome: "manual", reason: null },
      ],
    });
    const next = nextTodayLog(
      log,
      { outcome: "error", reason: "x" },
      new Date(at("06:50").getTime() + 86400000),
    );
    assert.equal(next.events.length, 1);
    let many = null;
    for (let i = 0; i < 35; i++)
      many = nextTodayLog(
        many,
        { outcome: "error", reason: String(i) },
        at("06:50"),
      );
    assert.equal(many.events.length, 30);
    assert.equal(many.events.at(-1).reason, "34");
  });
  test("確認用の作り直しが3回続けて失敗したら、Slack に1回知らせてやめる。理由はブラウザのログを除いた1行ずつ（2026-10-17 夜、届かずに5分ごとに失敗し続けた）", async () => {
    const { finishTodayLog, isTodayRebuild, REBUILD_MAX_FAILURES } =
      await import("../../lib/snsTodayPlanner.js");
    assert.equal(REBUILD_MAX_FAILURES, 3);
    // 作り直しは、その日の分で送る時刻を過ぎた後だけ
    assert.equal(isTodayRebuild(DATE, at("19:25")), true);
    assert.equal(isTodayRebuild(DATE, at("06:40")), false);
    assert.equal(isTodayRebuild("2037-10-16", at("19:25")), false);
    assert.equal(isTodayRebuild(null, at("19:25")), false);
    const crash = {
      outcome: "error",
      reason: `sonar_not_ready（${DATE}-04-07: browserContext.newPage: Target page, context or browser has been closed\nBrowser logs:\n\n<launching> /tmp/chromium ${"--flag ".repeat(80)} / ${DATE}-10-04: browser.newContext: Target page, context or browser has been closed）`,
    };
    let log = { date: DATE, events: [], missed_notified: true };
    const results = [];
    for (const hhmm of ["20:25", "20:30", "20:35"]) {
      const r = finishTodayLog(log, crash, at(hhmm), { rebuilding: true });
      results.push(r);
      log = r.log;
    }
    assert.deepEqual(
      results.map((r) => [r.giveUp, r.notice === null]),
      [
        [false, true],
        [false, true],
        [true, false],
      ],
    );
    assert.match(
      results[2].notice,
      /確認用の作り直しが3回続けて失敗したので、やめた/,
    );
    // 理由はブラウザのログを含まず、2レース分が残る
    const reason = log.events.at(-1).reason;
    assert.doesNotMatch(reason, /Browser logs|launching/);
    assert.match(reason, new RegExp(`${DATE}-10-04: browser.newContext`));
    assert.ok(reason.length < 400, reason.length);
    // 知らせた後は数え直し、朝の「作れなかった」の印は残す
    assert.equal(log.rebuild_failures, undefined);
    assert.equal(log.missed_notified, true);
    // 作り直しでない回の失敗は数えない
    assert.equal(
      finishTodayLog(null, crash, at("06:40")).log.rebuild_failures,
      undefined,
    );
  });
}

function scene4() {
  test("下書きを作れずに 8:00 を過ぎたら、理由つきで Slack に1回だけ知らせる文を出す。下書きがあれば出さない（2026-10-17 黙って終わった件）", async () => {
    const { finishTodayLog, nextTodayLog } =
      await import("../../lib/snsTodayPlanner.js");
    // 朝は図がそろわずやり直し続け、7:45 を過ぎた
    let log = nextTodayLog(
      null,
      {
        outcome: "error",
        reason:
          "sonar_not_ready（2037-10-17-04-07: screenshot_component_missing）",
      },
      at("07:20"),
    );
    const late = (await plan({ now: at("08:05") })).report.items[0];
    assert.equal(late.outcome, "missed");
    const first = finishTodayLog(log, late, at("08:05"));
    assert.match(
      first.notice,
      /SNS \/today（2037-10-17）: 08:00 までに下書きを作れなかった。今日は送らない/,
    );
    assert.match(
      first.notice,
      /最後の結果（07:20）: error sonar_not_ready（2037-10-17-04-07: screenshot_component_missing）（朝の記録 1件）/,
    );
    // 知らせた後（missed_notified を保存）は、その日はもう出さない。次の日は改めて出す
    first.log.missed_notified = true;
    const again = finishTodayLog(first.log, late, at("08:10"));
    assert.equal(again.notice, null);
    assert.equal(again.log.missed_notified, true);
    const nextDay = finishTodayLog(
      again.log,
      late,
      new Date(at("08:05").getTime() + 86400000),
    );
    assert.match(nextDay.notice, /朝の実行が一度も最後まで終わっていない/);
    // 朝の記録が無い（関数の時間切れで何も残らない）日も、その旨を出す
    assert.match(
      finishTodayLog(null, late, at("08:05")).notice,
      /関数の時間切れなど/,
    );
    // 下書きがあれば missed にならず、何も出さない
    await plan({ now: at("06:50") });
    const ok = (await plan({ now: at("08:05") })).report.items[0];
    assert.equal(ok.reason, "outside_window");
    assert.equal(finishTodayLog(null, ok, at("08:05")).notice, null);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・all・t・at・shooter・plan・approve） */
export function runSnsTodayPlanScenes6(env) {
  ({ db, all, t, at, shooter, plan, approve } = env);
  scene3();
  scene4();
}
