/**
 * SNS の自動送信の計画（sns-pdca-loop tasks 12 の前半、cron `sns_auto_plan`、plan §2、ADR 0094）。
 * 5分ごとに、その日の優勝戦・準優勝戦の素材 v1 から、レース×チャネル（X・YouTube）の item を作り、検査して個別承認に回す。
 *
 * 1回の流れ（item ごと）:
 *   item を作る（checking。締切は races から。notify_by=締切−3h、veto_until=締切−60分）
 *   → 検査: 数値の照合（claims を公開 API で読み直す）・リンク先の表示（未ログインの Chromium）・禁止表現（UTM を差し込んだ後の本文）・
 *     個別承認の画面と同じ条件（sendHolds）
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
import twitterText from "twitter-text";
import { matchRiskRules, draftRiskFields } from "./riskRuleMatcher.js";
import { prepareRaceTracking } from "./snsPostTracking.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { checkPublicDisplay } from "../../api/_lib/snsDeadlineQueue.js";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";
import { createHash, randomBytes } from "node:crypto";

/** item を作るレースの種別（race_conditions.race_stage の完全一致。冠の付いた「ツッキー優勝戦」等は対象外） */
export const AUTO_PLAN_STAGES = ["優勝戦", "準優勝戦"];
export const NOTIFY_BEFORE_MIN = 180;
export const VETO_BEFORE_MIN = 60;
export const EXPIRES_BEFORE_MIN = 30;
/** 取得の失敗（数値の API・Chromium）だけで落ちたときに、checking のままやり直す回数 */
export const AUTO_PLAN_MAX_ATTEMPTS = 3;
/** 1回の実行で検査する素材の上限（表示の確認は1回 最大 約45秒。関数の300秒に収める） */
export const AUTO_PLAN_MAX_BUNDLES = 4;
export const CHANNELS = ["x", "youtube"];
const RACE_URL = /^https:\/\/www\.boat-ai\.jp\/race\/([^/?#]+)(\?tab=sonar)?$/;
// 素材の作り直しでは直らない失敗（表示の印が無い・URL が不正）以外の表示の失敗は、取得の失敗としてやり直す
const DISPLAY_FINAL = [
  "public_component_missing",
  "public_url_invalid",
  "public_check_unconfigured",
];

const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();
const jstDate = (date) =>
  new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);

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
  if (live) {
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
  const now = ctx.now();
  const controls = await store.controls();
  const plans = planCandidates(await store.todaysBundles(jstDate(now)), now);
  results.push(...plans.skipped);
  let checked = 0;
  let written = 0;
  if (live)
    for (const { item, drafts } of plans.repairs) {
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
  if (live)
    for (const { item, reason } of plans.abandons) {
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
  const autoDeps = { store, approve, notify, controls };
  if (live)
    for (const resume of plans.autoResumes) {
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
  for (const plan of plans.todo) {
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
      const target = plan.channels[channel];
      if (!target) continue;
      const result = {
        bundle_import_id: plan.bundle.id,
        race_id: plan.raceId,
        channel,
      };
      results.push(result);
      try {
        const outcome = evaluateChannel(plan, channel, shared, {
          control: controls[channel],
          riskRules,
          isNewFormat,
          now,
        });
        Object.assign(result, {
          outcome: outcome.state,
          reasons: outcome.reasons,
        });
        if (!live) continue;
        const item =
          target.item ?? (await store.insertItem(newItem(plan, channel)));
        result.item_id = item.id;
        await applyOutcome(item, target.drafts, outcome, {
          store,
          trackingStore,
        });
        written += 1;
        const review = reviewGate(plan.bundle.qa);
        if (outcome.state === "held_manual")
          await tell(
            `SNS の自動送信: ${plan.raceId} ${channel} を止めた（検査の不合格のため送らない）: ${outcome.reasons.join("・")}`,
          );
        else if (
          outcome.state === "manual" &&
          controls[channel]?.mode === "auto"
        ) {
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
      } catch (error) {
        result.outcome = "error";
        result.reason = error.message;
        alerts.push({
          key: `plan:${plan.raceId}:${channel}`,
          text: `SNS の自動送信の計画に失敗: ${plan.raceId} ${channel}: ${error.message}`,
        });
      }
    }
  }
  return {
    rowsWritten: written,
    report: { items: results, alerts },
    body: { items: results },
  };
}

/**
 * 今日の素材から、検査する素材と飛ばす素材を分ける（純粋関数）。
 * 同じレースの素材が複数あれば新しいものを使う。既に item がある（checking 以外）チャネルは作らない。
 * @param {{bundles: object[], races: object[], stages: object[], drafts: object[], items: object[]}} rows
 */
export function planCandidates({ bundles, races, stages, drafts, items }, now) {
  const todo = [];
  const repairs = [];
  const skipped = [];
  const seen = new Set();
  const abandons = [];
  const autoResumes = [];
  // 進めない素材の checking の item（取得の失敗のやり直し中）は held_manual に閉じる。閉じないと
  // 部分一意索引（race_id, channel）を塞いだまま残り、直した素材の item も作れない
  const skip = (bundle, reason) => {
    for (const i of items)
      if (i.bundle_import_id === bundle.id && i.state === "checking")
        abandons.push({ item: i, reason });
    skipped.push({
      bundle_import_id: bundle.id,
      race_id: bundle.bundle?.race_id ?? null,
      outcome: "skipped",
      reason,
    });
  };
  const sorted = [...bundles].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  for (const bundle of sorted) {
    const raceId = bundle.bundle?.race_id;
    if (seen.has(raceId)) {
      skip(bundle, "newer_bundle");
      continue;
    }
    seen.add(raceId);
    const stage = stages.find((s) => s.race_id === raceId)?.race_stage ?? null;
    if (!AUTO_PLAN_STAGES.includes(stage)) {
      skip(bundle, "not_final_stage");
      continue;
    }
    const race = races.find((r) => r.race_id === raceId);
    const deadlineAt = deadlineIso(race);
    if (!race || !deadlineAt) {
      skip(bundle, "race_not_found");
      continue;
    }
    if (race.cancellation_status != null) {
      skip(bundle, "race_cancelled");
      continue;
    }
    // 送る時刻（締切の60分前）を過ぎたら作らない
    if (
      now.getTime() >= Date.parse(minutesBefore(deadlineAt, VETO_BEFORE_MIN))
    ) {
      skip(bundle, "too_late");
      continue;
    }
    const channels = {};
    for (const channel of CHANNELS) {
      const own = items.find(
        (i) => i.bundle_import_id === bundle.id && i.channel === channel,
      );
      // 別の素材の item が生きている（直した素材の入れ直しで前の item を止める操作は tasks 12 の後半）
      const other = items.find(
        (i) =>
          i.race_id === raceId &&
          i.channel === channel &&
          i.bundle_import_id !== bundle.id &&
          !["stopped", "held_manual"].includes(i.state),
      );
      const ownDrafts = drafts
        .filter(
          (d) => d.bundle_import_id === bundle.id && d.platform === channel,
        )
        .sort((a, b) => a.thread_index - b.thread_index);
      // manual にした後で公開保留を外すのに失敗した（前の実行の途中で落ちた）ものは、外すところだけやり直す
      if (
        own?.state === "manual" &&
        ownDrafts.some((d) => d.publish_blocked && unblockable(d))
      )
        repairs.push({ item: own, drafts: ownDrafts });
      // 事前通知・自動の承認の途中で落ちた（notifying のまま、または notified で承認していない下書きが残る）ものは続きからやり直す
      if (
        own?.state === "notifying" ||
        (own?.state === "notified" &&
          ownDrafts.some((d) => d.status === "pending_review"))
      )
        autoResumes.push({ item: own, drafts: ownDrafts });
      if ((own && own.state !== "checking") || (!own && other)) continue;
      channels[channel] = { item: own ?? null, drafts: ownDrafts };
    }
    if (!Object.keys(channels).length) continue;
    const parent =
      channels.x?.drafts[0] ??
      drafts.find((d) => d.bundle_import_id === bundle.id);
    todo.push({
      bundle,
      raceId,
      deadlineAt,
      channels,
      screenKey: bundle.bundle.screen_key,
      format: parent?.format ?? bundle.bundle.format,
      variant:
        parent?.source_data?.local_template_variant_id ??
        bundle.bundle.template_variant_id ??
        null,
    });
  }
  return { todo, skipped, repairs, abandons, autoResumes };
}

/** 素材ごとに1回: 親の投稿のレースの URL、数値の照合、リンク先の表示の確認 */
async function sharedChecks(plan, { checkClaims, headless, markers, now }) {
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

/**
 * チャネルの検査の結果（純粋関数）。書き込む下書きの内容（drafts）・UTM（tracking）・item の checks を返す。
 * state: manual（合格）・held_manual（不合格）・checking（取得の失敗だけ。やり直す）
 */
export function evaluateChannel(
  plan,
  channel,
  shared,
  { control, riskRules, isNewFormat, now },
) {
  const { drafts, item } = plan.channels[channel];
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

  const checkedAt = now.toISOString();
  const releaseEvidence = shared.display.ok
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
  let tracking = null;
  let publicUrl = shared.raceUrl;
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
        reasons.push(`UTM: ${error.message}`);
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
  if (risk.length) reasons.push(`禁止表現: ${risk.join(",")}`);
  const queue = {
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
  const draftUpdates = updates.map(({ draft, captionText }) => {
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
  // 個別承認の画面と同じ条件（公開保留は合格後に外すので、外した後の形で見る）
  const holds = [
    ...new Set(draftUpdates.flatMap((u) => sendHolds(u.projected))),
  ];
  reasons.push(...holds.map((h) => `承認の条件: ${h}`));

  const attempts = (item?.checks?.attempts ?? 0) + 1;
  const transientOnly =
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
    );
  const state =
    reasons.length === 0
      ? "manual"
      : transientOnly && attempts < AUTO_PLAN_MAX_ATTEMPTS
        ? "checking"
        : "held_manual";
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

const newItem = (plan, channel) => ({
  bundle_import_id: plan.bundle.id,
  channel,
  race_id: plan.raceId,
  deadline_at: plan.deadlineAt,
  notify_by: minutesBefore(plan.deadlineAt, NOTIFY_BEFORE_MIN),
  veto_until: minutesBefore(plan.deadlineAt, VETO_BEFORE_MIN),
  state: "checking",
});

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

/** スレッドの子は外さない（上の説明） */
export const unblockable = (draft) =>
  draft.platform !== "x" || (draft.thread_index ?? 0) === 0;

const unblockDrafts = async (drafts, store) => {
  for (const draft of drafts)
    if (draft.publish_blocked && unblockable(draft))
      await store.updateDraft(draft.id, {
        publish_blocked: false,
        publication_hold_reasons: [],
      });
};

/**
 * 評価役の検査で P0 が0件か（純粋関数、2026-10-18 ユーザー決定）。qa.review.p0（0以上の整数）があればそれで、
 * 無い素材（Codex の評価役の結果を入れていない版）は qa.pass で判定する
 */
export function reviewGate(qa) {
  // review があるのに p0 が無い・壊れているものは通さない（評価したのに件数が読めない）
  if (qa?.review !== undefined) {
    const p0 = qa.review?.p0;
    if (!Number.isInteger(p0) || p0 < 0)
      return { ok: false, reason: "qa.review.p0 が0以上の整数でない" };
    return p0 === 0
      ? { ok: true }
      : { ok: false, reason: `評価役の P0 が${p0}件` };
  }
  return qa?.pass === true
    ? { ok: true }
    : { ok: false, reason: "qa.pass が true でない" };
}

/** 書き込んだ後の下書き（本文・source_data を検査の結果で置き換えた形） */
const mergeDrafts = (drafts, updates) =>
  drafts.map((d) => {
    const u = updates.find((x) => x.id === d.id);
    return u ? { ...d, ...u, publish_blocked: !unblockable(d) } : d;
  });

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

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createAutoPlanStore({ url, key, fetchImpl = fetch }) {
  async function call(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        `自動送信の計画の DB 操作に失敗: HTTP ${response.status} ${method} ${path.split("?")[0]}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const one = (rows, what) => {
    if (rows?.length !== 1)
      throw new Error(`${what}（条件に合う行が無い。他の操作と競合した）`);
    return rows[0];
  };
  const inList = (ids) => `(${ids.map((id) => `"${id}"`).join(",")})`;
  return {
    rpc: (name) => call(`rpc/${name}`, { method: "POST", body: {} }),
    async controls() {
      const rows = await call(
        "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
      );
      return Object.fromEntries(rows.map((row) => [row.channel, row]));
    },
    async todaysBundles(today) {
      // 前日以前に入れた今日のレースの素材も拾う（3日前から）
      const since = new Date(
        Date.parse(`${today}T00:00:00+09:00`) - 3 * 86400000,
      ).toISOString();
      const all = await call(
        `sns_bundle_imports?schema_version=eq.${encodeURIComponent("ryujin-preview/1")}&created_at=gte.${encodeURIComponent(since)}&select=id,bundle,qa,created_at&order=created_at.desc&limit=500`,
      );
      const bundles = all.filter((b) =>
        String(b.bundle?.race_id ?? "").startsWith(`${today}-`),
      );
      if (!bundles.length)
        return { bundles, races: [], stages: [], drafts: [], items: [] };
      const raceIds = inList([
        ...new Set(bundles.map((b) => b.bundle.race_id)),
      ]);
      const [races, stages, drafts, items] = await Promise.all([
        call(
          `races?race_id=in.${encodeURIComponent(raceIds)}&select=race_id,race_date,start_time,cancellation_status`,
        ),
        call(
          `race_conditions?race_id=in.${encodeURIComponent(raceIds)}&select=race_id,race_stage`,
        ),
        call(
          `sns_drafts?bundle_import_id=in.${encodeURIComponent(inList(bundles.map((b) => b.id)))}&select=id,bundle_import_id,platform,thread_index,status,title,caption_text,hashtags,video_storage_path,cover_image_path,source_data,publish_blocked,publication_hold_reasons,risk_flags,format,template_variant_id,language&limit=500`,
        ),
        call(
          `sns_auto_send_items?race_id=in.${encodeURIComponent(raceIds)}&select=*`,
        ),
      ]);
      return { bundles, races, stages, drafts, items };
    },
    async hasPostedFormat(format, variant) {
      if (!format || !variant) return false;
      const rows = await call(
        `sns_drafts?status=eq.posted&format=eq.${encodeURIComponent(format)}&source_data->>local_template_variant_id=eq.${encodeURIComponent(variant)}&select=id&limit=1`,
      );
      return rows.length > 0;
    },
    jobsFor: async (draftIds) =>
      draftIds.length
        ? call(
            `sns_x_send_jobs?draft_id=in.${encodeURIComponent(inList(draftIds))}&select=id,draft_id,state`,
          )
        : [],
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    async updateItem(id, fromState, patch) {
      return one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      );
    },
    // 承認の前の下書きだけを書く（承認・送信が始まった下書きは 148 のトリガーが拒否する。ここでも pending_review に限る）
    async updateDraft(id, patch) {
      return one(
        await call(`sns_drafts?id=eq.${id}&status=eq.pending_review`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${id} を更新できない`,
      );
    },
  };
}
