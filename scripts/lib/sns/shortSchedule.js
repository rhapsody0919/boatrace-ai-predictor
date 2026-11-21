/**
 * YouTube Shorts の口（push-setsu-kiryoku-short.js・push-upset-win-short.js）の時刻・日の上限とクォータの純粋な部分
 * （定数・JST/PT の日付・schedule・checkTiming・youtubeRoomReason・dryRunClock）。push-setsu-kiryoku-short.js から移した（字は同じ）
 */
/** 送る時刻は早くても受け取りの2分後（送り手の1周期。push-research-image.js と同じ） */
export const SEND_DELAY_SEC = 120;
/** 送れる長さ（送る時刻から期限まで）。目安・根拠なし（送り手の2分ごとの実行で数回やり直せる長さ） */
export const EXPIRES_AFTER_SEND_MIN = 60;
/** 期限の10分前を過ぎて届いたら受け取らない（push-research-image.js と同じ目安） */
export const LATEST_BEFORE_EXPIRES_MIN = 10;
/**
 * 受け取りは送る時刻の15分前から（目安・根拠なし）。push で数えた YouTube の日の上限の空きを、後から入った全貌（push-full-picture.js は
 * 日の上限を数えない）が先に claim して使うと、この job は claim の「日次全体上限です」で queued のまま Slack が鳴り続けるため、
 * 数える時刻を送る時刻に近づける（2026-11-02 system-architect の P2）
 */
export const EARLIEST_BEFORE_SEND_MIN = 15;
export const SEND_TIME_EARLIEST = "08:00";
/** 送る時刻の上限（JST）。送り手の cron は 22:58 まで（vercel.json の sns-send、UTC 23,0-13 時）なので、期限 23:00 までに収める */
export const SEND_TIME_LATEST = "22:00";
/** dry-run で見本の束（date が今日でない）を受け取る時刻の既定（hq の型は 21:30 ごろ） */
export const DEFAULT_SEND_TIME = "21:30";
/** YouTube のクォータの1本の予約（146 の sns_youtube_quota_attempts の upload_reserved・general_reserved） */
export const QUOTA_UPLOAD_UNITS = 1;
export const QUOTA_GENERAL_UNITS = 104;

export const addMin = (iso, min) =>
  new Date(Date.parse(iso) + min * 60000).toISOString();
export const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
export const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export const ptDate = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    date,
  );
export const isHhmm = (v) =>
  typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
/** 時差（Z か ±HH:MM）つきの ISO だけ（push-research-image.js と同じ） */
export const isIso = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v));
/** フォルダの中のファイル名だけ（区切り・. と .. を拒否する） */

/**
 * 時刻（純粋関数）。送る時刻 S＝date の send_time（JST）と「今＋2分」の遅い方（send_time が無ければ今＋2分）。
 * item の CHECK（notify_by < veto_until < deadline_at、153）のため notify_by は今の1分前
 */
export function schedule(bundle, now, expiryMinutes) {
  const planned = bundle.send_time
    ? new Date(`${bundle.date}T${bundle.send_time}:00+09:00`).getTime()
    : now.getTime();
  const sendAt = new Date(
    Math.max(planned, now.getTime() + SEND_DELAY_SEC * 1000),
  ).toISOString();
  const expiresAt = addMin(sendAt, EXPIRES_AFTER_SEND_MIN);
  return {
    send_at: sendAt,
    veto_until: sendAt,
    expires_at: expiresAt,
    deadline_at: addMin(expiresAt, expiryMinutes),
    latest: addMin(expiresAt, -LATEST_BEFORE_EXPIRES_MIN),
    notify_by: new Date(now.getTime() - 60000).toISOString(),
  };
}

