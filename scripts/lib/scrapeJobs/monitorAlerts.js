import {
  SCRAPE_JOBS,
  activeMinutesOf,
  isCatchupOffset,
  isScheduledDate,
  isWeightOnlyOffset,
} from "./registry.js";
import { jstMinutesOfDay, toJstDateString } from "./time.js";
import { resolveTargetDate } from "./dailyJob.js";
import { DETECTION_LAG, isPastWindow } from "./expectedUnpublished.js";
import {
  THRESHOLDS,
  RACES_EXPECTED_BY_MIN,
  NOTIFIED_RETENTION_HOURS,
  ONCE_KEY_PREFIXES,
  isActiveMode,
  isHostRow,
  livenessCheckable,
  minutesBetween,
  deadlineOf,
  isCancelledRace,
  slotKey,
  aggregateByJob,
  toJstTimeString,
} from "./monitorWindowStats.js";

/** @typedef {{key: string, kind: string, text: string}} Alert */

/**
 * expired・未実行（1スロットごと）。確定中止のレースは除く。
 *
 * expired は claim_scrape_slots（またはscrape-cleanup）が付けるため、ジョブのCronが止まった・ブレーカーで
 * claim しなかった間は、期限+許容幅を超えても pending のまま残る。監視が claim に依存して見逃さないよう、
 * pending・リース切れの running で期限+許容幅を超えたものも、同じキーで、expired と同じく通知する
 * （後で claim が expired にしても、同じキーのため再通知しない）。
 *
 * 想定内の未公開（発売開始の遅れ。発走60分前のオッズ。classifyExpectedUnpublished の結果 expectedUnpublished）は通知しない
 * （後続の窓も取れなかったものは、その結果に含まれないため、従来どおり通知する）。
 *
 * @param {Array<Object>} slots expired・pending・running のスロット（races を埋め込んだ行）
 * @param {{activeJobs?: Set<string>, now?: Date, registry?: typeof SCRAPE_JOBS, expectedUnpublished?: Map<string, "confirmed"|"deferred">}} [options]
 */
export function evaluateExpired(
  slots,
  { activeJobs, now, registry = SCRAPE_JOBS, expectedUnpublished } = {},
) {
  /** @type {Alert[]} */
  const alerts = [];
  for (const slot of slots) {
    if (isExpiredAlertExempt(slot, activeJobs, registry)) continue;
    const deadline = deadlineOf(slot);
    if (!isPastWindow(slot, now, registry)) continue;
    // 想定内の未公開（後続の窓で公開が確認できた・確認待ち）は通知しない。後続の窓も取れなかったものは、ここに来る
    if (expectedUnpublished?.has(slotKey(slot))) continue;
    alerts.push(expiredAlertOf(slot, deadline));
  }
  return alerts;
}

/** expired・未実行の通知の対象外のスロットか（確定中止・shadow・対象外のジョブ・補完・体重だけの窓） */
function isExpiredAlertExempt(slot, activeJobs, registry) {
  if (isCancelledRace(slot)) return true;
  if (slot.run_mode === "shadow") return true;
  if (activeJobs && !activeJobs.has(slot.job)) return true;
  // 窓の外の補完（発走の後）は、中止・順延の疑い（tentative。確定はここまでで除いた）のレースを通知しない。
  // 中止・順延のレースは、展示が公開されないため、補完が最後まで取れないのが正常
  if (
    isCatchupOffset(registry[slot.job], slot.offset_min) &&
    slot.races?.cancellation_status
  ) {
    return true;
  }
  // 体重だけの窓（発走60分前）の期限切れは通知しない。体重の公開が窓より遅くても、-33 の窓が同じ行を埋める
  // （ファイル冒頭の説明）。未実行（attempts=0）は、公開の遅れでは起きないため通知する
  return (
    isWeightOnlyOffset(registry[slot.job], slot.offset_min) &&
    (slot.attempts ?? 0) > 0
  );
}

