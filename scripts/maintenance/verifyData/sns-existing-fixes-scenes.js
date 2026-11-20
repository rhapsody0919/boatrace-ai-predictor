/**
 * verify-sns-existing-fixes.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-existing-fixes.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { fixture, id } from "./sns-existing-fixes-fixture.js";

let youtube, request;

function scene1() {
  for (const thumbnailSuccess of [true, false]) {
    test(`サムネ待機中にDB反映だけ再試行しても結果を保存する（成功=${thumbnailSuccess}）`, async () => {
      let started, release;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      const waiting = new Promise((resolve) => {
        started = resolve;
      });
      const f = await fixture("youtube", {
        thumbnail: true,
        thumbnailSuccess,
        thumbnailGate: async () => {
          started();
          await pending;
        },
      });
      let first;
      try {
        first = youtube(request("publish-youtube"));
        await waiting;
        assert.equal((await f.row()).external_operation_state, "external_done");
        assert.equal((await youtube(request("publish-youtube"))).status, 200);
        assert.equal((await f.row()).external_operation_state, "done");
        release();
        assert.equal((await first).status, 200);
        const row = await f.row();
        assert.equal(row.external_operation_state, "done");
        assert.equal(
          row.external_operation_result.thumbnailWarning,
          thumbnailSuccess ? null : row.source_data.youtube_thumbnail_error,
        );
        if (!thumbnailSuccess)
          assert.equal(row.source_data.youtube_thumbnail_error, "failed");
        else assert.equal(row.source_data.youtube_thumbnail_error, undefined);
        const retry = await (await youtube(request("publish-youtube"))).json();
        assert.equal(
          retry.thumbnailWarning ?? null,
          row.external_operation_result.thumbnailWarning,
        );
        assert.equal(f.counts().uploads, 1);
        await assert.rejects(
          f.db.query("SELECT sns_update_external_warning($1,$2,$3)", [
            id,
            crypto.randomUUID(),
            "別操作",
          ]),
        );
      } finally {
        release();
        if (first) await first;
        await f.close();
      }
    });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（youtube・request） */
export function runSnsExistingFixesScenes1(env) {
  ({ youtube, request } = env);
  scene1();
}
