/**
 * YouTube Shorts【人気薄の1着】（format・kind = upset_win_short、BOA-1284、マイグレーション 198）のフォルダを受け取り、
 * YouTube の下書き（動画1本）と自動送信の item を作って、送る時刻の予定に入れる。形は節の機力の Shorts（push-setsu-kiryoku-short.js、193）と同じで、
 * 動画・時刻・日の上限とクォータの検査と、送り終わるまで待つ所はその口の関数を使う。違うのは、型の検査（upsetWin/model.js）・
 * そのレースの値の DB での読み直し・説明欄のリンク（龍神ソナーのレースの頁）・race_id・許可の列。
 * hq の機械が同じ Mac の本リポジトリで、毎朝 7:00 ごろに作り手（sns-video-studio/remotion/scripts/upset-win/daily.mjs）の後に実行する。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-upset-win-short.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-upset-win-short.js --status <YYYY-MM-DD>   その日の状態・動画の URL を出す
 *
 * フォルダ（作り手の出力）: bundle.json と upset_win.mp4（縦・60秒まで・32 MiB まで）。ほかのファイルは読まない
 *   題・説明欄は bundle の youtube.title・youtube.description をそのまま送る（書き換えない。型の検査が値から作り直した文と照らす）
 *
 * 検査（どれかが通らなければ何も書かない）:
 *   1. 型の検査（upsetWin/model.js の checkBundle）をもう一度通す: 選び（単勝10倍以上・弱さ・3コマ目の項目）・直近1年の日ごとの和・
 *      画面の文・声・題・説明欄が値から作った文と同じか・画面の数・禁止語・配当の円・尺（25〜35秒）
 *   2. DB の読み直し: そのレースの6艇の名前・級・勝率・展示タイム・展示 ST・モーター2連率・単勝、1着・決まり手が bundle と同じで、
 *      中止・不成立・欠場が無い（画面の数字と DB の照合。違えば送らない）
 *   3. この口の検査: 題は100字まで・改行と < > なし、説明欄は5000バイトまで・< > なし、説明欄のリンクはちょうど1つでそのレースの
 *      龍神ソナーの頁（https://www.boat-ai.jp/race/{race_id}?tab=sonar、ほかのクエリは utm_* だけ）、送る時刻は 07:00〜07:50、動画は MP4・縦・60秒まで
 *   4. 時刻: date は今日（JST）、受け取りは送る時刻の15分前から、期限の10分前より前、集計の時刻は今より前で期限まで鮮度の線の内
 *   5. 二重送信: 同じ日の upset_win_short が生きているか送ってあれば作らない（exit 4、198 の一意の索引でも止まる）。
 *      前の束が送らずに終わっていれば（held・failed・cancelled・承認の途中で落ちた）作り直す
 *   6. YouTube の日の上限（daily_limit_youtube）とクォータ（1 upload・104 units）: 節の機力と同じ数え方（youtubeRoomReason）
 *
 * 時刻（送る時刻 S＝date の send_time と「今＋2分」の遅い方）: 期限＝S＋60分、締切＝期限＋sns_x_send_control.expiry_minutes（節の機力と同じ）
 * 自動送信の許可（sns_auto_send_control の youtube の行の upset_win_short_enabled、198）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage・Slack に書かない、exit 3）。送り手も off の job を送らない
 * --dry-run は DB を読むだけ。date が今日でない束（見本の束）は、その日の送る時刻の2分前に受け取ったとして時刻の検査をする
 *
 * stdout の最後の1行は `UPSET_RESULT {...}`（upset_id・outcome・job_id・job_state・video_id・video_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足・3 許可が off なので書かなかった
 *   ・4 同じ日の upset_win_short が既にある（何もしない）・5 予定に入れたが送れなかった・6 想定外の失敗
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import twitterText from "twitter-text";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  parseUpsetId,
  UPSET_SCREEN_KEY,
  UPSET_WIN_SHORT_KIND,
  upsetIdOf,
} from "../../api/_lib/snsUpsetWinShort.js";
import {
  checkBundle,
  shapeRace,
} from "../../sns-video-studio/remotion/src/upsetWin/model.js";
import { fetchRaceRows } from "../../sns-video-studio/remotion/scripts/upset-win/materials.mjs";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import {
  RETRYABLE_JOB_STATES,
  checkTiming,
  checkVideo,
  createRestStore as createSetsuStore,
  mp4Info,
  schedule,
  SEND_DELAY_SEC,
  waitForSend,
  youtubeRoomReason,
} from "./push-setsu-kiryoku-short.js";

export const UPSET_FORMAT = UPSET_WIN_SHORT_KIND;
export const VIDEO_NAME = "upset_win.mp4";
/** 送る時刻（JST）。仕様「毎朝 7:00〜7:59 に1本」。期限は送る時刻＋60分 */
export const SEND_TIME_EARLIEST = "07:00";
export const SEND_TIME_LATEST = "07:50";
export const DEFAULT_SEND_TIME = "07:15";
/** 作り直してよい job の状態（節の機力の口と同じ） */
export { RETRYABLE_JOB_STATES };
/** job の無い自動の item は、作ってからこの分を過ぎたら承認の途中で落ちたとみなして作り直す（並行の push が作りかけの item を止めないため） */
export const ORPHAN_ITEM_MIN = 5;
const SITE = "https://www.boat-ai.jp";
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET upset_win_short_enabled = false WHERE channel = 'youtube';（上げている最中なら mode='manual' も）";
/** DB と照らす艇の欄（shapeRace の形） */
export const BOAT_FIELDS = [
  "boat",
  "racer",
  "class",
  "win_rate",
  "motor_2rate",
  "exhibition_time",
  "start_timing",
  "st_flag",
  "odds",
];

