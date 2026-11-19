// 優勝戦・思考投稿の画像投稿（push-finals-image.js）から移した、api・scripts/sns に依らない定数と純粋関数（形式名・画像と時刻の定数・PNG と画像の検査・締切の時刻・日の上限・投票の有無・job の状態）。

export const FINALS_IMAGE_FORMAT = "finals_image";
/** 展示後のリプの bundle の format（下書きの format・item の kind は本投稿と同じ finals_image） */
export const FINALS_REPLY_FORMAT = "finals_reply";
export const FINALS_STAGE = "優勝戦";
/**
 * 画像の名前の後ろ（hq の finals_run.py の出力は <race_id>-1-map.png の形）。bundle.images がこの順の4つちょうどであること。
 * snsXSend.js は snapshot.media を順に上げて1投稿にまとめる（先頭は cover_image_path）
 */
export const IMAGE_SUFFIXES = [
  "1-map.png",
  "2-q12.png",
  "3-q3.png",
  "4-routes.png",
];
export const imageNamesOf = (raceId) =>
  IMAGE_SUFFIXES.map((suffix) => `${raceId}-${suffix}`);
export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
/** 1枚の上限。承認の関数（160）の X の画像の上限と同じ（X の画像の上限 5MB 以内） */
export const IMAGE_MAX_BYTES = 5000000;
/** 期限（送り手が送れる最後）は締切の5分前。transition_sns_send_139（176）の finals_image の期限と同じ値 */
export const EXPIRES_BEFORE_MIN = 5;
/**
 * 本投稿を受け取る最後は締切の15分前（目安・根拠は送り手の周期）。本投稿の後に投票のリプを期限（5分前）までに送るので、
 * 送る時刻の遅らせ2分＋本投稿と投票のリプの送り手の実行（2分ごと）2回分＋リース5分を残す（/code-review の指摘。これより短いと投票のリプが期限に間に合わない）
 */
export const LATEST_BEFORE_MIN = 15;
/**
 * 送る時刻は受け取りの2分後（送り手の1周期）。本投稿を承認してから投票のリプを承認するまでの間に、送り手が本投稿を
 * claim して（子の枠を数えずに）送るのを防ぐ。投票のリプの承認に落ちたら、送る時刻の前に item を held_manual にして止める
 */
export const SEND_DELAY_SEC = 120;
/** 展示後のリプを受け取る窓は締切の25分前から13分前まで（13分前ちょうどは受け取らない。オーナー 2026-10-26） */
export const REPLY_EARLIEST_BEFORE_MIN = 25;
export const REPLY_LATEST_BEFORE_MIN = 13;
/** hq と決めた禁止表現（risk-rules.json に加えて見る。NFKC でそろえて含むかを見る） */
export const BANNED_WORDS = ["必ず当たる", "稼げる", "万舟券", "儲か", "競艇"];
/** 投票は4択（A〜D の道、hq の finals_sheet.py の poll_options） */
export const POLL_OPTIONS = 4;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** /today の対象レースの思考投稿（BOA-1169、189）の bundle の format。下書きの format は3本とも TODAY_THINKING_IMAGE_FORMAT */
export const TODAY_THINKING_IMAGE_FORMAT = "today_thinking_image";
export const TODAY_THINKING_REPLY_FORMAT = "today_thinking_reply";

export const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
export const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
export const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** 値が空でないか（null・undefined・空の配列・空白だけの文字列は空） */
const present = (v) =>
  Array.isArray(v)
    ? v.length > 0
    : typeof v === "string"
      ? v.trim() !== ""
      : v != null;

/**
 * bundle に投票（poll・poll_text のどちらか）があるか（純粋関数）。無ければ投票のリプを作らない（BOA-1208）。
 * キーが無い・null・空（[]・""）はどれも「投票なし」
 */
export function hasPoll(bundle) {
  return present(bundle?.poll) || present(bundle?.poll_text);
}

