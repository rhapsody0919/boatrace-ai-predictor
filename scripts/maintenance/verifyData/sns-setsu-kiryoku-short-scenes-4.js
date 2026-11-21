/**
 * verify-sns-setsu-kiryoku-short.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-setsu-kiryoku-short.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkShortBundle,
  descriptionLink,
  mp4Info,
  checkVideo,
  youtubeRoomReason,
  resultLine,
  pushSetsuKiryokuShort,
} from "../../sns/push-setsu-kiryoku-short.js";
import { venueCodeOf, parseSetsuId } from "../../../api/_lib/snsSetsuKiryokuShort.js";
import { push, counts, NOTHING, store } from "./sns-setsu-kiryoku-short-scenes-1.js";

let db, first, all, riskRules, SAMPLE, DAY, at, PUSHED_AT, SETSU_ID, mp4, VIDEO, bundle;

/** test("検査: 型の検査（checkBundle）をもう一度通す（禁止語・言い切り・数の照合・級・date と final_date）。 の中身を割った 1/2 */
function skstA1() {
  assert.deepEqual(checkShortBundle(bundle(), riskRules), []);
  const reasonsOf = (patch) => checkShortBundle(bundle(patch), riskRules);
  const yt = (p) => ({ youtube: { ...SAMPLE.youtube, ...p } });
  // 型の検査
  assert.ok(
    reasonsOf(yt({ title: "必ず当たるモーター #Shorts" })).some((x) =>
      x.includes("禁止表現"),
    ),
  );
  assert.ok(
    reasonsOf(yt({ title: "足が良いモーター #Shorts" })).some((x) =>
      x.includes("言い切り"),
    ),
  );
  assert.ok(
    reasonsOf({ hero: { ...SAMPLE.hero, class: undefined } }).some((x) =>
      x.includes("級"),
    ),
  );
  assert.ok(
    reasonsOf({ final_date: "2037-11-02" }).some((x) =>
      x.includes("final_date"),
    ),
  );
  assert.ok(
    reasonsOf({
      hero: {
        ...SAMPLE.hero,
        motor_2rate: { ...SAMPLE.hero.motor_2rate, rank_from_bottom: 3 },
      },
    }).some((x) => x.includes("rank_from_bottom")),
  );
  // この口の検査
  assert.ok(reasonsOf({ venue: "尼ケ崎" }).some((x) => x.includes("24場")));
  assert.ok(
    reasonsOf(yt({ title: "2連率\nの話 #Shorts" })).some((x) =>
      x.includes("改行"),
    ),
  );
  assert.ok(
    reasonsOf(yt({ title: "あ".repeat(101) })).some((x) => x.includes("100字")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: `${SAMPLE.youtube.description}\n${"あ".repeat(1700)}`,
      }),
    ).some((x) => x.includes("5000バイト")),
  );
  assert.ok(
    reasonsOf(yt({ description: `${SAMPLE.youtube.description} <b>` })).some(
      (x) => x.includes("< >"),
    ),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: SAMPLE.youtube.description.replace(
          "/venue/13",
          "/venue/12",
        ),
      }),
    ).some((x) => x.includes("この会場のページ")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: `${SAMPLE.youtube.description}\nhttps://www.boat-ai.jp/today`,
      }),
    ).some((x) => x.includes("ちょうど1つ")),
  );
  assert.ok(
    reasonsOf(
      yt({
        description: SAMPLE.youtube.description.replace(
          "utm_source=youtube",
          "ref=x",
        ),
      }),
    ).some((x) => x.includes("utm_")),
  );
  assert.ok(reasonsOf({ video: "../x.mp4" }).some((x) => x.includes("video")));
  return { reasonsOf, yt };
}

/** test("検査: 型の検査（checkBundle）をもう一度通す（禁止語・言い切り・数の照合・級・date と final_date）。 の中身を割った 2/2 */
async function skstA2({ reasonsOf, yt }) {
  assert.ok(
    reasonsOf({ source_observed_at: "2037-11-01 21:00" }).some((x) =>
      x.includes("ISO"),
    ),
  );
  assert.deepEqual(
    descriptionLink("https://www.boat-ai.jp/venue/1?utm_source=youtube", "01"),
    { url: "https://www.boat-ai.jp/venue/1", reasons: [] },
  );
  assert.equal(venueCodeOf("尼崎"), "13");
  assert.equal(venueCodeOf("桐生"), "01");
  assert.deepEqual(parseSetsuId(SETSU_ID), { date: DAY, venue: "13" });
  assert.equal(parseSetsuId(`setsu:${DAY}:00`), null);
  // 検査に落ちたら Slack に知らせて何も書かない
  const rejected = await push(bundle(yt({ title: "必ず当たる #Shorts" })));
  assert.ok(rejected.reasons.length);
  assert.equal(rejected.notes.length, 1);
  assert.deepEqual(await counts(), NOTHING);
}

