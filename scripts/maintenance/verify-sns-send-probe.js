// 送信の試験（投稿しない、api/_lib/snsSendProbe.js・/api/admin/sns-hub/send-probe、2026-10-18）の再現テスト。外部接続なし。
// 投稿（createPost）を一度も呼ばないこと、落ちた段階を「段階_種類」で返すことを固定する
import { test } from "node:test";
import assert from "node:assert/strict";
import { probeDisplay, probeMedia } from "../../api/_lib/snsSendProbe.js";
import { createMockXAdapter } from "../../api/_lib/snsXSend.js";
import { createMockHeadless } from "../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";

const bytes = new Uint8Array(5 * 1024 * 1024);

test("媒体の試験: initialize → append（4 MiB ずつ）→ finalize → status まで行い、投稿（createPost）は呼ばない", async () => {
  const x = createMockXAdapter({
    processingStates: ["in_progress", "succeeded"],
  });
  const result = await probeMedia("a/video.mp4", {
    x,
    loadMedia: async () => bytes,
    wait: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, "succeeded");
  const methods = x.calls.map((c) => c.method);
  assert.deepEqual(methods.slice(0, 3), ["initialize", "append", "append"]);
  assert.ok(methods.includes("finalize") && methods.includes("status"));
  assert.ok(!methods.includes("createPost"));
  assert.equal(x.calls[0].payload.category, "tweet_video");
});

test("媒体の試験: 落ちた段階を「段階_種類」で返す（API の本文は返さない）", async () => {
  const forbidden = {
    initialize: async () => {
      throw new Error(
        "X API POST /2/media/upload/initialize が失敗: HTTP 403 client-forbidden",
      );
    },
  };
  const r = await probeMedia("a/b.png", {
    x: forbidden,
    loadMedia: async () => bytes,
    wait: async () => {},
  });
  assert.deepEqual([r.ok, r.reason], [false, "x_initialize_forbidden"]);
  const missing = await probeMedia("a/b.png", {
    x: forbidden,
    loadMedia: async () => {
      throw new Error("Storage 404");
    },
    wait: async () => {},
  });
  assert.equal(missing.reason, "media_load_error");
  assert.equal(
    (
      await probeMedia("a/b.gif", {
        x: forbidden,
        loadMedia: async () => bytes,
        wait: async () => {},
      })
    ).reason,
    "unsupported_media_type",
  );
});

test("表示の試験: 印が見えれば ok、欠ければ public_component_missing。Chromium が落ちたら preflight_browser_closed", async () => {
  const ok = await probeDisplay(
    { url: "https://www.boat-ai.jp/today", screen_key: "today" },
    {
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
    },
  );
  assert.equal(ok.ok, true);
  const missing = await probeDisplay(
    { url: "https://www.boat-ai.jp/today", screen_key: "today" },
    {
      headless: createMockHeadless({ visibleSelectors: [] }),
      markers: SCREEN_MARKERS,
    },
  );
  assert.deepEqual(
    [missing.ok, missing.reason],
    [false, "public_component_missing"],
  );
  const crashed = await probeDisplay(
    { url: "https://www.boat-ai.jp/today", screen_key: "today" },
    {
      headless: {
        inspect: async () => {
          throw new Error(
            "browserContext.newPage: Target page, context or browser has been closed",
          );
        },
      },
      markers: SCREEN_MARKERS,
    },
  );
  assert.equal(crashed.reason, "preflight_browser_closed");
});

test("YouTube の試験: 非公開で上げ、処理の完了を待ち、削除する。公開（makePublic）は呼ばない", async () => {
  const { probeYoutube } = await import("../../api/_lib/snsSendProbe.js");
  const calls = [];
  const states = ["processing", "processing", "succeeded"];
  const adapter = {
    upload: async (a) => {
      calls.push(["upload", a.privacyStatus]);
      return a.uploaded("abcdefghijk");
    },
    processing: async () => ({
      processingStatus: states.shift(),
      privacyStatus: "private",
    }),
    makePublic: async () => calls.push(["makePublic"]),
  };
  const deleted = [];
  const r = await probeYoutube("p/v.mp4", {
    adapter,
    loadMedia: async () => new Uint8Array(10),
    wait: async () => {},
    deleteVideo: async (id) => deleted.push(id),
  });
  assert.equal(r.ok, true);
  assert.equal(r.processing, "succeeded");
  assert.deepEqual(calls, [["upload", "private"]]);
  assert.deepEqual(deleted, ["abcdefghijk"]);
  // 上げた後に落ちても削除する
  const failing = await probeYoutube("p/v.mp4", {
    adapter: {
      ...adapter,
      processing: async () => {
        throw new Error(
          "YouTube API GET /youtube/v3/videos が失敗: HTTP 403 forbidden",
        );
      },
    },
    loadMedia: async () => new Uint8Array(10),
    wait: async () => {},
    deleteVideo: async (id) => deleted.push(id),
  });
  assert.equal(failing.reason, "youtube_processing_forbidden");
  assert.equal(failing.deleted, true);
});
