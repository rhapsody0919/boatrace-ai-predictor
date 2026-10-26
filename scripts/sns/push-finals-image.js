/**
 * 優勝戦の「展示を見た直前の思考の順」の画像投稿（format=finals_image、X だけ）のフォルダを受け取り、X の下書きと自動送信の item を作って
 * 今すぐ送る予定に入れる（hq FT02、マイグレーション 176）。hq の作業役が同じ Mac の本リポジトリで実行する。
 * 鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）だけを使う。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait]
 *   node --env-file=.env.local scripts/sns/push-finals-image.js --status <race_id>   送った時刻・tweet id を出す
 *
 * フォルダ（hq の finals_run.py の出力）: bundle.json と PNG 4枚（1080×1350）。ほかのファイル（HTML 等）は読まない
 *   bundle.json: {format:"finals_image", race_id, x_text, deadline:"HH:MM"（JST）, images:[4つの名前], review:{p0_count, by}}
 *   images は <race_id>-1-map.png・-2-q12.png・-3-q3.png・-4-routes.png のこの順（この順で1投稿に付く）
 *
 * 自動送信の許可（sns_auto_send_control の x の行の finals_image_enabled）は既定 off。
 * off の間は --dry-run と同じ（検査だけして DB・Storage に書かない、exit 3）。送り手（cron sns-send）も off の job を送らない
 *
 * 時刻: 全貌の 60分の遅らせ・45分の締め・30分の期限は当てない。送る時刻＝今すぐ、期限＝締切の5分前。
 * 締切の8分前を過ぎて届いたら受け取らない（exit 1 と理由）。
 * 送るのは送り手（cron sns-send、2分ごと）。push は job を入れた後、送り終わる（posted・held 等）か期限を過ぎるまで待つ（--no-wait で待たない）
 *
 * stdout の最後の1行は `FINALS_RESULT {...}`（race_id・outcome・job_id・job_state・tweet_id・tweet_url・posted_at・error_code・reason）
 * exit: 0 送った（--dry-run は検査が通った・--no-wait は予定に入れた）・1 検査で拒否・2 使い方・鍵の不足
 *   ・3 許可が off なので書かなかった・4 同じレースの finals_image が既にある（何もしない）・5 予定に入れたが送れなかった（保留・期限切れ・個別承認）
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

export const FINALS_IMAGE_FORMAT = "finals_image";
/** item の版（172 の variant）。同じ優勝戦の全貌（full_picture・x・main）と両立させ、1レース1件に限る（176 の一意の索引） */
export const FINALS_VARIANT = "finals";
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
/** 受け取る最後は締切の8分前（送り手の周期2分で、期限までに1回以上の実行を残す） */
export const LATEST_BEFORE_MIN = 8;
/** hq と決めた禁止表現（risk-rules.json に加えて見る。NFKC でそろえて含むかを見る） */
export const BANNED_WORDS = ["必ず当たる", "稼げる", "万舟券", "儲か", "競艇"];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const RACE_URL =
  /^https:\/\/www\.boat-ai\.jp\/race\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})(?:[?#]|$)/;
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET finals_image_enabled = false WHERE channel = 'x';";

const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
const jstTime = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** bundle.json の検査（純粋関数）。不合格は理由の配列を返す */
export function checkFinalsImage(bundle, riskRules = []) {
  const reasons = [];
  if (bundle?.format !== FINALS_IMAGE_FORMAT)
    reasons.push(`format が ${FINALS_IMAGE_FORMAT} でない`);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(bundle?.race_id ?? ""))
    reasons.push("race_id が不正");
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(bundle?.deadline ?? ""))
    reasons.push("deadline が HH:MM でない");
  const expected = imageNamesOf(bundle?.race_id);
  if (
    !Array.isArray(bundle?.images) ||
    bundle.images.length !== expected.length ||
    bundle.images.some((name, i) => name !== expected[i])
  )
    reasons.push(`images が ${expected.join(",")} の4つ・この順でない`);
  if (bundle?.review?.p0_count !== 0)
    reasons.push(`機械の検査の P0 が0件でない（${bundle?.review?.p0_count}）`);
  const text = bundle?.x_text;
  if (typeof text !== "string" || !text.trim()) {
    reasons.push("x_text が無い");
    return reasons;
  }
  // 返信・スレッドにしない1投稿なので、送り手の検査（createDeadlinePreflight）と同じく加重の280まで
  if (!xPostValid(text)) reasons.push("x_text が X の加重280を超える");
  if (/[{}]|\$\{/.test(text))
    reasons.push("x_text に置き場所（{ } ・${）が残っている");
  // リンクは無いか、このレースのページ1つだけ
  const urls = twitterText.extractUrls(text);
  if (
    urls.length > 1 ||
    (urls.length === 1 && urls[0].match(RACE_URL)?.[1] !== bundle.race_id)
  )
    reasons.push("x_text のリンクがこのレースのページ1つでない");
  const normalized = text.normalize("NFKC");
  const banned = BANNED_WORDS.filter((w) => normalized.includes(w));
  if (banned.length) reasons.push(`禁止表現: ${banned.join(",")}`);
  const hits = matchRiskRules(
    draftRiskFields({ platform: "x", caption_text: text, hashtags: [] }),
    "x",
    riskRules,
  );
  if (hits.length)
    reasons.push(`禁止表現（risk-rules）: ${hits.map((h) => h.id).join(",")}`);
  return reasons;
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
 * 締切まわりの時刻（純粋関数）。送る時刻・止められる期限（veto_until）は今。
 * item の CHECK（notify_by < veto_until < deadline_at、153）のため、notify_by は今の1分前
 */
export function schedule(deadlineAt, now) {
  return {
    deadline_at: deadlineAt,
    expires_at: minutesBefore(deadlineAt, EXPIRES_BEFORE_MIN),
    latest: minutesBefore(deadlineAt, LATEST_BEFORE_MIN),
    notify_by: new Date(now.getTime() - 60000).toISOString(),
    veto_until: now.toISOString(),
    send_at: now.toISOString(),
  };
}

/** レース・段・既存の item の検査（純粋関数）。DB から読んだ行を受ける */
export function checkRace({ bundle, race, stage, now }) {
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return { reasons: ["レースが見つからない"] };
  const reasons = [];
  if (race.cancellation_status != null) reasons.push("レースが中止");
  if (race.race_date !== jstDate(now)) reasons.push("今日のレースでない");
  if (stage !== FINALS_STAGE)
    reasons.push(`優勝戦でない（race_stage=${stage ?? "なし"}）`);
  // deadline は race_id の日付の JST の HH:MM（races.start_time の時・分と一致すること）
  if (race.start_time?.slice(0, 5) !== bundle.deadline)
    reasons.push(
      `deadline が races の締切（${race.start_time?.slice(0, 5)}）と違う`,
    );
  if (race.race_date !== bundle.race_id.slice(0, 10))
    reasons.push("race_id の日付が races と違う");
  if (now.getTime() >= Date.parse(minutesBefore(deadlineAt, LATEST_BEFORE_MIN)))
    reasons.push(`締切の${LATEST_BEFORE_MIN}分前を過ぎた`);
  return { reasons, deadlineAt };
}

/**
 * X の日の上限（sns_x_send_control.daily_limit_x、無ければ daily_limit）にこの1本が入るか（純粋関数）。
 * 数え方は transition_sns_send_139 の claim と同じ（今日の JST の X の試行＋他経路の本数＋1）。入らなければ理由を返す。
 * 入らないまま job を作ると、claim が「日次全体上限です」で投げ続け、期限まで2分ごとに Slack が鳴る（2026-10-26 system-architect の P1）
 */
export function dailyLimitReason({ sendControl, jobs, now }) {
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
  return used + external + 1 > limit
    ? `X の日の上限 ${limit} に入らない（今日の試行 ${used}・他経路 ${external}）`
    : null;
}

/** 下書きの行（純粋関数）。public_url は送る直前の表示の確認に使う */
export function draftRow(bundle, { revision, paths, when, observedAt }) {
  const raceUrl = `https://www.boat-ai.jp/race/${bundle.race_id}?tab=sonar`;
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: FINALS_IMAGE_FORMAT,
    platform: "x",
    title: `優勝戦 思考の順 ${bundle.race_id}`,
    caption_text: bundle.x_text,
    hashtags: [],
    publish_blocked: false,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    cover_image_path: paths[0],
    source_data: {
      finals_image: {
        race_id: bundle.race_id,
        revision,
        review: bundle.review,
      },
      // 承認の関数（160）が媒体をこの順で照合する（先頭は cover_image_path）
      image_paths: paths,
      // thread_length は入れない（送り手の検査が加重280で見る）
      deadline_queue: {
        deadline_at: when.deadline_at,
        expires_at: when.expires_at,
        source_revision: revision,
        source_observed_at: observedAt,
        public_url: raceUrl,
        screen_key: "race-sonar",
      },
      release_evidence: {
        status: "released",
        url: raceUrl,
        screen_key: "race-sonar",
        confirmed_by: "push-finals-image",
        reference: FINALS_IMAGE_FORMAT,
        checked_at: observedAt,
        confirmed_at: observedAt,
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ draft_id, item_id, job_id, send_at, ... }
 */
export async function pushFinalsImage(
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
  const controls = await store.controls();
  // 列が無い（176 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.x?.finals_image_enabled === true;
  const writes = enabled && !dryRun;
  const reject = async (reasons) => {
    if (writes)
      await notify(
        `SNS 優勝戦の画像 ${bundle?.race_id ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { reasons };
  };
  const reasons = checkFinalsImage(bundle, riskRules);
  if (reasons.length) return reject(reasons);
  // 起こす係（hq finals_run.py）は締切の25〜8分前に2分ごとに呼ぶ。同じレースの生きている item・送った item があれば
  // 何も作らず、今の状態を返す（DB の一意の索引でも止まる、176）。
  // ただし自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無いときは、
  // その item を superseded で止めてから作り直す（期限までにやり直せるように。送った・送っている item は作り直さない）
  const live = (await store.finalsItems(bundle.race_id)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (item.state === "notified" && (!job || RETRYABLE_JOB_STATES.includes(job.state)))
      retry.push({ item, job });
    else
      return {
        already: true,
        reason: `同じレースの finals_image が既にある（item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
        status: statusOf(bundle.race_id, item, job),
      };
  }
  const names = bundle.images;
  const files = {};
  const readErrors = [];
  for (const name of names) {
    try {
      files[name] = await readBytes(path.join(folder, name));
    } catch (error) {
      files[name] = undefined;
      // 無い（ENOENT）は checkImages が「無い」と書く。それ以外（権限・I/O）は原因を残す
      if (error?.code && error.code !== "ENOENT")
        readErrors.push(`${name} を読めない（${error.code}: ${error.message}）`);
    }
  }
  const imageReasons = [...readErrors, ...checkImages(names, files)];
  if (imageReasons.length) return reject(imageReasons);
  const [race, stage, sendControl, todayJobs] = await Promise.all([
    store.race(bundle.race_id),
    store.stage(bundle.race_id),
    store.sendControl(),
    store.jobsAttemptedOn(jstDate(now)),
  ]);
  const raceCheck = checkRace({ bundle, race, stage, now });
  const limitReason = dailyLimitReason({ sendControl, jobs: todayJobs, now });
  if (limitReason) raceCheck.reasons.push(limitReason);
  if (raceCheck.reasons.length) return reject(raceCheck.reasons);
  const when = schedule(raceCheck.deadlineAt, now);
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  for (const name of names) hash.update(files[name]);
  const revision = hash.digest("hex").slice(0, 32);
  if (!writes)
    return {
      dryRun: true,
      enabled,
      // --dry-run でなく、許可が off なので書かなかった（exit 3）
      disabled: !dryRun,
      revision,
      when,
    };

  for (const { item } of retry)
    await store.updateItem(item.id, "notified", {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
  const paths = names.map(
    (name) => `finals-image/${bundle.race_id}/${revision}/${name}`,
  );
  for (const [i, name] of names.entries())
    await store.saveFile(paths[i], files[name]);
  const observedAt = now.toISOString();
  const auto = controls.x?.mode === "auto" && controls.x?.auto_approver_id;
  let draft = await store.insertDraft(
    draftRow(bundle, { revision, paths, when, observedAt }),
  );
  const item = await store.insertItem({
    kind: FINALS_IMAGE_FORMAT,
    variant: FINALS_VARIANT,
    draft_id: draft.id,
    channel: "x",
    race_id: bundle.race_id,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state: auto ? "notified" : "manual",
    checks: {
      passed: true,
      review: bundle.review,
      checked_at: observedAt,
    },
    // 止めるリンクは作らない（全貌と同じ）。153 の CHECK が notified に要求するので、使わない乱数のハッシュを入れる
    ...(auto
      ? {
          notified_at: observedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  });
  const out = { draft_id: draft.id, item_id: item.id, auto: Boolean(auto) };
  if (auto) {
    try {
      const byPath = new Map(paths.map((p, i) => [p, files[names[i]]]));
      const snapshot = await createXSnapshot(draft, async (p) =>
        byPath.has(p)
          ? byPath.get(p)
          : Promise.reject(new Error("媒体の path が違う")),
      );
      const job = await store.approve({
        p_draft_id: draft.id,
        p_approver_id: controls.x.auto_approver_id,
        p_snapshot: snapshot,
        p_scheduled_at: when.send_at,
      });
      out.job_id = job?.id ?? null;
      out.send_at = when.send_at;
    } catch (error) {
      out.error = error.message;
      try {
        await store.updateItem(item.id, "notified", { state: "manual" });
      } catch (updateError) {
        // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
        console.error(`item ${item.id} を manual に戻せない: ${updateError.message}`);
        out.error += `（item を manual に戻せない: ${updateError.message}）`;
      }
    }
  }
  const line = out.send_at
    ? `x: 今すぐ送る（送り手の次の実行、期限 ${jstTime(when.expires_at)}）${controls.x?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : out.error
      ? `x: 自動の承認に失敗（個別承認に回した）: ${out.error}`
      : "x: 自動モードでないので個別承認で承認する";
  await notify(
    `SNS 優勝戦の画像 ${bundle.race_id}（締切 ${jstTime(when.deadline_at)}）\n${line}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
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

/** 送った時刻・tweet id（hq の記録用）。新しい順に、生きている item（無ければ最新の item）の job。item が無ければ null */
export async function finalsStatus(raceId, { store }) {
  const items = await store.finalsItems(raceId);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ?? items[0];
  if (!item) return null;
  return statusOf(raceId, item, await store.jobForDraft(item.draft_id));
}

/** 送り手の結果を待つ間隔と、期限の後に待つ時間（送り手の最後の実行の終わりを待つ） */
export const WAIT_POLL_SEC = 15;
export const WAIT_AFTER_EXPIRES_SEC = 90;
// reconcile は begin_post から complete までの送っている途中でもあるので、終わりに数えない（期限＋90秒まで待つ）
const DONE_STATES = ["posted", ...RETRYABLE_JOB_STATES];

/** この push の job（draft で引く）が送り終わる（posted・held 等）か、期限＋WAIT_AFTER_EXPIRES_SEC を過ぎるまで待つ */
export async function waitForSend(
  raceId,
  { store, draftId, expiresAt, now = () => new Date(), sleep },
) {
  const until = Date.parse(expiresAt) + WAIT_AFTER_EXPIRES_SEC * 1000;
  for (;;) {
    const status = statusOf(raceId, null, await store.jobForDraft(draftId));
    if (DONE_STATES.includes(status.job_state) || now().getTime() >= until)
      return status;
    await sleep(WAIT_POLL_SEC);
  }
}

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(raceId, result, status = null, { waited = Boolean(status) } = {}) {
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
    error: 6,
  }[outcome];
  const s = status ?? result.status ?? null;
  const line = {
    race_id: raceId ?? null,
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
        ? "自動送信の許可（finals_image_enabled）が off なので送らなかった"
        : null),
  };
  return { code, text: `FINALS_RESULT ${JSON.stringify(line)}` };
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
  const id = (raceId) => encodeURIComponent(raceId);
  return {
    race: async (raceId) =>
      (
        await call(
          `races?race_id=eq.${id(raceId)}&select=race_id,race_date,start_time,cancellation_status`,
        )
      )[0] ?? null,
    stage: async (raceId) =>
      (
        await call(`race_conditions?race_id=eq.${id(raceId)}&select=race_stage`)
      )[0]?.race_stage ?? null,
    finalsItems: (raceId) =>
      call(
        `sns_auto_send_items?kind=eq.${FINALS_IMAGE_FORMAT}&race_id=eq.${id(raceId)}&select=id,state,draft_id&order=created_at.desc`,
      ),
    // finals_image_enabled が無い（176 が未適用）と PostgREST が 400 を返すので、その時は列なしで読み直して off とする
    async controls() {
      let rows;
      try {
        rows = await call(
          "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id,finals_image_enabled",
        );
      } catch (error) {
        if (!/HTTP 400/.test(error.message)) throw error;
        console.error(
          "finals_image_enabled の列が無い（マイグレーション 176 が未適用）。許可は off として扱う",
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
          "sns_x_send_control?id=eq.true&select=daily_limit,daily_limit_x,daily_baseline_date,daily_external_count",
        )
      )[0] ?? null,
    // 今日（JST）に試行のある job（X・YouTube の両方。数えるのは dailyLimitReason が X だけ）
    jobsAttemptedOn: (day) =>
      call(
        `sns_x_send_jobs?attempt_dates=cs.${encodeURIComponent(`{${day}}`)}&select=attempt_dates,attempt_channels`,
      ),
    jobForDraft: async (draftId) =>
      (
        await call(
          `sns_x_send_jobs?draft_id=eq.${draftId}&select=id,state,error_code,posted_at,external_post_id,external_post_url`,
        )
      )[0] ?? null,
    async saveFile(p, bytes) {
      const response = await fetchImpl(
        `${url}/storage/v1/object/sns-hub-media/${p}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "image/png",
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(`画像を保存できない: HTTP ${response.status} ${p}`);
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
    updateItem: async (itemId, fromState, patch) =>
      one(
        await call(
          `sns_auto_send_items?id=eq.${itemId}&state=eq.${fromState}`,
          {
            method: "PATCH",
            body: { ...patch, updated_at: new Date().toISOString() },
          },
        ),
        `item ${itemId} を更新できない`,
      ),
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const usage =
    "使い方: node --env-file=.env.local scripts/sns/push-finals-image.js <フォルダ> [--dry-run] [--no-wait] | --status <race_id>";
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const store = createRestStore({ url, key });
  if (args[0] === "--status") {
    if (!args[1]) {
      console.error(usage);
      process.exit(2);
    }
    console.log(
      JSON.stringify(await finalsStatus(args[1], { store }), null, 2),
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
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  let bundleRaceId = null;
  try {
    bundleRaceId = JSON.parse(
      await readFile(path.join(folder, "bundle.json"), "utf8"),
    ).race_id;
  } catch {
    /* 読めない bundle.json は pushFinalsImage が投げ、下で error の1行にする */
  }
  // どこで落ちても、最後の1行は FINALS_RESULT（exit 6）
  const fail = (error) => {
    console.error(error);
    console.log(
      `FINALS_RESULT ${JSON.stringify({ race_id: bundleRaceId ?? null, outcome: "error", reason: String(error?.message ?? error) })}`,
    );
    process.exit(6);
  };
  const result = await pushFinalsImage(folder, {
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
      ? await waitForSend(bundleRaceId, {
          store,
          draftId: result.draft_id,
          expiresAt: result.when.expires_at,
          sleep: (sec) => new Promise((r) => setTimeout(r, sec * 1000)),
        }).catch(fail)
      : null;
  const { code, text } = resultLine(bundleRaceId, result, status);
  console.log(text);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
