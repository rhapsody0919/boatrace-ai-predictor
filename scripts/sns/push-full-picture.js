/**
 * 全貌動画（format=full_picture）のフォルダを受け取り、X・YouTube の下書きと自動送信の item を作って、承認なしで送る予定に入れる
 * （2026-10-18 オーナー決定: 承認なし・事前通知と止めるリンクは最小。マイグレーション 161）。
 * hq の作業役が同じ Mac の本リポジトリで実行する。鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-full-picture.js <フォルダ> [--dry-run]
 *
 * フォルダ: bundle.json（format・race_id・x_text・youtube_full{title,description}・review{p0_count}・qa）、
 *   full-x.mp4（X）、full-youtube.mp4（YouTube の完全版）。
 *   bundle_version: 2 のときだけ、youtube_shorts{title,description} と shorts.mp4（入口版、縦）を受け、YouTube の Shorts の下書きを足す
 *   （マイグレーション 172、BOA-912）。Shorts は完全版の公開の後に送り、説明文の {full_url} を完全版の URL に置き換える（parent_job_id）
 *   channels（例 ["youtube","shorts"]）は送るチャネル。x を外すことだけができ、外したときは x_text・full-x.mp4 を受けず、
 *   X の下書き・item・job を作らない（BOA-1167、2026-10-27 オーナー決定「全貌の入口は Shorts、X は不要」）。無い bundle は今までどおり X も出す
 *   youtube_full.thumbnail（型 f01、例 "thumb-full.png"）があれば、フォルダのその名前の画像（PNG・JPEG）を完全版のサムネイルとして
 *   完全版の下書きの cover_image_path に入れる。送信は動画の upload の後に thumbnails.set で上げる（BOA-1172）。欄が無い bundle は今までどおり
 *
 * 1. 検査: 欄・P0 が0件・機械の検査が全部通った・禁止表現・動画の大きさ・レースが今日あり中止でない・締切の45分前より前
 *    同じレースの生きた全貌の item があれば、締切が違い・前の束がまだ送信を始めていない・版が違うときだけ差し替える（BOA-1201、supersedePlan）。
 *    ほかは拒否する（同じ締切は重複）
 *    --dry-run はここまで（DB・Storage に書かない。差し替えも書かない）
 * 1b. 差し替え: 前の item を stopped（superseded）にし、続けて前の job を hold（superseded）にする。落ちたら新しい束を作らない
 * 2. 動画（とサムネイル）を Storage（sns-hub-media/full-picture/{race_id}/{版}/）に上げる
 * 3. X・YouTube の下書き（send_lane=A、format=full_picture）と item（kind=full_picture）を作る
 *    X の日の枠の全貌の取り置き（182）に1本が入らなければ X の下書きを作らず、YouTube（完全版・Shorts）だけを送る
 * 4. チャネルが mode=auto なら item を notified にして自動送信の承認者で承認する（送る時刻は締切の60分前と今から5分後の遅い方）。
 *    mode=manual なら item を manual にして、個別承認の画面に回す
 * 5. Slack（SLACK_WEBHOOK_URL、無ければ SLACK_DIGEST_WEBHOOK_URL）に、送る時刻と止める SQL を知らせる
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
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";
import {
  FULL_URL_PLACEHOLDER,
  fillFullUrl,
} from "../../api/_lib/snsDeadlineQueue.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import { checkXSlot, SLOT_KINDS, xSlotRoomVia } from "../lib/snsXSlots.js";

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
/**
 * 完全版のサムネイルの上限。YouTube の thumbnails.set は 50MB まで（公式の API 文書、2026-10-27 に確認。
 * 以前の 2MB はモバイルからの上限に残るだけ）。承認の snapshot（createXSnapshot・approve_sns_x_send）がカバーを 32 MiB までにしているので、
 * 先に効くその値で受け取りを止める（超えた束を受けると、承認で落ちて完全版ごと個別承認に回る）
 */