const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const isHhmm = (v) =>
  typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);

/** 説明欄のリンク（純粋関数）。ちょうど1つで、そのレースの龍神ソナーの頁。返り値 { url（表示の確認に使う。tab だけ残す）, reasons } */
export function descriptionLink(description, raceId) {
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
  const extra = [...u.searchParams.keys()].filter(
    (k) => k !== "tab" && !k.startsWith("utm_"),
  );
  if (
    u.origin !== SITE ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname !== `/race/${raceId}` ||
    u.searchParams.get("tab") !== "sonar" ||
    extra.length
  )
    return {
      url: null,
      reasons: [
        `説明欄のリンクがこのレースの龍神ソナーの頁（${SITE}/race/${raceId}?tab=sonar、ほかのクエリは utm_* だけ）でない: ${urls[0]}`,
      ],
    };
  return { url: `${SITE}/race/${raceId}?tab=sonar`, reasons: [] };
}

/** bundle.json の検査（純粋関数）。型の検査とこの口の検査。時刻の窓は checkTiming、DB の照合は raceReasons が見る */
export function checkUpsetBundle(bundle, riskRules = []) {
  const reasons = checkBundle(bundle, { rules: riskRules, matchRiskRules });
  if (reasons.length || !bundle || typeof bundle !== "object") return reasons;
  const { title, description } = bundle.youtube;
  if ([...title].length > 100) reasons.push("youtube.title が100字を超える");
  if (/[\r\n<>]/.test(title))
    reasons.push("youtube.title に改行か < > がある（YouTube が受けない）");
  if (Buffer.byteLength(description, "utf8") > 5000)
    reasons.push("youtube.description が5000バイトを超える");
  if (/[<>]/.test(description))
    reasons.push("youtube.description に < > がある（YouTube が受けない）");
  reasons.push(...descriptionLink(description, bundle.race_id).reasons);
  if (
    !isHhmm(bundle.send_time) ||
    bundle.send_time < SEND_TIME_EARLIEST ||
    bundle.send_time > SEND_TIME_LATEST
  )
    reasons.push(
      `send_time が ${SEND_TIME_EARLIEST}〜${SEND_TIME_LATEST} の HH:MM でない`,
    );
  if (bundle.video !== undefined && bundle.video !== VIDEO_NAME)
    reasons.push(`video が ${VIDEO_NAME} でない`);
  return reasons;
}

