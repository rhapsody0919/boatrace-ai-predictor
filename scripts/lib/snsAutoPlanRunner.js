/**
 * SNS の自動送信の計画（sns-pdca-loop tasks 12 の前半、cron `sns_auto_plan`、plan §2、ADR 0094）。
 * 5分ごとに、その日の優勝戦・準優勝戦の素材 v1 から、レース×チャネル（X・YouTube）の item を作り、検査して個別承認に回す。
 *
 * 1回の流れ（item ごと）:
 *   item を作る（checking。締切は races から。notify_by=締切−3h、veto_until=締切−60分）
 *   → 検査: 数値の照合（claims を公開 API で読み直す）・リンク先の表示（未ログインの Chromium）・禁止表現（UTM を差し込んだ後の本文）・
 *     送る前の保留の条件（sendHolds）
 *   → 合格: UTM を sns_post_tracking に保存 → 下書きに UTM つきの本文と source_data（claim_check・release_evidence・deadline_queue）を書く
 *     → item を manual → 下書きの公開保留を外す（153 のトリガーは item が manual になってからだけ外せる）。
 *     X のスレッドの子（thread_index≥1）は外さない: 子の job は deadline_queue.parent_job_id が無いと親を待たずに claim される（153 の claim は
 *     parent_job_id があるときだけ親の posted を確かめる）ので、個別承認で子だけ先に承認すると単独の投稿になる。
 *     子を親の job につないで外すのは tasks 12 の後半（親から順の承認）
 *   → 不合格: item を held_manual（理由を held_reason に）。取得の失敗だけのときは checking のまま次の実行でやり直す（3回まで）
 *
 * - 自動（mode=auto、全貌動画だけ。2026-10-18 ユーザー決定）: 合格して manual にした item のうち、評価役の検査で P0 が0件のもの
 *   （qa.review.p0 が 0。review が無い素材は qa.pass が true）を、notifying → Slack に事前通知 → notified → 自動送信の承認者で approve する。
 *   X のスレッドは親から順に、子の deadline_queue.parent_job_id に1つ前の job をつないでから公開保留を外して承認する。
 *   送る時刻はどちらも止められる期限（締切の60分前）。P0 があれば manual のまま送らず Slack で知らせる。
 *   新しい型も自動の対象（spec A10 は 2026-10-18 ユーザー決定で外した）。止めるのはフラグだけ: sns_auto_send_control.mode を manual に
 *   戻す（153 の transition が自動の承認者の job を held にする）か、sns_x_send_control.paused=true。止めるリンクは作らない（同じ決定）
 * - 試運転（dry_run）は送信の側（sns-send）が claim の前で止める。ここでは checks.dry_run に記録するだけ
 * - shadow では検査だけを行い、DB・UTM の表・Slack には書かない
 * - 毎回、基準日（X は JST・YouTube は太平洋時間）と X の月の期間を進める（153 roll_sns_send_baselines・158 roll_sns_x_send_period）
 * - 一度きりの事象（item を manual・held_manual にした）は Slack に直接知らせる（report は5分ごとに上書きされるため）
 */
import { createHash, randomBytes } from "node:crypto";
import {
  AUTO_PLAN_MAX_BUNDLES,
  CHANNELS,
  mergeDrafts,
  newItem,
  planCandidatesWith,
  reviewGate,
  unblockable,
} from "./snsAutoPlanRunnerParts.js";
import {
  evaluateChannel as evaluateChannelWith,
  sharedChecks as sharedChecksWith,
} from "./snsAutoPlanRunnerEvaluate.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { checkPublicDisplay } from "../../api/_lib/snsDeadlineQueue.js";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";

export {
  AUTO_PLAN_STAGES,
  NOTIFY_BEFORE_MIN,
  VETO_BEFORE_MIN,
  EXPIRES_BEFORE_MIN,
  AUTO_PLAN_MAX_ATTEMPTS,
  AUTO_PLAN_MAX_BUNDLES,
  CHANNELS,
  reviewGate,
  unblockable,
} from "./snsAutoPlanRunnerParts.js";
export { createAutoPlanStore } from "./snsAutoPlanRunnerStore.js";

