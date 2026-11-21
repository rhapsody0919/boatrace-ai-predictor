/**
 * verify-sns-full-picture.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { THUMBNAIL_MAX_BYTES } from "../../sns/push-full-picture.js";
import { PNG, bundleF01, clearSent } from "./sns-full-picture-scenes-3.js";

let db, first, all, RACE, bundleV2, saved, store, push;

// BOA-1201: 締切が延びたら、作り手が作り直した束（題・説明文の「締切HH:MM」が変わる）を push し直し、前の束を差し替える
export const remade = (hm = "20:44") =>
  bundleV2({
    youtube_full: {
      title: `若松12R 締切${hm}、逃げ一本でいい？`,
      description: `10/18（日）若松12R 締切${hm}\nhttps://www.boat-ai.jp/race/${RACE}?tab=sonar&utm_source=youtube`,
    },
  });

export const itemsAndJobs = () =>
  all(
    `SELECT i.id, i.channel, i.variant, i.state, i.stopped_via, i.deadline_at, j.id AS job_id, j.state AS job_state, j.error_code
     FROM sns_auto_send_items i LEFT JOIN sns_x_send_jobs j ON j.auto_item_id=i.id ORDER BY i.created_at, i.channel, i.variant`,
  );

function scene1() {
  test("BOA-1172: サムネイルの欄があるのに画像が無い・PNG でも JPEG でもない・空・上限を超える・名前に区切りがあるときは束ごと拒否する", async () => {
    const big = new Uint8Array(THUMBNAIL_MAX_BYTES + 1);
    big.set(PNG);
    const gif = new TextEncoder().encode("GIF89a0000");
    const cases = [
      ["画像が無い", bundleF01(), {}, /thumb-full\.png が無い/],
      [
        "GIF",
        bundleF01(),
        { "/f/thumb-full.png": gif },
        /PNG でも JPEG でもない/,
      ],
      [
        "空",
        bundleF01(),
        { "/f/thumb-full.png": new Uint8Array() },
        /大きさが不正（0 バイト）/,
      ],
      ["上限を超える", bundleF01(), { "/f/thumb-full.png": big }, /大きさが不正/],
      [
        "上の階層",
        bundleF01("../thumb-full.png"),
        { "/thumb-full.png": PNG },
        /ファイル名でない/,
      ],
      [
        "下の階層",
        bundleF01("a/thumb-full.png"),
        { "/f/a/thumb-full.png": PNG },
        /ファイル名でない/,
      ],
      ["\\ を含む", bundleF01("a\\thumb-full.png"), {}, /ファイル名でない/],
      ["..", bundleF01(".."), {}, /ファイル名でない/],
      ["空の名前", bundleF01(""), {}, /ファイル名でない/],
      ["文字列でない", bundleF01(true), {}, /ファイル名でない/],
    ];
    await clearSent();
    for (const [label, b, extra, expected] of cases) {
      const savedBefore = saved.length;
      const result = await push(b, { files: extra });
      assert.ok(result.reasons?.length, label);
      assert.match(result.reasons.join("\n"), expected, label);
      assert.equal(saved.length, savedBefore, `${label}: 何も保存しない`);
    }
    assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
    // 上限ちょうどは通る（承認の snapshot のカバーの上限と同じ）
    const edge = new Uint8Array(THUMBNAIL_MAX_BYTES);
    edge.set(PNG);
    assert.equal(
      (
        await push(bundleF01(), {
          files: { "/f/thumb-full.png": edge },
          dryRun: true,
        })
      ).reasons,
      undefined,
    );
  });
  test("BOA-1201: 同じレースの全貌が同じ締切で入っていれば、作り直した束でも重複として拒否し、何も書かない", async () => {
    await push(bundleV2());
    const drafts = (await all("SELECT id FROM sns_drafts")).length;
    const savedBefore = saved.length;
    const again = await push(remade("20:36"));
    assert.match(
      again.reasons.join(),
      /同じレースの全貌が同じ締切 20:36 で既に入っている（重複）/,
    );
    assert.match(again.notes[0], /検査で拒否した/);
    assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
    assert.equal(saved.length, savedBefore);
    assert.ok((await itemsAndJobs()).every((r) => r.state === "notified"));
  });
}

function scene2() {
  test("BOA-1201: 締切が違い、前の job が queued かつ試行0なら、前の item を stopped（superseded）・job を held（superseded）にしてから新しい束を入れる", async () => {
    await push(bundleV2());
    const old = await itemsAndJobs();
    assert.equal(old.length, 3);
    const oldX = await first(
      "SELECT draft_id FROM sns_auto_send_items WHERE channel='x'",
    );
    await db.query("UPDATE races SET start_time='20:44:00'");
    // 作り直していない（版が同じ）束は、前の締切が焼き込まれたままなので拒否する
    assert.match(
      (await push(bundleV2())).reasons.join(),
      /締切が 20:36→20:44 に変わったのに束が前と同じ版/,
    );
    // --dry-run は差し替えを書かない（何を差し替えるかだけ返す）
    const dry = await push(remade(), { dryRun: true });
    assert.deepEqual(dry.replacing, { from: "20:36", to: "20:44", items: 3 });
    assert.deepEqual(await itemsAndJobs(), old);
    // X の日の枠は、前の X の下書きの job を数えずに確かめる
    const asked = [];
    store.xSlotRoom = async (kind, need, draftId) => {
      asked.push(draftId);
      return { ok: true };
    };
    let result;
    try {
      result = await push(remade());
    } finally {
      delete store.xSlotRoom;
    }
    assert.equal(result.reasons, undefined);
    assert.deepEqual(asked, [oldX.draft_id]);
    const rows = await itemsAndJobs();
    const before = rows.filter((r) => old.some((o) => o.id === r.id));
    const after = rows.filter((r) => !old.some((o) => o.id === r.id));
    assert.deepEqual(
      before.map((r) => [
        r.channel,
        r.variant,
        r.state,
        r.stopped_via,
        r.job_state,
        r.error_code,
      ]),
      [
        ["x", "main", "stopped", "superseded", "held", "superseded"],
        ["youtube", "main", "stopped", "superseded", "held", "superseded"],
        ["youtube", "shorts", "stopped", "superseded", "held", "superseded"],
      ],
    );
    assert.deepEqual(
      after.map((r) => [
        r.channel,
        r.variant,
        r.state,
        r.deadline_at.toISOString(),
        r.job_state,
      ]),
      [
        ["x", "main", "notified", "2037-10-18T11:44:00.000Z", "queued"],
        ["youtube", "main", "notified", "2037-10-18T11:44:00.000Z", "queued"],
        ["youtube", "shorts", "notified", "2037-10-18T11:44:00.000Z", "queued"],
      ],
    );
    assert.deepEqual(result.replacing, {
      from: "20:36",
      to: "20:44",
      items: 3,
      held_jobs: 3,
    });
    assert.match(
      result.notes[0],
      /締切 20:36→20:44 で差し替えた（前の item 3件を stopped（superseded）、job 3件を held（superseded））/,
    );
    assert.match(result.notes[0], /x: 19:44 に自動で送る/);
  });
}

function scene3() {
  test("BOA-1201: 前の job が sending・posted（送信を始めた・送った）なら、締切が違っても差し替えずに拒否する", async () => {
    await push(bundleV2());
    const old = await itemsAndJobs();
    const drafts = (await all("SELECT id FROM sns_drafts")).length;
    await db.query("UPDATE races SET start_time='20:44:00'");
    const xJob = old.find((r) => r.channel === "x").job_id;
    for (const [state, extra] of [
      ["sending", ""],
      ["posted", ", external_post_id='1234567890', posted_at=test_now()"],
    ]) {
      await db.query(
        `UPDATE sns_x_send_jobs SET state=$2, attempts=1${extra} WHERE id=$1`,
        [xJob, state],
      );
      const result = await push(remade());
      assert.match(
        result.reasons.join(),
        new RegExp(
          `前の束の送信が始まっているので差し替えない（x の job ${xJob} が ${state}（試行 1））`,
        ),
        state,
      );
      assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
      assert.ok(
        (await itemsAndJobs()).every((r) => r.state === "notified"),
        state,
      );
    }
  });
  test("BOA-1201: 前の item を止めた後に job の hold が落ちたら、新しい item を作らない（止めた item の job は claim で auto_stopped）", async () => {
    await push(bundleV2());
    const drafts = (await all("SELECT id FROM sns_drafts")).length;
    await db.query("UPDATE races SET start_time='20:44:00'");
    store.failHold = true;
    let result;
    try {
      result = await push(remade());
    } finally {
      store.failHold = false;
    }
    assert.match(
      result.reasons.join(),
      /前の束（締切 20:36）の差し替えに失敗したので、新しい束を作らない: hold_failed/,
    );
    assert.match(result.notes[0], /検査で拒否した/);
    const rows = await itemsAndJobs();
    assert.equal(rows.length, 3);
    assert.ok(
      rows.every((r) => r.state === "stopped" && r.job_state === "queued"),
    );
    assert.equal((await all("SELECT id FROM sns_drafts")).length, drafts);
    // 残った queued の job は、item が止まっているので claim で auto_stopped になり、外へ出ない
    // （held にした後、下書きを公開保留に戻すので 148 のガードが job を取り消す）
    const claimed = await first(
      "SELECT public.transition_sns_x_send($1,'claim','{}'::jsonb) r",
      [rows.find((r) => r.channel === "x").job_id],
    );
    assert.deepEqual(
      [claimed.r.state, claimed.r.error_code],
      ["cancelled", "auto_stopped"],
    );
  });
  test("BOA-1201: 文に焼き込んだ締切が今の締切と違う束は、初回でも差し替えでも拒否する。合う束・締切の文が無い束は通る", async () => {
    // 初回（前の item が無い）: 締切が 20:44 に延びた後に、20:36 の材料で作った束が届く
    await db.query("UPDATE races SET start_time='20:44:00'");
    const first1 = await push(remade("20:36"));
    assert.deepEqual(first1.reasons, [
      "束の締切 20:36 が今の締切 20:44 と違う（作り直す。youtube_full.title・youtube_full.description）",
    ]);
    assert.match(first1.notes[0], /検査で拒否した/);
    assert.equal((await all("SELECT id FROM sns_drafts")).length, 0);
    // --dry-run でも同じく拒否する
    assert.match(
      (await push(remade("20:36"), { dryRun: true })).reasons.join(),
      /束の締切 20:36 が今の締切 20:44 と違う/,
    );
    // 締切が合う束は通る
    assert.equal((await push(remade("20:44"))).reasons, undefined);
    assert.equal((await all("SELECT id FROM sns_drafts")).length, 3);

    // 差し替え: 20:44 の束が入った後に 20:50 へ延び、版は違うが締切が古いまま（20:44）の束が届く
    await db.query("UPDATE races SET start_time='20:50:00'");
    const staleRemade = remade("20:44");
    staleRemade.youtube_full.title += "（作り直し）";
    const second = await push(staleRemade);
    assert.deepEqual(second.reasons, [
      "束の締切 20:44 が今の締切 20:50 と違う（作り直す。youtube_full.title・youtube_full.description）",
    ]);
    assert.equal((await all("SELECT id FROM sns_drafts")).length, 3);
    assert.ok((await itemsAndJobs()).every((r) => r.state === "notified"));
    // 締切の文が無い束は今までどおり見ない（差し替えの判定に進む）
    assert.equal((await push(bundleV2())).reasons, undefined);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・RACE・bundleV2・saved・store・push） */
export function runSnsFullPictureScenes4(env) {
  ({ db, first, all, RACE, bundleV2, saved, store, push } = env);
  scene1();
  scene2();
  scene3();
}