/** DB の読み直し（そのレースの行を shapeRace にした形）と bundle の照合（純粋関数）。理由の配列 */
export function raceReasons(bundle, race) {
  if (!race) return [`${bundle.race_id} が DB に無い`];
  const why = [];
  if (race.cancelled) why.push("DB でそのレースが中止");
  if (race.no_race) why.push("DB でそのレースが不成立");
  if (race.absent) why.push("DB でそのレースに欠場がある");
  if (race.rank1 !== bundle.rank1)
    why.push(`1着が DB と違う（bundle ${bundle.rank1}・DB ${race.rank1}）`);
  if (race.technique !== bundle.technique)
    why.push(
      `決まり手が DB と違う（bundle ${bundle.technique}・DB ${race.technique}）`,
    );
  for (const k of ["venue", "venue_code", "race_number", "grade", "race_date"])
    if (race[k] !== bundle[k])
      why.push(`${k} が DB と違う（bundle ${bundle[k]}・DB ${race[k]}）`);
  if (race.boats.length !== 6)
    why.push(`DB の出走表が6艇でない（${race.boats.length}）`);
  race.boats.forEach((b, i) => {
    for (const f of BOAT_FIELDS)
      if (b[f] !== bundle.boats[i]?.[f])
        why.push(
          `${i + 1}号艇の ${f} が DB と違う（bundle ${bundle.boats[i]?.[f]}・DB ${b[f]}）`,
        );
  });
  return why;
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

/** 下書きの行（純粋関数）。題・説明欄は bundle の値のまま（ハッシュタグは説明欄に入っているので hashtags は空） */
export function draftRow(
  bundle,
  { revision, videoPath, when, observedAt, publicUrl },
) {
  const upsetId = upsetIdOf(bundle.date, bundle.race_id);
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: UPSET_FORMAT,
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
      race_id: upsetId,
      upset_win_short: {
        upset_id: upsetId,
        date: bundle.date,
        race_id: bundle.race_id,
        rank1: bundle.rank1,
        venue: bundle.venue,
        primary: bundle.primary,
        weaknesses: bundle.weaknesses,
        odds: bundle.boats[bundle.rank1 - 1].odds,
        year: {
          n: bundle.year.n,
          k: bundle.year.k,
          from: bundle.year.from,
          to: bundle.year.to,
        },
        as_of: bundle.as_of,
        revision,
      },
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        public_url: publicUrl,
        screen_key: UPSET_SCREEN_KEY,
        youtube_mode: "immediate",
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

function itemRow({ upsetId, draftId, when, checkedAt }) {
  return {
    kind: UPSET_WIN_SHORT_KIND,
    variant: "main",
    draft_id: draftId,
    channel: "youtube",
    race_id: upsetId,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state: "notified",
    checks: { passed: true, checked_at: checkedAt },
    notified_at: checkedAt,
    // 自動（notified）は止めるリンクを作らない（節の機力と同じ。153 の CHECK が要るので使わない乱数のハッシュ）
    stop_token_hash: randomBytes(32).toString("hex"),
  };
}

export const upsetStatusOf = (item, job) => ({
  upset_id: item?.race_id ?? null,
  item_state: item?.state ?? null,
  held_reason: item?.held_reason ?? null,
  job_id: job?.id ?? null,
  job_state: job?.state ?? null,
  error_code: job?.error_code ?? null,
  posted_at: job?.posted_at ?? null,
  video_id: job?.external_post_id ?? null,
  video_url: job?.external_post_url ?? null,
});

const retryable = (item, job, now) =>
  item.state === "notified" &&
  (job
    ? RETRYABLE_JOB_STATES.includes(job.state)
    : Date.parse(item.created_at) < now.getTime() - ORPHAN_ITEM_MIN * 60000);

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ upset_id, draft_id, item_id, job_id, send_at, ... }
 */
export async function pushUpsetWinShort(
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
  const upsetId =
    /^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "") && bundle?.race_id
      ? upsetIdOf(bundle.date, bundle.race_id)
      : null;
  const controls = await store.controls();
  // 列が無い（198 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.youtube?.upset_win_short_enabled === true;
  const writes = enabled && !dryRun;
  const extra = simulated ? { simulated_now: simulated.toISOString() } : {};
  const reject = async (reasons) => {
    if (writes)
      await notify(
        `SNS 人気薄の1着（Shorts） ${upsetId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { upset_id: upsetId, reasons, ...extra };
  };
  const reasons = checkUpsetBundle(bundle, riskRules);
  if (reasons.length) return reject(reasons);
  if (!parseUpsetId(upsetId)) return reject(["upset_id が作れない"]);
  // 画面の数字と DB の照合（そのレースの6艇の値・1着・単勝を読み直す）
  const dbReasons = raceReasons(bundle, await store.raceOf(bundle.race_id));
  if (dbReasons.length) return reject(dbReasons);
  let bytes = null;
  try {
    bytes = await readBytes(path.join(folder, VIDEO_NAME));
  } catch (error) {
    if (error?.code !== "ENOENT")
      return reject([
        `${VIDEO_NAME} を読めない（${error?.code ?? "code なし"}: ${error?.message ?? error}）`,
      ]);
  }
  const videoReasons = checkVideo(VIDEO_NAME, bytes);
  if (videoReasons.length) return reject(videoReasons);
  const sendControl = await store.sendControl();
  if (!(sendControl?.expiry_minutes > 0))
    return reject(["期限の分（sns_x_send_control.expiry_minutes）が読めない"]);
  const when = schedule(bundle, now, sendControl.expiry_minutes);
  const observedAt = bundle.source_observed_at;
  const timing = checkTiming(bundle, when, now, {
    observedAt,
    maxAgeSec: sendControl?.max_source_age_seconds,
  });
  if (jstTime(when.send_at) > "07:59")
    timing.push(`送る時刻（${jstTime(when.send_at)}）が 7時台でない`);
  if (timing.length) return reject(timing);
  // 同じ日に生きている・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、198）
  const retry = [];
  for (const item of (await store.upsetItems(bundle.date)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  )) {
    const job = await store.jobForDraft(item.draft_id);
    if (retryable(item, job, realNow)) retry.push(item);
    else
      return {
        upset_id: upsetId,
        already: true,
        reason: `同じ日の upset_win_short が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
        status: upsetStatusOf(item, job),
        ...extra,
      };
  }
  const roomSendAt = simulated
    ? new Date(realNow.getTime() + SEND_DELAY_SEC * 1000).toISOString()
    : when.send_at;
  const ptDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date(roomSendAt));
  const [jobs, queued, quota, quotaUsed] = await Promise.all([
    store.jobsAttemptedOn(jstDate(realNow)),
    store.queuedYoutubeJobs(realNow),
    store.quotaControl(),
    store.quotaUsed(ptDay),
  ]);
  const replacing = new Set(retry.map((i) => i.draft_id));
  const roomReason = youtubeRoomReason({
    sendControl,
    jobs,
    queued: queued.filter((j) => !replacing.has(j.draft_id)),
    quota,
    quotaUsed,
    now: realNow,
    sendAt: roomSendAt,
  });
  if (roomReason) return reject([roomReason]);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  hash.update(bytes);
  const revision = hash.digest("hex").slice(0, 32);
  const publicUrl = descriptionLink(
    bundle.youtube.description,
    bundle.race_id,
  ).url;
  const control = controls.youtube;
  const auto = Boolean(control?.mode === "auto" && control?.auto_approver_id);
  if (writes && !auto)
    return {
      upset_id: upsetId,
      manual: true,
      reason:
        "youtube の mode が auto でない（この型は自動の道だけで送る）ので何も書かなかった",
      ...extra,
    };
  if (!writes)
    return {
      upset_id: upsetId,
      dryRun: true,
      enabled,
      disabled: !dryRun,
      auto,
      revision,
      when,
      public_url: publicUrl,
      video: { name: VIDEO_NAME, bytes: bytes.byteLength, ...mp4Info(bytes) },
      ...extra,
    };

  for (const item of retry) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
  const videoPath = `upset-win-short/${bundle.date}/${revision}.mp4`;
  await store.saveFile(videoPath, bytes);
  const checkedAt = now.toISOString();
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, videoPath, when, observedAt, publicUrl }),
  );
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
      itemRow({ upsetId, draftId: draft.id, when, checkedAt }),
    );
  } catch (error) {
    await blockDraft("item を作れない");
    throw error;
  }
  const out = {
    upset_id: upsetId,
    draft_id: draft.id,
    item_id: item.id,
    auto,
    trial: control?.dry_run !== false,
  };
  try {
    const snapshot = await createXSnapshot(draft, async (p) =>
      p === videoPath ? bytes : Promise.reject(new Error("媒体の path が違う")),
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
    await store
      .updateItem(item.id, "notified", {
        state: "held_manual",
        held_reason: `自動の承認に失敗: ${error.message.split("\n")[0]}`,
      })
      .catch((updateError) => {
        console.error(
          `item ${item.id} を held_manual に戻せない: ${updateError.message}`,
        );
        out.error += `（item を戻せない: ${updateError.message}）`;
      });
  }
  const line = out.send_at
    ? `youtube（Shorts）: ${jstTime(when.send_at)} に送る（期限 ${jstTime(when.expires_at)}）${control?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : `youtube（Shorts）: 自動の承認に失敗（送らない。下書きは公開保留）: ${out.error}`;
  await notify(
    `SNS 人気薄の1着（Shorts） ${upsetId}「${bundle.youtube.title}」\n${line}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

/** その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null */
export async function upsetStatus(date, { store }) {
  const items = await store.upsetItems(date);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return upsetStatusOf(item, await store.jobForDraft(item.draft_id));
}

/** 結果の1行と exit の番号（純粋関数） */
export function resultLine(result, status = null) {
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
            : result.job_id && !status
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
    upset_id: result.upset_id ?? null,
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
        ? "自動送信の許可（upset_win_short_enabled）が off なので送らなかった"
        : outcome === "not_posted" && !result.job_id
          ? result.error
            ? `自動の承認に失敗したので job を作らなかった: ${result.error}`
            : "自動モードでないので job を作らなかった"
          : null),
  };
  return { code, text: `UPSET_RESULT ${JSON.stringify(line)}` };
}

