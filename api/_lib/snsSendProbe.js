/**
 * 送信の試験（投稿しない）。2026-10-18 の /today の初めての実送信が preflight_or_media_failed で止まり、
 * X の API 側か Chromium 側かを本番で切り分けるために使う（管理 API /api/admin/sns-hub/send-probe）。
 *
 * - media: 本番の X の鍵で、媒体のアップロード（initialize → append → finalize → status）だけを行う。投稿（createPost）は呼ばない
 * - display: 送る前の表示の確認（未ログインの Chromium、checkPublicDisplay）だけを行う
 * 結果は段階ごとに ok と、落ちたら「段階_種類」（holdReasonOf、#1620 と同じ）を返す。API の本文・鍵は返さない
 */
import {
  X_CHUNK_BYTES,
  X_MAX_POLLS,
  holdReasonOf,
  waitSecsOf,
} from "./snsXSend.js";
import { checkPublicDisplay } from "./snsDeadlineQueue.js";

const typeOf = (path) =>
  path.endsWith(".mp4")
    ? "video/mp4"
    : /\.jpe?g$/i.test(path)
      ? "image/jpeg"
      : path.endsWith(".png")
        ? "image/png"
        : null;

/** 媒体1つをアップロードする（投稿しない）。返り値: { path, ok, reason?, media_id?, state?, seconds } */
export async function probeMedia(path, { x, loadMedia, wait, now = Date.now }) {
  const started = now();
  let stage = "media_load";
  try {
    const type = typeOf(path);
    if (!type) throw new Error("unsupported_media_type");
    const bytes = await loadMedia(path);
    stage = "x_initialize";
    const upload = await x.initialize({
      size: bytes.byteLength,
      type,
      category: type.startsWith("video/") ? "tweet_video" : "tweet_image",
    });
    stage = "x_append";
    for (
      let offset = 0, index = 0;
      offset < bytes.byteLength;
      offset += X_CHUNK_BYTES, index++
    )
      await x.append({
        id: upload.id,
        index,
        bytes: bytes.slice(offset, offset + X_CHUNK_BYTES),
      });
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
      stage = "x_status";
      result = await x.status(upload.id);
    }
    return {
      path,
      ok: true,
      media_id: upload.id,
      bytes: bytes.byteLength,
      state: result.processing_info?.state ?? "no_processing",
      seconds: Math.round((now() - started) / 1000),
    };
  } catch (error) {
    console.error(`送信の試験 ${path}: ${stage}: ${error.message}`);
    return {
      path,
      ok: false,
      reason: holdReasonOf(error, stage),
      seconds: Math.round((now() - started) / 1000),
    };
  }
}

/** 送る前の表示の確認だけを行う。返り値: { url, ok, reason?, seconds } */
export async function probeDisplay(
  { url, screen_key },
  { headless, markers, now = Date.now },
) {
  const started = now();
  try {
    await checkPublicDisplay(
      { public_url: url, screen_key },
      headless,
      markers,
    );
    return { url, ok: true, seconds: Math.round((now() - started) / 1000) };
  } catch (error) {
    console.error(`送信の試験 表示 ${url}: ${error.message}`);
    return {
      url,
      ok: false,
      reason: holdReasonOf(error, "preflight"),
      ...(headless.launchInfo ? { launch: headless.launchInfo() } : {}),
      seconds: Math.round((now() - started) / 1000),
    };
  }
}
