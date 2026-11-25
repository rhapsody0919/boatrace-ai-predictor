import { jstTime, minutesBefore } from "./researchSchedule.js";
export { jstTime, minutesBefore };
/**
 * 全貌動画の取り込み（scripts/sns/push-full-picture.js）から移した、api・scripts/sns に依らない純な部分: 定数・チャネルの決め方・
 * 送る時刻・差し替えの判定・締切の焼き込みの検査。
 */
export const FULL_PICTURE_FORMAT = "full_picture";
export const FILES = {
  x: "full-x.mp4",
  youtube: "full-youtube.mp4",
  shorts: "shorts.mp4",
};
// 動画は送信の契約（snsXSend.js の X_MEDIA_MAX_BYTES・YOUTUBE_MEDIA_MAX_BYTES、youtubeQueueAdapter）と同じ 32 MiB まで
export const MAX_BYTES = {
  x: 32 * 1024 * 1024,
  youtube: 32 * 1024 * 1024,
  shorts: 32 * 1024 * 1024,
};
/** サムネイルの中身の判定（先頭のバイト列）。保存の拡張子と Content-Type はこれで決める（名前の拡張子は見ない） */
const THUMBNAIL_KINDS = [
  {
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ext: "png",
    contentType: "image/png",
  },
  { signature: [0xff, 0xd8, 0xff], ext: "jpg", contentType: "image/jpeg" },
];
export const thumbnailKind = (bytes) =>
  THUMBNAIL_KINDS.find(({ signature }) =>
    signature.every((b, i) => bytes[i] === b),
  ) ?? null;
/** サムネイルの名前はフォルダの中のファイル名だけ（区切り・. と .. を拒否する） */
export const thumbnailNameOk = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 255 &&
  !/[/\\\0]/.test(name) &&
  name !== "." &&
  name !== "..";
/** Shorts を受ける bundle の版。版の欄が無い bundle は今までどおり X・YouTube（完全版）の2件 */
export const SHORTS_BUNDLE_VERSION = 2;
/** Shorts（入口版）の機械の検査として、qa.machine に true で入っていなければならない項目（全貌レーンとの契約） */
export const SHORTS_MACHINE_CHECKS = ["shorts_vertical", "shorts_max_60s"];
/** Shorts は完全版の4分後に送る（YouTube の job は1回の実行で Chromium の上限6回を使い切るので、同じ実行に重ねない） */
export const SHORTS_OFFSET_MIN = 4;
/**
 * Shorts を作る受付の上限（締切の何分前まで）。X の送る時刻は今から5分後以降、Shorts はその8分後で、期限（締切の30分前）の前に
 * 完全版の公開を待つ余裕（送信の実行2回分）を残す。過ぎたら Shorts だけ作らず、Slack に書く
 */
export const SHORTS_LATEST_BEFORE_MIN = 50;
export const NOTIFY_BEFORE_MIN = 180;
export const VETO_BEFORE_MIN = 60;
export const EXPIRES_BEFORE_MIN = 30;
export const LATEST_BEFORE_MIN = 45;
export const SEND_GRACE_MIN = 5;
/**
 * YouTube は X の4分後に送る。送信の cron（2分ごと）の1回の実行で X と YouTube を両方送ると、送る前の表示の確認（Chromium）が
 * 上限の6回を超え（X 3回・YouTube 6回）、YouTube が public_check_budget で非公開のまま残る（2026-10-18 レビューの指摘）
 */
export const YOUTUBE_OFFSET_MIN = 4;
export const nonEmpty = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
export const withShorts = (bundle) =>
  bundle?.bundle_version === SHORTS_BUNDLE_VERSION;
/** 版で決まるチャネル（shorts は DB では channel=youtube・variant=shorts） */
export const versionChannels = (bundle) =>
  withShorts(bundle) ? ["x", "youtube", "shorts"] : ["x", "youtube"];
/** 下書きを作るチャネル。bundle の channels があれば、その中にあるものだけ（検査は checkFullPicture） */
export const channelsOf = (bundle) =>
  Array.isArray(bundle?.channels)
    ? versionChannels(bundle).filter((c) => bundle.channels.includes(c))
    : versionChannels(bundle);
export const wantsX = (bundle) => channelsOf(bundle).includes("x");
export const dbChannel = (channel) =>
  channel === "shorts" ? "youtube" : channel;
const OFFSET_MIN = {
  x: 0,
  youtube: YOUTUBE_OFFSET_MIN,
  shorts: YOUTUBE_OFFSET_MIN + SHORTS_OFFSET_MIN,
};
/**
 * チャネルごとの送る時刻（YouTube の完全版は X の4分後、Shorts は完全版のさらに4分後。Shorts は完全版の公開まで待つ）。
 * X を作らない bundle（channels）でもずらしは変えない（SHORTS_LATEST_BEFORE_MIN の余裕の計算がこの並びの上にある。
 * 別のレース・別の型の X と同じ送信の実行に重なる見込みも減る、BOA-1167）
 */
export const sendAtOf = (when, channel) =>
  new Date(
    Date.parse(when.send_at) + OFFSET_MIN[channel] * 60000,
  ).toISOString();

