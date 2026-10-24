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
 *
 * 1. 検査: 欄・P0 が0件・機械の検査が全部通った・禁止表現・動画の大きさ・レースが今日あり中止でない・締切の45分前より前
 *    --dry-run はここまで（DB・Storage に書かない）
 * 2. 動画を Storage（sns-hub-media/full-picture/{race_id}/{版}/）に上げる
 * 3. X・YouTube の下書き（send_lane=A、format=full_picture）と item（kind=full_picture）を作る
 * 4. チャネルが mode=auto なら item を notified にして自動送信の承認者で承認する（送る時刻は締切の60分前と今から5分後の遅い方）。
 *    mode=manual なら item を manual にして、個別承認の画面に回す
 * 5. Slack（SLACK_WEBHOOK_URL、無ければ SLACK_DIGEST_WEBHOOK_URL）に、送る時刻と止める SQL を知らせる
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import twitterText from "twitter-text";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";
import {
  FULL_URL_PLACEHOLDER,
  fillFullUrl,
} from "../../api/_lib/snsDeadlineQueue.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";

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
/** 下書きを作るチャネル（shorts は DB では channel=youtube・variant=shorts） */
const channelsOf = (bundle) =>
  withShorts(bundle) ? ["x", "youtube", "shorts"] : ["x", "youtube"];
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
  if (!nonEmpty(bundle?.x_text, 25000)) reasons.push("x_text が無い・長すぎる");
  else {
    if (!xPostValid(bundle.x_text, { long: true }))
      reasons.push("x_text が X の長文の上限を超える");
    const urls = twitterText.extractUrls(bundle.x_text);
    if (urls.length !== 1 || urls[0].match(RACE_URL)?.[1] !== bundle.race_id)
      reasons.push("x_text にこのレースの URL がちょうど1つ無い");
  }
  // 完全版の URL の置き場所は Shorts の説明文だけ（ほかに入っていると、送る前の検査で初めて止まる）
  for (const [field, text] of [
    ["x_text", bundle?.x_text],
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

const draftTexts = (bundle) => ({
  x: { platform: "x", caption_text: bundle?.x_text ?? "", hashtags: [] },
  youtube: {
    platform: "youtube",
    title: bundle?.youtube_full?.title ?? "",
    caption_text: bundle?.youtube_full?.description ?? "",
    hashtags: [],
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
/** チャネルごとの送る時刻（YouTube の完全版は X の4分後、Shorts は完全版のさらに4分後。Shorts は完全版の公開まで待つ） */
export const sendAtOf = (when, channel) =>
  new Date(
    Date.parse(when.send_at) + OFFSET_MIN[channel] * 60000,
  ).toISOString();

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
    ...(bundle.full_picture_variant ? { full_picture_variant: { id: bundle.full_picture_variant.id } } : {}),
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
    x: {
      ...common,
      scheduled_at: sendAtOf(when, "x"),
      platform: "x",
      title: bundle.youtube_full.title,
      caption_text: bundle.x_text,
      video_storage_path: paths.x,
      source_data: sourceData("x"),
    },
    youtube: {
      ...common,
      scheduled_at: sendAtOf(when, "youtube"),
      platform: "youtube",
      title: bundle.youtube_full.title,
      caption_text: bundle.youtube_full.description,
      video_storage_path: paths.youtube,
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
 * 返り値: { reasons } （不合格）か { channels: { x: {...}, youtube: {...} } }
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
  if (reasons.length) return reject(reasons);
  const race = await store.race(bundle.race_id);
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return reject(["レースが見つからない"]);
  if (race.cancellation_status != null) return reject(["レースが中止"]);
  const when = schedule(deadlineAt, now);
  if (now.getTime() >= Date.parse(when.latest))
    return reject([`締切の${LATEST_BEFORE_MIN}分前を過ぎた`]);
  // Shorts は、期限までに完全版の公開を待てる時刻に届いたときだけ作る
  const shortsLate =
    withShorts(bundle) &&
    now.getTime() >=
      Date.parse(minutesBefore(deadlineAt, SHORTS_LATEST_BEFORE_MIN));
  const channels = channelsOf(bundle).filter(
    (c) => c !== "shorts" || !shortsLate,
  );
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  // 版には受け取った動画を全部入れる（shorts.mp4 だけを直して入れ直しても、前の版の承認と同じ path を上書きしない）
  for (const channel of channelsOf(bundle)) hash.update(files[channel]);
  const revision = hash.digest("hex").slice(0, 32);
  if (dryRun) return { dryRun: true, revision, when, shortsLate };

  const paths = Object.fromEntries(
    channels.map((c) => [
      c,
      `full-picture/${bundle.race_id}/${revision}/${FILES[c]}`,
    ]),
  );
  for (const channel of channels)
    await store.saveFile(paths[channel], files[channel]);
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
      const snapshot = await createXSnapshot(draft, async (p) =>
        p === paths[channel]
          ? files[channel]
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
  if (shortsError)
    lines.push(
      `youtube（Shorts）: 下書き・item を作れなかったので作らなかった（X・完全版は送る）: ${shortsError}`,
    );
  if (shortsLate)
    lines.push(
      `youtube（Shorts）: 締切の${SHORTS_LATEST_BEFORE_MIN}分前を過ぎて届いたので作らなかった（完全版の公開を待つ時間が無い）`,
    );
  await notify(
    `SNS 全貌動画 ${bundle.race_id}（締切 ${jstTime(deadlineAt)}）\n${lines.join("\n")}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { channels: out, revision, when, shortsLate, shortsError };
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
    async saveFile(p, bytes) {
      const response = await fetchImpl(
        `${url}/storage/v1/object/sns-hub-media/${p}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "video/mp4",
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(`動画を保存できない: HTTP ${response.status} ${p}`);
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
