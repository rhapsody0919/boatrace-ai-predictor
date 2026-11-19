/**
 * verify-sns-x-delete.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-x-delete.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { runDeleteXPosts } from "../../../api/_lib/snsXDelete.js";
import { DELETE_API_URL } from "../../sns/delete-x-post.js";
import { fakeSupabase, runMain, ENV, fakeStore, fakeXFactory } from "./sns-x-delete-scenes-1.js";

let JOB, JOB2, TWEET, TWEET2, postedJob, fixture, db;

function scene1() {
  test("CLI: --apply は ID を明示した投稿だけを API に送る。HQ_TEST が立っていれば何も読まず断る", async () => {
    const f = fakeSupabase(fixture());
    const { code, result } = await runMain(
      ["--tweet-id", TWEET, "--reason", "架空の選手", "--apply"],
      ENV,
      f.fetchImpl,
    );
    assert.equal(code, 0);
    assert.equal(result.mode, "apply");
    const sent = f.calls.find((c) => c.url === DELETE_API_URL);
    assert.equal(sent.method, "POST");
    // fake の DB は or の条件を見ずに2件返す。手元でも指定の ID に絞り、指定した1件だけを送る
    assert.deepEqual(JSON.parse(sent.body).targets, [
      { job_id: JOB, tweet_id: TWEET },
    ]);
    assert.equal(JSON.parse(sent.body).reason, "架空の選手");
    const t = fakeSupabase(fixture());
    const refused = await runMain(
      ["--tweet-id", TWEET, "--reason", "r", "--apply"],
      { ...ENV, HQ_TEST: "1" },
      t.fetchImpl,
    );
    assert.equal(refused.code, 2);
    assert.match(refused.result.error, /HQ_TEST/);
    assert.equal(t.calls.length, 0);
  });
  test("CLI: 記録に無い ID は --apply でも何も消さない（exit 2）", async () => {
    const f = fakeSupabase({ ...fixture(), jobs: [] });
    const { code, result } = await runMain(
      ["--tweet-id", TWEET, "--reason", "r", "--apply"],
      ENV,
      f.fetchImpl,
    );
    assert.equal(code, 2);
    assert.deepEqual(result.missing, [TWEET]);
    assert.ok(f.calls.every((c) => c.url !== DELETE_API_URL));
  });
  test("本体: 2件目の DB の読み取りが落ちても、1件目の済んだ結果を返す", async () => {
    const store = fakeStore({ [JOB]: postedJob() });
    const read = store.readJob;
    store.readJob = async (id) => {
      if (id === JOB2) throw new Error("X送信のDB操作に失敗しました");
      return read(id);
    };
    const x = fakeXFactory();
    const out = await runDeleteXPosts(
      {
        targets: [
          { job_id: JOB, tweet_id: TWEET },
          { job_id: JOB2, tweet_id: TWEET2 },
        ],
        reason: "r",
      },
      { store, getX: x.getX },
    );
    assert.equal(out.ok, false);
    assert.deepEqual(
      out.results.map((r) => r.ok),
      [true, false],
    );
    assert.deepEqual(x.deleted, [TWEET]);
  });
  test("CLI: --item-id だけで当たった消せない job（同じ item の未送信）は外し、止めない", async () => {
    const ITEM = "33333333-3333-4333-8333-333333333333";
    const f = fakeSupabase({
      ...fixture(),
      jobs: [
        postedJob({ auto_item_id: ITEM }),
        postedJob({
          id: JOB2,
          draft_id: "d2",
          state: "cancelled",
          external_post_id: null,
          auto_item_id: ITEM,
        }),
      ],
    });
    const { code, result } = await runMain(
      ["--item-id", ITEM, "--reason", "架空", "--apply"],
      ENV,
      f.fetchImpl,
    );
    assert.equal(code, 0);
    const sent = f.calls.find((c) => c.url === DELETE_API_URL);
    assert.deepEqual(JSON.parse(sent.body).targets, [
      { job_id: JOB, tweet_id: TWEET },
    ]);
    assert.equal(result.mode, "apply");
  });
}

function scene2() {
  test("CLI: 消す API の応答が JSON でない（未デプロイ等）ときも DELETE_RESULT を出して exit 1", async () => {
    const f = fakeSupabase(fixture());
    const fetchImpl = async (url, init) =>
      String(url) === DELETE_API_URL
        ? new Response("<html></html>", { status: 200 })
        : f.fetchImpl(url, init);
    const { code, result } = await runMain(
      ["--tweet-id", TWEET, "--reason", "r", "--apply"],
      ENV,
      fetchImpl,
    );
    assert.equal(code, 1);
    assert.match(result.error, /応答が読めない/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（JOB・JOB2・TWEET・TWEET2・postedJob・fixture） */
export function runSnsXDeleteScenes3(env) {
  ({ JOB, JOB2, TWEET, TWEET2, postedJob, fixture } = env);
  scene1();
  scene2();
}

function scene3() {
  after(() => db.close());
}

/** verify から呼ぶ入口。env は verify 側の束縛（JOB・JOB2・TWEET・TWEET2・postedJob・fixture・db） */
export function runSnsXDeleteScenes4(env) {
  ({ JOB, JOB2, TWEET, TWEET2, postedJob, fixture, db } = env);
  scene3();
}