export const THUMBNAIL_MAX_BYTES = YOUTUBE_MEDIA_MAX_BYTES;
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
const thumbnailNameOk = (name) =>
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
const RACE_URL =
  /https:\/\/www\.boat-ai\.jp\/race\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})/;
const STOP_SQL =
  "UPDATE public.sns_x_send_control SET paused = true WHERE id = true;";

const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const nonEmpty = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const withShorts = (bundle) => bundle?.bundle_version === SHORTS_BUNDLE_VERSION;
/** 版で決まるチャネル（shorts は DB では channel=youtube・variant=shorts） */
const versionChannels = (bundle) =>
  withShorts(bundle) ? ["x", "youtube", "shorts"] : ["x", "youtube"];
/** 下書きを作るチャネル。bundle の channels があれば、その中にあるものだけ（検査は checkFullPicture） */
const channelsOf = (bundle) =>
  Array.isArray(bundle?.channels)
    ? versionChannels(bundle).filter((c) => bundle.channels.includes(c))
    : versionChannels(bundle);
const wantsX = (bundle) => channelsOf(bundle).includes("x");
const dbChannel = (channel) => (channel === "shorts" ? "youtube" : channel);
// 置き換えで増える字数（送る時の fillFullUrl と同じ書式から求める）
// 個別承認の道では親（完全版の job）が下書きに入らないので、承認しても送る前の検査（unresolved_placeholder）で止まる
const SHORTS_MANUAL_NOTE =
  "。ただし Shorts は個別承認では送れない（完全版の URL が入らない）。完全版を送った後に作り直す";
const FILLED_URL_EXTRA =
  fillFullUrl(FULL_URL_PLACEHOLDER, "x".repeat(11)).length -
  FULL_URL_PLACEHOLDER.length;

