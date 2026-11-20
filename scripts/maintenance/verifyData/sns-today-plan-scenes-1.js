/**
 * verify-sns-today-plan.js の後半の場面（1/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { createTodayStore } from "../../lib/snsTodayPlanner.js";

let first, all, at, sqlStore, shooter, plan, approve;

// 逃げ: 1位は 6:45 締切（送る 7:00 より前）、4位は全国29走（30走未満）で載せない。2・3・5位を載せる。
// まくり: 1位と2位は同じレース（区分の中は最初の行だけ）、3位を載せて2人まで。逃がし・注目・フライング・帰郷は載せない
const NIGE_TIME = {
  1: "06:45:00",
  2: "16:15:00",
  3: "14:15:00",
  4: "13:45:00",
  5: "15:15:00",
};

export const digestOf = (count = 25, prefix = "逃げ") => ({
  day: {
    generated_at: `${DATE}T05:30:27Z`,
    venue_count: 13,
    race_count: 156,
    notes: {},
  },
  rows: [
    {
      section: "featured",
      rank: 1,
      race_id: `${DATE}-04-12`,
      venue_code: 4,
      race_number: 12,
      start_time: "20:35:00",
      reason: "AIが当日条件から算出したイン崩れ指数は…",
      from: "nige",
      course: 1,
      boat_number: 1,
      racer_name: "注目\u30001",
      metric_value: "84.13",
      metric_venue_baseline: "58.40",
      sample_size: 63,
    },
    ...Array.from({ length: count }, (_, i) => ({
      section: "nige",
      rank: i + 1,
      race_id: `${DATE}-04-${String(i + 1).padStart(2, "0")}`,
      venue_code: 4,
      race_number: i + 1,
      start_time: NIGE_TIME[i + 1] ?? "17:15:00",
      racer_name: `${prefix}\u3000${i + 1}`,
      boat_number: 1,
      sample_size: i === 3 ? 29 : 40,
    })).reverse(),
    {
      section: "makuri",
      rank: 1,
      race_id: `${DATE}-02-05`,
      venue_code: 2,
      race_number: 5,
      start_time: "13:15:00",
      racer_name: "まくり\u30001",
      boat_number: 3,
      sample_size: 31,
    },
    {
      section: "makuri",
      rank: 2,
      race_id: `${DATE}-02-05`,
      venue_code: 2,
      race_number: 5,
      start_time: "13:15:00",
      racer_name: "まくり\u30002",
      boat_number: 4,
      sample_size: 35,
    },
    {
      section: "makuri",
      rank: 3,
      race_id: `${DATE}-02-07`,
      venue_code: 2,
      race_number: 7,
      start_time: "18:15:00",
      racer_name: "まくり\u30003",
      boat_number: 2,
      sample_size: 33,
    },
    {
      section: "makuri",
      rank: 4,
      race_id: `${DATE}-02-08`,
      venue_code: 2,
      race_number: 8,
      start_time: "19:15:00",
      racer_name: "まくり\u30004",
      boat_number: 2,
      sample_size: 40,
    },
    {
      section: "nigashi",
      rank: 1,
      race_id: `${DATE}-12-03`,
      venue_code: 12,
      race_number: 3,
      start_time: "20:25:00",
      racer_name: "逃がし\u30001",
      boat_number: 5,
      sample_size: 50,
    },
    { section: "flying", rank: 1, racer_name: "フライング1" },
    { section: "returned", rank: 1, racer_name: "帰郷1" },
  ],
});

export const FEATURED_LINE =
  "注目レース：平和島12R 20:35締切｜1号艇 注目 1｜1コースで逃げ切った割合 84.13%（全国63走）・この会場の平均 58.4%";

// 出走表・中止の読み取り（PostgREST の形）。absent は "race_id:艇番"、cancelled は race_id
export function raceDbOf({ absent = [], cancelled = [], missing = [] } = {}) {
  return async (path) => {
    const ids = decodeURIComponent(path)
      .match(/in\.\(([^)]*)\)/)[1]
      .split(",")
      .map((x) => x.replaceAll('"', ""));
    if (path.startsWith("races"))
      return ids
        .filter((id) => !missing.includes(id))
        .map((race_id) => ({
          race_id,
          start_time: "14:15:00",
          cancellation_status: cancelled.includes(race_id) ? "confirmed" : null,
        }));
    return absent
      .map((key) => key.split(":"))
      .filter(([id]) => ids.includes(id))
      .map(([race_id, boat]) => ({
        race_id,
        boat_number: Number(boat),
        is_absent: true,
      }));
  };
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・at・sqlStore・shooter・plan・approve） */
export function runSnsTodayPlanScenes1(env) {
  ({ first, all, at, sqlStore, shooter, plan, approve } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・at・sqlStore・shooter・plan・approve） */
export function runSnsTodayPlanScenes2(env) {
  ({ first, all, at, sqlStore, shooter, plan, approve } = env);

}

function scene1() {
  test("同じ一覧でもう一度走らせても何も書かない。一覧がやり直されたら撮り直し、承認を外して知らせる", async () => {
    await plan();
    const [before] = await all("SELECT * FROM sns_drafts");
    const job = await approve(before);
    const notes = [];
    const again = await plan({ now: at("06:50"), notes });
    assert.equal(again.report.items[0].outcome, "unchanged");
    assert.equal(notes.length, 0);
    const rebuilt = await plan({ now: at("07:10"), digest: digestOf(24), notes });
    assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
    const [after] = await all("SELECT * FROM sns_drafts");
    assert.equal(after.id, before.id);
    assert.notEqual(
      after.source_data.digest.revision,
      before.source_data.digest.revision,
    );
    assert.equal(
      after.source_data.deadline_queue.source_revision,
      after.source_data.digest.revision,
    );
    assert.equal(after.status, "pending_review");
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
        .state,
      "cancelled",
    );
    assert.match(notes[0], /承認し直して/);
    assert.equal(
      (await all("SELECT * FROM sns_auto_send_items"))[0].state,
      "manual",
    );
  });
  test("6:30 より前・一覧が未公開は何もしない。8:00 以降に下書きが無ければ missed。shadow は撮らず書かない", async () => {
    assert.equal(
      (await plan({ now: at("06:29") })).report.items[0].reason,
      "outside_window",
    );
    assert.deepEqual(
      (({ outcome, reason }) => ({ outcome, reason }))(
        (await plan({ now: at("08:00") })).report.items[0],
      ),
      { outcome: "missed", reason: "no_draft_by_send_time" },
    );
    assert.equal(
      (await plan({ digest: { day: { generated_at: null }, rows: [] } })).report
        .items[0].reason,
      "not_generated",
    );
    const headless = shooter();
    const notes = [];
    const shadow = await plan({ mode: "shadow", headless, notes });
    assert.equal(shadow.report.items[0].outcome, "manual");
    assert.equal(headless.calls.length, 0);
    assert.equal(notes.length, 0);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  });
  test("撮れなければ何も書かずに投げる（次の5分でやり直す）", async () => {
    const saved = [];
    await assert.rejects(
      plan({ headless: shooter({ fail: true }), saved }),
      /sonar_not_ready/,
    );
    await assert.rejects(
      plan({ headless: shooter({ todayMissing: true }), saved }),
      /today_page_not_ready/,
    );
    assert.equal(saved.length, 0);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
    assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
  });
  test("本文に禁止表現があれば held_manual。その後に一覧が変わっても作り直さない", async () => {
    const notes = [];
    await plan({ digest: digestOf(25, "競艇"), notes });
    const [item] = await all("SELECT * FROM sns_auto_send_items");
    assert.equal(item.state, "held_manual");
    assert.match(item.held_reason, /禁止表現/);
    assert.match(notes[0], /禁止表現があり、止めた/);
    const again = await plan({
      now: at("07:10"),
      digest: digestOf(24, "競艇"),
    });
    assert.equal(again.report.items[0].reason, "item_held_manual");
  });
}

function scene2() {
  test("PostgREST の store: 今日の下書き・item の引き方、承認済みも書き換える条件、失敗は投げる", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({
        url: decodeURIComponent(String(url)),
        method: options.method ?? "GET",
      });
      if (String(url).includes("fail")) return new Response("", { status: 500 });
      if (options.method === "PATCH" && String(url).includes("none"))
        return new Response("[]");
      return new Response(JSON.stringify([{ id: "1" }]));
    };
    const store = createTodayStore({ url: "https://db", key: "k", fetchImpl });
    await store.todayState(DATE);
    assert.ok(
      calls.some((c) =>
        c.url.includes(
          `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${DATE}`,
        ),
      ),
    );
    assert.ok(
      calls.some((c) =>
        c.url.includes(
          `sns_auto_send_items?kind=eq.digest&race_id=in.("today:${DATE}","today:${DATE}:reply")`,
        ),
      ),
    );
    // 型の列（174）はその日の1行
    await store.typeSchedule(DATE);
    assert.ok(
      calls
        .at(-1)
        .url.endsWith(
          `sns_today_type_schedule?day=eq.${DATE}&select=day,type_id,post`,
        ),
    );
    await store.updateTodayDraft("d1", {});
    assert.ok(
      calls
        .at(-1)
        .url.endsWith("sns_drafts?id=eq.d1&status=in.(pending_review,approved)"),
    );
    await assert.rejects(store.updateTodayDraft("none", {}), /書き換えられない/);
    await assert.rejects(
      createTodayStore({ url: "https://fail", key: "k", fetchImpl }).todayState(
        DATE,
      ),
      /HTTP 500/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・at・sqlStore・shooter・plan・approve） */
export function runSnsTodayPlanScenes3(env) {
  ({ first, all, at, sqlStore, shooter, plan, approve } = env);
  scene1();
  scene2();
}

function scene3() {
  test("下書きを作った後に item の作成で落ちても、次の実行で item を作る（同じ版でも「変化なし」で止まらない）", async () => {
    const insertItem = sqlStore.insertItem;
    sqlStore.insertItem = async () => {
      throw new Error("item を作れない");
    };
    await assert.rejects(plan(), /item を作れない/);
    sqlStore.insertItem = insertItem;
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
    assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
    const again = await plan({ now: at("06:45") });
    assert.equal(again.report.items[0].outcome, "manual");
    const [item] = await all("SELECT * FROM sns_auto_send_items");
    assert.equal(item.state, "manual");
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・at・sqlStore・shooter・plan・approve） */
export function runSnsTodayPlanScenes4(env) {
  ({ first, all, at, sqlStore, shooter, plan, approve } = env);
  scene3();
}