function skst4Scene1() {
  test("検査: 型の検査（checkBundle）をもう一度通す（禁止語・言い切り・数の照合・級・date と final_date）。題・説明欄・リンク・会場の形", async () => {
    const { reasonsOf, yt } = skstA1();
    await skstA2({ reasonsOf, yt });
  });
  test("動画の検査: MP4・縦・60秒まで・32 MiB まで。無い・横・長い・MP4 でないものは受け取らない", async () => {
    assert.deepEqual(mp4Info(VIDEO), {
      ftyp: true,
      width: 1080,
      height: 1920,
      durationSec: 17,
    });
    assert.deepEqual(checkVideo("v.mp4", VIDEO), []);
    assert.ok(
      checkVideo("v.mp4", mp4({ width: 1920, height: 1080 }))[0].includes("縦"),
    );
    // 表示の行列で90度回すものは、見える縦横で判定する
    assert.deepEqual(
      checkVideo("v.mp4", mp4({ width: 1920, height: 1080, rotate: true })),
      [],
    );
    assert.ok(checkVideo("v.mp4", mp4({ rotate: true }))[0].includes("縦"));
    assert.ok(checkVideo("v.mp4", mp4({ seconds: 61 }))[0].includes("60"));
    assert.deepEqual(
      checkVideo("v.mp4", mp4({ seconds: 60 })),
      [],
      "60秒ちょうどは通す",
    );
    assert.ok(checkVideo("v.mp4", new Uint8Array(64))[0].includes("MP4 でない"));
    assert.ok(
      checkVideo("v.mp4", new Uint8Array(32 * 1024 * 1024 + 1))[0].includes(
        "大きさ",
      ),
    );
    assert.ok(checkVideo("v.mp4", null)[0].includes("無い"));
    const none = await push(bundle(), {}, null);
    assert.ok(none.reasons.some((x) => x.includes("final_gap.mp4 が無い")));
    // video の欄で名前を変えられる
    const named = await push(bundle({ video: "short.mp4" }));
    assert.equal(named.reasons, undefined, JSON.stringify(named.reasons));
  });
}

function skst4Scene2() {
  test("YouTube の日の上限とクォータ: ちょうど入る数は通し、1本多ければ受け取らない。まだ claim していない予定も数える", async () => {
    const now = PUSHED_AT;
    const today = "2037-11-01";
    const base = {
      sendControl: {
        daily_limit_youtube: 3,
        daily_baseline_date: today,
        daily_external_count: 0,
      },
      jobs: [
        { attempt_dates: [today, today], attempt_channels: ["youtube", "x"] },
      ],
      queued: [{ scheduled_at: now.toISOString() }],
      quota: {
        verified: true,
        baseline_day: "2037-11-01",
        upload_limit: 100,
        general_limit: 10000,
        external_uploads: 0,
        external_general: 0,
      },
      quotaUsed: { uploads: 0, general: 0 },
      now,
      sendAt: now.toISOString(),
    };
    assert.equal(youtubeRoomReason(base), null, "試行1＋予定1＋この1本＝3");
    assert.match(
      youtubeRoomReason({
        ...base,
        sendControl: { ...base.sendControl, daily_external_count: 1 },
      }),
      /日の上限 3/,
    );
    assert.match(
      youtubeRoomReason({
        ...base,
        sendControl: { ...base.sendControl, daily_baseline_date: "2037-10-31" },
      }),
      /確かめられていない/,
    );
    // クォータ（PT の日。PUSHED_AT は PT の 11/1 05:25）: 予約＋予定の分＋この1本の分
    const q = (general) =>
      youtubeRoomReason({ ...base, quotaUsed: { uploads: 0, general } });
    assert.equal(q(10000 - 104 * 2), null);
    assert.match(q(10000 - 104 * 2 + 1), /クォータ/);
    assert.match(
      youtubeRoomReason({ ...base, quota: { ...base.quota, verified: false } }),
      /確かめられていない/,
    );
    assert.equal(
      youtubeRoomReason({
        ...base,
        quota: { ...base.quota, baseline_day: "2037-10-31" },
        quotaUsed: { uploads: 999, general: 99999 },
      }),
      null,
      "クォータの日の前は数えない（claim が数える）",
    );
    // push の中でも同じ（DB の数）。今日の YouTube の試行で上限が埋まっていれば受け取らない
    await db.exec("UPDATE sns_x_send_control SET daily_limit_youtube=1");
    await db.exec(`WITH d AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text) VALUES(gen_random_uuid(),'youtube','ja','full_picture','x') RETURNING id)
    INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at,channel,attempt_dates,attempt_channels,attempts)
    SELECT d.id,'posted','{}'::jsonb,'{}','h',c.auto_approver_id,test_now(),test_now(),'youtube',ARRAY['${today}'::date],ARRAY['youtube'],1
      FROM d, sns_auto_send_control c WHERE c.channel='youtube'`);
    const full = await push();
    assert.ok(
      full.reasons.some((x) => x.includes("YouTube の日の上限 1")),
      JSON.stringify(full.reasons),
    );
  });
}

