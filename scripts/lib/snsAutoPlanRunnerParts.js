/**
 * SNS の自動送信の計画の部品。snsAutoPlanRunner.js から、定数・素材の振り分け（planCandidates）・
 * 評価役の関門（reviewGate）・item の組み立てを移した（振る舞いは同じ。越えの関数を割った）。検査は snsAutoPlanRunnerEvaluate.js。
 */
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

export const minutesBefore = (iso, min) =>
  new Date(Date.parse(iso) - min * 60000).toISOString();

/** スレッドの子は外さない（snsAutoPlanRunner.js の上の説明） */
export const unblockable = (draft) =>
  draft.platform !== "x" || (draft.thread_index ?? 0) === 0;

/** 素材から、レースの状態で飛ばす理由（無ければ締切の時刻）を返す */
function classifyBundle(raceId, { races, stages, now, deadlineIso }) {
  const stage = stages.find((s) => s.race_id === raceId)?.race_stage ?? null;
  if (!AUTO_PLAN_STAGES.includes(stage)) return { reason: "not_final_stage" };
  const race = races.find((r) => r.race_id === raceId);
  const deadlineAt = deadlineIso(race);
  if (!race || !deadlineAt) return { reason: "race_not_found" };
  if (race.cancellation_status != null) return { reason: "race_cancelled" };
  // 送る時刻（締切の60分前）を過ぎたら作らない
  if (now.getTime() >= Date.parse(minutesBefore(deadlineAt, VETO_BEFORE_MIN)))
    return { reason: "too_late" };
  return { deadlineAt };
}

/** manual にした後で公開保留を外すのに失敗した（前の実行の途中で落ちた）ものは、外すところだけやり直す */
const needsRepair = (own, ownDrafts) =>
  own?.state === "manual" &&
  ownDrafts.some((d) => d.publish_blocked && unblockable(d));

/** 事前通知・自動の承認の途中で落ちた（notifying のまま、または notified で承認していない下書きが残る）ものは続きからやり直す */
const needsResume = (own, ownDrafts) =>
  own?.state === "notifying" ||
  (own?.state === "notified" &&
    ownDrafts.some((d) => d.status === "pending_review"));

/** 素材のチャネルごとに、検査の対象（channels）と、やり直す物（repairs・autoResumes）を集める */
function planChannels(bundle, raceId, { drafts, items }, repairs, autoResumes) {
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
      .filter((d) => d.bundle_import_id === bundle.id && d.platform === channel)
      .sort((a, b) => a.thread_index - b.thread_index);
    if (needsRepair(own, ownDrafts)) repairs.push({ item: own, drafts: ownDrafts });
    if (needsResume(own, ownDrafts))
      autoResumes.push({ item: own, drafts: ownDrafts });
    if ((own && own.state !== "checking") || (!own && other)) continue;
    channels[channel] = { item: own ?? null, drafts: ownDrafts };
  }
  return channels;
}

/** 検査する素材 1 件（todo の要素） */
function todoEntry(bundle, raceId, deadlineAt, channels, drafts) {
  const parent =
    channels.x?.drafts[0] ??
    drafts.find((d) => d.bundle_import_id === bundle.id);
  return {
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
  };
}

/**
 * 今日の素材から、検査する素材と飛ばす素材を分ける（純粋関数）。deadlineIso（api/ の物）は runner から渡す（lib から api/ を import しない）。
 * 同じレースの素材が複数あれば新しいものを使う。既に item がある（checking 以外）チャネルは作らない。
 * @param {{bundles: object[], races: object[], stages: object[], drafts: object[], items: object[]}} rows
 */
export function planCandidatesWith(
  deadlineIso,
  { bundles, races, stages, drafts, items },
  now,
) {
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
    const verdict = classifyBundle(raceId, {
      races,
      stages,
      now,
      deadlineIso,
    });
    if (verdict.reason) {
      skip(bundle, verdict.reason);
      continue;
    }
    const channels = planChannels(
      bundle,
      raceId,
      { drafts, items },
      repairs,
      autoResumes,
    );
    if (!Object.keys(channels).length) continue;
    todo.push(todoEntry(bundle, raceId, verdict.deadlineAt, channels, drafts));
  }
  return { todo, skipped, repairs, abandons, autoResumes };
}

export const newItem = (plan, channel) => ({
  bundle_import_id: plan.bundle.id,
  channel,
  race_id: plan.raceId,
  deadline_at: plan.deadlineAt,
  notify_by: minutesBefore(plan.deadlineAt, NOTIFY_BEFORE_MIN),
  veto_until: minutesBefore(plan.deadlineAt, VETO_BEFORE_MIN),
  state: "checking",
});

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
export const mergeDrafts = (drafts, updates) =>
  drafts.map((d) => {
    const u = updates.find((x) => x.id === d.id);
    return u ? { ...d, ...u, publish_blocked: !unblockable(d) } : d;
  });
