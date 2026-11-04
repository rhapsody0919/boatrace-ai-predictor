/**
 * YouTube Shorts「節の機力」（format・kind = setsu_kiryoku_short、BOA-1209、マイグレーション 193）のフォルダを受け取り、
 * YouTube の下書き（動画1本）と自動送信の item を作って、送る時刻の予定に入れる。全貌の Shorts（push-full-picture.js の版2）とは別の出し物で、
 * 親の完全版を持たない単独の Shorts。hq の作業役が同じ Mac の本リポジトリで実行する（1日1本、21:30 ごろ、hq drafts/venue-shorts-request-20261031.md）。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js --status <YYYY-MM-DD> [border|main]   その日の状態・動画の URL を出す
 *     （版を付けなければ、生きている item のうち新しい方。border の日は版を付けて読む）
 *
 * フォルダ（hq の作り手の出力）: bundle.json と mp4 1本（縦・60秒まで・32 MiB まで）。ほかのファイルは読まない
 *   bundle.json の形は sns-video-studio/remotion/src/setsuKiryoku/model.js（型の正本）。この口が足す欄（どれも任意）:
 *     video: mp4 の名前（無ければ "<variant>.mp4"）、send_time: 送る時刻 "HH:MM"（JST、無ければ受け取りの2分後）、
 *     source_observed_at: 集計した時刻（時差つきの ISO。無ければ受け取りの時刻）
 *   題・説明欄は bundle の youtube.title・youtube.description をそのまま送る（書き換えない）
 *
 * 検査（どれかが通らなければ何も書かない）:
 *   1. 型の検査（setsuKiryoku/model.js の checkBundle）をもう一度通す: 禁止語・言い切り・risk-rules・画面の文の数と bundle の値の照合・
 *      名前と級・final_gap の date と final_date と when・主役の選び など（作り手が通した後も、送る口で必ず通す）
 *   2. この口の検査: 会場名が24場のどれか、題は100字まで・改行と < > なし、説明欄は5000バイトまで・< > なし、説明欄のリンクはちょうど1つで
 *      その会場のページ（https://www.boat-ai.jp/venue/{会場コード}、クエリは utm_* だけ）、動画は MP4・縦・60秒まで・32 MiB まで
 *   3. 時刻: date は今日（JST）、送る時刻は 22:00 まで、受け取りは送る時刻の15分前から、期限の10分前より前、集計の時刻は今より前で期限まで鮮度の線（max_source_age_seconds）の内
 *   4. 優勝戦の型で when=today: その日のその会場の優勝戦が DB にあり、中止・欠場が無い
 *   5. 二重送信: 同じ日・同じ版（item の variant。border の束は 'border'、ほかの型は 'main'）の setsu_kiryoku_short が生きているか
 *      送ってあれば作らない（exit 4、201 の一意の索引でも止まる）。朝の border と夜の節の機力は同じ日に両方受ける（BOA-1249）。
 *      final_gap は同じ優勝戦（日と会場）を前夜と当日で2回出さない。前の束が送らずに終わっていれば（held・failed・cancelled・承認の途中で落ちた）作り直す
 *   6. YouTube の日の上限（daily_limit_youtube）とクォータ（sns_youtube_quota_control）: 今日の試行・まだ claim していない YouTube の予定に
 *      この1本（1 upload・104 units、146 の claim の予約と同じ値）が入るか。claim でも DB がもう一度数えて予約する
 *
 * 時刻（送る時刻 S＝date の send_time と「今＋2分」の遅い方）: 期限（expires_at、送り手が送れる最後）＝S＋60分、
 *   締切（deadline_at）＝期限＋sns_x_send_control.expiry_minutes（186 の youtube_call の照合と同じ値で、kind で変えない）
 * 自動送信の許可（sns_auto_send_control の youtube の行の setsu_kiryoku_short_enabled、193）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 * --dry-run は DB を読むだけ。date が今日でない束（見本の束）は、その日の送る時刻（send_time、無ければ 21:30）の2分前に受け取ったとして時刻の検査をする
 *   （結果の simulated_now。DB の数（日の上限・クォータ・二重送信）は今の値で見る）
 *
 * stdout の最後の1行は `SETSU_RESULT {...}`（setsu_id・variant（border・main）・outcome・job_id・job_state・video_id・video_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日・同じ版の setsu_kiryoku_short が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・自動モードでない）・6 想定外の失敗
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import twitterText from "twitter-text";
import {
  createXSnapshot,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "../../api/_lib/snsXSend.js";
import {
  finalKeyOf,
  parseSetsuId,
  SETSU_KIRYOKU_SHORT_KIND,
  SETSU_SCREEN_KEY,
  setsuIdOf,
  setsuItemVariantOf,
  venueCodeOf,
} from "../../api/_lib/snsSetsuKiryokuShort.js";
import { checkBundle } from "../../sns-video-studio/remotion/src/setsuKiryoku/model.js";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import { createRestStore as createFullPictureStore } from "./push-full-picture.js";

export const SETSU_FORMAT = SETSU_KIRYOKU_SHORT_KIND;
/** 動画の上限（承認の snapshot・送り手の契約の 32 MiB） */
export const VIDEO_MAX_BYTES = YOUTUBE_MEDIA_MAX_BYTES;
/** Shorts の尺（全貌の入口版と同じ60秒まで。型は約15〜17秒） */
export const MAX_DURATION_SEC = 60;
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
export const RETRYABLE_JOB_STATES = ["held", "failed", "cancelled"];
export const WAIT_POLL_SEC = 30;
export const WAIT_AFTER_EXPIRES_SEC = 90;
const DONE_STATES = ["posted", ...RETRYABLE_JOB_STATES];
const SITE = "https://www.boat-ai.jp";
// 旗は claim と送る直前の検査で効く。上げている最中（youtube_call の後）を DB で止めるのは mode=manual か item の停止（system-architect P3）
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET setsu_kiryoku_short_enabled = false WHERE channel = 'youtube';（上げている最中なら mode='manual' も）";

