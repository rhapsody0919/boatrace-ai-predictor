// push-research-image.js から移した、時刻・期限の定数と純粋な時刻の関数（schedule・dryRunClock・observedAtOf・checkTiming）。import なし
/** 締切は送る時刻の120分後、期限は締切の60分前（180 の transition_sns_send_139 の research_image の期限と同じ値） */
export const DEADLINE_AFTER_MIN = 120;
export const EXPIRES_BEFORE_MIN = 60;
/** 期限の10分前を過ぎて届いたら受け取らない（送り手の2分ごとの実行・リース5分を残す。目安・根拠なし） */
export const LATEST_BEFORE_EXPIRES_MIN = 10;
/** 送る時刻は早くても受け取りの2分後（送り手の1周期。push-finals-image.js の SEND_DELAY_SEC と同じ） */
export const SEND_DELAY_SEC = 120;
/** 根拠の鮮度（集計の時刻から）。180 の v_max_age と同じ */
export const MAX_SOURCE_AGE_SEC = 86400;
export const SEND_TIME_EARLIEST = "08:00";
export const SEND_TIME_LATEST = "21:30";
/** hq の集計の as_of（「2026-11-03 12R まで」） */
export const AS_OF = /^(\d{4}-\d{2}-\d{2}) \d{1,2}R まで$/;

// minutesBefore・addMin・jstTime・jstDate・isIso は SNS の送り手の共通の時刻の関数（finalsImageBase・fullPictureShape・shortSchedule が
// ここから読む。4ファイルに字のまま同じ物があったのを 2026-11-25 に寄せた）
export const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
export const addMin = (iso, min) =>
  new Date(Date.parse(iso) + min * 60000).toISOString();
export const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
export const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
/** 時差（Z か ±HH:MM）つきの ISO だけ。時差の無い文字列は Node は手元の時刻、DB は接続の TimeZone で読み、別の時刻になる */
export const isIso = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v));

/**
 * 時刻（純粋関数）。送る時刻 S＝date の send_time（JST）。item の CHECK（notify_by < veto_until < deadline_at、153）のため notify_by は今の1分前
 */
export function schedule(bundle, now) {
  const planned = new Date(
    `${bundle.date}T${bundle.send_time}:00+09:00`,
  ).toISOString();
  const deadlineAt = addMin(planned, DEADLINE_AFTER_MIN);
  const sendAt = new Date(
    Math.max(Date.parse(planned), now.getTime() + SEND_DELAY_SEC * 1000),
  ).toISOString();
  return {
    planned_at: planned,
    deadline_at: deadlineAt,
    expires_at: addMin(deadlineAt, -EXPIRES_BEFORE_MIN),
    latest: addMin(deadlineAt, -EXPIRES_BEFORE_MIN - LATEST_BEFORE_EXPIRES_MIN),
    notify_by: new Date(now.getTime() - 60000).toISOString(),
    veto_until: sendAt,
    send_at: sendAt,
  };
}

/**
 * --dry-run の時計（純粋関数）。date が今日（JST）でなければ、その日の send_time の2分前（SEND_DELAY_SEC）。今日か形が違えば null（今の時計のまま）
 */
export function dryRunClock(bundle, now) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "") ||
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(bundle?.send_time ?? "") ||
    bundle.date === jstDate(now)
  )
    return null;
  return new Date(
    Date.parse(`${bundle.date}T${bundle.send_time}:00+09:00`) -
      SEND_DELAY_SEC * 1000,
  );
}

/** 集計の時刻（ISO）。as_of（「YYYY-MM-DD NR まで」）は時刻を持たないのでその日の 00:00 JST にする（純粋関数。PUSH_RULES の注記） */
export const observedAtOf = (bundle) => {
  const asOf = AS_OF.exec(bundle?.source_observed_at ?? "");
  return asOf
    ? new Date(`${asOf[1]}T00:00:00+09:00`).toISOString()
    : bundle.source_observed_at;
};

/** 時刻の検査（純粋関数）。date は今日（JST）、期限の10分前より前、集計の時刻は今より前で期限まで24時間以内 */
export function checkTiming(
  bundle,
  when,
  now,
  observedAt = bundle.source_observed_at,
) {
  const reasons = [];
  if (bundle.date !== jstDate(now)) reasons.push("date が今日（JST）でない");
  if (now.getTime() >= Date.parse(when.latest))
    reasons.push(
      `期限（${jstTime(when.expires_at)}）の${LATEST_BEFORE_EXPIRES_MIN}分前を過ぎた`,
    );
  const observed = Date.parse(observedAt);
  if (observed > now.getTime()) reasons.push("source_observed_at が今より後");
  if (Date.parse(when.expires_at) - observed >= MAX_SOURCE_AGE_SEC * 1000)
    reasons.push(
      "source_observed_at が古い（期限までに集計から24時間を越える）",
    );
  return reasons;
}