/** 1スロットの未実行・expired の通知 */
function expiredAlertOf(slot, deadline) {
  const id = slotKey(slot);
  const when = deadline ? `期限 ${toJstTimeString(deadline)}` : "期限不明";
  const detail = slot.last_error ? ` / 最終エラー: ${slot.last_error}` : "";
  const pendingNote =
    slot.status === "expired" ? "" : "（まだexpired化されていない）";
  if ((slot.attempts ?? 0) === 0) {
    return {
      key: `unexecuted:${id}`,
      kind: "unexecuted",
      text: `未実行（attempts=0のまま期限+許容幅を超過${pendingNote}。Cronの未配信・tickの死活・claimの不具合・ブレーカーの兆候） ${id}（${when}）`,
    };
  }
  return {
    key: `expired:${id}`,
    kind: "expired",
    text: `expired（許容幅を超えて未完了${pendingNote}） ${id}（${when}、試行${slot.attempts}回、outcome=${slot.outcome ?? "なし"}）${detail}`,
  };
}

/**
 * 当日の races が無い（朝の初期化の失敗・遅延）。予定表は races から作るため、races が無いと、
 * 全ての窓型ジョブが「対象なし」で黙る（plan.md F1・R8）。skip_lapsed で作られなかったスロットも、
 * expired にならず分母に入らないため、この検知で補う
 */
export function evaluateRacesPresent({ jobStates, todayRaceCount, now }) {
  /** @type {Alert[]} */
  const alerts = [];
  const windowJobActive = jobStates.some(
    (r) =>
      !isHostRow(r) &&
      SCRAPE_JOBS[r.job]?.kind === "window" &&
      isActiveMode(r.mode),
  );
  if (
    windowJobActive &&
    todayRaceCount === 0 &&
    jstMinutesOfDay(now) >= RACES_EXPECTED_BY_MIN
  ) {
    alerts.push({
      key: `races_missing:${toJstDateString(now)}`,
      kind: "races_missing",
      text: `当日(${toJstDateString(now)})のracesが0件です（朝の初期化の失敗・遅延の可能性。全ての窓型ジョブが対象なしで黙ります）`,
    });
  }
  return alerts;
}

/** 分母から外した想定内の未公開・保留の件数の注記（無ければ空。「取れなかったのに黙って除外」を避けるため、必ず出す） */
function unpublishedNote(j) {
  return [
    j.expectedUnpublished > 0
      ? `、分母から除外: 発売開始の遅れ(想定内の未公開) ${j.expectedUnpublished}件`
      : "",
    j.deferred > 0 ? `、判定保留 ${j.deferred}件` : "",
  ].join("");
}

/** 窓内取得率が閾値を割ったジョブ（当日の集計。母数が小さいときは判定しない） */
export function evaluateWindowRates(stats, date) {
  /** @type {Alert[]} */
  const alerts = [];
  for (const j of aggregateByJob(stats)) {
    if (j.total < THRESHOLDS.windowRateMinSamples || j.rate === null) continue;
    if (j.rate >= THRESHOLDS.windowRate) continue;
    alerts.push({
      key: `window_rate:${j.job}:${date}`,
      kind: "window_rate",
      text: `窓内取得率が閾値未満 ${j.job}: ${(j.rate * 100).toFixed(1)}%（${j.hit}/${j.total}、閾値${THRESHOLDS.windowRate * 100}%、expired ${j.expired}件${unpublishedNote(j)}）`,
    });
  }
  return alerts;
}

/**
 * 発売開始の検知の遅れ（除外した-60のスロットの、最初の成功取得と直前の未公開の試行の差）が、5分を超えたもの
 * （当日の集計。1件でもあれば通知する。定義・近似は expectedUnpublished.js）。
 * 延長が効いていない（マイグレーション092が未適用で、既存の関数へフォールバックしている等）と、後続の窓での取得になり、
 * 検知の遅れが大きくなるため、この通知が、延長の不具合の検知にもなる
 *
 * @param {ReturnType<typeof summarizeDetectionLags>} lag 当日の集計
 * @param {string} date
 */
export function evaluateDetectionLag(lag, date) {
  /** @type {Alert[]} */
  const alerts = [];
  if (lag.over === 0) return alerts;
  const worst = [...lag.overSlots]
    .sort((a, b) => b.lagMin - a.lagMin)
    .slice(0, 3)
    .map((l) => `${l.race_id} ${l.lagMin.toFixed(1)}分`)
    .join("、");
  alerts.push({
    key: `detection_lag:${date}`,
    kind: "detection_lag",
    text: `発売開始の検知の遅れが${DETECTION_LAG.thresholdMin}分超 ${lag.over}件/${lag.measured}件（最大${lag.maxMin.toFixed(1)}分。${worst}。基準は${DETECTION_LAG.thresholdMin}分以内の割合${DETECTION_LAG.rate * 100}%以上。延長（-60の窓の1分間隔の再試行）が効いているか確認）`,
  });
  return alerts;
}

