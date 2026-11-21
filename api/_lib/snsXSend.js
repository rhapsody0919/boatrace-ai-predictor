/** X呼び出しは注入のみ。実adapter・鍵・cronは今回提供しない。 */
// 定数・投票の検査・sha256・保留の理由は snsXSendCore.js へ移した。外へは同じ名で出す
export {
  holdReasonOf,
  pollDurationMinutes,
  pollOptionsIssue,
  sha256,
  waitSecsOf,
  X_CHUNK_BYTES,
  X_MAX_POLLS,
  X_MAX_WAIT_SECS,
  X_MEDIA_MAX_BYTES,
  X_POLL_MAX_MINUTES,
  X_POLL_MAX_OPTIONS,
  X_POLL_MIN_MINUTES,
  X_POLL_MIN_OPTIONS,
  X_POLL_OPTION_MAX_CHARS,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "./snsXSendCore.js";

// 本体（snapshot・送信・偽の adapter）は scripts/lib/sns/xSend.js（送信の runner が api/ を読まないため）。外へは同じ名で出す
export {
  mobileVersion,
  createXSnapshot,
  runXSendJob,
  createMockXAdapter,
} from "../../scripts/lib/sns/xSend.js";
