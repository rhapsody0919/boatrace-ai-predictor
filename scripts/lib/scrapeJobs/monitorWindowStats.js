import {
  SCRAPE_JOBS,
  isCatchupOffset,
  isWeightOnlyOffset,
} from "./registry.js";
import { jstMinutesOfDay, slotWindowEnd } from "./time.js";
import { isCancellationConfirmed } from "../cancellationStatus.js";
import { slotDeadlineOf, slotKeyOf } from "./expectedUnpublished.js";

export const THRESHOLDS = Object.freeze({
  /** 窓内取得率の閾値（欠落率2%以内。完了の定義B） */
  windowRate: 0.98,
  /** 窓内取得率の通知に必要な最小の母数（朝の少数のスロットで誤報しない） */
  windowRateMinSamples: 20,
  /** last_tick_at がこの分数以上更新されていなければ、死活の異常（5分に1回しか書かないため、書き込み2回分） */
  livenessStaleMin: 10,
  /**
   * 10分ごとに起動する常駐型（kind: continuous。race_notices・race_status）の死活の閾値（BOA-373）。
   * last_tick_at は起動のたびに書かれるが、5分未満の間隔では書かないため、起動2回分（20分）＋余裕5分
   */
  continuousLivenessStaleMin: 25,
  /** 運用窓の開始から、この分数が過ぎてから死活を判定する（開始直後の最初のtickを待つ） */
  livenessStartGraceMin: 10,
  consecutiveFailures: 3,
  /** 日次ジョブが、指定時刻からこの時間を過ぎても対象日を処理していなければ通知 */
  dailyOverdueHours: 3,
  /** 持続する状態（死活・連続失敗・ブレーカー・窓内取得率）を、同じ内容で再通知する間隔 */
  renotifyHours: 6,
});

/** 当日のracesが登録されているべき時刻（JST 08:00。最初のレースの窓（60分前）より前） */
const RACES_EXPECTED_BY_MIN = 8 * 60;

/** 運用窓（JST 07:00〜23:59。plan.md §2.3のcron式と同じ） */
export const OPERATING_START_MIN = 7 * 60;
export const OPERATING_END_MIN = 24 * 60;

/** 通知済みの記録を保持する時間。expired・未実行はこの間は再通知しない（実質、1スロットにつき1回） */
const NOTIFIED_RETENTION_HOURS = 72;
const ONCE_KEY_PREFIXES = ["expired:", "unexecuted:"];

const isActiveMode = (mode) => mode === "shadow" || mode === "live";
const isHostRow = (row) => String(row.job).startsWith("host:");

/**
 * 死活を判定してよい時刻か（運用窓の開始から graceMin 経過後〜23:59）。
 * 常駐型（10分ごと）は、日中と同じく起動2回分の欠落までを許すよう、graceMin に閾値（25分）を渡す（BOA-373）
 */
export function livenessCheckable(
  now,
  graceMin = THRESHOLDS.livenessStartGraceMin,
  active = null,
) {
  const m = jstMinutesOfDay(now);
  // 稼働時間を持つジョブ（activeHoursJst。例: SNS の送信は JST 8:00〜23:00）は、その時間の中だけを見る
  const start = active?.start ?? OPERATING_START_MIN;
  const end = active?.end ?? OPERATING_END_MIN;
  return m >= start + graceMin && m < end;
}

const minutesBetween = (later, earlier) =>
  (later.getTime() - earlier.getTime()) / 60000;

/** 最近傍順位法のパーセンタイル（空なら null） */
export function percentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  return sortedAscending[
    Math.min(sortedAscending.length, Math.max(1, rank)) - 1
  ];
}

/** スロットの期限（races の埋め込み行から）。races が無い（削除済み等）なら null */
export const deadlineOf = slotDeadlineOf;

const isCancelledRace = (slot) =>
  slot.outcome === "cancelled_race" ||
  isCancellationConfirmed(slot.races?.cancellation_status);

const slotKey = slotKeyOf;

/**
 * ジョブ×窓ごとの窓内取得率・遅延の集計。
 * 対象: live で完了（done）またはexpiredしたスロット。shadow・pending・running・確定中止は数えない。
 *
 * 想定内の未公開（classifyExpectedUnpublished の結果 expectedUnpublished）は、後で公開されたことが確認できたもの（confirmed）だけを
 * 分母から外して expectedUnpublished 件として別に数え、結論待ち（deferred）は分母に入れず deferred 件として別に数える
 * （保留の間に欠落として数えると、後続の窓で取れる前に、窓内取得率の警告が出るため。日次サマリーの時点では保留は残らない）。
 * どちらの件数も、日次サマリー・警告に出す（黙って除外しない）。
 *
 * @param {Array<Object>} slots races（start_time・cancellation_status）を埋め込んだ scrape_slots の行
 * @param {typeof SCRAPE_JOBS} [registry]
 * @param {{liveJobs?: Set<string>, expectedUnpublished?: Map<string, "confirmed"|"deferred">}} [options]
 * @returns {Array<{job, offset_min, total, hit, hitTolerance, hitGrace, expired, unexecuted, expectedUnpublished, deferred, delayP50Min, delayP95Min}>}
 */