/**
 * 自分の Cron を持たず、他のジョブの成功フックで動くジョブ（registry には無い）。連続失敗・0件エラー・
 * ジョブ自身の通知だけを見る（起動は親のジョブに依存するため、死活は見ない）。
 *   prediction_odds  買い目オッズ（A4）。odds（A3）の成功フックで race_odds から導出する
 *                    （predictionOddsHandlers.js の PREDICTION_ODDS_JOB。GitHub Actions 側の A4 は A3 を肩代わり
 *                    するときしか動かないため、導出の失敗を、ここで通知しないと誰も気づかない。BOA-645）
 */
export const HOOK_JOBS = Object.freeze({
  prediction_odds: Object.freeze({ kind: "hook" }),
});

/** 死活・連続失敗・ブレーカー・日次の期限超過 */
export function evaluateJobStates(jobStates, now, registry = SCRAPE_JOBS) {
  /** @type {Alert[]} */
  const alerts = [];
  for (const row of jobStates) {
    if (isHostRow(row)) {
      alerts.push(...hostRowAlerts(row, now));
      continue;
    }
    const def = registry[row.job] ?? HOOK_JOBS[row.job];
    if (!def) continue;
    // 監視・保守のジョブは mode のゲートを掛けない（常に有効）。それ以外は shadow・live のみ
    const active = def.kind === "monitor" || isActiveMode(row.mode);
    if (!active) continue;
    alerts.push(
      ...failureAlerts(row, def),
      ...livenessAlerts(row, def, now),
      ...jobReportAlerts(row, now),
      ...dailyOverdueAlerts(row, def, now),
    );
  }
  return alerts;
}

/** ホスト行（host:*）の非常停止・ブレーカー */
function hostRowAlerts(row, now) {
  /** @type {Alert[]} */
  const alerts = [];
  // 非常停止（fetch_stop、178）は人が下ろすまで止まり続ける。下ろし忘れで黙って取得が止まらないよう、立っている間は知らせる
  if (row.fetch_stop === true) {
    alerts.push({
      key: `fetch_stop:${row.job}`,
      kind: "breaker",
      text: `取得の非常停止が立っています ${row.job}（fetch_stop=true。人が下ろすまで、このホストへの取得は止まったまま）`,
    });
  }
  if (row.breaker_open_until && new Date(row.breaker_open_until) > now) {
    alerts.push({
      key: `breaker:${row.job}`,
      kind: "breaker",
      text: `サーキットブレーカーが開いています ${row.job}（${toJstTimeString(new Date(row.breaker_open_until))}まで。直近: ${row.last_error ?? "不明"}）`,
    });
  }
  return alerts;
}

/** 連続失敗・0件エラー */
function failureAlerts(row, def) {
  /** @type {Alert[]} */
  const alerts = [];
  // failureAlertAfter: 起動が週1回のジョブは、既定の3回を待つと通知が数週遅れる（registry.js）
  if (
    (row.consecutive_failures ?? 0) >=
    (def.failureAlertAfter ?? THRESHOLDS.consecutiveFailures)
  ) {
    alerts.push({
      key: `failures:${row.job}`,
      kind: "failures",
      text: `連続失敗 ${row.job}: ${row.consecutive_failures}回（最終エラー: ${row.last_error ?? "不明"}）`,
    });
  }
  if (
    row.last_error &&
    /(?<![0-9])0件/.test(row.last_error) &&
    (row.consecutive_failures ?? 0) >= 1
  ) {
    alerts.push({
      key: `zero_rows:${row.job}`,
      kind: "zero_rows",
      text: `0件エラー ${row.job}: ${row.last_error}`,
    });
  }
  return alerts;
}

/**
 * 死活: 毎分起動する窓型と、10分ごとの常駐型（自分自身の鮮度は、メタ監視が見る）。
 * 監視・保守のジョブは、レジストリに livenessStaleMin を書いたものだけ、mode が shadow・live の間に見る
 * （1日数回の起動の未配信・古い版への巻き戻しで cron が消えたことを拾う。ADR-0106 の release_dispatch）
 */