/** bundle.json の検査（純粋関数）。不合格は理由の配列を返す */
export function checkFullPicture(bundle, riskRules = []) {
  const reasons = [];
  if (bundle?.format !== FULL_PICTURE_FORMAT)
    reasons.push(`format が ${FULL_PICTURE_FORMAT} でない`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? ""))
    reasons.push("race_id が不正");
  // 札は無いか、{id: "a"|"b"} だけ（hq SQ08 v5）
  if (
    bundle?.full_picture_variant !== undefined &&
    !["a", "b"].includes(bundle.full_picture_variant?.id)
  )
    reasons.push("full_picture_variant.id が a・b でない");
  // 型は無いか、{id: 空でない文字列} だけ
  if (
    bundle?.content_type !== undefined &&
    !(
      typeof bundle.content_type?.id === "string" &&
      bundle.content_type.id.trim()
    )
  )
    reasons.push("content_type.id が無い");
  // channels は x を外すことだけができる（完全版は必須、Shorts は版2と一致。Shorts の親は完全版の job）
  if (bundle?.channels !== undefined) {
    const c = bundle.channels;
    const all = versionChannels(bundle);
    if (
      !Array.isArray(c) ||
      new Set(c).size !== c.length ||
      c.some((v) => !all.includes(v)) ||
      all.some((v) => v !== "x" && !c.includes(v))
    )
      reasons.push(
        `channels が不正（x を外すことだけができる。必須は ${all.filter((v) => v !== "x").join("・")}）`,
      );
  }
  // X を作らない bundle では x_text を見ない
  if (wantsX(bundle)) {
    if (!nonEmpty(bundle?.x_text, 25000))
      reasons.push("x_text が無い・長すぎる");
    else {
      if (!xPostValid(bundle.x_text, { long: true }))
        reasons.push("x_text が X の長文の上限を超える");
      const urls = twitterText.extractUrls(bundle.x_text);
      if (urls.length !== 1 || urls[0].match(RACE_URL)?.[1] !== bundle.race_id)
        reasons.push("x_text にこのレースの URL がちょうど1つ無い");
    }
  }
  // 完全版の URL の置き場所は Shorts の説明文だけ（ほかに入っていると、送る前の検査で初めて止まる）
  for (const [field, text] of [
    ["x_text", wantsX(bundle) ? bundle?.x_text : undefined],
    ["youtube_full.title", bundle?.youtube_full?.title],
    ["youtube_full.description", bundle?.youtube_full?.description],
    ["youtube_shorts.title", bundle?.youtube_shorts?.title],
  ])
    if (typeof text === "string" && text.includes(FULL_URL_PLACEHOLDER))
      reasons.push(
        `${field} に ${FULL_URL_PLACEHOLDER} がある（Shorts の説明文だけに置く）`,
      );
  if (!nonEmpty(bundle?.youtube_full?.title, 100))
    reasons.push("youtube_full.title が無い・100字を超える");
  if (!nonEmpty(bundle?.youtube_full?.description, 5000))
    reasons.push("youtube_full.description が無い・5000字を超える");
  if (
    bundle?.youtube_full?.thumbnail !== undefined &&
    !thumbnailNameOk(bundle.youtube_full.thumbnail)
  )
    reasons.push(
      "youtube_full.thumbnail がファイル名でない（区切り・空は受けない）",
    );
  if (bundle?.bundle_version != null && !withShorts(bundle))
    reasons.push(`bundle_version が不正（${bundle.bundle_version}）`);
  if (withShorts(bundle)) {
    const shorts = bundle.youtube_shorts;
    if (!nonEmpty(shorts?.title, 100) || /[\r\n]/.test(shorts.title))
      reasons.push("youtube_shorts.title が無い・100字を超える・改行がある");
    else if (shorts.title === bundle?.youtube_full?.title)
      reasons.push("youtube_shorts.title が youtube_full.title と同じ");
    if (!nonEmpty(shorts?.description, 5000 - FILLED_URL_EXTRA))
      reasons.push(
        "youtube_shorts.description が無い・完全版の URL を入れると5000字を超える",
      );
    else if (shorts.description.split(FULL_URL_PLACEHOLDER).length !== 2)
      reasons.push(
        `youtube_shorts.description に ${FULL_URL_PLACEHOLDER} がちょうど1つ無い`,
      );
    for (const key of SHORTS_MACHINE_CHECKS)
      if (bundle?.qa?.machine?.[key] !== true)
        reasons.push(`Shorts の機械の検査 ${key} が通っていない`);
  }
  // review.p0_count の検査は、2026-10-20 オーナー決定（全貌は機械の検査だけで送る）に合わせて、別の PR（全貌の自動送信を
  // 機械の検査だけにする、#1714 の後）が外して review を任意にする。この PR では元の検査のまま残す
  if (bundle?.review?.p0_count !== 0)
    reasons.push(`評価役の P0 が0件でない（${bundle?.review?.p0_count}）`);
  const machine = bundle?.qa?.machine;
  if (
    !machine ||
    !Object.keys(machine).length ||
    !Object.values(machine).every((v) => v === true)
  )
    reasons.push("機械の検査が全部通っていない");
  if (Array.isArray(bundle?.qa?.bannedWords) && bundle.qa.bannedWords.length)
    reasons.push(`禁止語: ${bundle.qa.bannedWords.join(",")}`);
  for (const [channel, draft] of Object.entries(draftTexts(bundle))) {
    const hits = matchRiskRules(
      draftRiskFields(draft),
      draft.platform,
      riskRules,
    );
    if (hits.length)
      reasons.push(
        `禁止表現（${channel}）: ${hits.map((h) => h.id).join(",")}`,
      );
  }
  return reasons;
}

