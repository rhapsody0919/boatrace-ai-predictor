/**
 * SNS の自動送信の計画の検査（api/ の checkPublicDisplay・sendHolds は runner から引数で渡す）。snsAutoPlanRunner.js から、sharedChecks・evaluateChannel（割った）を移した（振る舞いは同じ）。
 */
import twitterText from "twitter-text";
import { matchRiskRules, draftRiskFields } from "./riskRuleMatcher.js";
import { prepareRaceTracking } from "./snsPostTracking.js";
import {
  AUTO_PLAN_MAX_ATTEMPTS,
  EXPIRES_BEFORE_MIN,
  minutesBefore,
} from "./snsAutoPlanRunnerParts.js";

const RACE_URL = /^https:\/\/www\.boat-ai\.jp\/race\/([^/?#]+)(\?tab=sonar)?$/;
// 素材の作り直しでは直らない失敗（表示の印が無い・URL が不正）以外の表示の失敗は、取得の失敗としてやり直す
const DISPLAY_FINAL = [
  "public_component_missing",
  "public_url_invalid",
  "public_check_unconfigured",
];

/** 素材ごとに1回: 親の投稿のレースの URL、数値の照合、リンク先の表示の確認 */
export async function sharedChecks(
  checkPublicDisplay,
  plan,
  { checkClaims, headless, markers, now },
) {
  const parentText = plan.bundle.bundle.x_thread?.[0]?.text ?? "";
  const urls = twitterText.extractUrls(parentText);
  const match = urls.length === 1 ? RACE_URL.exec(urls[0]) : null;
  const raceUrl = match && match[1] === plan.raceId ? urls[0] : null;
  const claims = await checkClaims({
    claims: plan.bundle.bundle.claims,
    raceId: plan.raceId,
  });
  let display = { ok: false, reason: "race_url_invalid" };
  if (raceUrl) {
    try {
      await checkPublicDisplay(
        { public_url: raceUrl, screen_key: plan.screenKey },
        headless,
        markers,
      );
      display = { ok: true, checked_at: now.toISOString() };
    } catch (error) {
      display = { ok: false, reason: error.message };
    }
  }
  return { raceUrl, claims, display };
}

/** 素材の検査（URL・数値・表示・下書きの本数）の不合格の理由 */
function baseReasons(plan, channel, shared, drafts) {
  const reasons = [];
  if (!shared.raceUrl) reasons.push("親の投稿のレースの URL が不正");
  if (!shared.claims.ok)
    reasons.push(
      ...shared.claims.results
        .filter((r) => !r.ok)
        .map((r) => `数値の照合: ${r.id} ${r.reason}`),
    );
  if (!shared.display.ok)
    reasons.push(`リンク先の表示: ${shared.display.reason}`);
  const expected =
    channel === "x" ? (plan.bundle.bundle.x_thread?.length ?? 0) : 1;
  if (drafts.length !== expected || drafts.some((d, i) => d.thread_index !== i))
    reasons.push("下書きの本数・順番が素材と合わない");
  return reasons;
}

/** buildObservationUtm が求める確認の記録（誰が・何で・いつ）を含む公開の証拠。表示が通っていなければ null */
function buildReleaseEvidence(plan, shared) {
  return shared.display.ok
    ? {
        status: "released",
        url: shared.raceUrl,
        screen_key: plan.screenKey,
        checked_at: shared.display.checked_at,
        // buildObservationUtm が求める確認の記録（誰が・何で・いつ）
        confirmed_by: "sns-auto-plan",
        reference: `headless:${plan.screenKey}`,
        confirmed_at: shared.display.checked_at,
      }
    : null;
}

/** 下書きごとに UTM を差し込んだ本文と禁止表現の検査。utmReasons は UTM の失敗の理由（reasons に足す順で返す） */
function prepareDraftTexts({ drafts, channel, shared, releaseEvidence, riskRules }) {
  let tracking = null;
  let publicUrl = shared.raceUrl;
  const utmReasons = [];
  const updates = [];
  const risk = [];
  for (const draft of drafts) {
    let captionText = draft.caption_text;
    if (channel === "x" && draft.thread_index === 0 && releaseEvidence) {
      try {
        const prepared = prepareRaceTracking({
          draft,
          raceUrl: shared.raceUrl,
          releaseEvidence,
        });
        captionText = prepared.text;
        tracking = prepared.tracking;
        publicUrl = tracking.tracking_url;
      } catch (error) {
        utmReasons.push(`UTM: ${error.message}`);
      }
    }
    risk.push(
      ...matchRiskRules(
        draftRiskFields({ ...draft, caption_text: captionText }),
        channel,
        riskRules,
      ).map((r) => `${draft.thread_index}:${r.id}`),
    );
    updates.push({ draft, captionText });
  }
  return { tracking, publicUrl, utmReasons, updates, risk };
}

/** 下書きの source_data の deadline_queue */
function buildQueue(plan, channel, shared, publicUrl, drafts) {
  return {
    deadline_at: plan.deadlineAt,
    expires_at: minutesBefore(plan.deadlineAt, EXPIRES_BEFORE_MIN),
    source_revision: shared.claims.revision,
    source_observed_at: shared.claims.observedAt,
    public_url: publicUrl,
    screen_key: plan.screenKey,
    // 送る直前の検査（snsDeadlineQueue.js）が長文の1投稿（25,000まで）を許すかの印。承認の snapshot に入る
    ...(channel === "x" ? { thread_length: drafts.length } : {}),
    ...(channel === "youtube" ? { youtube_mode: "immediate" } : {}),
  };
}

/** 書き込む下書きの内容（projected は公開保留を外した後の形） */
function buildDraftUpdates(updates, shared, releaseEvidence, queue) {
  return updates.map(({ draft, captionText }) => {
    const sourceData = {
      ...draft.source_data,
      claim_check: {
        ok: shared.claims.ok,
        revision: shared.claims.revision,
        observed_at: shared.claims.observedAt,
      },
      release_evidence: releaseEvidence,
      deadline_queue: queue,
    };
    return {
      id: draft.id,
      caption_text: captionText,
      source_data: sourceData,
      projected: {
        ...draft,
        caption_text: captionText,
        source_data: sourceData,
        publish_blocked: false,
      },
    };
  });
}

/** 理由が取得の失敗だけ（やり直せる）か */
function isTransientOnly(reasons, shared) {
  return (
    reasons.length > 0 &&
    shared.raceUrl &&
    shared.claims.results.length > 0 &&
    shared.claims.results.every(
      (r) => r.ok || String(r.reason).startsWith("fetch_failed"),
    ) &&
    (shared.display.ok || !DISPLAY_FINAL.includes(shared.display.reason)) &&
    reasons.every(
      (r) =>
        r.startsWith("数値の照合") ||
        r.startsWith("リンク先の表示") ||
        r.startsWith("承認の条件: 正式公開証拠なし") ||
        r.startsWith("承認の条件: 数値の照合"),
    )
  );
}

/** 検査の結果の state: manual（合格）・checking（取得の失敗だけ。回数の上限まで）・held_manual */
function decideState(reasons, shared, attempts) {
  if (reasons.length === 0) return "manual";
  return isTransientOnly(reasons, shared) && attempts < AUTO_PLAN_MAX_ATTEMPTS
    ? "checking"
    : "held_manual";
}

/**
 * チャネルの検査の結果（純粋関数）。書き込む下書きの内容（drafts）・UTM（tracking）・item の checks を返す。
 * state: manual（合格）・held_manual（不合格）・checking（取得の失敗だけ。やり直す）
 */
export function evaluateChannel(
  sendHolds,
  plan,
  channel,
  shared,
  { control, riskRules, isNewFormat, now },
) {
  const { drafts, item } = plan.channels[channel];
  const reasons = baseReasons(plan, channel, shared, drafts);

  const checkedAt = now.toISOString();
  const releaseEvidence = buildReleaseEvidence(plan, shared);
  const { tracking, publicUrl, utmReasons, updates, risk } = prepareDraftTexts({
    drafts,
    channel,
    shared,
    releaseEvidence,
    riskRules,
  });
  reasons.push(...utmReasons);
  if (risk.length) reasons.push(`禁止表現: ${risk.join(",")}`);
  const queue = buildQueue(plan, channel, shared, publicUrl, drafts);
  const draftUpdates = buildDraftUpdates(updates, shared, releaseEvidence, queue);
  // 個別承認の画面と同じ条件（公開保留は合格後に外すので、外した後の形で見る）
  const holds = [
    ...new Set(draftUpdates.flatMap((u) => sendHolds(u.projected))),
  ];
  reasons.push(...holds.map((h) => `承認の条件: ${h}`));

  const attempts = (item?.checks?.attempts ?? 0) + 1;
  const state = decideState(reasons, shared, attempts);
  const checks = {
    passed: reasons.length === 0,
    risk,
    claims: shared.claims,
    display: shared.display,
    mobile_gate: holds,
    new_format: isNewFormat,
    dry_run: control?.dry_run !== false,
    mode: control?.mode ?? null,
    attempts,
    checked_at: checkedAt,
  };
  return {
    state,
    reasons,
    checks,
    drafts: draftUpdates.map(({ id, caption_text, source_data }) => ({
      id,
      caption_text,
      source_data,
    })),
    tracking,
  };
}