/** api/ の物を部品へ渡す（lib の新しいファイルから api/ を import しない） */
export const planCandidates = (rows, now) =>
  planCandidatesWith(deadlineIso, rows, now);
export const evaluateChannel = (plan, channel, shared, options) =>
  evaluateChannelWith(sendHolds, plan, channel, shared, options);
const sharedChecks = (plan, deps) =>
  sharedChecksWith(checkPublicDisplay, plan, deps);

const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** 基準日・月の期間の切り替え。失敗は続いている状態として alerts に足す */
async function rollBaselines(store, alerts) {
  // 基準日・月の期間の切り替えは item の計画と独立。失敗は続いている状態として report.alerts に出す（158 が未適用の間も含む）
  for (const name of ["roll_sns_send_baselines", "roll_sns_x_send_period"]) {
    try {
      await store.rpc(name);
    } catch (error) {
      alerts.push({
        key: `roll:${name}`,
        text: `SNS の ${name} に失敗: ${error.message}`,
      });
    }
  }
}

/** 公開保留を外せなかった item の、外すところだけのやり直し */
async function runRepairs(repairs, store, results, alerts) {
  for (const { item, drafts } of repairs) {
    try {
      await unblockDrafts(drafts, store);
      results.push({
        item_id: item.id,
        race_id: item.race_id,
        channel: item.channel,
        outcome: "unblocked",
      });
    } catch (error) {
      alerts.push({
        key: `unblock:${item.id}`,
        text: `SNS の自動送信: ${item.race_id} ${item.channel} の公開保留を外せない: ${error.message}`,
      });
    }
  }
}

/** 進めない素材の検査中の item を held_manual に閉じる */
async function runAbandons(abandons, store, alerts) {
  for (const { item, reason } of abandons) {
    try {
      await store.updateItem(item.id, "checking", {
        state: "held_manual",
        held_reason: `検査をやり直さずに閉じた: ${reason}`,
      });
    } catch (error) {
      alerts.push({
        key: `abandon:${item.id}`,
        text: `SNS の自動送信: ${item.race_id} ${item.channel} の検査中の item を閉じられない: ${error.message}`,
      });
    }
  }
}

/** 事前通知・自動の承認の途中で落ちた item の続き */
async function runAutoResumes(autoResumes, controls, autoDeps, results, alerts) {
  for (const resume of autoResumes) {
    if (controls[resume.item.channel]?.mode !== "auto") continue;
    try {
      await sendAutomatically(resume.item, resume.drafts, autoDeps);
      results.push({
        item_id: resume.item.id,
        race_id: resume.item.race_id,
        channel: resume.item.channel,
        outcome: "auto_approved",
      });
    } catch (error) {
      alerts.push({
        key: `auto:${resume.item.id}`,
        text: `SNS の自動送信: ${resume.item.race_id} ${resume.item.channel} の事前通知・自動の承認に失敗（次の実行でやり直す）: ${error.message}`,
      });
    }
  }
}

/** 書き込んだ後の通知と、自動のチャネルの自動送信 */
async function notifyOrSend(
  { plan, channel, item, target, outcome, result },
  { controls, tell, autoDeps },
) {
  const review = reviewGate(plan.bundle.qa);
  if (outcome.state === "held_manual")
    await tell(
      `SNS の自動送信: ${plan.raceId} ${channel} を止めた（検査の不合格のため送らない）: ${outcome.reasons.join("・")}`,
    );
  else if (outcome.state === "manual" && controls[channel]?.mode === "auto") {
    if (!review.ok)
      await tell(
        `SNS の自動送信: ${plan.raceId} ${channel} は評価役の検査で P0 があるので送らない（${review.reason}）。直すなら素材を直して入れ直す`,
      );
    else {
      await sendAutomatically(
        { ...item, state: "manual" },
        mergeDrafts(target.drafts, outcome.drafts),
        autoDeps,
      );
      result.outcome = "auto_approved";
    }
  } else if (outcome.state === "manual")
    await tell(
      `SNS の自動送信: ${plan.raceId} ${channel} の検査が通ったが、このチャネルは個別承認（mode=manual）なので送らない。自動で送るなら sns_auto_send_control の mode を auto にする`,
    );
}