/** PNG の幅と高さ（IHDR）。PNG でなければ null */
export function pngSize(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 24 ||
    PNG_SIGNATURE.some((b, i) => bytes[i] !== b)
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 画像4枚の検査（純粋関数）。names は bundle.images、files は名前→バイト（無いものは undefined） */
export function checkImages(names, files) {
  const reasons = [];
  for (const name of names) {
    const bytes = files[name];
    if (!bytes) {
      reasons.push(`${name} が無い`);
      continue;
    }
    if (bytes.byteLength < 1 || bytes.byteLength > IMAGE_MAX_BYTES)
      reasons.push(`${name} の大きさが不正（${bytes.byteLength} バイト）`);
    const size = pngSize(bytes);
    if (!size) reasons.push(`${name} が PNG でない`);
    else if (size.width !== IMAGE_WIDTH || size.height !== IMAGE_HEIGHT)
      reasons.push(
        `${name} が ${IMAGE_WIDTH}×${IMAGE_HEIGHT} でない（${size.width}×${size.height}）`,
      );
  }
  return reasons;
}

/**
 * 締切まわりの時刻（純粋関数）。止められる期限（veto_until）は今、送る時刻は SEND_DELAY_SEC の後。
 * item の CHECK（notify_by < veto_until < deadline_at、153）のため、notify_by は今の1分前
 */
export function schedule(deadlineAt, now) {
  return {
    deadline_at: deadlineAt,
    expires_at: minutesBefore(deadlineAt, EXPIRES_BEFORE_MIN),
    latest: minutesBefore(deadlineAt, LATEST_BEFORE_MIN),
    notify_by: new Date(now.getTime() - 60000).toISOString(),
    veto_until: now.toISOString(),
    send_at: new Date(now.getTime() + SEND_DELAY_SEC * 1000).toISOString(),
  };
}

/**
 * X の日の上限（sns_x_send_control.daily_limit_x、無ければ daily_limit）に need 本が入るか（純粋関数）。
 * 数え方は transition_sns_send_139 の claim と同じ（今日の JST の X の試行＋他経路の本数＋need）。入らなければ理由を返す。
 * 入らないまま job を作ると、claim が「日次全体上限です」で投げ続け、期限まで2分ごとに Slack が鳴る（2026-10-26 system-architect の P1）。
 * 投票のある本投稿は投票のリプと対で need=2（177 の claim も親の claim で子の分を数える）。投票の無い本投稿は need=1（BOA-1208）。
 * 本投稿（子でない job）は、177 の claim と同じく、他の親の予約の子（children のうち、親が今日 claim 済みのもの）も数える。
 * 展示後のリプ（子）は他の子を数えない（177 と同じ）
 */
export function dailyLimitReason({
  sendControl,
  jobs,
  now,
  need = 1,
  children = [],
}) {
  const limit = sendControl?.daily_limit_x ?? sendControl?.daily_limit;
  const today = jstDate(now);
  if (!limit || sendControl.daily_baseline_date !== today)
    return "X の日の上限・他経路の本数が今日の分として確かめられていない（daily_baseline_date）";
  const used = jobs.reduce(
    (n, job) =>
      n +
      (job.attempt_dates ?? []).filter(
        (day, i) => day === today && job.attempt_channels?.[i] === "x",
      ).length,
    0,
  );
  const external = sendControl.daily_external_count ?? 0;
  const reserved = reservedChildren({ jobs, children, today, now });
  return used + external + reserved + need > limit
    ? `X の日の上限 ${limit} に${need}本が入らない（今日の試行 ${used}・他経路 ${external}・予約の子 ${reserved}）`
    : null;
}

/**
 * 他の親の予約の子の数（純粋関数）。177 の transition_sns_send_139 の v_children の「他の親の子」と同じ条件:
 * 子は X・queued・attempts=0・期限の前・下書きの bundle_import_id が NULL（children は store.waitingChildren がこの形で読む）、
 * 親は今日の試行があり sending・reconcile・posted（jobs は今日の試行のある job）
 */
export function reservedChildren({ jobs, children, today, now }) {
  const claimed = new Set(
    jobs
      .filter(
        (job) =>
          ["sending", "reconcile", "posted"].includes(job.state) &&
          (job.attempt_dates ?? []).includes(today),
      )
      .map((job) => job.id),
  );
  return children.filter(
    (c) =>
      c.channel === "x" &&
      c.state === "queued" &&
      c.attempts === 0 &&
      Date.parse(c.expires_at) > now.getTime() &&
      c.bundle_import_id == null &&
      claimed.has(c.parent_job_id),
  ).length;
}

/** 作り直してよい job の状態（送らずに終わった） */
export const RETRYABLE_JOB_STATES = ["held", "failed", "cancelled"];

/** item と job から、hq に返す状態（純粋関数） */
export const statusOf = (raceId, item, job) => ({
  race_id: raceId,
  item_state: item?.state ?? null,
  job_id: job?.id ?? null,
  job_state: job?.state ?? null,
  error_code: job?.error_code ?? null,
  posted_at: job?.posted_at ?? null,
  tweet_id: job?.external_post_id ?? null,
  tweet_url: job?.external_post_url ?? null,
});
