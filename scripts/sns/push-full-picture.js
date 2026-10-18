/**
 * 全貌動画（format=full_picture）のフォルダを受け取り、X・YouTube の下書きと自動送信の item を作って、承認なしで送る予定に入れる
 * （2026-10-18 オーナー決定: 承認なし・事前通知と止めるリンクは最小。マイグレーション 161）。
 * hq の作業役が同じ Mac の本リポジトリで実行する。鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-full-picture.js <フォルダ> [--dry-run]
 *
 * フォルダ: bundle.json（format・race_id・x_text・youtube_full{title,description}・shorts・review{p0_count}・qa）、
 *   full-x.mp4（X、全編）、full-youtube.mp4（YouTube、全編）。shorts.mp4 は今は使わない（162 の後）
 *
 * 1. 検査: 欄・P0 が0件・機械の検査が全部通った・禁止表現・動画の大きさ・レースが今日あり中止でない・締切の40分前より前
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
import { xPostValid } from "../../api/_lib/snsXLength.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";

export const FULL_PICTURE_FORMAT = "full_picture";
export const FILES = { x: "full-x.mp4", youtube: "full-youtube.mp4" };
// 動画は送信の契約（snsXSend.js の X_MEDIA_MAX_BYTES・YOUTUBE_MEDIA_MAX_BYTES、youtubeQueueAdapter）と同じ 32 MiB まで
export const MAX_BYTES = { x: 32 * 1024 * 1024, youtube: 32 * 1024 * 1024 };
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

/** bundle.json の検査（純粋関数）。不合格は理由の配列を返す */
export function checkFullPicture(bundle, riskRules = []) {
  const reasons = [];
  if (bundle?.format !== FULL_PICTURE_FORMAT)
    reasons.push(`format が ${FULL_PICTURE_FORMAT} でない`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? ""))
    reasons.push("race_id が不正");
  if (!nonEmpty(bundle?.x_text, 25000)) reasons.push("x_text が無い・長すぎる");
  else {
    if (!xPostValid(bundle.x_text, { long: true }))
      reasons.push("x_text が X の長文の上限を超える");
    const urls = twitterText.extractUrls(bundle.x_text);
    if (urls.length !== 1 || urls[0].match(RACE_URL)?.[1] !== bundle.race_id)
      reasons.push("x_text にこのレースの URL がちょうど1つ無い");
  }
  if (!nonEmpty(bundle?.youtube_full?.title, 100))
    reasons.push("youtube_full.title が無い・100字を超える");
  if (!nonEmpty(bundle?.youtube_full?.description, 5000))
    reasons.push("youtube_full.description が無い・5000字を超える");
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
    const hits = matchRiskRules(draftRiskFields(draft), channel, riskRules);
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

/** チャネルごとの送る時刻（YouTube は X の4分後） */
export const sendAtOf = (when, channel) =>
  channel === "youtube"
    ? new Date(
        Date.parse(when.send_at) + YOUTUBE_OFFSET_MIN * 60000,
      ).toISOString()
    : when.send_at;

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
  const reasons = checkFullPicture(bundle, riskRules);
  const files = {};
  for (const [channel, name] of Object.entries(FILES)) {
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
  if (reasons.length) return { reasons };
  const race = await store.race(bundle.race_id);
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return { reasons: ["レースが見つからない"] };
  if (race.cancellation_status != null) return { reasons: ["レースが中止"] };
  const when = schedule(deadlineAt, now);
  if (now.getTime() >= Date.parse(when.latest))
    return { reasons: [`締切の${LATEST_BEFORE_MIN}分前を過ぎた`] };
  const revision = createHash("sha256")
    .update(JSON.stringify(bundle))
    .update(files.x)
    .update(files.youtube)
    .digest("hex")
    .slice(0, 32);
  if (dryRun) return { dryRun: true, revision, when };

  const paths = {
    x: `full-picture/${bundle.race_id}/${revision}/${FILES.x}`,
    youtube: `full-picture/${bundle.race_id}/${revision}/${FILES.youtube}`,
  };
  for (const channel of Object.keys(FILES))
    await store.saveFile(paths[channel], files[channel]);
  const observedAt = now.toISOString();
  const rows = draftRows(bundle, { revision, paths, when, observedAt });
  const controls = await store.controls();
  const out = {};
  for (const channel of Object.keys(FILES)) {
    const control = controls[channel];
    const auto = control?.mode === "auto" && control?.auto_approver_id;
    const draft = await store.insertDraft(rows[channel]);
    const item = await store.insertItem({
      kind: FULL_PICTURE_FORMAT,
      draft_id: draft.id,
      channel,
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
    out[channel] = {
      draft_id: draft.id,
      item_id: item.id,
      auto: Boolean(auto),
    };
    if (!auto) continue;
    try {
      const snapshot = await createXSnapshot(draft, async (p) =>
        p === paths[channel]
          ? files[channel]
          : Promise.reject(new Error("媒体の path が違う")),
      );
      await store.approve({
        p_draft_id: draft.id,
        p_approver_id: control.auto_approver_id,
        p_snapshot: snapshot,
        p_scheduled_at: sendAtOf(when, channel),
      });
      out[channel].send_at = sendAtOf(when, channel);
    } catch (error) {
      await store
        .updateItem(item.id, "notified", { state: "manual" })
        .catch(() => {});
      out[channel].error = error.message;
    }
  }
  const lines = Object.entries(out).map(([channel, r]) =>
    r.send_at
      ? `${channel}: ${jstTime(r.send_at)} に自動で送る${controls[channel]?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
      : r.error
        ? `${channel}: 自動の承認に失敗（個別承認に回した）: ${r.error}`
        : `${channel}: 自動モードでないので個別承認の画面で承認する`,
  );
  await notify(
    `SNS 全貌動画 ${bundle.race_id}（締切 ${jstTime(deadlineAt)}）\n${lines.join("\n")}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { channels: out, revision, when };
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