const addMin = (iso, min) =>
  new Date(Date.parse(iso) + min * 60000).toISOString();
const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const ptDate = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    date,
  );
const isHhmm = (v) =>
  typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
/** 時差（Z か ±HH:MM）つきの ISO だけ（push-research-image.js と同じ） */
const isIso = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v));
/** フォルダの中のファイル名だけ（区切り・. と .. を拒否する） */
const fileNameOk = (name) =>
  typeof name === "string" &&
  /\.mp4$/.test(name) &&
  name.length <= 255 &&
  !/[/\\\0]/.test(name);
export const videoNameOf = (bundle) =>
  bundle?.video ?? `${bundle?.variant}.mp4`;

/**
 * MP4 の大きさと尺（純粋関数）。moov の mvhd（尺）と、trak の tkhd のうち幅・高さが0でないもの（映像）を読む。読めなければ null の欄
 * 返り値: { ftyp, width, height, durationSec }
 */
export function mp4Info(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const info = { ftyp: false, width: null, height: null, durationSec: null };
  const walk = (start, end, depth) => {
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at);
      const t = type(at + 4);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return;
      const body = at + header;
      if (depth === 0 && t === "ftyp") info.ftyp = at === 0;
      if (t === "moov" || t === "trak") walk(body, at + size, depth + 1);
      if (t === "mvhd" && body + 32 <= at + size) {
        const v1 = bytes[body] === 1;
        const scale = view.getUint32(body + (v1 ? 20 : 12));
        const duration = v1
          ? Number(view.getBigUint64(body + 24))
          : view.getUint32(body + 16);
        if (scale > 0) info.durationSec = duration / scale;
      }
      if (t === "tkhd") {
        const v1 = bytes[body] === 1;
        const off = body + (v1 ? 88 : 76);
        if (off + 8 <= at + size) {
          const w = view.getUint32(off) / 65536;
          const h = view.getUint32(off + 4) / 65536;
          // 表示の行列（幅・高さの直前の36バイト、先頭の a・b は 16.16）が 90度・270度の回転なら、見える縦横は入れ替わる
          const a = view.getInt32(off - 36) / 65536;
          const b = view.getInt32(off - 32) / 65536;
          const rotated = a === 0 && Math.abs(b) === 1;
          if (w > 0 && h > 0 && info.width == null) {
            info.width = rotated ? h : w;
            info.height = rotated ? w : h;
          }
        }
      }
      at += size;
    }
  };
  walk(0, bytes.byteLength, 0);
  return info;
}

/** 動画の検査（純粋関数） */
export function checkVideo(name, bytes) {
  if (!bytes) return [`${name} が無い`];
  if (!bytes.byteLength || bytes.byteLength > VIDEO_MAX_BYTES)
    return [`${name} の大きさが不正（${bytes.byteLength} バイト）`];
  const info = mp4Info(bytes);
  if (!info.ftyp) return [`${name} が MP4 でない（先頭に ftyp が無い）`];
  const reasons = [];
  if (!(info.width > 0 && info.height > info.width))
    reasons.push(`${name} が縦でない（${info.width}×${info.height}）`);
  if (!(info.durationSec > 0 && info.durationSec <= MAX_DURATION_SEC))
    reasons.push(
      `${name} の尺が ${MAX_DURATION_SEC} 秒までの値でない（${info.durationSec}）`,
    );
  return reasons;
}

