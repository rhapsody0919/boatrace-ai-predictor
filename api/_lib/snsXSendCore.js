/**
 * snsXSend.js から移した、定数・投票の検査・sha256・保留の理由（外部通信も store も使わない純粋な部分）。
 * 外へは snsXSend.js が同じ名で再 export する。
 */
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
// X の投票（POST /2/tweets の poll）の上限: 2〜4択、1つ25字まで、5〜10080分（7日）
export const X_POLL_MIN_OPTIONS = 2;
export const X_POLL_MAX_OPTIONS = 4;
export const X_POLL_OPTION_MAX_CHARS = 25;
export const X_POLL_MIN_MINUTES = 5;
export const X_POLL_MAX_MINUTES = 10080;

/** 投票の選択肢の不備（純粋関数）。無ければ null。字数はコードポイントで数える（絵文字・異体字は X と数えが違いうるので、使わない前提） */
export function pollOptionsIssue(options) {
  if (
    !Array.isArray(options) ||
    options.length < X_POLL_MIN_OPTIONS ||
    options.length > X_POLL_MAX_OPTIONS
  )
    return `投票の選択肢が${X_POLL_MIN_OPTIONS}〜${X_POLL_MAX_OPTIONS}個でない`;
  for (const option of options) {
    if (typeof option !== "string" || !option.trim())
      return "投票の選択肢に空がある";
    if ([...option].length > X_POLL_OPTION_MAX_CHARS)
      return `投票の選択肢「${option}」が${X_POLL_OPTION_MAX_CHARS}字を超える`;
  }
  if (new Set(options).size !== options.length)
    return "投票の選択肢が重なっている";
  return null;
}

/**
 * 投票の時間（分、純粋関数）。投票は締切（closes_at）で閉じるように、送る時の今から締切までの分（切り捨て）を
 * X の範囲（5〜10080）に収める。承認するのは締切（closes_at）で、分は送る時に決まる
 */
export function pollDurationMinutes(closesAt, nowMs) {
  const t = Date.parse(closesAt);
  if (!Number.isFinite(t)) throw new Error("poll_closes_at_invalid");
  return Math.min(
    X_POLL_MAX_MINUTES,
    Math.max(X_POLL_MIN_MINUTES, Math.floor((t - nowMs) / 60000)),
  );
}

// X の分割アップロードは1回 5 MB まで。5 MiB（5,242,880）は十進の 5 MB を超えるので、余裕をとって 4 MiB にする
export const X_CHUNK_BYTES = 4 * 1024 * 1024;

export async function sha256(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

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
  if (error?.dbRejected) return `${stage}_db_rejected`.slice(0, 64);
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