/** 1素材の1チャネルの検査・書き込み・通知。書き込んだら 1、そうでなければ 0 を返す */
async function planChannel(plan, channel, shared, env) {
  const { live, store, trackingStore, controls, riskRules, now } = env;
  const target = plan.channels[channel];
  const result = {
    bundle_import_id: plan.bundle.id,
    race_id: plan.raceId,
    channel,
  };
  env.results.push(result);
  let written = 0;
  try {
    const outcome = evaluateChannel(plan, channel, shared, {
      control: controls[channel],
      riskRules,
      isNewFormat: env.isNewFormat,
      now,
    });
    Object.assign(result, {
      outcome: outcome.state,
      reasons: outcome.reasons,
    });
    if (!live) return written;
    const item =
      target.item ?? (await store.insertItem(newItem(plan, channel)));
    result.item_id = item.id;
    await applyOutcome(item, target.drafts, outcome, { store, trackingStore });
    written += 1;
    await notifyOrSend(
      { plan, channel, item, target, outcome, result },
      env,
    );
  } catch (error) {
    result.outcome = "error";
    result.reason = error.message;
    env.alerts.push({
      key: `plan:${plan.raceId}:${channel}`,
      text: `SNS の自動送信の計画に失敗: ${plan.raceId} ${channel}: ${error.message}`,
    });
  }
  return written;
}

/** 検査する素材を、上限・停止の指示の範囲で1件ずつ処理する。書き込んだ数を返す */
async function checkTodo(todo, env, { ctx, maxBundles, checkClaims, headless, markers }) {
  const { store, alerts, now } = env;
  let checked = 0;
  let written = 0;
  for (const plan of todo) {
    if (checked >= maxBundles || ctx.shouldStop()) break;
    checked += 1;
    let shared, isNewFormat;
    try {
      shared = await sharedChecks(plan, {
        checkClaims,
        headless,
        markers,
        now,
      });
      isNewFormat = !(await store.hasPostedFormat(plan.format, plan.variant));
    } catch (error) {
      alerts.push({
        key: `plan:${plan.raceId}`,
        text: `SNS の自動送信の検査に失敗: ${plan.raceId}: ${error.message}`,
      });
      continue;
    }
    for (const channel of CHANNELS) {
      if (!plan.channels[channel]) continue;
      written += await planChannel(plan, channel, shared, {
        ...env,
        isNewFormat,
      });
    }
  }
  return written;
}

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, checkClaims, headless, markers, riskRules: object[], trackingStore, notify?, maxBundles?, approve?}} deps
 *   checkClaims({claims, raceId}) は snsClaimCheck.js、headless は snsHeadless.js（同じ実行の中で使い回す）
 *   approve(draft, approverId, scheduledAt) は承認の snapshot を作って approve_sns_x_send を呼び、job の行を返す（自動のときだけ使う）
 */
export async function runSnsAutoPlan(
  ctx,
  {
    store,
    checkClaims,
    headless,
    markers,
    riskRules,
    trackingStore,
    notify = async () => {},
    maxBundles = AUTO_PLAN_MAX_BUNDLES,
    approve,
  },
) {
  const live = ctx.mode === "live";
  const alerts = [];
  const results = [];
  const tell = async (text) => {
    try {
      await notify(text);
    } catch (error) {
      console.error(`Slack に通知できません（${text}）: ${error.message}`);
    }
  };
  if (live) await rollBaselines(store, alerts);
  const now = ctx.now();
  const controls = await store.controls();
  const plans = planCandidates(await store.todaysBundles(jstDate(now)), now);
  results.push(...plans.skipped);
  if (live) await runRepairs(plans.repairs, store, results, alerts);
  if (live) await runAbandons(plans.abandons, store, alerts);
  const autoDeps = { store, approve, notify, controls };
  if (live)
    await runAutoResumes(plans.autoResumes, controls, autoDeps, results, alerts);
  const written = await checkTodo(
    plans.todo,
    { live, store, trackingStore, controls, riskRules, now, results, alerts, tell, autoDeps },
    { ctx, maxBundles, checkClaims, headless, markers },
  );
  return {
    rowsWritten: written,
    report: { items: results, alerts },
    body: { items: results },
  };
}