/** 完全版の YouTube のタグ（bundle の youtube_full.tags。hq 契約 10/24 C1） */
export const fullTagsOf = (bundle) =>
  Array.isArray(bundle?.youtube_full?.tags)
    ? [
        ...new Set(
          bundle.youtube_full.tags
            .filter((t) => typeof t === "string" && t.trim())
            .map((t) => t.trim().replace(/^#+/, "")),
        ),
      ]
    : [];

/**
 * 完全版の下書きの本文とハッシュタグ。送る文は buildPostText（本文＋空行＋hashtags の行）で作られ、YouTube の snippet.tags は
 * hashtags の頭の # を外したもの（youtubeTagsOf）。説明文の末尾のハッシュタグ行を hashtags に移し、送る文を bundle の説明文と同じにする
 * （本文に残したまま hashtags を足すと、末尾に「#」なしのタグの行が重なっていた。代わりの審査 2026-10-24 P2-1）
 */
export function fullYoutubeText(bundle) {
  const description = bundle?.youtube_full?.description ?? "";
  const tags = fullTagsOf(bundle);
  if (!tags.length) return { caption_text: description, hashtags: [] };
  const line = tags.map((t) => `#${t}`).join(" ");
  const lines = description.split("\n");
  if (lines.at(-1) !== line)
    return { caption_text: description, hashtags: tags.map((t) => `#${t}`) };
  return {
    caption_text: lines.slice(0, -1).join("\n").replace(/\n+$/, ""),
    hashtags: tags.map((t) => `#${t}`),
  };
}

const draftTexts = (bundle) => ({
  ...(wantsX(bundle)
    ? { x: { platform: "x", caption_text: bundle?.x_text ?? "", hashtags: [] } }
    : {}),
  youtube: {
    platform: "youtube",
    title: bundle?.youtube_full?.title ?? "",
    ...fullYoutubeText(bundle),
  },
  ...(withShorts(bundle)
    ? {
        youtube_shorts: {
          platform: "youtube",
          title: bundle.youtube_shorts?.title ?? "",
          caption_text: bundle.youtube_shorts?.description ?? "",
          hashtags: [],
        },
      }
    : {}),
});

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

/** 送信を始めた job の状態（このどれか、または attempts が1以上なら、外へ出たか出かけた） */
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
  // 1回でも claim した job（attempts が1以上）は送信を始めている。外へ出たかもしれないので差し替えない
  const started = live.flatMap((item) =>
    item.jobs
      .filter((j) => j.attempts > 0 || STARTED_STATES.includes(j.state))
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

/**
 * 前の束を止める（BOA-1201）。item を先に stopped（superseded）にして一意の索引（172 の sns_auto_send_items_race_channel）から外し、
 * 続けて queued の job を hold（理由 superseded）にする。item が先なのは、hold の前に claim されても transition_sns_x_send が
 * auto_stopped で止めるため。どこかで落ちたら投げる（呼ぶ側は新しい束を作らない）
 */
async function supersede(store, items, now) {
  for (const item of items)
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
  let held = 0;
  for (const item of items)
    for (const job of item.jobs.filter((j) => j.state === "queued")) {
      await store.holdJob(job.id, "superseded");
      held += 1;
    }
  return held;
}

/** 下書きの行（純粋関数）。public_url は送る直前の表示の確認に使う（UTM・タブ以外の query を付けない） */
export function draftRows(bundle, { revision, paths, when, observedAt }) {
  const raceUrl = `https://www.boat-ai.jp/race/${bundle.race_id}?tab=sonar`;
  const groupId = randomUUID();
  const common = {
    content_group_id: groupId,
    language: "ja",
    status: "pending_review",
    format: FULL_PICTURE_FORMAT,
    hashtags: [],
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
  };
  const queue = (channel) => ({
    deadline_at: when.deadline_at,
    expires_at: when.expires_at,
    source_revision: revision,
    source_observed_at: observedAt,
    public_url: raceUrl,
    screen_key: "race-sonar",
    ...(channel === "x" ? { thread_length: 1 } : { youtube_mode: "immediate" }),
  });
  const sourceData = (channel) => ({
    full_picture: {
      race_id: bundle.race_id,
      revision,
      review: bundle.review,
      qa: bundle.qa,
    },
    // YouTube の型を比べる札（daily.mjs --variant、hq SQ08 v5）。hq が source_data.full_picture_variant.id で数える
    ...(bundle.full_picture_variant
      ? { full_picture_variant: { id: bundle.full_picture_variant.id } }
      : {}),
    // 投稿の型の id（daily.mjs --type-spec、hq PD02）。hq が source_data.content_type.id で数える
    ...(bundle.content_type
      ? { content_type: { id: bundle.content_type.id } }
      : {}),
    deadline_queue: queue(channel),
    release_evidence: {
      status: "released",
      url: raceUrl,
      screen_key: "race-sonar",
      confirmed_by: "push-full-picture",
      reference: "full_picture",
      checked_at: observedAt,
      confirmed_at: observedAt,
    },
    qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
  });
  return {
    ...(paths.x
      ? {
          x: {
            ...common,
            scheduled_at: sendAtOf(when, "x"),
            platform: "x",
            title: bundle.youtube_full.title,
            caption_text: bundle.x_text,
            video_storage_path: paths.x,
            source_data: sourceData("x"),
          },
        }
      : {}),
    youtube: {
      ...common,
      scheduled_at: sendAtOf(when, "youtube"),
      platform: "youtube",
      title: bundle.youtube_full.title,
      ...fullYoutubeText(bundle),
      video_storage_path: paths.youtube,
      // 完全版のサムネイル（BOA-1172）。X・Shorts には付けない
      ...(paths.thumbnail ? { cover_image_path: paths.thumbnail } : {}),
      source_data: sourceData("youtube"),
    },
    ...(paths.shorts
      ? {
          // 親（完全版の job）の id は、完全版を承認した後に deadline_queue.parent_job_id へ入れる（承認は queue の一致を照合する）
          shorts: {
            ...common,
            scheduled_at: sendAtOf(when, "shorts"),
            platform: "youtube",
            title: bundle.youtube_shorts.title,
            caption_text: bundle.youtube_shorts.description,
            video_storage_path: paths.shorts,
            source_data: sourceData("shorts"),
          },
        }
      : {}),
  };
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons } （不合格）か { channels: { x: {...}, youtube: {...}, shorts: {...} } }（作ったチャネルだけ）
 */
export async function pushFullPicture(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const reject = async (reasons) => {
    if (!dryRun) {
      try {
        await notify(
          `SNS 全貌動画 ${bundle?.race_id ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
        );
      } catch (error) {
        console.error(`Slack に通知できません: ${error.message}`);
      }
    }
    return { reasons };
  };
  const reasons = checkFullPicture(bundle, riskRules);
  const files = {};
  for (const channel of channelsOf(bundle)) {
    const name = FILES[channel];
    try {
      files[channel] = await readBytes(path.join(folder, name));
      if (
        !files[channel].byteLength ||
        files[channel].byteLength > MAX_BYTES[channel]
      )
        reasons.push(
          `${name} の大きさが不正（${files[channel].byteLength} バイト）`,
        );
    } catch {
      reasons.push(`${name} が無い`);
    }
  }
  // 完全版のサムネイル（BOA-1172）。欄があるのに画像が無い・不正なら、作り手の不具合なので束ごと拒否する（黙って外さない）
  const thumbName = bundle?.youtube_full?.thumbnail;
  let thumbnail = null;
  if (thumbName !== undefined && thumbnailNameOk(thumbName)) {
    try {
      const bytes = await readBytes(path.join(folder, thumbName));
      const kind = thumbnailKind(bytes);
      if (!bytes.byteLength || bytes.byteLength > THUMBNAIL_MAX_BYTES)
        reasons.push(
          `${thumbName} の大きさが不正（${bytes.byteLength} バイト）`,
        );
      else if (!kind) reasons.push(`${thumbName} が PNG でも JPEG でもない`);
      else thumbnail = { bytes, ...kind };
    } catch {
      reasons.push(`${thumbName} が無い`);
    }
  }
  if (reasons.length) return reject(reasons);
  const race = await store.race(bundle.race_id);
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return reject(["レースが見つからない"]);
  if (race.cancellation_status != null) return reject(["レースが中止"]);
  const when = schedule(deadlineAt, now);
  if (now.getTime() >= Date.parse(when.latest))
    return reject([`締切の${LATEST_BEFORE_MIN}分前を過ぎた`]);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  // 版には受け取った動画を全部入れる（shorts.mp4 だけを直して入れ直しても、前の版の承認と同じ path を上書きしない）
  for (const channel of channelsOf(bundle)) hash.update(files[channel]);
  // サムネイルは動画の後に足す（欄の無い束の式は変えない）
  if (thumbnail) hash.update(thumbnail.bytes);
  const revision = hash.digest("hex").slice(0, 32);
  // 同じレースの生きた全貌の item（BOA-1201）。あれば一意の索引（172）に当たるので、差し替えるか拒否するかを先に決める
  const plan = supersedePlan(await store.liveFullPicture(bundle.race_id), {
    deadlineAt,
    revision,
  });
  if (plan.reasons) return reject(plan.reasons);
  // Shorts は、期限までに完全版の公開を待てる時刻に届いたときだけ作る
  const shortsLate =
    withShorts(bundle) &&
    now.getTime() >=
      Date.parse(minutesBefore(deadlineAt, SHORTS_LATEST_BEFORE_MIN));
  // X の日の枠の全貌の取り置き（182、docs/design/x-daily-slots/plan.md）。入らないと分かったら X だけ作らない
  // （claim で止まる job を作ると期限まで Slack が鳴る）。182 の前・読めないときは今のまま作る（claim が正）。X を作らない bundle では見ない
  // 差し替えるときは前の X の下書きの job を数えない（差し替えで hold にするので、二重に数えて X を落とさない）
  const xSlot =
    store.xSlotRoom && wantsX(bundle)
      ? await checkXSlot(
          store.xSlotRoom,
          SLOT_KINDS.fullPicture,
          1,
          plan.items.find((i) => i.channel === "x")?.draft_id ?? null,
        )
      : null;
  const channels = channelsOf(bundle).filter(
    (c) => (c !== "shorts" || !shortsLate) && (c !== "x" || !xSlot?.blocked),
  );
  const replacing = plan.items.length
    ? { from: plan.from, to: jstTime(deadlineAt), items: plan.items.length }
    : null;
  if (dryRun)
    return { dryRun: true, revision, when, shortsLate, xSlot, replacing };

  if (replacing) {
    try {
      replacing.held_jobs = await supersede(store, plan.items, now);
    } catch (error) {
      // 新しい item は作らない（送らない側に倒す）。止めた item の job は claim で auto_stopped、残った item は deadline_changed で止まる
      return reject([
        `前の束（締切 ${replacing.from}）の差し替えに失敗したので、新しい束を作らない: ${error.message}`,
      ]);
    }
  }

  const paths = Object.fromEntries(
    channels.map((c) => [
      c,
      `full-picture/${bundle.race_id}/${revision}/${FILES[c]}`,
    ]),
  );
  for (const channel of channels)
    await store.saveFile(paths[channel], files[channel]);
  if (thumbnail) {
    paths.thumbnail = `full-picture/${bundle.race_id}/${revision}/thumb-full.${thumbnail.ext}`;
    await store.saveFile(
      paths.thumbnail,
      thumbnail.bytes,
      thumbnail.contentType,
    );
  }
  const observedAt = now.toISOString();
  const rows = draftRows(bundle, { revision, paths, when, observedAt });
  const controls = await store.controls();
  const out = {};
  // 下書きと item を全部入れてから承認する（途中の item で落ちたとき、先に承認した分だけが送られて残らないように）
  const made = {};
  let shortsError = null;
  for (const channel of channels) {
    const control = controls[dbChannel(channel)];
    const auto = control?.mode === "auto" && control?.auto_approver_id;
    let draft, item;
    try {
      draft = await store.insertDraft(rows[channel]);
      item = await store.insertItem({
        kind: FULL_PICTURE_FORMAT,
        draft_id: draft.id,
        channel: dbChannel(channel),
        ...(channel === "shorts" ? { variant: "shorts" } : {}),
        race_id: bundle.race_id,
        deadline_at: when.deadline_at,
        notify_by: when.notify_by,
        veto_until: when.veto_until,
        state: auto ? "notified" : "manual",
        checks: {
          passed: true,
          review: bundle.review,
          machine: bundle.qa.machine,
          checked_at: observedAt,
        },
        // 止めるリンクは作らない（オーナー決定）。153 の CHECK が notified に要求するので、使わない乱数のハッシュを入れる
        ...(auto
          ? {
              notified_at: observedAt,
              stop_token_hash: randomBytes(32).toString("hex"),
            }
          : {}),
      });
    } catch (error) {
      // Shorts の書き込み（172 が未適用・一意の索引に当たる等）が落ちても、X・完全版は送る（X は Shorts と独立。x-channel の P1）
      if (channel !== "shorts") throw error;
      shortsError = `${error.message}${draft ? `（下書き ${draft.id} は承認されないまま残る）` : ""}`;
      continue;
    }
    made[channel] = { draft, item, control, auto: Boolean(auto) };
    out[channel] = {
      draft_id: draft.id,
      item_id: item.id,
      auto: Boolean(auto),
    };
  }
  for (const channel of Object.keys(made)) {
    const { item, control, auto } = made[channel];
    let { draft } = made[channel];
    if (!auto) continue;
    try {
      if (channel === "shorts") {
        // 完全版が自動で承認されていなければ、Shorts も自動では承認しない（親の無い {full_url} は送る前の検査でも止まる）
        const parentJobId = out.youtube?.job_id;
        if (!parentJobId)
          throw new Error(
            "完全版が自動で承認されなかったので、Shorts も個別承認に回した",
          );
        draft = await store.setParentJob(draft, parentJobId);
      }
      // 承認の媒体は動画と、完全版ならサムネイル（createXSnapshot が cover_image_path を2つ目に読む）
      const media = {
        [paths[channel]]: files[channel],
        ...(channel === "youtube" && thumbnail
          ? { [paths.thumbnail]: thumbnail.bytes }
          : {}),
      };
      const snapshot = await createXSnapshot(draft, async (p) =>
        Object.hasOwn(media, p)
          ? media[p]
          : Promise.reject(new Error("媒体の path が違う")),
      );
      const job = await store.approve({
        p_draft_id: draft.id,
        p_approver_id: control.auto_approver_id,
        p_snapshot: snapshot,
        p_scheduled_at: sendAtOf(when, channel),
      });
      out[channel].job_id = job?.id ?? null;
      out[channel].send_at = sendAtOf(when, channel);
    } catch (error) {
      await store
        .updateItem(item.id, "notified", { state: "manual" })
        .catch(() => {});
      out[channel].error = error.message;
    }
  }
  const label = {
    x: "x",
    youtube: "youtube（完全版）",
    shorts: "youtube（Shorts）",
  };
  const lines = Object.entries(out).map(([channel, r]) =>
    r.send_at
      ? `${label[channel]}: ${jstTime(r.send_at)} に自動で送る${channel === "shorts" ? "（完全版の公開の後。説明文に完全版の URL を入れる）" : ""}${controls[dbChannel(channel)]?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
      : r.error
        ? `${label[channel]}: 自動の承認に失敗（個別承認に回した）: ${r.error}${channel === "shorts" ? SHORTS_MANUAL_NOTE : ""}`
        : `${label[channel]}: 自動モードでないので個別承認の画面で承認する${channel === "shorts" ? SHORTS_MANUAL_NOTE : ""}`,
  );
  if (replacing)
    lines.unshift(
      `締切 ${replacing.from}→${replacing.to} で差し替えた（前の item ${replacing.items}件を stopped（superseded）、job ${replacing.held_jobs}件を held（superseded））`,
    );
  if (shortsError)
    lines.push(
      `youtube（Shorts）: 下書き・item を作れなかったので作らなかった（${out.x ? "X・" : ""}完全版は送る）: ${shortsError}`,
    );
  if (!wantsX(bundle)) lines.push("x: 束の channels に無いので作らない");
  if (xSlot?.blocked)
    lines.push(`x: 作らなかった（${xSlot.reason}）。YouTube は送る`);
  if (xSlot?.note) lines.push(`x: ${xSlot.note}`);
  if (shortsLate)
    lines.push(
      `youtube（Shorts）: 締切の${SHORTS_LATEST_BEFORE_MIN}分前を過ぎて届いたので作らなかった（完全版の公開を待つ時間が無い）`,
    );
  await notify(
    `SNS 全貌動画 ${bundle.race_id}（締切 ${jstTime(deadlineAt)}）\n${lines.join("\n")}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return {
    channels: out,
    revision,
    when,
    shortsLate,
    shortsError,
    xSlot,
    replacing,
  };
}

/** PostgREST・Storage の読み書き（service_role）。失敗は投げる */
export function createRestStore({ url, key, fetchImpl = fetch }) {
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
  return {
    race: async (raceId) =>
      (
        await call(
          `races?race_id=eq.${encodeURIComponent(raceId)}&select=race_id,race_date,start_time,cancellation_status`,
        )
      )[0] ?? null,
    controls: async () =>
      Object.fromEntries(
        (
          await call(
            "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
          )
        ).map((r) => [r.channel, r]),
      ),
    async saveFile(p, bytes, contentType = "video/mp4") {
      const response = await fetchImpl(
        `${url}/storage/v1/object/sns-hub-media/${p}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(`媒体を保存できない: HTTP ${response.status} ${p}`);
    },
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    updateItem: async (id, fromState, patch) =>
      one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      ),
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
    // 同じレースの生きた全貌の item（172 の一意の索引に当たるもの）と、その下書きの版・job（BOA-1201）
    async liveFullPicture(raceId) {
      const items = await call(
        `sns_auto_send_items?race_id=eq.${encodeURIComponent(raceId)}&kind=eq.full_picture&state=not.in.(stopped,held_manual)&select=id,draft_id,channel,variant,state,deadline_at`,
      );
      if (!items.length) return [];
      const ids = items.map((i) => i.draft_id).join(",");
      const [drafts, jobs] = await Promise.all([
        call(
          `sns_drafts?id=in.(${ids})&select=id,revision:source_data->full_picture->>revision`,
        ),
        call(
          `sns_x_send_jobs?draft_id=in.(${ids})&select=id,draft_id,state,attempts`,
        ),
      ]);
      return items.map((i) => ({
        ...i,
        revision: drafts.find((d) => d.id === i.draft_id)?.revision ?? null,
        jobs: jobs.filter((j) => j.draft_id === i.draft_id),
      }));
    },
    // job を保留にする（transition_sns_x_send の hold。理由は英小文字と _ なら error_code に入る、139・189）
    holdJob: (jobId, reason) =>
      call("rpc/transition_sns_x_send", {
        method: "POST",
        body: { p_job_id: jobId, p_action: "hold", p_result: { reason } },
      }),
    // X の日の枠の取り置きの残り（182）
    xSlotRoom: xSlotRoomVia(call),
    // 下書きの deadline_queue に親（完全版の job）を入れる。承認の前に入れないと、承認の queue の照合に通らない
    setParentJob: async (draft, parentJobId) =>
      one(
        await call(`sns_drafts?id=eq.${draft.id}&status=eq.pending_review`, {
          method: "PATCH",
          body: {
            source_data: {
              ...draft.source_data,
              deadline_queue: {
                ...draft.source_data.deadline_queue,
                parent_job_id: parentJobId,
              },
            },
          },
        }),
        `下書き ${draft.id} に親の job を入れられない`,
      ),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/push-full-picture.js <フォルダ> [--dry-run]",
    );
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const webhook =
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_DIGEST_WEBHOOK_URL;
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  const result = await pushFullPicture(folder, {
    store: createRestStore({ url, key }),
    readBytes: async (p) => {
      await stat(p);
      return new Uint8Array(await readFile(p));
    },
    notify: async (text) => {
      console.log(text);
      if (webhook)
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
    },
    riskRules,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.reasons?.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
