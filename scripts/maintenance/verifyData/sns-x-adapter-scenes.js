/**
 * verify-sns-x-adapter.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-x-adapter.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

let json, first, sendWith, mediaFake;

function scene1() {
  test("動画は finalize で processing_info が省略されても STATUS で完了を確かめてから投稿し、画像は省略で完了", async () => {
    const video = mediaFake({
      finalize: () => json({ data: { id: "m1" } }),
      status: () =>
        json({ data: { id: "m1", processing_info: { state: "succeeded" } } }),
    });
    const v = await sendWith(video.fetchImpl);
    assert.equal((await v.run()).state, "posted");
    assert.deepEqual(video.calls.slice(-2), [
      "/2/media/upload?command=STATUS&media_id=m1",
      "/2/tweets",
    ]);

    const image = mediaFake({
      finalize: () => json({ data: { id: "m1" } }),
      status: () => assert.fail("呼ばない"),
    });
    const i = await sendWith(image.fetchImpl, { path: "c.png" });
    assert.equal((await i.run()).state, "posted");
    assert.equal(
      image.calls.some((c) => c.startsWith("/2/media/upload?command=STATUS")),
      false,
    );
  });
  test("finalize: processing_info のキーが無いときだけ省略とみなし、null・false・0・空文字・状態の無い値は投稿の前に止める", async () => {
    for (const info of [
      null,
      false,
      0,
      "",
      {},
      { state: "" },
      { state: 5 },
      [],
      "succeeded",
    ]) {
      for (const path of ["c.png", "v.mp4"]) {
        const fake = mediaFake({
          finalize: () => json({ data: { id: "m1", processing_info: info } }),
          status: () =>
            json({ data: { id: "m1", processing_info: { state: "succeeded" } } }),
        });
        const { run, job } = await sendWith(fake.fetchImpl, { path });
        await assert.rejects(
          run(),
          /finalize の processing_info が不正です/,
          `${JSON.stringify(info)} ${path}`,
        );
        assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
        assert.notEqual(
          (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
            .state,
          "reconcile",
        );
      }
    }
  });
  test("finalize・STATUS: data がオブジェクトでない（文字列・配列・数）ときは投稿の前に止める", async () => {
    for (const data of ["ok", [], 1]) {
      const finalizeBad = mediaFake({
        finalize: () => json({ data }),
        status: () => assert.fail("呼ばない"),
      });
      await assert.rejects(
        (await sendWith(finalizeBad.fetchImpl, { path: "c.png" })).run(),
        /finalize の応答に data がありません/,
      );
      assert.equal(finalizeBad.calls.filter((c) => c === "/2/tweets").length, 0);
      const statusBad = mediaFake({
        finalize: () =>
          json({
            data: {
              id: "m1",
              processing_info: { state: "in_progress", check_after_secs: 1 },
            },
          }),
        status: () => json({ data }),
      });
      await assert.rejects(
        (await sendWith(statusBad.fetchImpl)).run(),
        /処理状態が読めません/,
      );
      assert.equal(statusBad.calls.filter((c) => c === "/2/tweets").length, 0);
    }
  });
}

function scene2() {
  test("媒体の処理の待ちは 1〜30 秒に収め、check_after_secs が数でなければ投稿の前に止める", async () => {
    const inProgress = (secs) => () =>
      json({
        data: {
          id: "m1",
          processing_info: { state: "in_progress", check_after_secs: secs },
        },
      });
    const done = () =>
      json({ data: { id: "m1", processing_info: { state: "succeeded" } } });
    for (const [secs, expected] of [
      [3600, 30],
      [0, 1],
      [-5, 1],
      [7, 7],
      [undefined, 1],
    ]) {
      const waits = [];
      const fake = mediaFake({ finalize: inProgress(secs), status: done });
      const { run } = await sendWith(fake.fetchImpl, { waits });
      assert.equal((await run()).state, "posted", String(secs));
      assert.deepEqual(waits, [expected], String(secs));
    }
    for (const secs of ["5", null, true, {}]) {
      const fake = mediaFake({ finalize: inProgress(secs), status: done });
      const { run, job } = await sendWith(fake.fetchImpl);
      await assert.rejects(run(), /check_after_secs/, JSON.stringify(secs));
      assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
      // この DB は 137 だけなので hold が無い（上の説明）。begin_post に進まず要照合にならないことを見る
      assert.notEqual(
        (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
          .state,
        "reconcile",
      );
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（json・first・sendWith・mediaFake） */
export function runSnsXAdapterScenes1(env) {
  ({ json, first, sendWith, mediaFake } = env);
  scene1();
  scene2();
}