/**
 * PostgREST・Storage の読み書き（service_role）。共通の読み書きは節の機力の Shorts の store（その中は全貌の store）を使い、
 * この型の item・許可の列・レースの読み直しだけを足す。失敗は投げる
 */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const base = createSetsuStore({ url, key, fetchImpl });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function call(p) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, { headers });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB 操作に失敗: HTTP ${response.status} GET ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  return {
    ...base,
    // upset_win_short_enabled が無い（198 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする
    async controls() {
      let rows;
      try {
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,upset_win_short_enabled",
        );
      } catch (error) {
        if (
          !/HTTP 400/.test(error.message) ||
          !error.message.includes("upset_win_short_enabled")
        )
          throw error;
        console.error(
          "upset_win_short_enabled の列が無い（マイグレーション 198 が未適用）。許可は off として扱う",
        );
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
        );
      }
      return Object.fromEntries(rows.map((r) => [r.channel, r]));
    },
    upsetItems: (date) =>
      call(
        `sns_auto_send_items?kind=eq.${UPSET_WIN_SHORT_KIND}&channel=eq.youtube&race_id=like.${encodeURIComponent(`upset:${date}:*`)}&select=id,state,draft_id,race_id,held_reason,created_at&order=created_at.desc`,
      ),
    async raceOf(raceId) {
      const rows = await fetchRaceRows(raceId, {
        get: (table, query) => call(`${table}?${query}`),
      });
      return rows.races[0]
        ? shapeRace({
            race: rows.races[0],
            result: rows.results[0] ?? null,
            entries: rows.entries,
            exhibition: rows.exhibition,
            odds: rows.odds[0] ?? null,
          })
        : null;
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-upset-win-short.js <フォルダ> [--dry-run] [--no-wait] | --status <YYYY-MM-DD>";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? "")) {
      console.error(usage);
      process.exit(2);
    }
    console.log(JSON.stringify(await upsetStatus(args[1], { store }), null, 2));
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
  const fail = (error) => {
    console.error(error);
    console.log(
      `UPSET_RESULT ${JSON.stringify({ upset_id: null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const riskRules = await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  )
    .then((text) => JSON.parse(text).rules)
    .catch(fail);
  const result = await pushUpsetWinShort(folder, {
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
