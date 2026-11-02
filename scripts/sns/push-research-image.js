/**
 * X の「数字で見たら」（集計ランキングの画像1枚、format=research_image、X だけ、月・水・金 19:00）のフォルダを受け取り、
 * X の下書きと自動送信の item を作って、送る時刻（19:00 等）の予定に入れる（hq XR01、マイグレーション 179・180）。
 * hq の作業役が同じ Mac の本リポジトリで実行する（15:00 に作り、--no-wait で入れて 19:00 に送り手が送る）。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 * 同じ形の「節の機力」（kind=setsu_kiryoku、毎日 21:30、BOA-1209、マイグレーション 194）も、この口が型（DAILY_IMAGE_TYPES）ごとに受け取る。
 * 入口は scripts/sns/push-setsu-kiryoku.js（hq の setsu_sheet.py の出力）。違いは PUSH_RULES の注記を見る
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-research-image.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-research-image.js --status <YYYY-MM-DD>   その日の状態・tweet id を出す
 *
 * フォルダ（hq の research_rank.py の出力）: bundle.json と PNG 1枚（1080×1350）。ほかのファイルは読まない
 *   {format:"research_image", date:"YYYY-MM-DD"（送る日の JST）, slug:"英小文字・数字・ハイフン 40字まで", send_time:"HH:MM"（JST）,
 *    x_text:"本文（ハッシュタグ・リンクなし）", hashtags:["#ボートレース"]（0〜2個）, images:["<slug>.png"],
 *    source_observed_at:"集計した時刻（ISO）", review:{p0_count:0, by}}
 *
 * race_id の代わり: research:{date}:{slug}（item の race_id・下書きの source_data.race_id・結果の research_id）。1日1本（179 の一意の索引）
 * 時刻（すべて送る時刻 S＝date の send_time から決まる）:
 *   締切（deadline_at）＝S＋120分、期限（expires_at、送り手が送れる最後）＝締切−60分＝S＋60分（180 の research_image の期限と同じ）。
 *   送る時刻（scheduled_at・veto_until）＝S と「今＋2分」の遅い方。期限の10分前を過ぎて届いたら受け取らない。
 *   send_time は 08:00〜21:30（送り手の cron が JST 22:58 まで動くので、期限が 22:30 までに収まる。目安）
 *   source_observed_at（集計の時刻）は今より前、かつ期限まで24時間以内（180 の research_image の鮮度と同じ。超えると送り手が source_stale で止める）
 * 自動送信の許可（sns_auto_send_control の x の行の research_image_enabled、179）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 * X の日の上限（daily_limit_x）は、受け取る時点でもう1本が入らなければ受け取らない（19:00 までの他の投稿は数えられない。送り手の claim が最後に数える）
 * 送るのは送り手（cron sns-send、2分ごと）。push は job を入れた後、送り終わる（posted・held 等）か期限＋90秒まで待つ（--no-wait で待たない）
 *
 * stdout の最後の1行は `RESEARCH_RESULT {...}`（research_id・outcome・job_id・job_state・tweet_id・tweet_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日の research_image が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・自動モードでない）・6 想定外の失敗
 * --status は、その日の生きている item（無ければ最新）と job の状態・送れていない理由（held の error_code、送る前の検査で落ちた理由
 *   precheck_reason（送り手の最後の報告から、30分だけ残る）、待ちのまま送る時刻を過ぎていれば日の上限の見込み blocked_hint）を JSON で出す（hq の記録用。送れなかった理由は sns_x_send_jobs.error_code と item の held_reason に残る）
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  DAILY_IMAGE_TYPES,
  dailyIdOf,
  researchTextReasons,
  setsuRacerReasons,
} from "../../api/_lib/snsResearchImage.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import {
  checkImages,
  createRestStore as createFinalsRestStore,
  dailyLimitReason,
  RETRYABLE_JOB_STATES,
  statusOf,
  waitForSend,
} from "./push-finals-image.js";

export const RESEARCH_TYPE = DAILY_IMAGE_TYPES.research_image;
export const SETSU_TYPE = DAILY_IMAGE_TYPES.setsu_kiryoku;
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
/**
 * 型ごとの取り込みの決まり。結果の1行の札（tag）・送る時刻の幅・機械の検査の P0 の要否・集計の時刻の書き方。
 * 節の機力: 送る時刻は 21:30 だけ（hq config/setsu-kiryoku.json の send_time、正本 hq drafts/x-setsu-kiryoku-20261031.md）。
 *   hq の作り手は review を出さない（関門は setsu_sheet.py の verify が作る前に見る）ので、review は有れば P0 が0件であることだけを見る。
 *   source_observed_at は時差つきの ISO か、hq の集計の as_of（「YYYY-MM-DD NR まで」、日は date と同じ）。as_of のときは
 *   時刻を持たないので、その日の 00:00 JST（いちばん古い見積り）を集計の時刻として DB の鮮度の照合（24時間）に渡し、as_of の文字列は
 *   下書きに残す（受け取った時刻にすると、作り直しのたびに新しく見え、鮮度の照合が名前だけになる。/code-review の指摘）。
 *   選手（racers）は必ず名前と級（setsuRacerReasons、オーナー 2026-11-01）。dryRunAhead: --dry-run で今日でない束を送る時刻の時計で通す
 *   （hq の見本を前の日に試すため。数字で見たらは今までどおり今日の束だけ）。extraSource: 下書きの source_data に足す欄
 */