/** 説明欄のリンク（純粋関数）。ちょうど1つで、その会場のページ。返り値 { url（表示の確認に使う、クエリなし）, reasons } */
export function descriptionLink(description, venueCode) {
  const urls = twitterText.extractUrls(description ?? "");
  if (urls.length !== 1)
    return {
      url: null,
      reasons: [`説明欄のリンクがちょうど1つでない（${urls.length}）`],
    };
  let u;
  try {
    u = new URL(urls[0]);
  } catch {
    return { url: null, reasons: [`説明欄のリンクが URL でない: ${urls[0]}`] };
  }
  const m = /^\/venue\/(\d{1,2})$/.exec(u.pathname);
  if (
    u.origin !== SITE ||
    u.username ||
    u.password ||
    u.hash ||
    !m ||
    Number(m[1]) !== Number(venueCode) ||
    [...u.searchParams.keys()].some((k) => !k.startsWith("utm_"))
  )
    return {
      url: null,
      reasons: [
        `説明欄のリンクがこの会場のページ（${SITE}/venue/${Number(venueCode)}、クエリは utm_* だけ）でない: ${urls[0]}`,
      ],
    };
  return { url: `${SITE}${u.pathname}`, reasons: [] };
}

/**
 * 当日の final_gap の締切（任意、BOA-1282）が DB の優勝戦と同じか（純粋関数）。違えば理由、同じか締切が無ければ null。
 * R は race_id の末尾、時刻は races.start_time（分の単位）。前夜の型は出走表がまだ無いので照らさない（hq が eve_race_deadlines から入れる）
 */
export function finalDeadlineMismatch(deadline, final) {
  if (deadline == null) return null;
  const race = `${Number(String(final.race_id).slice(-2))}R`;
  const time = typeof final.start_time === "string" ? final.start_time.slice(0, 5) : null;
  if (deadline.race !== race || deadline.time !== time)
    return `final_deadline（${deadline.race} ${deadline.time}）が DB の優勝戦（${race} ${time ?? "締切なし"}）と違う`;
  return null;
}

/**
 * 前夜の final_gap の締切が、前夜に取った表の優勝戦の行（is_final=true、男女W優勝戦なら2行）のどれかと同じか（純粋関数）。
 * 違えば理由、同じなら null
 */
export function eveDeadlineMismatch(deadline, finals) {
  if (deadline == null) return null;
  const rows = (finals ?? []).map((f) => ({
    race: `${Number(String(f.race_id).slice(-2))}R`,
    time: typeof f.deadline === "string" ? f.deadline.slice(0, 5) : null,
  }));
  if (rows.length === 0)
    return "前夜の締切の表に、その日の優勝戦の行（is_final）が無い";
  if (rows.some((r) => r.race === deadline.race && r.time === deadline.time))
    return null;
  return `final_deadline（${deadline.race} ${deadline.time}）が前夜の表の優勝戦（${rows.map((r) => `${r.race} ${r.time}`).join("・")}）と違う`;
}

/** bundle.json の検査（純粋関数）。型の検査（checkBundle）とこの口の検査。時刻の窓は checkTiming が見る */
export function checkShortBundle(bundle, riskRules = []) {
  const reasons = checkBundle(bundle, { rules: riskRules, matchRiskRules });
  if (!bundle || typeof bundle !== "object") return reasons;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bundle.date ?? ""))
    reasons.push("date が YYYY-MM-DD でない");
  const venueCode = venueCodeOf(bundle.venue);
  if (!venueCode) reasons.push(`venue が24場の名前でない: ${bundle.venue}`);
  const title = bundle.youtube?.title;
  const description = bundle.youtube?.description;
  if (typeof title === "string") {
    if ([...title].length > 100) reasons.push("youtube.title が100字を超える");
    if (/[\r\n<>]/.test(title))
      reasons.push("youtube.title に改行か < > がある（YouTube が受けない）");
  }
  if (typeof description === "string") {
    if (Buffer.byteLength(description, "utf8") > 5000)
      reasons.push("youtube.description が5000バイトを超える");
    if (/[<>]/.test(description))
      reasons.push("youtube.description に < > がある（YouTube が受けない）");
    if (venueCode)
      reasons.push(...descriptionLink(description, venueCode).reasons);
  }
  if (bundle.send_time !== undefined) {
    if (
      !isHhmm(bundle.send_time) ||
      bundle.send_time < SEND_TIME_EARLIEST ||
      bundle.send_time > SEND_TIME_LATEST
    )
      reasons.push(
        `send_time が ${SEND_TIME_EARLIEST}〜${SEND_TIME_LATEST} の HH:MM でない`,
      );
  }
  if (
    bundle.source_observed_at !== undefined &&
    !isIso(bundle.source_observed_at)
  )
    reasons.push(
      "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でない",
    );
  if (bundle.video !== undefined && !fileNameOk(bundle.video))
    reasons.push("video がフォルダの中の .mp4 の名前でない");
  return reasons;
}

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

