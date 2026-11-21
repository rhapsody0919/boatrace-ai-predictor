/**
 * verify-sns-bundle-import.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-bundle-import.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runYoutubeQueueJob, createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import assert from "node:assert/strict";
import {
  sha256,
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_V1,
  BUNDLE_LIMITS_V1,
  X_VIDEO,
  validateBundle,
} from "../../../api/_lib/snsBundleValidation.js";
import { bundleStore, importValidatedBundle } from "../../../api/_lib/snsBundleImport.js";
import { validateV1Fields } from "../../../api/_lib/snsBundleV1.js";
import { files } from "./sns-bundle-import-scenes-1.js";

let encode, check, fixture, form, db, mockHandler, MP4, fixtureV1;

const V1_OPTIONS = {
  schemas: [BUNDLE_SCHEMA, BUNDLE_SCHEMA_V1],
  limits: BUNDLE_LIMITS_V1,
  derived: [X_VIDEO],
  v1Fields: validateV1Fields,
};

async function sbi4Scene1() {
  await check(
    "取り込みAPIの正常・不正schema・multipart不備・認証なし",
    async () => {
      const handler = await mockHandler("api/admin/sns-hub/import-bundle.js", {});
      const ok = await handler(
        new Request("https://local.invalid/import", {
          method: "POST",
          body: form(files),
        }),
      );
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).data.publish_blocked, true);
      const unsupported = await fixture({ schema_version: "ryujin-preview/1" });
      assert.equal(
        (
          await handler(
            new Request("https://local.invalid/import", {
              method: "POST",
              body: form(unsupported),
            }),
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await handler(
            new Request("https://local.invalid/import", {
              method: "POST",
              body: "{}",
            }),
          )
        ).status,
        400,
      );
      const denied = await mockHandler(
        "api/admin/sns-hub/import-bundle.js",
        {},
        true,
      );
      assert.equal(
        (
          await denied(
            new Request("https://local.invalid/import", { method: "POST" }),
          )
        ).status,
        401,
      );
    },
  );
  await db.close();
}

async function sbi4Scene2() {
  await check(
    "bundleStoreのsaveFile/registerは4xxで再試行を案内しない(F02対応)",
    async () => {
      // saveFile・registerの実装(実fetch)を対象にする。dbを使わないテストなので
      // db.close()後でよい。グローバルfetchを差し替え、元に戻すまでtry/finallyで囲む。
      const originalFetch = globalThis.fetch;
      async function withMockedFetch(status, detail, run) {
        globalThis.fetch = async () => ({
          ok: false,
          status,
          text: async () => detail,
        });
        try {
          return await run();
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
      await withMockedFetch(400, "invalid path", () =>
        assert.rejects(
          () =>
            bundleStore.saveFile("x", {
              bytes: new Uint8Array(),
              mime: "application/octet-stream",
            }),
          (err) => {
            assert(err.message.includes("(400)"));
            assert(err.message.includes("invalid path"));
            assert(!err.message.includes("再試行できます"));
            return true;
          },
        ),
      );
      await withMockedFetch(503, "temporarily unavailable", () =>
        assert.rejects(
          () =>
            bundleStore.saveFile("x", {
              bytes: new Uint8Array(),
              mime: "application/octet-stream",
            }),
          (err) => {
            assert(err.message.includes("(503)"));
            assert(err.message.includes("temporarily unavailable"));
            assert(err.message.includes("再試行できます"));
            return true;
          },
        ),
      );
      await withMockedFetch(400, "bundleの版・groupの対応が不正です", () =>
        assert.rejects(
          () => bundleStore.register({}),
          (err) => {
            assert(err.message.includes("(400)"));
            assert(!err.message.includes("再試行できます"));
            return true;
          },
        ),
      );
      await withMockedFetch(502, "bad gateway", () =>
        assert.rejects(
          () => bundleStore.register({}),
          (err) => {
            assert(err.message.includes("(502)"));
            assert(err.message.includes("再試行できます"));
            return true;
          },
        ),
      );
    },
  );
}

async function sbi4Scene3() {
  await check(
    "Shorts公開未確認は要照合、呼出し前のクォータ記録と候補ID保存",
    async () => {
      const mediaBytes = new Uint8Array([1]);
      const snapshot_text = JSON.stringify({
        source: { video_storage_path: "a.mp4" },
        media: [
          {
            path: "a.mp4",
            type: "video/mp4",
            size: 1,
            sha256: await sha256(mediaBytes),
          },
        ],
        queue: { youtube_mode: "scheduled" },
      });
      let state = "queued";
      const actions = [];
      const store = {
        async transition(id, action, result) {
          actions.push({ action, result });
          if (action === "claim") state = "sending";
          if (action === "begin_post") state = "reconcile";
          if (action === "complete") state = "posted";
          return {
            id,
            external_post_id: "abcdefghijk",
            state,
            channel: "youtube",
            snapshot_text,
            approved_hash: await sha256(encode(snapshot_text)),
          };
        },
      };
      await assert.rejects(
        runYoutubeQueueJob("mock", {
          store,
          youtube: createMockYoutubeAdapter({ privacyStatus: "private" }),
          preflight: async () => {},
          loadMedia: async () => mediaBytes,
        }),
        /unconfirmed/,
      );
      assert.equal(state, "reconcile");
      assert.deepEqual(
        actions
          .filter((a) => a.action === "youtube_call")
          .map((a) => a.result.method),
        ["videos.insert", "videos.update", "videos.list"],
      );
      assert.equal(
        actions.find((a) => a.action === "youtube_uploaded").result.id,
        "abcdefghijk",
      );
      assert(!actions.some((a) => a.action === "complete"));
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・check・fixture・form・db・mockHandler・fixtureV1） */
export async function runSnsBundleImportScenes10(env) {
  ({ encode, check, fixture, form, db, mockHandler, fixtureV1 } = env);
  await sbi4Scene1();
  await sbi4Scene2();
  await sbi4Scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・check・fixture・form・db・mockHandler・MP4・fixtureV1） */
export function runSnsBundleImportScenes11(env) {
  ({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 } = env);

}

async function sbi4Scene4() {
  await check("v1: 管理画面の手取り込み（既定の v0 だけ）では受け付けない", async () => {
    await assert.rejects(validateBundle(form(await fixtureV1())), /未対応または重複したファイル名|v0のみ/);
    // v1 を受け付けても、v1 の欄の検査（twitter-text）を渡さなければ通さない
    await assert.rejects(
      validateBundle(form(await fixtureV1()), [], { ...V1_OPTIONS, v1Fields: null }),
      /v1Fields/,
    );
    const noXVideo = await fixtureV1({}, { withXVideo: false });
    await assert.rejects(validateBundle(form(noXVideo)), /v0のみ/);
  });
  await check("v1: x_thread・claims・screen_key を検査し、v0 の恒久保留を付けず、スレッドごとの risk を返す", async () => {
    const result = await validateBundle(form(await fixtureV1()), [], V1_OPTIONS);
    assert.equal(result.bundle.schema_version, BUNDLE_SCHEMA_V1);
    assert(!result.holds.some((h) => h.includes("v0素材")));
    assert(!result.holds.some((h) => h.includes(X_VIDEO)), result.holds.join(" / "));
    assert.equal(result.manifest.find((m) => m.name === X_VIDEO).verification, "derived");
    assert.equal(result.riskFlags.x_thread.length, 2);
    assert.deepEqual(result.missing, []);
  });
  await check("v1: 子の URL・連番の崩れ・親の媒体・文字数・claims の形は拒否する", async () => {
    const bad = [
      [{ x_thread: [{ index: 0, text: "親 https://www.boat-ai.jp/race/202610071110", media: X_VIDEO }, { index: 1, text: "子 https://www.boat-ai.jp/race/1" }] }, /URLは親/],
      [{ x_thread: [{ index: 0, text: "親", media: X_VIDEO }, { index: 2, text: "子" }] }, /連番/],
      [{ x_thread: [{ index: 0, text: "親", media: "scene-1.png" }] }, /draft-x\.mp4/],
      // 子のあるスレッドは各投稿280まで（親も子も）
      [{ x_thread: [{ index: 0, text: "あ".repeat(141), media: X_VIDEO }, { index: 1, text: "子" }] }, /文字数/],
      [{ x_thread: [{ index: 0, text: "親 https://www.boat-ai.jp/race/202610071110", media: X_VIDEO }, { index: 1, text: "あ".repeat(141) }] }, /文字数/],
      // 親1件だけ（長文の1投稿）でも25,000（全角は2）を超えれば拒否
      [{ x_thread: [{ index: 0, text: "あ".repeat(12501) + " https://www.boat-ai.jp/race/202610071110", media: X_VIDEO }] }, /文字数|本文が必要/],
      [{ x_thread: Array.from({ length: 7 }, (_, i) => ({ index: i, text: "本文", ...(i === 0 ? { media: X_VIDEO } : {}) })) }, /1〜6件/],
      [{ x_thread: [{ index: 0, text: "親", media: X_VIDEO }, { index: 1, text: "子", media: "nothing.png" }] }, /媒体が添付にありません/],
      [{ claims: [{ source: "facts", path: ["count"], value: 30 }] }, /v1のclaims/],
      [{ claims: [{ id: "c", text: "t", value: 1, source: { endpoint: "https://evil.example/api/x", path: ["a"] } }] }, /v1のclaims/],
      [{ screen_key: undefined }, /screen_key/],
      [{ x_thread: [{ index: 0, text: "URL なしの親", media: X_VIDEO }] }, /レースのURL/],
      [{ x_thread: [{ index: 0, text: "https://example.com/race/1", media: X_VIDEO }] }, /レースのURL/],
    ];
    for (const [change, message] of bad)
      await assert.rejects(
        validateBundle(form(await fixtureV1(change)), [], V1_OPTIONS),
        message,
        JSON.stringify(change).slice(0, 80),
      );
  });
  await check("v1: 親1件だけのスレッドは長文の1投稿（Premium）として25,000まで通す（2026-10-14 オーナー決定）", async () => {
    const long = "あ".repeat(5000) + "\nhttps://www.boat-ai.jp/race/202610071110";
    const result = await validateBundle(
      form(await fixtureV1({ x_thread: [{ index: 0, text: long, media: X_VIDEO }] })),
      [],
      V1_OPTIONS,
    );
    assert.equal(result.bundle.x_thread[0].text, long);
  });
  await check("v1: 動画は 32 MiB まで（v0 は 2 MiB のまま）、draft-x.mp4 は v0 では使えない", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(MP4);
    const files = await fixtureV1();
    files.set(X_VIDEO, big);
    const result = await validateBundle(form(files), [], V1_OPTIONS);
    assert.equal(result.files.get(X_VIDEO).bytes.length, big.length);
    const tooBig = new Uint8Array(32 * 1024 * 1024 + 1);
    tooBig.set(MP4);
    files.set(X_VIDEO, tooBig);
    await assert.rejects(validateBundle(form(files), [], V1_OPTIONS), /容量超過/);
    const v0 = await fixture();
    v0.set(X_VIDEO, MP4);
    await assert.rejects(validateBundle(form(v0), [], V1_OPTIONS), /v1だけ/);
  });
  await check("v1: 取り込みは bundle の版で RPC を呼ぶ（v0 の定数で上書きしない）", async () => {
    const validated = await validateBundle(form(await fixtureV1()), [], V1_OPTIONS);
    let payload;
    await importValidatedBundle(validated, {
      saveFile: async () => {},
      register: async (p) => (payload = p),
    });
    assert.equal(payload.p_schema_version, BUNDLE_SCHEMA_V1);
    assert.equal(payload.p_risk_flags.x_thread.length, 2);
    const v0 = await validateBundle(form(await fixture()));
    await importValidatedBundle(v0, { saveFile: async () => {}, register: async (p) => (payload = p) });
    assert.equal(payload.p_schema_version, BUNDLE_SCHEMA);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・check・fixture・form・db・mockHandler・MP4・fixtureV1） */
export async function runSnsBundleImportScenes12(env) {
  ({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 } = env);
  await sbi4Scene4();
}

async function sbi4Scene5() {
  await check("v1: X の投稿ごとの risk に、共通のタイトルと場面の文字の警告も入る（点検 08-15 D1）", async () => {
    const rules = [{ id: "t", category: "c", description: "d", platforms: "all", patterns: ["必勝"] }];
    const title = await validateBundle(form(await fixtureV1({ title: "必勝の展望" })), rules, V1_OPTIONS);
    assert(title.riskFlags.x_thread.every((flags) => flags.some((f) => f.id === "t")));
    const scene = await validateBundle(
      form(await fixtureV1({ scenes: Array.from({ length: 3 }, () => ({ seconds: 6, tab: "差がつく材料", component: "観測件数", lines: ["必勝"] })) })),
      rules,
      V1_OPTIONS,
    );
    assert(scene.riskFlags.x_thread.every((flags) => flags.some((f) => f.id === "t")));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・check・fixture・form・db・mockHandler・MP4・fixtureV1） */
export async function runSnsBundleImportScenes13(env) {
  ({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 } = env);
  await sbi4Scene5();
}

async function sbi4Scene6() {
  if (process.argv.includes("--draft-diff-ui"))
    await import("../snsDraftDiffUi.js");
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・check・fixture・form・db・mockHandler・MP4・fixtureV1） */
export async function runSnsBundleImportScenes14(env) {
  ({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 } = env);
  await sbi4Scene6();
}
