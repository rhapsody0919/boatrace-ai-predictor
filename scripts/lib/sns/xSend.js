// X の送信（snapshot の作成・runXSendJob・偽の adapter）。api/_lib/snsXSend.js から字のまま移した（api/ 側は再 export）。X の呼び出しは注入のみ
import { buildPostText } from "../../../src/pure/snsPostText.js";
import {
  pollDurationMinutes,
  pollOptionsIssue,
  sha256,
  waitSecsOf,
  holdReasonOf,
  X_CHUNK_BYTES,
  X_MAX_POLLS,
  X_MEDIA_MAX_BYTES,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "./xSendCore.js";

/** SQL140 revisionと実媒体snapshotによる既存の確認版。 */
export async function mobileVersion(revision, snapshot) {
  return sha256(new TextEncoder().encode(JSON.stringify([revision, snapshot])));
}

/** 媒体の path から Content-Type を決める（対応外は null） */
function mediaTypeOf(path) {
  if (path.endsWith(".mp4")) return "video/mp4";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  return null;
}

/** 下書きから載せる媒体の path の列（YouTube は動画＋cover、X は画像の複数枚か先頭の1つ） */
function snapshotPaths(draft, path) {
  if (draft.platform === "youtube")
    return [path, draft.cover_image_path].filter(Boolean);
  return Array.isArray(draft.source_data?.image_paths)
    ? draft.source_data.image_paths // X の画像の複数枚（/today、160）。先頭は cover_image_path
    : [path].filter(Boolean);
}

/** 投票（優勝戦の投票のリプ、177）の検査。X は投票と媒体を同じ投稿に載せられない。不備は投げる */
function assertPollSnapshot(poll, paths) {
  const issue = pollOptionsIssue(poll?.options);
  if (issue) throw new Error(issue);
  if (paths.length) throw new Error("投票と媒体は同じ投稿に載せられない");
  if (!Number.isFinite(Date.parse(poll.closes_at)))
    throw new Error("投票の締切（closes_at）が不正です");
}

/** 媒体を順に読んで、path・sha256・size・type の列にする */
async function loadSnapshotMedia(paths, loadMedia, maxBytes) {
  const media = [];
  for (const path of paths) {
    const bytes = await loadMedia(path, maxBytes);
    if (!bytes.byteLength || bytes.byteLength > maxBytes)
      throw new Error("媒体の容量が不正です");
    const type = mediaTypeOf(path);
    if (!type) throw new Error("対応していない媒体です");
    media.push({
      path,
      sha256: await sha256(bytes),
      size: bytes.byteLength,
      type,
    });
  }
  return media;
}

/** snapshot の text・media の後ろに付く鍵（poll・youtube_title・queue。この順） */
function snapshotExtras(draft, poll) {
  return {
    ...(poll !== undefined
      ? { poll: { options: poll.options, closes_at: poll.closes_at } }
      : {}),
    ...(draft.platform === "youtube" ? { youtube_title: draft.title } : {}),
    ...(draft.source_data?.deadline_queue
      ? { queue: draft.source_data.deadline_queue }
      : {}),
  };
}

/** snapshot の source（元の下書きの写し） */
function snapshotSource(draft) {
  return {
    caption_text: draft.caption_text ?? null,
    hashtags: draft.hashtags ?? null,
    video_storage_path: draft.video_storage_path ?? null,
    cover_image_path: draft.cover_image_path ?? null,
    language: draft.language,
  };
}

export async function createXSnapshot(draft, loadMedia) {
  if (draft.source_data?.dataCardUrl)
    throw new Error("追加画像のある投稿は手動経路を使ってください");
  const path = draft.video_storage_path || draft.cover_image_path;
  const text = buildPostText(draft);
  if (!text.trim() && !path) throw new Error("内容が空です");
  const maxBytes =
    draft.platform === "youtube" ? YOUTUBE_MEDIA_MAX_BYTES : X_MEDIA_MAX_BYTES;
  const paths = snapshotPaths(draft, path);
  // 投票（優勝戦の投票のリプ、177）: 下書きの source_data.x_poll を写す
  const poll = draft.platform === "x" ? draft.source_data?.x_poll : undefined;
  if (poll !== undefined) assertPollSnapshot(poll, paths);
  const media = await loadSnapshotMedia(paths, loadMedia, maxBytes);
  return {
    text,
    media,
    ...snapshotExtras(draft, poll),
    source: snapshotSource(draft),
  };
}

/**
 * store.transition(id, action, result): SQL137の原子的RPC。
 * x: initialize({size,type,category}), append({id,index,bytes}), finalize(id), status(id),
 * createPost({text,mediaIds}) -> {id,posted_at}。POSTはadapter内部でも自動再試行禁止。
 * wait(seconds)は実adapter側でcheck_after_secsを尊重。DB失敗時は決して再送しない。
 */
/** store.transition の拒否（DB/RPC）と媒体・X の失敗を区別する check を作る（元は runXSendJob の中） */
function makeCheck(store, id) {
  return async (action) => {
    let current;
    try {
      current = await store.transition(id, action);
    } catch (error) {
      // DB（RPC）が拒否した。媒体・X の失敗と区別する（「段階_db_rejected」）
      error.dbRejected = true;
      throw error;
    }
    if (current.state === "held") throw new Error(current.error_code);
    return current;
  };
}

/** 承認版の hash・チャネルの検査（元は runXSendJob の try の頭）。不備は投げる */
async function assertApprovedJob(job) {
  if (
    (await sha256(new TextEncoder().encode(job.snapshot_text))) !==
    job.approved_hash
  ) {
    throw new Error("承認版のhashが一致しません");
  }
  if (job.channel && job.channel !== "x") throw new Error("チャネルが違います");
}

/** 投票は begin_post の前に形を確かめ、時間（分）を決める。投票が無ければ null。st.stage は元の stage */
function pollForPost(snapshot, now, st) {
  if (snapshot.poll === undefined) return null;
  st.stage = "poll";
  const issue = pollOptionsIssue(snapshot.poll?.options);
  if (issue || snapshot.media?.length) throw new Error("poll_invalid");
  let minutes;
  try {
    minutes = pollDurationMinutes(snapshot.poll.closes_at, now());
  } catch {
    throw new Error("poll_invalid");
  }
  return { options: snapshot.poll.options, duration_minutes: minutes };
}

/** finalize の後、媒体の処理が済むまで待って status を引く（元の for の中身） */
async function awaitMediaProcessing(first, upload, { x, wait, check, st }) {
  let result = first;
  for (
    let poll = 0;
    result.processing_info && result.processing_info.state !== "succeeded";
    poll++
  ) {
    if (result.processing_info.state === "failed" || poll >= X_MAX_POLLS)
      throw new Error("媒体処理が完了しません");
    await wait(waitSecsOf(result.processing_info));
    await check("check");
    st.stage = "x_status";
    result = await x.status(upload.id);
  }
  return result;
}

/** 媒体1つを読み・分割して上げ・処理の完了を待ち、upload.id を返す（元の for-of の中身） */
async function uploadOneMedia(m, ctx) {
  const { x, loadMedia, check, st } = ctx;
  st.stage = "media_load";
  const bytes = await loadMedia(m.path);
  if (bytes.byteLength !== m.size || (await sha256(bytes)) !== m.sha256)
    throw new Error("媒体が変更されています");
  await check("check");
  st.stage = "x_initialize";
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
    st.stage = "x_append";
    await x.append({
      id: upload.id,
      index,
      bytes: bytes.slice(offset, offset + X_CHUNK_BYTES),
    });
  }
  await check("check");
  st.stage = "x_finalize";
  await awaitMediaProcessing(await x.finalize(upload.id), upload, ctx);
  return upload.id;
}