function livenessAlerts(row, def, now) {
  const staleMin =
    def.kind === "window"
      ? THRESHOLDS.livenessStaleMin
      : def.kind === "continuous"
        ? THRESHOLDS.continuousLivenessStaleMin
        : def.livenessStaleMin && isActiveMode(row.mode)
          ? def.livenessStaleMin
          : null;
  const graceMin =
    def.kind === "continuous"
      ? THRESHOLDS.continuousLivenessStaleMin
      : THRESHOLDS.livenessStartGraceMin;
  if (
    staleMin === null ||
    !livenessCheckable(now, graceMin, activeMinutesOf(def))
  ) {
    return [];
  }
  const last = row.last_tick_at ? new Date(row.last_tick_at) : null;
  if (!last || minutesBetween(now, last) >= staleMin) {
    return [
      {
        key: `liveness:${row.job}`,
        kind: "liveness",
        text: `起動の死活 ${row.job}: last_tick_at が${last ? `${Math.floor(minutesBetween(now, last))}分前（${toJstTimeString(last)}）` : "未記録"}。Cronの未配信か関数の障害の可能性`,
      },
    ];
  }
  return [];
}

/**
 * ジョブ自身が通知したい事項（last_report.alerts: [{key, text, until?}]。会場サイトの構造変化の疑い、期別成績の失敗率など）。
 * 状態が続く間は、同じ key で renotifyHours ごとに再通知される
 */
function jobReportAlerts(row, now) {
  /** @type {Alert[]} */
  const alerts = [];
  if (!Array.isArray(row.last_report?.alerts)) return alerts;
  for (const a of row.last_report.alerts) {
    if (typeof a?.key !== "string" || typeof a?.text !== "string") continue;
    // until（ISO）を過ぎた通知は出さない（月次の1回きりの事象が、last_report が残る間、再通知され続けないため）
    if (a.until && new Date(a.until) < now) continue;
    alerts.push({
      key: `report:${row.job}:${a.key}`,
      kind: "job_report",
      text: `${row.job}: ${a.text}`,
    });
  }
  return alerts;
}

/**
 * 日次ジョブ: 指定時刻から一定時間を過ぎても、その対象日を処理していない（liveのみ。shadowは記録しない）。
 * 起動する日が決まっているジョブ（月次: runDaysOfMonth）は、起動しない日の対象日を判定しない
 */
function dailyOverdueAlerts(row, def, now) {
  if (def.kind !== "daily" || row.mode !== "live") return [];
  const targetDate = resolveTargetDate(now, def.targetTimeJst);
  const targetInstant = new Date(`${targetDate}T${def.targetTimeJst}:00+09:00`);
  if (
    isScheduledDate(def, targetDate) &&
    minutesBetween(now, targetInstant) >= THRESHOLDS.dailyOverdueHours * 60 &&
    row.last_target_date !== targetDate
  ) {
    return [
      {
        key: `daily_overdue:${row.job}:${targetDate}`,
        kind: "daily_overdue",
        text: `日次ジョブが未処理 ${row.job}: 対象日 ${targetDate}（指定 ${def.targetTimeJst} JST から${THRESHOLDS.dailyOverdueHours}時間以上）。最終成功の対象日: ${row.last_target_date ?? "なし"}`,
      },
    ];
  }
  return [];
}

/**
 * 通知済みの記録を使って、再通知を抑える。
 * @param {Alert[]} alerts
 * @param {Record<string, string>} notified key → 通知した時刻（ISO）
 * @returns {{toSend: Alert[], notified: Record<string, string>}}
 */
export function applyDedupe(alerts, notified = {}, now = new Date()) {
  const next = {};
  const cutoff = now.getTime() - NOTIFIED_RETENTION_HOURS * 3600 * 1000;
  for (const [key, at] of Object.entries(notified)) {
    if (new Date(at).getTime() >= cutoff) next[key] = at;
  }
  const toSend = [];
  for (const alert of alerts) {
    const previous = next[alert.key];
    const once = ONCE_KEY_PREFIXES.some((p) => alert.key.startsWith(p));
    const renotifyAfterMs = THRESHOLDS.renotifyHours * 3600 * 1000;
    const suppressed =
      previous !== undefined &&
      (once || now.getTime() - new Date(previous).getTime() < renotifyAfterMs);
    if (suppressed) continue;
    toSend.push(alert);
    next[alert.key] = now.toISOString();
  }
  return { toSend, notified: next };
}