/** 時刻の検査（純粋関数）。maxAgeSec は sns_x_send_control.max_source_age_seconds（186 の youtube_call の鮮度の線） */
export function checkTiming(bundle, when, now, { observedAt, maxAgeSec }) {
  const reasons = [];
  if (bundle.date !== jstDate(now)) reasons.push("date が今日（JST）でない");
  if (
    jstTime(when.send_at) > SEND_TIME_LATEST ||
    jstDate(new Date(when.send_at)) !== bundle.date
  )
    reasons.push(
      `送る時刻（${jstTime(when.send_at)}）が date の ${SEND_TIME_LATEST} を過ぎる`,
    );
  if (
    Date.parse(when.send_at) - now.getTime() >
    EARLIEST_BEFORE_SEND_MIN * 60000
  )
    reasons.push(
      `送る時刻（${jstTime(when.send_at)}）の${EARLIEST_BEFORE_SEND_MIN}分前より早い（送る時刻の直前に入れる）`,
    );
  if (now.getTime() >= Date.parse(when.latest))
    reasons.push(
      `期限（${jstTime(when.expires_at)}）の${LATEST_BEFORE_EXPIRES_MIN}分前を過ぎた`,
    );
  const observed = Date.parse(observedAt);
  if (observed > now.getTime()) reasons.push("source_observed_at が今より後");
  if (!(maxAgeSec > 0))
    reasons.push("鮮度の線（max_source_age_seconds）が読めない");
  else if (Date.parse(when.expires_at) - observed >= maxAgeSec * 1000)
    reasons.push(
      `source_observed_at が古い（期限までに集計から ${maxAgeSec / 3600} 時間を越える）`,
    );
  return reasons;
}

/**
 * YouTube の日の上限とクォータに、この1本が入るか（純粋関数）。入らなければ理由の文、入れば null。
 *   日の上限（JST、transition_sns_send_139 の v_limit・day_count と同じ数え方）: 今日の YouTube の試行＋他経路＋まだ claim していない YouTube の予定（queued）＋1
 *   クォータ（PT、186 の claim の予約と同じ式）: その日の予約＋読み取り＋他経路＋まだ claim していない予定の分＋この1本の分
 * queued: まだ claim していない YouTube の job（state=queued・attempts=0・期限の前）。差し替える前の job は呼ぶ側が外す
 */
export function youtubeRoomReason({
  sendControl,
  jobs,
  queued,
  quota,
  quotaUsed,
  now,
  sendAt,
}) {
  const today = jstDate(now);
  const limit = sendControl?.daily_limit_youtube ?? sendControl?.daily_limit;
  if (!limit || sendControl.daily_baseline_date !== today)
    return "YouTube の日の上限・他経路の本数が今日の分として確かめられていない（daily_baseline_date）";
  const used = jobs.reduce(
    (n, job) =>
      n +
      (job.attempt_dates ?? []).filter(
        (day, i) => day === today && job.attempt_channels?.[i] === "youtube",
      ).length,
    0,
  );
  const external = sendControl.daily_external_count ?? 0;
  const pending = queued.filter(
    (j) => jstDate(new Date(j.scheduled_at)) === today,
  ).length;
  if (used + external + pending + 1 > limit)
    return `YouTube の日の上限 ${limit} にこの1本が入らない（今日の試行 ${used}・他経路 ${external}・まだ送っていない予定 ${pending}）`;
  if (quota?.verified !== true || !quota.upload_limit || !quota.general_limit)
    return "YouTube のクォータが確かめられていない（sns_youtube_quota_control.verified）";
  // クォータの日（PT）は claim の時に決まる。送る時刻の PT の日に基準がまだ無ければ（日付の境目の前）数を見ない（claim が最後に数える）
  if (quota.baseline_day !== ptDate(new Date(sendAt))) return null;
  const pendingQuota = queued.filter(
    (j) => ptDate(new Date(j.scheduled_at)) === quota.baseline_day,
  ).length;
  const uploads =
    quotaUsed.uploads +
    quota.external_uploads +
    pendingQuota * QUOTA_UPLOAD_UNITS;
  const general =
    quotaUsed.general +
    quota.external_general +
    pendingQuota * QUOTA_GENERAL_UNITS;
  if (
    uploads + QUOTA_UPLOAD_UNITS > quota.upload_limit ||
    general + QUOTA_GENERAL_UNITS > quota.general_limit
  )
    return `YouTube のクォータにこの1本（${QUOTA_UPLOAD_UNITS} upload・${QUOTA_GENERAL_UNITS} units）が入らない（予約 upload ${uploads}/${quota.upload_limit}・units ${general}/${quota.general_limit}）`;
  return null;
}

/** dry-run の時計。date が今日なら今、違えば（見本の束）その日の送る時刻（send_time、無ければ defaultSendTime）の2分前（純粋関数） */
export function dryRunClock(bundle, now, defaultSendTime = DEFAULT_SEND_TIME) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "") ||
    bundle.date === jstDate(now)
  )
    return null;
  const at = isHhmm(bundle.send_time) ? bundle.send_time : defaultSendTime;
  return new Date(
    Date.parse(`${bundle.date}T${at}:00+09:00`) - SEND_DELAY_SEC * 1000,
  );
}