export const PUSH_RULES = {
  research_image: {
    tag: "RESEARCH_RESULT",
    earliest: SEND_TIME_EARLIEST,
    latest: SEND_TIME_LATEST,
    requireReview: true,
    allowAsOf: false,
    dryRunAhead: false,
    extraSource: () => ({}),
  },
  setsu_kiryoku: {
    tag: "SETSU_RESULT",
    earliest: "21:30",
    latest: "21:30",
    requireReview: false,
    allowAsOf: true,
    dryRunAhead: true,
    // 画像の材料の選手（名前と級。送る直前の読み直しが見る）と節・ネタ・集計の as_of
    extraSource: (bundle) => ({
      meet_id: bundle.meet_id ?? null,
      neta: bundle.neta ?? null,
      racers: bundle.racers,
      // hq 33bd771 からは as_of の欄（「YYYY-MM-DD NR まで」）を別に出す。古い束は source_observed_at が as_of の形
      as_of:
        typeof bundle.as_of === "string"
          ? bundle.as_of
          : AS_OF.test(bundle.source_observed_at ?? "")
            ? bundle.source_observed_at
            : null,
    }),
  },
};
const stopSql = (type) =>
  `UPDATE public.sns_auto_send_control SET ${type.enabledColumn} = false WHERE channel = 'x';`;
/** hq の集計の as_of（「2026-11-03 12R まで」） */
const AS_OF = /^(\d{4}-\d{2}-\d{2}) \d{1,2}R まで$/;

const addMin = (iso, min) =>
  new Date(Date.parse(iso) + min * 60000).toISOString();
const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
/** 時差（Z か ±HH:MM）つきの ISO だけ。時差の無い文字列は Node は手元の時刻、DB は接続の TimeZone で読み、別の時刻になる */
const isIso = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v));