function skst4Scene3() {
  test("自動モードでなければ何も書かない（何度入れても下書きを積まない、exit 5）。自動の承認に失敗したら item を held_manual・下書きを公開保留にする。item が入らなければ下書きを公開保留にして投げる", async () => {
    await db.exec("UPDATE sns_auto_send_control SET mode='manual'");
    const manual = await push();
    await push(bundle(), { now: at("21:26:00") });
    assert.equal(manual.manual, true);
    assert.deepEqual(await counts(), NOTHING);
    assert.equal(resultLine(manual, null, { waited: false }).code, 5);
    assert.match(resultLine(manual).text, /mode が auto でない/);
    await db.exec("UPDATE sns_auto_send_control SET mode='auto'");
    // 試運転（dry_run=true）は結果に trial を立てる（CLI は待たない）
    await db.exec("UPDATE sns_auto_send_control SET dry_run=true");
    const trial = await push();
    assert.equal(trial.trial, true);
    await db.exec(
      "DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; UPDATE sns_auto_send_control SET dry_run=false",
    );
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER",
    );
    // item が入らない（並行して入れた束が先に1日1本の索引に入った等）: 下書きを公開保留にして投げる
    const noItem = {
      ...store,
      insertItem: async () => {
        throw new Error("duplicate key value violates unique constraint");
      },
    };
    const g = {
      "/f/bundle.json": new TextEncoder().encode(JSON.stringify(bundle())),
      "/f/final_gap.mp4": VIDEO,
    };
    await assert.rejects(
      pushSetsuKiryokuShort("/f", {
        store: noItem,
        readBytes: async (p) => g[p],
        riskRules,
        now: PUSHED_AT,
      }),
      /duplicate key/,
    );
    assert.equal(
      (await first("SELECT publish_blocked FROM sns_drafts")).publish_blocked,
      true,
    );
    await db.exec(
      "ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER",
    );
    // 動画の読み取りの失敗は「無い」と書かず、原因を残す
    const unreadable = await pushSetsuKiryokuShort("/f", {
      store,
      readBytes: async (p) => {
        if (p.endsWith(".mp4")) throw new RangeError("too big");
        return g[p];
      },
      riskRules,
      now: PUSHED_AT,
    });
    assert.ok(unreadable.reasons[0].includes("読めない"), unreadable.reasons[0]);
    const failing = {
      ...store,
      approve: async () => {
        throw new Error("承認できない");
      },
    };
    const f = {
      "/f/bundle.json": new TextEncoder().encode(JSON.stringify(bundle())),
      "/f/final_gap.mp4": VIDEO,
    };
    const r = await pushSetsuKiryokuShort("/f", {
      store: failing,
      readBytes: async (p) => f[p],
      riskRules,
      now: at("21:26:00"),
    });
    assert.match(r.error, /承認できない/);
    const states = (
      await all("SELECT state FROM sns_auto_send_items ORDER BY created_at")
    ).map((i) => i.state);
    assert.deepEqual(states, ["held_manual"]);
    assert.equal(
      (await first("SELECT publish_blocked FROM sns_drafts")).publish_blocked,
      true,
      "承認に落ちた下書きは個別承認でも送れない形にする",
    );
    assert.equal(resultLine(r, null, { waited: false }).code, 5);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・riskRules・SAMPLE・DAY・at・PUSHED_AT・SETSU_ID・mp4・VIDEO・bundle） */
export function runSnsSetsuKiryokuShortScenes8(env) {
  ({ db, first, all, riskRules, SAMPLE, DAY, at, PUSHED_AT, SETSU_ID, mp4, VIDEO, bundle } = env);
  skst4Scene1();
  skst4Scene2();
  skst4Scene3();
}