export function computeWindowStats(
  slots,
  registry = SCRAPE_JOBS,
  { liveJobs, expectedUnpublished } = {},
) {
  const groups = new Map();
  for (const slot of slots) {
    if (!isWindowStatsSlot(slot, liveJobs)) continue;
    const def = registry[slot.job];
    if (!def || def.kind !== "window") continue;
    const deadline = deadlineOf(slot);
    if (!deadline) continue;
    const key = `${slot.job}|${slot.offset_min}`;
    if (!groups.has(key)) groups.set(key, newWindowGroup(slot, def));
    const g = groups.get(key);
    tallyWindowSlot(g, slot, deadline, expectedUnpublished?.get(slotKey(slot)));
  }
  return summarizeWindowGroups(groups);
}

/** 窓内取得率の集計に入れるスロットか（ジョブの種別・期限の有無の前の、スロット自身の条件） */
function isWindowStatsSlot(slot, liveJobs) {
  if (slot.status !== "done" && slot.status !== "expired") return false;
  if (isCancelledRace(slot)) return false;
  // 取得の対象外で終端したスロット（ピットレポートの最終日のG1 R7〜R11 等）は、窓内取得率の分母に入れない
  if (slot.outcome === "skipped_not_target") return false;
  if (slot.run_mode === "shadow") return false;
  // 一度も claim されず expired になったスロット（run_mode が無い）は、そのジョブが live のときだけ数える
  // （off・shadow のジョブの予定表の残りを、live の欠落として数えない）
  if (
    liveJobs &&
    slot.status === "expired" &&
    !slot.run_mode &&
    !liveJobs.has(slot.job)
  ) {
    return false;
  }
  return true;
}

function newWindowGroup(slot, def) {
  return {
    job: slot.job,
    offset_min: slot.offset_min,
    total: 0,
    hitTolerance: 0,
    hitGrace: 0,
    expired: 0,
    unexecuted: 0,
    expectedUnpublished: 0,
    deferred: 0,
    delays: [],
    graceMin: def.graceMin,
  };
}

/** 1スロットを、窓の集計（g）へ数える */
function tallyWindowSlot(g, slot, deadline, unpublished) {
  if (unpublished === "confirmed") {
    g.expectedUnpublished++;
    return;
  }
  if (unpublished === "deferred") {
    g.deferred++;
    return;
  }
  g.total++;
  if (slot.status === "expired") {
    g.expired++;
    if ((slot.attempts ?? 0) === 0) g.unexecuted++;
    return;
  }
  if (!slot.done_at) return;
  const doneAt = new Date(slot.done_at);
  const delayMin = minutesBetween(doneAt, deadline);
  g.delays.push(delayMin);
  if (delayMin >= 0 && delayMin <= 3) g.hitTolerance++;
  if (delayMin >= 0 && doneAt <= slotWindowEnd(deadline, g.graceMin))
    g.hitGrace++;
}

function summarizeWindowGroups(groups) {
  return [...groups.values()]
    .map(({ delays, graceMin, ...g }) => {
      const sorted = [...delays].sort((a, b) => a - b);
      return {
        ...g,
        // 主たる指標: 許容幅3分以下のジョブは「期限+3分」、それ以外は「期限+許容幅」
        hit: graceMin <= 3 ? g.hitTolerance : g.hitGrace,
        delayP50Min: percentile(sorted, 50),
        delayP95Min: percentile(sorted, 95),
      };
    })
    .sort((a, b) => a.job.localeCompare(b.job) || a.offset_min - b.offset_min);
}

/**
 * ジョブごとに窓を束ねた窓内取得率。窓の外の補完のスロット（catchupOffsets）・体重だけの窓（weightOnlyOffsets）は
 * 束ねない（ファイル冒頭の説明）
 */
export function aggregateByJob(stats, registry = SCRAPE_JOBS) {
  const byJob = new Map();
  for (const s of stats) {
    if (isCatchupOffset(registry[s.job], s.offset_min)) continue;
    if (isWeightOnlyOffset(registry[s.job], s.offset_min)) continue;
    const j = byJob.get(s.job) ?? {
      job: s.job,
      total: 0,
      hit: 0,
      expired: 0,
      unexecuted: 0,
      expectedUnpublished: 0,
      deferred: 0,
    };
    j.total += s.total;
    j.hit += s.hit;
    j.expired += s.expired;
    j.unexecuted += s.unexecuted;
    j.expectedUnpublished += s.expectedUnpublished ?? 0;
    j.deferred += s.deferred ?? 0;
    byJob.set(s.job, j);
  }
  return [...byJob.values()].map((j) => ({
    ...j,
    rate: j.total > 0 ? j.hit / j.total : null,
  }));
}

function toJstTimeString(date) {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${j.toISOString().slice(5, 10)} ${j.toISOString().slice(11, 16)}`;
}

export {
  RACES_EXPECTED_BY_MIN,
  NOTIFIED_RETENTION_HOURS,
  ONCE_KEY_PREFIXES,
  isActiveMode,
  isHostRow,
  minutesBetween,
  isCancelledRace,
  slotKey,
  toJstTimeString,
};