/** bundle.json の検査（純粋関数）。時刻の窓は checkTiming が見る。type は DAILY_IMAGE_TYPES の1つ（既定は数字で見たら） */
export function checkResearchBundle(
  bundle,
  riskRules = [],
  type = RESEARCH_TYPE,
) {
  const rules = PUSH_RULES[type.kind];
  const reasons = [];
  if (bundle?.format !== type.bundleFormat)
    reasons.push(`format が ${type.bundleFormat} でない`);
  if (bundle?.kind !== undefined && bundle.kind !== type.kind)
    reasons.push(`kind が ${type.kind} でない（${bundle.kind}）`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? ""))
    reasons.push("date が YYYY-MM-DD でない");
  if (!type.slug.test(bundle?.slug ?? ""))
    reasons.push(
      `slug が ${type.slug.source} の形（英小文字・数字・ハイフンの40字まで）でない`,
    );
  const sendTime = bundle?.send_time ?? "";
  if (
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(sendTime) ||
    sendTime < rules.earliest ||
    sendTime > rules.latest
  )
    reasons.push(
      rules.earliest === rules.latest
        ? `send_time が ${rules.earliest} でない`
        : `send_time が ${rules.earliest}〜${rules.latest} の HH:MM でない`,
    );
  if (
    !Array.isArray(bundle?.images) ||
    bundle.images.length !== 1 ||
    bundle.images[0] !== `${bundle?.slug}.png`
  )
    reasons.push(`images が ["${bundle?.slug}.png"] の1枚でない`);
  const asOf = rules.allowAsOf
    ? AS_OF.exec(bundle?.source_observed_at ?? "")
    : null;
  if (asOf && asOf[1] !== bundle?.date)
    reasons.push(
      `source_observed_at（集計の as_of）の日 ${asOf[1]} が date ${bundle?.date} と違う`,
    );
  else if (!asOf && !isIso(bundle?.source_observed_at))
    reasons.push(
      rules.allowAsOf
        ? "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でも「YYYY-MM-DD NR まで」でもない"
        : "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でない",
    );
  if (
    (rules.requireReview || bundle?.review !== undefined) &&
    bundle?.review?.p0_count !== 0
  )
    reasons.push(`機械の検査の P0 が0件でない（${bundle?.review?.p0_count}）`);
  if (type.hasRacers) reasons.push(...setsuRacerReasons(bundle?.racers));
  const fields = { caption: bundle?.x_text, hashtags: bundle?.hashtags };
  reasons.push(...researchTextReasons(fields));
  const hits = matchRiskRules(
    draftRiskFields({
      platform: "x",
      caption_text: bundle?.x_text ?? "",
      hashtags: Array.isArray(bundle?.hashtags) ? bundle.hashtags : [],
    }),
    "x",
    riskRules,
  );
  if (hits.length)
    reasons.push(`禁止表現（risk-rules）: ${hits.map((h) => h.id).join(",")}`);
  return reasons;
}

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

