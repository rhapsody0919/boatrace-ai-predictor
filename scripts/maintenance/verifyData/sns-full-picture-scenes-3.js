/**
 * verify-sns-full-picture.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-full-picture.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFullPicture } from "../../sns/push-full-picture.js";

let db, first, all, riskRules, RACE, NOW, VIDEO, bundle, SHORTS, files, bundleV2, saved, store, push;
let rejectionCases, JPEG;
export let PNG;

const withThumbnail = (b, thumbnail = "thumb-full.png") => ({
  ...b,
  youtube_full: { ...b.youtube_full, thumbnail },
});

export const bundleF01 = (thumbnail) =>
  withThumbnail(bundleV2({ channels: ["youtube", "shorts"] }), thumbnail);

const draftOf = (jobId) =>
  first(
    "SELECT d.cover_image_path, d.video_storage_path, j.snapshot_text FROM sns_x_send_jobs j JOIN sns_drafts d ON d.id=j.draft_id WHERE j.id=$1",
    [jobId],
  );

export const clearSent = () =>
  db.exec(
    "UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );

function scene1() {
  test("BOA-1167: channels の検査。x を外すことだけができ（完全版は必須・Shorts は版2と一致）、x を含めば x_text は今までどおり必須", () => {
    const bad = (b) =>
      checkFullPicture(b, riskRules).filter((r) => /channels/.test(r));
    for (const b of [
      bundleV2({ channels: ["shorts"] }),
      bundleV2({ channels: ["youtube"] }),
      bundleV2({ channels: ["youtube", "shorts", "shorts"] }),
      bundleV2({ channels: ["youtube", "shorts", "tiktok"] }),
      bundleV2({ channels: [] }),
      bundleV2({ channels: "youtube,shorts" }),
      bundle({ channels: ["youtube", "shorts"] }),
    ])
      assert.equal(bad(b).length, 1, JSON.stringify(b.channels));
    // 版1の X なし（完全版だけ）・X ありの明示・版2の X なしは通る
    for (const b of [
      bundle({ channels: ["youtube"], x_text: undefined }),
      bundle({ channels: ["x", "youtube"] }),
      bundleV2({ channels: ["youtube", "shorts"], x_text: undefined }),
      bundleV2({ channels: ["x", "youtube", "shorts"] }),
    ])
      assert.deepEqual(
        checkFullPicture(b, riskRules),
        [],
        JSON.stringify(b.channels),
      );
    // x を含む channels では x_text が要る。x を含まなければ x_text の禁止表現・置き場所も見ない
    assert.match(
      checkFullPicture(
        bundle({ channels: ["x", "youtube"], x_text: undefined }),
        riskRules,
      ).join(),
      /x_text が無い/,
    );
    assert.deepEqual(
      checkFullPicture(
        bundleV2({ channels: ["youtube", "shorts"], x_text: "{full_url}" }),
        riskRules,
      ),
      [],
    );
  });
  test("BOA-1167: channels に x が無い束で Shorts の item を作れなければ、Slack に「X・」を付けずに完全版は送ると書く", async () => {
    const b = bundleV2({ channels: ["youtube", "shorts"], x_text: undefined });
    store.failInsertItem = (row) => row.variant === "shorts";
    try {
      const result = await push(b);
      assert.deepEqual(Object.keys(result.channels), ["youtube"]);
      assert.match(
        result.notes[0],
        /作れなかったので作らなかった（完全版は送る）/,
      );
    } finally {
      store.failInsertItem = null;
    }
  });
  test("BOA-1167: channels に x が無い束で完全版の動画が無ければ拒否する（full-x.mp4 の有無は問わない）", async () => {
    const b = bundle({ channels: ["youtube"], x_text: undefined });
    const f = files(b);
    delete f["/f/full-youtube.mp4"];
    delete f["/f/full-x.mp4"];
    const result = await push(b, {
      readBytes: async (p) => {
        if (!f[p]) throw new Error("no file");
        return f[p];
      },
    });
    assert.deepEqual(result.reasons, ["full-youtube.mp4 が無い"]);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  });
  // BOA-909: 検査で拒否した束は理由を1回通知し、試運転では通知しない。
  rejectionCases = [
    ["欄", () => bundle({ x_text: undefined }), {}, /x_text/],
    ["P0", () => bundle({ review: { p0_count: 1 } }), {}, /P0/],
    ["機械", () => bundle({ qa: { machine: { verify: false } } }), {}, /機械/],
    ["動画欠落", bundleV2, { missingVideo: true }, /shorts.mp4 が無い/],
    ["レース無し", bundle, { race: null }, /レースが見つからない/],
    ["中止", bundle, { cancelled: true }, /レースが中止/],
    [
      "締切45分前",
      bundle,
      { now: new Date("2037-10-18T19:51:00+09:00") },
      /45分前/,
    ],
    [
      "複数理由",
      () => bundle({ x_text: undefined, review: { p0_count: 1 } }),
      {},
      /P0/,
    ],
  ];
}

function scene2() {
  for (const [name, makeBundle, scenario, expected] of rejectionCases) {
    test(`BOA-909: ${name} の拒否理由と race_id を1回通知する（dry-run は通知しない）`, async () => {
      const b = makeBundle();
      const f = files(b);
      if (scenario.missingVideo) delete f["/f/shorts.mp4"];
      const readBytes = async (p) => {
        if (!f[p]) throw new Error("no file");
        return f[p];
      };
      const raceStore = {
        ...store,
        race: async (id) =>
          scenario.race === null
            ? null
            : {
                ...(await store.race(id)),
                ...(scenario.cancelled
                  ? { cancellation_status: "confirmed" }
                  : {}),
              },
      };
      const savedBefore = saved.length;
      let reasons;
      for (const dryRun of [false, true]) {
        const result = await push(b, {
          store: raceStore,
          readBytes,
          dryRun,
          now: scenario.now ?? NOW,
        });
        assert.match(result.reasons.join("\n"), expected);
        assert.equal(result.notes.length, dryRun ? 0 : 1);
        if (!dryRun) {
          reasons = result.reasons;
          assert.ok(result.notes[0].includes(RACE));
          assert.ok(result.notes[0].includes(reasons.join("\n")));
        } else assert.deepEqual(result.reasons, reasons);
      }
      assert.equal(saved.length, savedBefore);
      assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
      assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
      assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
    });
  }
  test("BOA-909: notify の同期例外・非同期拒否でも元の拒否理由を返す", async (t) => {
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const b = bundle({ x_text: undefined, review: { p0_count: 1 } });
    const reasons = checkFullPicture(b, riskRules);
    for (const asyncFailure of [false, true]) {
      let calls = 0;
      const result = await push(b, {
        notify: () => {
          calls++;
          if (asyncFailure) return Promise.reject(new Error("notify_failed"));
          throw new Error("notify_failed");
        },
      });
      assert.equal(calls, 1);
      assert.deepEqual(result.reasons, reasons);
    }
    assert.equal(errors.length, 2);
  });
  // BOA-1172: 型 f01 の完全版のサムネイル（bundle の youtube_full.thumbnail と bundle/thumb-full.png、run-full.mjs）
  PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
  ]);
  JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
}

function scene3() {
  test("BOA-1172: f01 の束のサムネイルは完全版の下書きの cover_image_path に入り、承認の snapshot の media が2つになる。Shorts には付けない", async () => {
    for (const [bytes, ext, type] of [
      [PNG, "png", "image/png"],
      [JPEG, "jpg", "image/jpeg"],
    ]) {
      await clearSent();
      const savedBefore = saved.length;
      const result = await push(bundleF01(), {
        files: { "/f/thumb-full.png": bytes },
      });
      assert.equal(result.reasons, undefined, ext);
      const cover = `full-picture/${RACE}/${result.revision}/thumb-full.${ext}`;
      // 保存の拡張子と Content-Type は中身（先頭のバイト列）で決める
      assert.deepEqual(
        saved.slice(savedBefore).find(([p]) => p === cover),
        [cover, bytes.byteLength, type],
        ext,
      );
      const full = await draftOf(result.channels.youtube.job_id);
      assert.equal(full.cover_image_path, cover, ext);
      const snapshot = JSON.parse(full.snapshot_text);
      assert.deepEqual(
        snapshot.media.map((m) => [m.path, m.type, m.size]),
        [
          [full.video_storage_path, "video/mp4", VIDEO.byteLength],
          [cover, type, bytes.byteLength],
        ],
        ext,
      );
      assert.equal(snapshot.source.cover_image_path, cover, ext);
      const shorts = await draftOf(result.channels.shorts.job_id);
      assert.equal(shorts.cover_image_path, null, `${ext}: Shorts には付けない`);
      assert.equal(JSON.parse(shorts.snapshot_text).media.length, 1, ext);
      assert.equal(result.channels.x, undefined);
    }
  });
  test("BOA-1172: X も出す束でも、サムネイルは完全版だけ。版（revision）は動画の後にサムネイルを足した sha256", async () => {
    const { createHash } = await import("node:crypto");
    const b = withThumbnail(bundleV2());
    const expected = createHash("sha256")
      .update(JSON.stringify(b))
      .update(VIDEO)
      .update(VIDEO)
      .update(SHORTS)
      .update(PNG)
      .digest("hex")
      .slice(0, 32);
    const thumb = { "/f/thumb-full.png": PNG };
    assert.equal(
      (await push(b, { files: thumb, dryRun: true })).revision,
      expected,
    );
    // サムネイルだけ違えば版も変わる（前の版の承認と同じ path を上書きしない）
    assert.notEqual(
      (await push(b, { files: { "/f/thumb-full.png": JPEG }, dryRun: true }))
        .revision,
      expected,
    );
    const result = await push(b, { files: thumb });
    assert.equal(result.reasons, undefined);
    assert.equal(
      (await draftOf(result.channels.x.job_id)).cover_image_path,
      null,
    );
    assert.match(
      (await draftOf(result.channels.youtube.job_id)).cover_image_path,
      /\/thumb-full\.png$/,
    );
  });
  test("BOA-1172: 欄の無い束は今までどおり（cover なし・media は1つ・版の式も同じ）。フォルダに画像があっても読まない", async () => {
    const { createHash } = await import("node:crypto");
    const b = bundleV2();
    const expected = createHash("sha256")
      .update(JSON.stringify(b))
      .update(VIDEO)
      .update(VIDEO)
      .update(SHORTS)
      .digest("hex")
      .slice(0, 32);
    const savedBefore = saved.length;
    const result = await push(b, { files: { "/f/thumb-full.png": PNG } });
    assert.equal(result.reasons, undefined);
    assert.equal(result.revision, expected);
    const full = await draftOf(result.channels.youtube.job_id);
    assert.equal(full.cover_image_path, null);
    assert.equal(JSON.parse(full.snapshot_text).media.length, 1);
    assert.ok(saved.slice(savedBefore).every(([p]) => !p.includes("thumb")));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・riskRules・RACE・NOW・VIDEO・bundle・SHORTS・files・bundleV2・saved・store・push） */
export function runSnsFullPictureScenes3(env) {
  ({ db, first, all, riskRules, RACE, NOW, VIDEO, bundle, SHORTS, files, bundleV2, saved, store, push } = env);
  scene1();
  scene2();
  scene3();
}