/** 検査の結果を DB に書く。合格は UTM → 下書き → item（manual）→ 公開保留を外す、の順（153 のトリガーの順番） */
async function applyOutcome(item, drafts, outcome, { store, trackingStore }) {
  if (outcome.state === "checking") {
    await store.updateItem(item.id, "checking", { checks: outcome.checks });
    return;
  }
  if (outcome.state === "held_manual") {
    await store.updateItem(item.id, "checking", {
      state: "held_manual",
      checks: outcome.checks,
      held_reason: outcome.reasons.join("\n").slice(0, 2000),
    });
    return;
  }
  if (outcome.tracking) await trackingStore.save(outcome.tracking);
  for (const draft of outcome.drafts)
    await store.updateDraft(draft.id, {
      caption_text: draft.caption_text,
      source_data: draft.source_data,
    });
  await store.updateItem(item.id, "checking", {
    state: "manual",
    checks: outcome.checks,
  });
  await unblockDrafts(drafts, store);
}

const unblockDrafts = async (drafts, store) => {
  for (const draft of drafts)
    if (draft.publish_blocked && unblockable(draft))
      await store.updateDraft(draft.id, {
        publish_blocked: false,
        publication_hold_reasons: [],
      });
};

const jst = (at) =>
  new Date(new Date(at).getTime() + 9 * 3600000).toISOString().slice(11, 16);

/**
 * 自動で送る: manual → notifying → Slack に事前通知 → notified → 自動送信の承認者で approve（X は親から順）。
 * 途中で落ちたら次の実行で続きから（planCandidates の autoResumes）。承認済みの下書きは承認し直さない
 */
async function sendAutomatically(
  item,
  drafts,
  { store, approve, notify, controls },
) {
  const approverId = controls[item.channel]?.auto_approver_id;
  if (!approve || !approverId)
    throw new Error("自動送信の承認者・承認の関数が無い");
  let current = item;
  if (current.state === "manual") {
    const token = randomBytes(32).toString("hex");
    current = await store.updateItem(item.id, "manual", {
      state: "notifying",
      stop_token_hash: createHash("sha256").update(token).digest("hex"),
    });
  }
  if (current.state === "notifying") {
    const dry = controls[item.channel]?.dry_run !== false;
    await notify(
      `SNS の自動送信（全貌動画）: ${item.race_id} ${item.channel} を JST ${jst(item.veto_until)} に送る${dry ? "（試運転中: claim の前で止まる）" : ""}。` +
        `止めるには本番 SQL で sns_auto_send_control の ${item.channel} を mode='manual' にする（全部止めるなら sns_x_send_control.paused=true）`,
    );
    current = await store.updateItem(item.id, "notifying", {
      state: "notified",
      notified_at: new Date().toISOString(),
    });
  }
  const ordered = [...drafts].sort((a, b) => a.thread_index - b.thread_index);
  const jobs = new Map(
    (await store.jobsFor(ordered.map((d) => d.id))).map((j) => [j.draft_id, j]),
  );
  let previous = null;
  for (const draft of ordered) {
    const existing = jobs.get(draft.id);
    if (draft.status !== "pending_review" && existing) {
      previous = existing;
      continue;
    }
    let target = draft;
    if (item.channel === "x" && draft.thread_index > 0) {
      if (!previous) throw new Error("スレッドの1つ前の job が無い");
      const sourceData = {
        ...draft.source_data,
        deadline_queue: {
          ...draft.source_data.deadline_queue,
          parent_job_id: previous.id,
        },
      };
      target = await store.updateDraft(draft.id, {
        source_data: sourceData,
        publish_blocked: false,
        publication_hold_reasons: [],
      });
    }
    previous = await approve(
      target,
      approverId,
      new Date(item.veto_until).toISOString(),
    );
  }
}