/** 下書きの行（純粋関数）。リンクは置かないので、送る直前のリンク先の表示の確認は無い（screen_key は none） */
export function draftRow(
  bundle,
  { revision, imagePath, when, observedAt },
  type = RESEARCH_TYPE,
) {
  const researchId = dailyIdOf(type, bundle.date, bundle.slug);
  const extra = PUSH_RULES[type.kind].extraSource(bundle);
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: type.kind,
    platform: "x",
    title: `${type.label} ${bundle.date} ${bundle.slug}`,
    caption_text: bundle.x_text,
    hashtags: bundle.hashtags,
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    cover_image_path: imagePath,
    source_data: {
      // 管理画面の一覧・記録（snsXSendStore の race_id）が読む
      race_id: researchId,
      [type.sourceKey]: {
        [type.idField]: researchId,
        date: bundle.date,
        slug: bundle.slug,
        revision,
        review: bundle.review ?? null,
        ...extra,
      },
      // 承認の関数（160）が媒体をこの順で照合する（先頭は cover_image_path）。この型は1枚だけ
      image_paths: [imagePath],
      // thread_length は入れない（送り手の検査が加重280で見る）。public_url は無い（リンクなし）
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        screen_key: "none",
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/** item の行（純粋関数）。自動（notified）は止めるリンクを作らない（全貌・優勝戦と同じ。153 の CHECK が要るので使わない乱数のハッシュ） */
function itemRow(
  bundle,
  { draftId, when, state, checkedAt, heldReason },
  type = RESEARCH_TYPE,
) {
  return {
    kind: type.kind,
    variant: "main",
    draft_id: draftId,
    channel: "x",
    race_id: dailyIdOf(type, bundle.date, bundle.slug),
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state,
    checks: {
      passed: true,
      review: bundle.review ?? null,
      checked_at: checkedAt,
    },
    ...(heldReason ? { held_reason: heldReason } : {}),
    ...(state === "notified"
      ? {
          notified_at: checkedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/**
 * 同じ日の生きている item を見る。送った・送っている・待っている item があれば { already } を返す（1日1本）。
 * 自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無い item は、作り直す対象として返す
 */
async function liveOf(store, date, type) {
  const live = (await store.researchItems(date)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (
      item.state === "notified" &&
      (!job || RETRYABLE_JOB_STATES.includes(job.state))
    )
      retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じ日の ${type.kind} が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: dailyStatusOf(type, item, job),
        },
      };
  }
  return { retry };
}

/** item と job から、hq に返す状態（純粋関数） */
export const dailyStatusOf = (type, item, job) => ({
  ...statusOf(item?.race_id ?? null, item, job),
  [type.idField]: item?.race_id ?? null,
  held_reason: item?.held_reason ?? null,
});
export const researchStatusOf = (item, job) =>
  dailyStatusOf(RESEARCH_TYPE, item, job);

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ research_id, draft_id, item_id, job_id, send_at, ... }
 */
export const pushResearchImage = (folder, deps) =>
  pushDailyImage(folder, { ...deps, type: RESEARCH_TYPE });
export const pushSetsuKiryoku = (folder, deps) =>
  pushDailyImage(folder, { ...deps, type: SETSU_TYPE });

/** 型（type）ごとの受け取り。返り値の id は type.idField（research_id・setsu_id）のキー */
export async function pushDailyImage(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now: realNow = new Date(),
    dryRun = false,
    type = RESEARCH_TYPE,
  },
) {
  const idKey = type.idField;
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  // --dry-run で今日でない日の束（hq の見本・前日の試し）は、その日の送る時刻の2分前の時計で時刻の検査を通す（dryRunAhead の型だけ。
  // push-setsu-kiryoku-short.js と同じ時計）。その日の X の日の上限はまだ決まらないので見ない（limit_checked=false、結果の1行に simulated_now）。
  // Shorts は今の値で上限を見るが、X の上限は daily_baseline_date が今日の分しか無いので、別の日には当てられない。書く道では使わない
  const simulated =
    dryRun && PUSH_RULES[type.kind].dryRunAhead
      ? dryRunClock(bundle, realNow)
      : null;
  const extra = simulated
    ? { simulated_now: simulated.toISOString(), limit_checked: false }
    : {};
  const now = simulated ?? realNow;
  const researchId =
    bundle?.date && bundle?.slug
      ? dailyIdOf(type, bundle.date, bundle.slug)
      : null;
  const controls = await store.controls();
  // 列が無い（179・194 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.x?.[type.enabledColumn] === true;
  const writes = enabled && !dryRun;
  const reject = async (reasons) => {
    if (writes)
      await notify(
        `SNS ${type.label} ${researchId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { [idKey]: researchId, reasons, ...extra };
  };
  const reasons = checkResearchBundle(bundle, riskRules, type);
  if (reasons.length) return reject(reasons);
  if (!type.parseId(researchId)) return reject([`${idKey} が作れない`]);
  const when = schedule(bundle, now);
  const observedAt = observedAtOf(bundle);
  const timing = checkTiming(bundle, when, now, observedAt);
  if (timing.length) return reject(timing);
  // 同じ日の生きている item・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、179）
  const live = await liveOf(store, bundle.date, type);
  if (live.already) return { [idKey]: researchId, ...live.already };
  const [name] = bundle.images;
  let bytes;
  try {
    bytes = await readBytes(path.join(folder, name));
  } catch (error) {
    // 無い（ENOENT）は checkImages が「無い」と書く。それ以外（権限・I/O）は原因を残す
    if (error?.code && error.code !== "ENOENT")
      return reject([`${name} を読めない（${error.code}: ${error.message}）`]);
  }
  const imageReasons = checkImages([name], { [name]: bytes });
  if (imageReasons.length) return reject(imageReasons);
  if (!simulated) {
    const [sendControl, todayJobs] = await Promise.all([
      store.sendControl(),
      store.jobsAttemptedOn(jstDate(now)),
    ]);
    const limitReason = dailyLimitReason({
      sendControl,
      jobs: todayJobs,
      now,
    });
    if (limitReason) return reject([limitReason]);
  }
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  hash.update(bytes);
  const revision = hash.digest("hex").slice(0, 32);
  if (!writes)
    return {
      [idKey]: researchId,
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      revision,
      when,
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
  const imagePath = `${type.storagePrefix}/${bundle.date}/${bundle.slug}/${revision}.png`;
  await store.saveFile(imagePath, bytes);
  const checkedAt = now.toISOString();
  const auto = controls.x?.mode === "auto" && controls.x?.auto_approver_id;
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, imagePath, when, observedAt }, type),
  );
  const item = await store.insertItem(
    itemRow(
      bundle,
      {
        draftId: draft.id,
        when,
        state: auto ? "notified" : "held_manual",
        checkedAt,
        heldReason: auto
          ? null
          : "自動モードでない（この型は自動の道だけで送る）",
      },
      type,
    ),
  );
  const out = {
    [idKey]: researchId,
    draft_id: draft.id,
    item_id: item.id,
    auto: Boolean(auto),
  };
  if (auto) {
    try {
      const snapshot = await createXSnapshot(draft, async (p) =>
        p === imagePath
          ? bytes
          : Promise.reject(new Error("媒体の path が違う")),
      );
      const job = await store.approve({
        p_draft_id: draft.id,
        p_approver_id: controls.x.auto_approver_id,
        p_snapshot: snapshot,
        p_scheduled_at: when.send_at,
      });
      if (!job?.id) throw new Error("job の id を受け取れない");
      out.job_id = job.id;
      out.send_at = when.send_at;
    } catch (error) {
      out.error = error.message;
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
    ? `x: ${jstTime(when.send_at)} に送る（期限 ${jstTime(when.expires_at)}）${controls.x?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : out.error
      ? `x: 自動の承認に失敗（送らない）: ${out.error}`
      : "x: 自動モードでないので送らない";
  await notify(
    `SNS ${type.label} ${researchId}\n${line}\n止めるには: ${stopSql(type)}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

/**
 * その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null。
 * job が queued のまま送る時刻を過ぎていれば、日の上限の見込み（blocked_hint）を添える（claim が「日次全体上限です」で投げている間は
 * job に error_code が残らず、期限の後に deadline_expired になるため）
 */
export async function researchStatus(
  date,
  { store, now = new Date(), type = RESEARCH_TYPE },
) {
  const items = await store.researchItems(date);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  const job = await store.jobForDraft(item.draft_id);
  const status = dailyStatusOf(type, item, job);
  // 送る前の検査（readCurrent・preflight）で落ちた job は claim されず queued のまま、期限の後に deadline_expired になるので、
  // job に理由が残らない。送り手の最後の報告（scrape_job_state の sns_send の last_report.alerts、key は precheck:{job_id}:{理由}）から引く。
  // 報告は2分ごとに上書きされ、理由は見直すまで30分だけ残る（snsSendRunner.js の CONTINUING_ALERT_MINUTES）。読めなければ null
  if (job && job.state !== "posted" && store.sendReport) {
    const report = await store.sendReport().catch((error) => {
      console.error(`送り手の報告を読めない: ${error.message}`);
      return null;
    });
    const prefix = `precheck:${job.id}:`;
    const alert = (report?.alerts ?? []).find((a) =>
      a?.key?.startsWith(prefix),
    );
    status.precheck_reason = alert ? alert.key.slice(prefix.length) : null;
  }
  if (
    job?.state === "queued" &&
    job.scheduled_at &&
    now.getTime() > Date.parse(job.scheduled_at) + 5 * 60000
  ) {
    const [sendControl, todayJobs] = await Promise.all([
      store.sendControl(),
      store.jobsAttemptedOn(jstDate(now)),
    ]);
    status.blocked_hint =
      dailyLimitReason({ sendControl, jobs: todayJobs, now }) ??
      "送る時刻を過ぎて待っている（送り手の検査の通知を Slack で見る）";
  }
  return status;
}

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  result,
  status = null,
  { waited = Boolean(status), type = RESEARCH_TYPE } = {},
) {
  const idKey = type.idField;
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
    [idKey]: result[idKey] ?? null,
    outcome,
    job_id: s?.job_id ?? result.job_id ?? null,
    job_state: s?.job_state ?? null,
    tweet_id: s?.tweet_id ?? null,
    tweet_url: s?.tweet_url ?? null,
    posted_at: s?.posted_at ?? null,
    error_code: s?.error_code ?? result.error ?? null,
    reason:
      result.reasons?.join(" / ") ??
      result.reason ??
      (result.disabled
        ? `自動送信の許可（${type.enabledColumn}）が off なので送らなかった`
        : outcome === "not_posted" && !result.job_id
          ? result.error
            ? `自動の承認に失敗したので job を作らなかった: ${result.error}`
            : "自動モードでないので job を作らなかった"
          : null),
    // --dry-run を別の日の時計で通したとき（日の上限は見ていない）。hq は1行だけを読むので、ここに出す
    ...(result.simulated_now ? { simulated_now: result.simulated_now } : {}),
  };
  return { code, text: `${PUSH_RULES[type.kind].tag} ${JSON.stringify(line)}` };
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の読み書きは push-finals-image.js の store を使い、
 * この型の item の読み取りと許可の列だけを足す。失敗は投げる
 */
export function createRestStore({
  url,
  key,
  fetchImpl = fetch,
  type = RESEARCH_TYPE,
}) {
  const base = createFinalsRestStore({ url, key, fetchImpl });
  async function get(p) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB の読み取りに失敗: HTTP ${response.status} ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  return {
    ...base,
    // この型（type）の item（名前は数字で見たらのときのまま）
    researchItems: (date) =>
      get(
        `sns_auto_send_items?kind=eq.${type.kind}&channel=eq.x&race_id=like.${encodeURIComponent(`${type.idPrefix}:${date}:*`)}&select=id,state,draft_id,race_id,held_reason&order=created_at.desc`,
      ),
    // 許可の列（research_image_enabled・setsu_kiryoku_enabled）が無い（179・194 が未適用）と PostgREST が 400 を返すので、
    // その時は列なしで読み直して off とする
    async controls() {
      let rows;
      try {
        rows = await get(
          `sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,${type.enabledColumn}`,
        );
      } catch (error) {
        if (!/HTTP 400/.test(error.message)) throw error;
        console.error(
          `${type.enabledColumn} の列が無い（マイグレーションが未適用）。許可は off として扱う`,
        );
        rows = await get(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
        );
      }
      return Object.fromEntries(rows.map((r) => [r.channel, r]));
    },
    sendReport: async () =>
      (await get("scrape_job_state?job=eq.sns_send&select=last_report"))[0]
        ?.last_report ?? null,
    jobForDraft: async (draftId) =>
      (
        await get(
          `sns_x_send_jobs?draft_id=eq.${draftId}&select=id,state,error_code,scheduled_at,expires_at,posted_at,external_post_id,external_post_url`,
        )
      )[0] ?? null,
  };
}

/** CLI。型ごとの入口（push-research-image.js・push-setsu-kiryoku.js）から呼ぶ */
export async function main(
  type = RESEARCH_TYPE,
  script = "push-research-image.js",
) {
  const args = process.argv.slice(2);
  const tag = PUSH_RULES[type.kind].tag;
  const usage = `使い方: node --env-file=.env.local scripts/sns/${script} <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD>`;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key, type });
  if (args[0] === "--status") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "")) {
      console.error(usage);
      process.exit(2);
    }
    console.log(
      JSON.stringify(await researchStatus(args[1], { store, type }), null, 2),
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
  let researchId = null;
  try {
    const b = JSON.parse(
      await readFile(path.join(folder, "bundle.json"), "utf8"),
    );
    if (b?.date && b?.slug) researchId = dailyIdOf(type, b.date, b.slug);
  } catch {
    /* 読めない bundle.json は pushResearchImage が投げ、下で error の1行にする */
  }
  // どこで落ちても、最後の1行は RESEARCH_RESULT・SETSU_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `${tag} ${JSON.stringify({ [type.idField]: researchId, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushDailyImage(folder, {
    type,
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
    result.job_id && !args.includes("--no-wait")
      ? await waitForSend(result[type.idField], {
          store,
          draftId: result.draft_id,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(result, status, {
    waited: Boolean(status),
    type,
  });
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