/** 下書きの行（純粋関数）。題・説明欄は bundle の値のまま（ハッシュタグは説明欄に入っているので hashtags は空） */
export function draftRow(
  bundle,
  { revision, videoPath, when, observedAt, venueCode, publicUrl },
) {
  const setsuId = setsuIdOf(bundle.date, venueCode);
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: SETSU_FORMAT,
    platform: "youtube",
    title: bundle.youtube.title,
    caption_text: bundle.youtube.description,
    hashtags: [],
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    video_storage_path: videoPath,
    source_data: {
      // 管理画面の一覧・記録（snsXSendStore の race_id）が読む
      race_id: setsuId,
      setsu_kiryoku_short: {
        setsu_id: setsuId,
        date: bundle.date,
        venue: bundle.venue,
        venue_code: venueCode,
        variant: bundle.variant,
        when: bundle.when ?? null,
        final_date: bundle.final_date ?? null,
        final_key: finalKeyOf(bundle, venueCode),
        as_of: bundle.as_of,
        revision,
      },
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        public_url: publicUrl,
        screen_key: SETSU_SCREEN_KEY,
        youtube_mode: "immediate",
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/** item の行（純粋関数）。自動（notified）は止めるリンクを作らない（全貌・優勝戦・数字で見たらと同じ。153 の CHECK が要るので使わない乱数のハッシュ） */
function itemRow({
  setsuId,
  variant,
  draftId,
  when,
  state,
  checkedAt,
  heldReason,
}) {
  return {
    kind: SETSU_KIRYOKU_SHORT_KIND,
    variant,
    draft_id: draftId,
    channel: "youtube",
    race_id: setsuId,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state,
    checks: { passed: true, checked_at: checkedAt },
    ...(heldReason ? { held_reason: heldReason } : {}),
    ...(state === "notified"
      ? {
          notified_at: checkedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/** item と job から、hq に返す状態（純粋関数） */
export const setsuStatusOf = (item, job) => ({
  setsu_id: item?.race_id ?? null,
  variant: item?.variant ?? null,
  item_state: item?.state ?? null,
  held_reason: item?.held_reason ?? null,
  job_id: job?.id ?? null,
  job_state: job?.state ?? null,
  error_code: job?.error_code ?? null,
  posted_at: job?.posted_at ?? null,
  video_id: job?.external_post_id ?? null,
  video_url: job?.external_post_url ?? null,
});

/** 送らずに終わった item か（作り直してよい）。自動の item で job が無い（承認の途中で落ちた）か、job が held・failed・cancelled */
const retryable = (item, job) =>
  item.state === "notified" &&
  (!job || RETRYABLE_JOB_STATES.includes(job.state));

/**
 * 同じ日・同じ版（variant）の生きている item と、同じ優勝戦（final_gap）の item を見る。送った・送っている・待っている item があれば
 * { already } か { reasons }。送らずに終わった item は作り直す対象（retry）として返す。版の違う item（朝の border と夜の節の機力）は見ない
 */
async function liveOf(store, { date, variant, finalKey }) {
  const live = (await store.setsuItems(date)).filter(
    (i) =>
      i.variant === variant && !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (retryable(item, job)) retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じ日の setsu_kiryoku_short（版 ${variant}）が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: setsuStatusOf(item, job),
        },
      };
  }
  if (finalKey) {
    for (const item of await store.finalItems(finalKey)) {
      if (["stopped", "held_manual"].includes(item.state)) continue;
      if (retry.some((r) => r.id === item.id)) continue;
      const job = await store.jobForDraft(item.draft_id);
      if (!retryable(item, job))
        return {
          reasons: [
            `同じ優勝戦（${finalKey}）の setsu_kiryoku_short を既に出した（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）`,
          ],
        };
    }
  }
  return { retry };
}

/** dry-run の時計。date が今日なら今、違えば（見本の束）その日の送る時刻の2分前（純粋関数） */
export function dryRunClock(bundle, now) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "") ||
    bundle.date === jstDate(now)
  )
    return null;
  const at = isHhmm(bundle.send_time) ? bundle.send_time : DEFAULT_SEND_TIME;
  return new Date(
    Date.parse(`${bundle.date}T${at}:00+09:00`) - SEND_DELAY_SEC * 1000,
  );
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ setsu_id, draft_id, item_id, job_id, send_at, ... }
 */
export async function pushSetsuKiryokuShort(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now: realNow = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const simulated = dryRun ? dryRunClock(bundle, realNow) : null;
  const now = simulated ?? realNow;
  const venueCode = venueCodeOf(bundle?.venue);
  const setsuId =
    venueCode && /^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "")
      ? setsuIdOf(bundle.date, venueCode)
      : null;
  const controls = await store.controls();
  // 列が無い（193 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.youtube?.setsu_kiryoku_short_enabled === true;
  const writes = enabled && !dryRun;
  // item の版（border・main）。同じ日・同じ会場の border と節の機力は setsu_id が同じなので、結果には版も出す（201）
  const itemVariant = setsuItemVariantOf(bundle?.variant);
  const extra = {
    variant: itemVariant,
    ...(simulated ? { simulated_now: simulated.toISOString() } : {}),
  };
  const reject = async (reasons) => {
    if (writes)
      await notify(
        `SNS 節の機力（Shorts） ${setsuId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { setsu_id: setsuId, reasons, ...extra };
  };
  const reasons = checkShortBundle(bundle, riskRules);
  if (reasons.length) return reject(reasons);
  if (!parseSetsuId(setsuId)) return reject(["setsu_id が作れない"]);
  const name = videoNameOf(bundle);
  let bytes = null;
  try {
    bytes = await readBytes(path.join(folder, name));
  } catch (error) {
    // 無い（ENOENT）は checkVideo が「無い」と書く。それ以外（権限・I/O・code の無い失敗）は原因を残す
    if (error?.code !== "ENOENT")
      return reject([
        `${name} を読めない（${error?.code ?? "code なし"}: ${error?.message ?? error}）`,
      ]);
  }
  const videoReasons = checkVideo(name, bytes);
  if (videoReasons.length) return reject(videoReasons);
  const sendControl = await store.sendControl();
  if (!(sendControl?.expiry_minutes > 0))
    return reject(["期限の分（sns_x_send_control.expiry_minutes）が読めない"]);
  const when = schedule(bundle, now, sendControl.expiry_minutes);
  const observedAt = bundle.source_observed_at ?? now.toISOString();
  const timing = checkTiming(bundle, when, now, {
    observedAt,
    maxAgeSec: sendControl?.max_source_age_seconds,
  });
  if (timing.length) return reject(timing);
  // 同じ日・同じ版に生きている・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、201）
  const live = await liveOf(store, {
    date: bundle.date,
    variant: itemVariant,
    finalKey: finalKeyOf(bundle, venueCode),
  });
  if (live.already) return { setsu_id: setsuId, ...live.already, ...extra };
  if (live.reasons) return reject(live.reasons);
  // 優勝戦が今日の型は、その優勝戦が DB にあり、中止・欠場が無いこと（前夜は出走表がまだ無い）
  if (bundle.variant === "final_gap" && bundle.when === "today") {
    const final = await store.finalRace(bundle.final_date, venueCode);
    if (!final)
      return reject([
        `${bundle.final_date} の ${bundle.venue} の優勝戦が DB に無い`,
      ]);
    if (final.cancelled) return reject(["優勝戦が中止"]);
    if (final.withdrawn) return reject(["優勝戦に欠場がある"]);
    const deadlineWhy = finalDeadlineMismatch(bundle.final_deadline, final);
    if (deadlineWhy) return reject([deadlineWhy]);
  }
  // 前夜の型の締切は、前夜に取った表（eve_race_deadlines、#2249 のマイグレーション202）の優勝戦の行と照らす。
  // hq は表から入れるので、表が読めない・優勝戦の行が無い・違うなら送らない（誤った締切を焼き込んだ動画を出さない）
  if (
    bundle.variant === "final_gap" &&
    bundle.when === "eve" &&
    bundle.final_deadline != null
  ) {
    let finals;
    try {
      finals = await store.eveFinals(bundle.final_date, venueCode);
    } catch (error) {
      return reject([`前夜の締切の表が読めない: ${error.message}`]);
    }
    const why = eveDeadlineMismatch(bundle.final_deadline, finals);
    if (why) return reject([why]);
  }
  // 日の上限・クォータは DB の今の値で見る（dry-run の見本の束でも、時計を進めた日ではなく今日の数。基準の日が今日なので）
  const roomNow = realNow;
  const roomSendAt = simulated
    ? new Date(realNow.getTime() + SEND_DELAY_SEC * 1000).toISOString()
    : when.send_at;
  const [jobs, queued, quota, quotaUsed] = await Promise.all([
    store.jobsAttemptedOn(jstDate(roomNow)),
    store.queuedYoutubeJobs(roomNow),
    store.quotaControl(),
    store.quotaUsed(ptDate(new Date(roomSendAt))),
  ]);
  // 差し替える前の job は数えない（差し替えで止めるので、二重に数えてこの1本を落とさない）
  const replacing = new Set(live.retry.map((i) => i.draft_id));
  const roomReason = youtubeRoomReason({
    sendControl,
    jobs,
    queued: queued.filter((j) => !replacing.has(j.draft_id)),
    quota,
    quotaUsed,
    now: roomNow,
    sendAt: roomSendAt,
  });
  if (roomReason) return reject([roomReason]);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  hash.update(bytes);
  const revision = hash.digest("hex").slice(0, 32);
  const publicUrl = descriptionLink(bundle.youtube.description, venueCode).url;
  const control = controls.youtube;
  const auto = Boolean(control?.mode === "auto" && control?.auto_approver_id);
  // この型は自動の道だけで送る。自動モードでなければ何も書かない（held_manual の下書きを毎回積まない。個別承認で1日1本の守りを外さない）
  if (writes && !auto)
    return {
      setsu_id: setsuId,
      manual: true,
      reason:
        "youtube の mode が auto でない（この型は自動の道だけで送る）ので何も書かなかった",
      ...extra,
    };
  if (!writes)
    return {
      setsu_id: setsuId,
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      auto,
      revision,
      when,
      public_url: publicUrl,
      video: { name, bytes: bytes.byteLength, ...mp4Info(bytes) },
      ...extra,
    };

  // 前の item を止め、下書きを公開保留に戻す（148 のトリガーが承認を外し、queued・held の job を取り消す）
  for (const item of live.retry) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
  const videoPath = `setsu-kiryoku-short/${bundle.date}/${venueCode}/${revision}.mp4`;
  await store.saveFile(videoPath, bytes);
  const checkedAt = now.toISOString();
  const draft = await store.insertDraft(
    draftRow(bundle, {
      revision,
      videoPath,
      when,
      observedAt,
      venueCode,
      publicUrl,
    }),
  );
  // 下書きを公開保留にする（承認できない形に倒す）。item が入らなかった・承認に落ちた下書きを、管理画面の個別承認で送らないため
  const blockDraft = (why) =>
    store
      .updateDraft(draft.id, { publish_blocked: true })
      .catch((error) =>
        console.error(
          `下書き ${draft.id} を公開保留にできない（${why}）: ${error.message}`,
        ),
      );
  let item;
  try {
    item = await store.insertItem(
      itemRow({
        setsuId,
        variant: itemVariant,
        draftId: draft.id,
        when,
        state: "notified",
        checkedAt,
      }),
    );
  } catch (error) {
    // 同じ日・同じ版に並行して入れた束が先に一意の索引（201 の setsu_day）に入った等。下書きを残すと個別承認で送れてしまう
    await blockDraft("item を作れない");
    throw error;
  }
  const out = {
    setsu_id: setsuId,
    variant: itemVariant,
    draft_id: draft.id,
    item_id: item.id,
    auto,
    trial: control?.dry_run !== false,
  };
  {
    try {
      const snapshot = await createXSnapshot(draft, async (p) =>
        p === videoPath
          ? bytes
          : Promise.reject(new Error("媒体の path が違う")),
      );
      const job = await store.approve({
        p_draft_id: draft.id,
        p_approver_id: control.auto_approver_id,
        p_snapshot: snapshot,
        p_scheduled_at: when.send_at,
      });
      if (!job?.id) throw new Error("job の id を受け取れない");
      out.job_id = job.id;
      out.send_at = when.send_at;
    } catch (error) {
      out.error = error.message;
      await blockDraft("自動の承認に失敗");
      // 承認に落ちた item は held_manual にして、次の呼び出しで作り直せるようにする（1日1本の索引から外れる）
      await store
        .updateItem(item.id, "notified", {
          state: "held_manual",
          held_reason: `自動の承認に失敗: ${error.message.split("\n")[0]}`,
        })
        .catch((updateError) => {
          // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
          console.error(
            `item ${item.id} を held_manual に戻せない: ${updateError.message}`,
          );
          out.error += `（item を戻せない: ${updateError.message}）`;
        });
    }
  }
  const line = out.send_at
    ? `youtube（Shorts）: ${jstTime(when.send_at)} に送る（期限 ${jstTime(when.expires_at)}）${control?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : `youtube（Shorts）: 自動の承認に失敗（送らない。下書きは公開保留）: ${out.error}`;
  await notify(
    `SNS 節の機力（Shorts） ${setsuId}「${bundle.youtube.title}」\n${line}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

/** その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null。variant（border・main）を渡せばその版だけ */
export async function setsuStatus(date, { store, variant = null }) {
  const items = (await store.setsuItems(date)).filter(
    (i) => variant == null || i.variant === variant,
  );
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return setsuStatusOf(item, await store.jobForDraft(item.draft_id));
}

/** 送り終わる（posted・held 等）か期限＋90秒まで待つ */
export async function waitForSend({
  store,
  draftId,
  expiresAt,
  now = () => new Date(),
  sleep,
}) {
  const until = Date.parse(expiresAt) + WAIT_AFTER_EXPIRES_SEC * 1000;
  for (;;) {
    const job = await store.jobForDraft(draftId);
    if (DONE_STATES.includes(job?.state) || now().getTime() >= until)
      return setsuStatusOf(null, job);
    await sleep(WAIT_POLL_SEC);
  }
}

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  result,
  status = null,
  { waited = Boolean(status) } = {},
) {
  const outcome = result.reasons?.length
    ? "rejected"
    : result.already
      ? "already_exists"
      : result.disabled
        ? "disabled"
        : result.dryRun
          ? "dry_run_ok"
          : status?.job_state === "posted"
            ? "posted"
            : result.job_id && !waited
              ? "queued"
              : "not_posted";
  const code = {
    posted: 0,
    dry_run_ok: 0,
    queued: 0,
    rejected: 1,
    disabled: 3,
    already_exists: 4,
    not_posted: 5,
  }[outcome];
  const s = status ?? result.status ?? null;
  const line = {
    setsu_id: result.setsu_id ?? null,
    variant: result.variant ?? s?.variant ?? null,
    outcome,
    job_id: s?.job_id ?? result.job_id ?? null,
    job_state: s?.job_state ?? null,
    video_id: s?.video_id ?? null,
    video_url: s?.video_url ?? null,
    posted_at: s?.posted_at ?? null,
    error_code: s?.error_code ?? result.error ?? null,
    reason:
      result.reasons?.join(" / ") ??
      result.reason ??
      (result.disabled
        ? "自動送信の許可（setsu_kiryoku_short_enabled）が off なので送らなかった"
        : outcome === "not_posted" && !result.job_id
          ? result.error
            ? `自動の承認に失敗したので job を作らなかった: ${result.error}`
            : "自動モードでないので job を作らなかった"
          : null),
  };
  return { code, text: `SETSU_RESULT ${JSON.stringify(line)}` };
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の書き込み（Storage・下書き・item・承認）は push-full-picture.js の store を使い、
 * この型の読み取りと許可の列だけを足す。失敗は投げる
 */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const base = createFullPictureStore({ url, key, fetchImpl });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function call(p, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB 操作に失敗: HTTP ${response.status} ${method} ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  const one = (rows, what) => {
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error(what);
    return rows[0];
  };
  const jobSelect =
    "id,draft_id,state,error_code,scheduled_at,expires_at,posted_at,external_post_id,external_post_url";
  return {
    saveFile: (p, bytes) => base.saveFile(p, bytes, "video/mp4"),
    insertDraft: base.insertDraft,
    insertItem: base.insertItem,
    updateItem: base.updateItem,
    approve: base.approve,
    updateDraft: async (draftId, patch) =>
      one(
        await call(`sns_drafts?id=eq.${draftId}`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${draftId} を更新できない`,
      ),
    // setsu_kiryoku_short_enabled が無い（193 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする
    async controls() {
      let rows;
      try {
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,setsu_kiryoku_short_enabled",
        );
      } catch (error) {
        // 列が無いときの 400（PostgREST の本文に列の名前が出る）だけを off に倒す。ほかの 400 は投げる
        if (
          !/HTTP 400/.test(error.message) ||
          !error.message.includes("setsu_kiryoku_short_enabled")
        )
          throw error;
        console.error(
          "setsu_kiryoku_short_enabled の列が無い（マイグレーション 193 が未適用）。許可は off として扱う",
        );
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
        );
      }
      return Object.fromEntries(rows.map((r) => [r.channel, r]));
    },
    sendControl: async () =>
      (
        await call(
          "sns_x_send_control?id=eq.true&select=daily_limit,daily_limit_youtube,daily_baseline_date,daily_external_count,expiry_minutes,max_source_age_seconds",
        )
      )[0] ?? null,
    setsuItems: (date) =>
      call(
        `sns_auto_send_items?kind=eq.${SETSU_KIRYOKU_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`setsu:${date}:*`)}&select=id,state,draft_id,race_id,variant,held_reason&order=created_at.desc`,
      ),
    // 同じ優勝戦（final_key）の下書きの item
    async finalItems(finalKey) {
      const drafts = await call(
        `sns_drafts?format=eq.${SETSU_FORMAT}&source_data->setsu_kiryoku_short->>final_key=eq.${encodeURIComponent(finalKey)}&select=id`,
      );
      if (!drafts.length) return [];
      return call(
        `sns_auto_send_items?draft_id=in.(${drafts.map((d) => d.id).join(",")})&select=id,state,draft_id,race_id`,
      );
    },
    jobForDraft: async (draftId) =>
      (
        await call(`sns_x_send_jobs?draft_id=eq.${draftId}&select=${jobSelect}`)
      )[0] ?? null,
    jobsAttemptedOn: (day) =>
      call(
        `sns_x_send_jobs?attempt_dates=cs.${encodeURIComponent(`{${day}}`)}&select=id,state,attempt_dates,attempt_channels`,
      ),
    // まだ claim していない YouTube の予定（期限の前）
    queuedYoutubeJobs: (now) =>
      call(
        `sns_x_send_jobs?channel=eq.youtube&state=eq.queued&attempts=eq.0&expires_at=gt.${encodeURIComponent(now.toISOString())}&select=id,draft_id,scheduled_at`,
      ),
    quotaControl: async () =>
      (
        await call(
          "sns_youtube_quota_control?id=eq.true&select=verified,baseline_day,upload_limit,general_limit,external_uploads,external_general",
        )
      )[0] ?? null,
    // その PT の日の予約（146 の claim の式と同じ: attempts の upload_reserved・general_reserved と reads の units）
    async quotaUsed(day) {
      const [attempts, reads] = await Promise.all([
        call(
          `sns_youtube_quota_attempts?quota_day=eq.${day}&select=upload_reserved,general_reserved`,
        ),
        call(`sns_youtube_quota_reads?quota_day=eq.${day}&select=units`),
      ]);
      return {
        uploads: attempts.reduce((n, a) => n + a.upload_reserved, 0),
        general:
          attempts.reduce((n, a) => n + a.general_reserved, 0) +
          reads.reduce((n, r) => n + r.units, 0),
      };
    },
    // その日のその会場の優勝戦（race_conditions.race_stage）と、中止・欠場
    /** 前夜に取った表の、その日・その会場の優勝戦の行（is_final=true） */
    async eveFinals(date, venueCode) {
      return call(
        `eve_race_deadlines?race_date=eq.${encodeURIComponent(date)}&venue_code=eq.${Number(venueCode)}&is_final=is.true&select=race_id,deadline`,
      );
    },
    async finalRace(date, venueCode) {
      const [final] = await call(
        `race_conditions?race_id=like.${encodeURIComponent(`${date}-${venueCode}-*`)}&race_stage=eq.${encodeURIComponent("優勝戦")}&select=race_id`,
      );
      if (!final) return null;
      const id = encodeURIComponent(final.race_id);
      const [[race], entries, exhibition] = await Promise.all([
        call(`races?race_id=eq.${id}&select=cancellation_status,start_time`),
        call(`race_entries?race_id=eq.${id}&select=is_absent`),
        call(`exhibition_data?race_id=eq.${id}&select=is_absent`),
      ]);
      if (!race) return null;
      return {
        race_id: final.race_id,
        start_time: race.start_time ?? null,
        cancelled: race.cancellation_status != null,
        withdrawn: [...entries, ...exhibition].some(
          (r) => r.is_absent === true,
        ),
      };
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-setsu-kiryoku-short.js <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD> [border|main]";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "") ||
      ![undefined, "border", "main"].includes(args[2])
    ) {
      console.error(usage);
      process.exit(2);
    }
    console.log(
      JSON.stringify(
        await setsuStatus(args[1], { store, variant: args[2] ?? null }),
        null,
        2,
      ),
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(usage);
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  // どこで落ちても、最後の1行は SETSU_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `SETSU_RESULT ${JSON.stringify({ setsu_id: null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushSetsuKiryokuShort(folder, {
    store,
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: async (text) => {
      console.log(text);
      if (!webhook) return;
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok)
        throw new Error(`Slack が HTTP ${response.status} を返した`);
    },
    riskRules,
    dryRun,
  }).catch(fail);
  console.log(JSON.stringify(result, null, 2));
  const status =
    // 試運転（youtube の dry_run が true）は送り手が claim しないので待たない（待つと期限＋90秒まで止まる）
    result.job_id && !result.trial && !args.includes("--no-wait")
      ? await waitForSend({
          store,
          draftId: result.draft_id,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(result, status);
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
