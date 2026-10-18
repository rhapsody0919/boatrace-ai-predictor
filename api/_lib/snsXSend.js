import { buildPostText } from "../../src/pages/admin/sns-hub/utils.js";
/** X呼び出しは注入のみ。実adapter・鍵・cronは今回提供しない。 */
export const X_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
/** YouTube の動画も 32 MiB まで（youtubeQueueAdapter.js は1回の multipart で上げるため。承認と送信の上限をそろえる、2026-10-13）。 */
export const YOUTUBE_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
export const X_MAX_POLLS = 10;
// 媒体の処理の待ちは1回 1〜30 秒に収める（極端な値で関数が時間切れになり、job が sending のまま残るのを防ぐ。2026-10-13 オーケストレーター決定）
export const X_MAX_WAIT_SECS = 30;

/** check_after_secs を待つ秒数にする。無ければ1秒、数でなければ投げる（begin_post の前なので保留になる） */
export function waitSecsOf(info) {
  const secs = info.check_after_secs;
  if (secs === undefined) return 1;
  if (typeof secs !== "number" || !Number.isFinite(secs))
    throw new Error("媒体の処理の待ち時間（check_after_secs）が不正です");
  return Math.min(X_MAX_WAIT_SECS, Math.max(1, secs));
}
// X の分割アップロードは1回 5 MB まで。5 MiB（5,242,880）は十進の 5 MB を超えるので、余裕をとって 4 MiB にする
export const X_CHUNK_BYTES = 4 * 1024 * 1024;

export async function sha256(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** SQL140 revisionと実媒体snapshotによる既存の確認版。 */
export async function mobileVersion(revision, snapshot) {
  return sha256(new TextEncoder().encode(JSON.stringify([revision, snapshot])));
}

export async function createXSnapshot(draft, loadMedia) {
  if (draft.source_data?.dataCardUrl)
    throw new Error("追加画像のある投稿は手動経路を使ってください");
  const path = draft.video_storage_path || draft.cover_image_path;
  const text = buildPostText(draft);
  if (!text.trim() && !path) throw new Error("内容が空です");
  const media = [];
  const maxBytes =
    draft.platform === "youtube" ? YOUTUBE_MEDIA_MAX_BYTES : X_MEDIA_MAX_BYTES;
  const paths =
    draft.platform === "youtube"
      ? [path, draft.cover_image_path].filter(Boolean)
      : Array.isArray(draft.source_data?.image_paths)
        ? draft.source_data.image_paths // X の画像の複数枚（/today、160）。先頭は cover_image_path
        : [path].filter(Boolean);
  for (const path of paths) {
    const bytes = await loadMedia(path, maxBytes);
    if (!bytes.byteLength || bytes.byteLength > maxBytes)
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
    ...(draft.platform === "youtube" ? { youtube_title: draft.title } : {}),
    ...(draft.source_data?.deadline_queue
      ? { queue: draft.source_data.deadline_queue }
      : {}),
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
// HTTP の状態の種類（DB の error_code は英小文字と _ だけ。数字を入れられない）
const HTTP_KINDS = {
  400: "bad_request",
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "too_large",
  429: "rate_limited",
};
/**
 * 保留の理由（純粋関数）。英小文字と _ の理由はそのまま。それ以外は「段階_種類」にする（API の本文・鍵は入れない）。
 * 2026-10-18、/today の初めての実送信が preflight_or_media_failed だけを残し、どこで落ちたか分からなかった
 */
export function holdReasonOf(error, stage) {
  const message = String(error?.message ?? "");
  if (/^[a-z_]{1,64}$/.test(message)) return message;
  const status = Number(message.match(/HTTP (\d{3})/)?.[1]);
  const kind = status
    ? (HTTP_KINDS[status] ?? (status >= 500 ? "server_error" : "http_error"))
    : /browser has been closed|Target page/.test(message)
      ? "browser_closed"
      : /timeout|Timeout/.test(message)
        ? "timeout"
        : /媒体が変更/.test(message)
          ? "media_changed"
          : /媒体処理が完了しません/.test(message)
            ? "processing_failed"
            : "error";
  return `${stage}_${kind}`.slice(0, 64);
}

export async function runXSendJob(
  id,
  { store, x, loadMedia, wait, preflight },
) {
  if (!x || !wait) throw new Error("X adapterは未接続です");
  const job = await store.transition(id, "claim");
  if (job.state !== "sending") return job;
  let postStarted = false;
  // どの段階で落ちたか（保留の理由に入れる）
  let stage = "precheck";
  const check = async (action) => {
    const current = await store.transition(id, action);
    if (current.state === "held") throw new Error(current.error_code);
    return current;
  };
  try {
    if (
      (await sha256(new TextEncoder().encode(job.snapshot_text))) !==
      job.approved_hash
    ) {
      throw new Error("承認版のhashが一致しません");
    }
    if (job.channel && job.channel !== "x")
      throw new Error("チャネルが違います");
    if (!preflight) throw new Error("送信前検査は未接続です");
    stage = "preflight";
    await preflight(job);
    const snapshot = JSON.parse(job.snapshot_text);
    const mediaIds = [];
    for (const m of snapshot.media) {
      stage = "media_load";
      const bytes = await loadMedia(m.path);
      if (bytes.byteLength !== m.size || (await sha256(bytes)) !== m.sha256)
        throw new Error("媒体が変更されています");
      await check("check");
      stage = "x_initialize";
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
        await check("check");
        stage = "x_append";
        await x.append({
          id: upload.id,
          index,
          bytes: bytes.slice(offset, offset + X_CHUNK_BYTES),
        });
      }
      await check("check");
      stage = "x_finalize";
      let result = await x.finalize(upload.id);
      for (
        let poll = 0;
        result.processing_info && result.processing_info.state !== "succeeded";
        poll++
      ) {
        if (result.processing_info.state === "failed" || poll >= X_MAX_POLLS)
          throw new Error("媒体処理が完了しません");
        await wait(waitSecsOf(result.processing_info));
        await check("check");
        stage = "x_status";
        result = await x.status(upload.id);
      }
      mediaIds.push(upload.id);
    }
    const replyTo = snapshot.queue?.parent_job_id
      ? (await store.parent(snapshot.queue.parent_job_id)).external_post_id
      : null;
    if (snapshot.queue?.parent_job_id && !replyTo)
      throw new Error("parent_not_posted");
    stage = "preflight_before_post";
    await preflight(job);
    await check("begin_post");
    postStarted = true;
    const result = await x.createPost({
      text: snapshot.text,
      mediaIds,
      ...(replyTo ? { replyTo } : {}),
    });
    return await store.transition(id, "complete", result);
  } catch (error) {
    if (!postStarted) {
      const reason = holdReasonOf(error, stage);
      // API本文や認証情報をDB・ログに保存しない（adapter の例外は「X API … が失敗: HTTP 403 種類」の形で、本文を含まない）
      console.error(`X 送信 ${id} を保留: ${reason}: ${error.message}`);
      // begin_postの応答喪失でもDB側reconcileをfailで戻せない。
      try {
        await store.transition(id, "hold", { reason });
      } catch {
        /* 永続状態を優先 */
      }
      // 送信の側（snsSendRunner）の report にも同じ理由を残す
      error.holdReason = reason;
    }
    // API本文や認証情報をDB・ログに保存しない。
    throw error;
  }
}

/** モック専用。外部通信しない。 */
export function createMockXAdapter({
  processingStates = ["succeeded"],
  failAt,
  postId = "1234567890",
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
      return { id: postId, posted_at: "2026-10-07T00:00:00Z" };
    },
  };
}
