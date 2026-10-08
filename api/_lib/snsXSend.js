import { buildPostText } from "../../src/pages/admin/sns-hub/utils.js";
/** X呼び出しは注入のみ。実adapter・鍵・cronは今回提供しない。 */
export const X_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
export const X_MAX_POLLS = 10;
export const X_CHUNK_BYTES = 5 * 1024 * 1024;

export async function sha256(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createXSnapshot(draft, loadMedia) {
  if (draft.source_data?.dataCardUrl)
    throw new Error("追加画像のある投稿は手動経路を使ってください");
  const path = draft.video_storage_path || draft.cover_image_path;
  const text = buildPostText(draft);
  if (!text.trim() && !path) throw new Error("内容が空です");
  const media = [];
  if (path) {
    const bytes = await loadMedia(path);
    if (!bytes.byteLength || bytes.byteLength > X_MEDIA_MAX_BYTES)
      throw new Error("媒体の容量が不正です");
    const type = path.endsWith(".mp4")
      ? "video/mp4"
      : /\.jpe?g$/i.test(path)
        ? "image/jpeg"
        : path.endsWith(".png")
          ? "image/png"
          : null;
    if (!type) throw new Error("対応していない媒体です");
    media.push({
      path,
      sha256: await sha256(bytes),
      size: bytes.byteLength,
      type,
    });
  }
  return {
    text,
    media,
    source: {
      caption_text: draft.caption_text ?? null,
      hashtags: draft.hashtags ?? null,
      video_storage_path: draft.video_storage_path ?? null,
      cover_image_path: draft.cover_image_path ?? null,
      language: draft.language,
    },
  };
}

/**
 * store.transition(id, action, result): SQL137の原子的RPC。
 * x: initialize({size,type,category}), append({id,index,bytes}), finalize(id), status(id),
 * createPost({text,mediaIds}) -> {id,posted_at}。POSTはadapter内部でも自動再試行禁止。
 * wait(seconds)は実adapter側でcheck_after_secsを尊重。DB失敗時は決して再送しない。
 */
export async function runXSendJob(id, { store, x, loadMedia, wait }) {
  if (!x || !wait) throw new Error("X adapterは未接続です");
  const job = await store.transition(id, "claim");
  let postStarted = false;
  try {
    if (
      (await sha256(new TextEncoder().encode(job.snapshot_text))) !==
      job.approved_hash
    ) {
      throw new Error("承認版のhashが一致しません");
    }
    const snapshot = JSON.parse(job.snapshot_text);
    const mediaIds = [];
    for (const m of snapshot.media) {
      const bytes = await loadMedia(m.path);
      if (bytes.byteLength !== m.size || (await sha256(bytes)) !== m.sha256)
        throw new Error("媒体が変更されています");
      await store.transition(id, "check");
      const upload = await x.initialize({
        size: m.size,
        type: m.type,
        category: m.type.startsWith("video/") ? "tweet_video" : "tweet_image",
      });
      for (
        let offset = 0, index = 0;
        offset < bytes.byteLength;
        offset += X_CHUNK_BYTES, index++
      ) {
        await store.transition(id, "check");
        await x.append({
          id: upload.id,
          index,
          bytes: bytes.slice(offset, offset + X_CHUNK_BYTES),
        });
      }
      await store.transition(id, "check");
      let result = await x.finalize(upload.id);
      for (
        let poll = 0;
        result.processing_info && result.processing_info.state !== "succeeded";
        poll++
      ) {
        if (result.processing_info.state === "failed" || poll >= X_MAX_POLLS)
          throw new Error("媒体処理が完了しません");
        await wait(Math.max(1, result.processing_info.check_after_secs || 1));
        await store.transition(id, "check");
        result = await x.status(upload.id);
      }
      mediaIds.push(upload.id);
    }
    await store.transition(id, "begin_post");
    postStarted = true;
    const result = await x.createPost({ text: snapshot.text, mediaIds });
    return await store.transition(id, "complete", result);
  } catch (error) {
    if (!postStarted) {
      // begin_postの応答喪失でもDB側reconcileをfailで戻せない。
      try {
        await store.transition(id, "fail");
      } catch {
        /* 永続状態を優先 */
      }
    }
    // API本文や認証情報をDB・ログに保存しない。
    throw error;
  }
}

/** モック専用。外部通信しない。 */
export function createMockXAdapter({
  processingStates = ["succeeded"],
  failAt,
} = {}) {
  const calls = [];
  let poll = 0;
  function record(method, payload) {
    calls.push({ method, payload });
    if (failAt === method) throw new Error("mock_failure");
  }
  function processing() {
    return {
      processing_info: {
        state: processingStates[Math.min(poll++, processingStates.length - 1)],
        check_after_secs: 1,
      },
    };
  }
  return {
    calls,
    async initialize(payload) {
      record("initialize", payload);
      return { id: "mock-media" };
    },
    async append(payload) {
      record("append", { ...payload, bytes: payload.bytes.byteLength });
    },
    async finalize(id) {
      record("finalize", id);
      return processing();
    },
    async status(id) {
      record("status", id);
      return processing();
    },
    async createPost(payload) {
      record("createPost", payload);
      return { id: "1234567890", posted_at: "2026-10-07T00:00:00Z" };
    },
  };
}
