// push-research-image.js から移した、下書き・item の行と状態・結果の1行を作る純粋関数（draftRow・itemRow・dailyStatusOf・resultLine）
import { randomBytes, randomUUID } from "node:crypto";
import { dailyIdOf } from "../../api/_lib/snsResearchImage.js";
import { PUSH_RULES } from "../lib/sns/researchPushRules.js";
import { statusOf } from "./push-finals-image.js";
import { RESEARCH_TYPE } from "./pushResearchImageChecks.js";

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
export function itemRow(
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

/** item と job から、hq に返す状態（純粋関数） */
export const dailyStatusOf = (type, item, job) => ({
  ...statusOf(item?.race_id ?? null, item, job),
  [type.idField]: item?.race_id ?? null,
  held_reason: item?.held_reason ?? null,
});
export const researchStatusOf = (item, job) =>
  dailyStatusOf(RESEARCH_TYPE, item, job);

/** 結果の1行の outcome（resultLine から移した） */
function outcomeOf(result, status, waited) {
  if (result.reasons?.length) return "rejected";
  if (result.already) return "already_exists";
  if (result.disabled) return "disabled";
  if (result.dryRun) return "dry_run_ok";
  if (status?.job_state === "posted") return "posted";
  return result.job_id && !waited ? "queued" : "not_posted";
}

/** 結果の1行の reason（resultLine から移した） */
function reasonOf(result, outcome, type) {
  return (
    result.reasons?.join(" / ") ??
    result.reason ??
    (result.disabled
      ? `自動送信の許可（${type.enabledColumn}）が off なので送らなかった`
      : outcome === "not_posted" && !result.job_id
        ? result.error
          ? `自動の承認に失敗したので job を作らなかった: ${result.error}`
          : "自動モードでないので job を作らなかった"
        : null)
  );
}

const EXIT_CODES = {
  posted: 0,
  dry_run_ok: 0,
  queued: 0,
  rejected: 1,
  disabled: 3,
  already_exists: 4,
  not_posted: 5,
};

/** 結果の1行の job・tweet の欄（resultLine から移した。status は待った結果か result.status） */
function jobFields(s, result) {
  return {
    job_id: s?.job_id ?? result.job_id ?? null,
    job_state: s?.job_state ?? null,
    tweet_id: s?.tweet_id ?? null,
    tweet_url: s?.tweet_url ?? null,
    posted_at: s?.posted_at ?? null,
    error_code: s?.error_code ?? result.error ?? null,
  };
}

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  result,
  status = null,
  { waited = Boolean(status), type = RESEARCH_TYPE } = {},
) {
  const outcome = outcomeOf(result, status, waited);
  const s = status ?? result.status ?? null;
  const line = {
    [type.idField]: result[type.idField] ?? null,
    outcome,
    ...jobFields(s, result),
    reason: reasonOf(result, outcome, type),
    // --dry-run を別の日の時計で通したとき（日の上限は見ていない）。hq は1行だけを読むので、ここに出す
    ...(result.simulated_now ? { simulated_now: result.simulated_now } : {}),
  };
  return {
    code: EXIT_CODES[outcome],
    text: `${PUSH_RULES[type.kind].tag} ${JSON.stringify(line)}`,
  };
}