/** 返信先（親の job の投稿 id）。親があるのに投稿されていなければ投げる。親が無ければ null */
async function replyToOf(snapshot, store) {
  const replyTo = snapshot.queue?.parent_job_id
    ? (await store.parent(snapshot.queue.parent_job_id)).external_post_id
    : null;
  if (snapshot.queue?.parent_job_id && !replyTo)
    throw new Error("parent_not_posted");
  return replyTo;
}

/** begin_post の前に保留へ落とす（送っていない）。理由は holdReasonOf。DB の失敗は握って永続状態を優先 */
async function holdUnsent(store, id, error, stage) {
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

export async function runXSendJob(
  id,
  { store, x, loadMedia, wait, preflight, now = () => Date.now() },
) {
  if (!x || !wait) throw new Error("X adapterは未接続です");
  const job = await store.transition(id, "claim");
  if (job.state !== "sending") return job;
  let postStarted = false;
  // どの段階で落ちたか（保留の理由に入れる）。取り出した関数へ渡すので object に持つ
  const st = { stage: "precheck" };
  const check = makeCheck(store, id);
  try {
    await assertApprovedJob(job);
    if (!preflight) throw new Error("送信前検査は未接続です");
    st.stage = "preflight";
    await preflight(job);
    const snapshot = JSON.parse(job.snapshot_text);
    // 投票は begin_post の前に形を確かめ、時間（分）を決める（後で落ちると、何も送っていない job が要照合に残る）
    const poll = pollForPost(snapshot, now, st);
    const mediaIds = [];
    for (const m of snapshot.media) {
      mediaIds.push(await uploadOneMedia(m, { x, loadMedia, wait, check, st }));
    }
    const replyTo = await replyToOf(snapshot, store);
    st.stage = "preflight_before_post";
    await preflight(job);
    await check("begin_post");
    postStarted = true;
    const result = await x.createPost({
      text: snapshot.text,
      mediaIds,
      ...(replyTo ? { replyTo } : {}),
      ...(poll ? { poll } : {}),
    });
    return await store.transition(id, "complete", result);
  } catch (error) {
    if (!postStarted) {
      await holdUnsent(store, id, error, st.stage);
    } else {
      // begin_post の後（要照合、出たかもしれない）。runner は送らなかった理由と分けて stage=after_post に残す（BOA-1201）
      error.postStarted = true;
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