/**
 * 送信を始めた job の状態（外へ出たか出かけた）。held・failed・cancelled は試行の数によらず公開されていない
 * （transition_sns_x_send の hold は queued・sending から、fail は sending からだけ移す。外への POST は begin_post で reconcile に
 * 移した後。docs/db-migration/153:414-423・189:252-261。reconcile から cancelled へ移すのは非公開・削除済みの YouTube を閉じる
 * youtube_close_private だけ、186:112-116）。締切が延びて送る直前の検査の deadline_changed で held になった job こそ差し替えたい
 */
const STARTED_STATES = ["sending", "reconcile", "posted"];
const itemLabel = (item) =>
  `${item.channel}${item.variant === "shorts" ? "（Shorts）" : ""}`;

/**
 * 同じレースの生きた全貌の item への対応（純粋関数、BOA-1201）。全貌は締切の時刻を動画・題・説明文に焼き込む
 * （sns-video-studio/remotion/scripts/full-picture/bundle.mjs の raceHeader）ので、締切が変わった束は送る側で通さない
 * （snsDeadlineQueue.js の deadline_changed）。作り手が作り直して push し直し、ここで前の束を差し替える。
 * live: [{id, draft_id, channel, variant, state, deadline_at, revision, jobs: [{id, state, attempts}]}]
 * 返り値: { reasons }（拒否）か { items, from }（差し替える item。生きた item が無ければ items は空）
 */
export function supersedePlan(live, { deadlineAt, revision }) {
  if (!live.length) return { items: [] };
  // sending・reconcile・posted の job は外へ出たかもしれないので差し替えない
  const started = live.flatMap((item) =>
    item.jobs
      .filter((j) => STARTED_STATES.includes(j.state))
      .map(
        (j) =>
          `${itemLabel(item)} の job ${j.id} が ${j.state}（試行 ${j.attempts}）`,
      ),
  );
  if (started.length)
    return {
      reasons: [
        `前の束の送信が始まっているので差し替えない（${started.join("・")}）`,
      ],
    };
  const to = jstTime(deadlineAt);
  if (live.every((i) => Date.parse(i.deadline_at) === Date.parse(deadlineAt)))
    return {
      reasons: [`同じレースの全貌が同じ締切 ${to} で既に入っている（重複）`],
    };
  const from = [...new Set(live.map((i) => jstTime(i.deadline_at)))].join("・");
  // 締切だけ変わって束が同じなら、前の締切が焼き込まれたまま（作り直していない）
  if (live.some((i) => i.revision === revision))
    return {
      reasons: [
        `締切が ${from}→${to} に変わったのに束が前と同じ版（作り直してから push する）`,
      ],
    };
  return { items: live, from };
}
/** 締切まわりの時刻（純粋関数）。送る時刻は veto_until と「今から5分後」の遅い方 */
export function schedule(deadlineAt, now) {
  const vetoUntil = minutesBefore(deadlineAt, VETO_BEFORE_MIN);
  return {
    deadline_at: deadlineAt,
    notify_by: minutesBefore(deadlineAt, NOTIFY_BEFORE_MIN),
    veto_until: vetoUntil,
    expires_at: minutesBefore(deadlineAt, EXPIRES_BEFORE_MIN),
    latest: minutesBefore(deadlineAt, LATEST_BEFORE_MIN),
    send_at: new Date(
      Math.max(Date.parse(vetoUntil), now.getTime() + SEND_GRACE_MIN * 60000),
    ).toISOString(),
  };
}

/** 締切が焼き込まれうる文（[欄の名前, 文]）。Shorts は版2のときだけ */
function bakedTexts(bundle) {
  return [
    ["x_text", wantsX(bundle) ? bundle?.x_text : undefined],
    ["youtube_full.title", bundle?.youtube_full?.title],
    ["youtube_full.description", bundle?.youtube_full?.description],
    ...(withShorts(bundle)
      ? [
          ["youtube_shorts.title", bundle?.youtube_shorts?.title],
          ["youtube_shorts.description", bundle?.youtube_shorts?.description],
        ]
      : []),
  ];
}

/** 文の中の「締切HH:MM」のうち今の締切と違う物を stale（HH:MM → 欄の配列）へ足す */
function collectStaleDeadlines(stale, field, text, current) {
  for (const [, h, m] of text.matchAll(/締切(\d{1,2}):(\d{2})/g)) {
    const hm = `${h.padStart(2, "0")}:${m}`;
    if (hm !== current) stale.set(hm, [...(stale.get(hm) ?? []), field]);
  }
}

/**
 * 束の文に焼き込まれた「締切HH:MM」が今の締切と合うか（純粋関数、BOA-1201）。版の違いだけでは、締切が変わる前の材料で
 * 作り直した束を見分けられない（前の item が無い初回も同じ）。作り手の raceHeader（bundle.mjs 65-75）の形「締切16:44」を拾い、
 * 時は0埋めの違いを同じと扱う。「締切HH:MM」が1つも無い文は見ない（型によっては入らない）
 * 返り値: 拒否の理由の配列（合っていれば空）
 */
export function bakedDeadlineReasons(bundle, deadlineAt) {
  const current = jstTime(deadlineAt);
  const stale = new Map();
  for (const [field, text] of bakedTexts(bundle)) {
    if (typeof text !== "string") continue;
    collectStaleDeadlines(stale, field, text, current);
  }
  return [...stale].map(
    ([hm, fields]) =>
      `束の締切 ${hm} が今の締切 ${current} と違う（作り直す。${[...new Set(fields)].join("・")}）`,
  );
}
