/**
 * データ取得の監視（完了の定義C、plan.md §7）。予定表（scrape_slots）とジョブ状態（scrape_job_state）から、
 * 次を計測し、閾値超過をSlackに通知する。
 *
 *   expired     期限+許容幅を超えて未完了になったスロット（1件でも即時通知。ジョブ・レース・窓・最終エラー付き）
 *   未実行      attempts=0 のまま expired（Cronの未配信・tickの死活・claimの不具合の兆候）
 *   窓内取得率  ジョブ×窓ごとの、done かつ done_at が窓に入っている割合（98%未満。分母は確定中止を除く、liveのみ）。
 *               許容幅3分以下のジョブ（オッズ・レース情報）は「期限〜期限+3分」、それ以外（展示・結果・公式予想）は
 *               「期限〜期限+許容幅」で数える（展示は、旧定義（30・15・10分前の各±3分）との比較のため、
 *               旧定義の集計は別途、WS2の取得時刻列で行う。plan.md §3.1）
 *   遅延        done_at − 期限 の p50・p95（日次サマリー）
 *   想定内の未公開  朝の最初のレースの、発走60分前のオッズの未公開は、後の窓で公開が確認できたときだけ、警告・窓内取得率の
 *               対象外にする（件数は日次サマリーに別枠で出す。定義は expectedUnpublished.js。BOA-386）
 *   死活        ジョブごとの last_tick_at の鮮度（運用窓の中で10分以上更新なし）
 *   連続失敗・ブレーカー  consecutive_failures >= 3、breaker_open_until が未来
 *   日次の期限超過  日次ジョブが、指定時刻から3時間経っても、その日の対象日を処理していない
 *
 * 窓の外の補完のスロット（レジストリの catchupOffsets。展示の発走の10分後。BOA-382）は、取得済みのレースが
 * skipped_have_data で即完了するため、ほぼ全てヒットになり、窓内取得率（ジョブ別）を実際より高く見せてしまう。
 * ジョブ別の集計（aggregateByJob）には入れず、窓別の集計（computeWindowStats）にだけ残す。期限切れの通知は、
 * 補完の失敗（展示が最後まで取れなかった）を伝えるが、中止・順延の疑い（cancellation_status が入っている）のレースは通知しない
 *
 * 「予定表・ジョブ状態のテーブルが無い」（075未適用）、および全ジョブが off の間は、何も通知しない（誤報なし）。
 *
 * 純粋関数（evaluate*・compute*・format*・dedupe）と、IO（collectMonitorInput・postSlack・runMonitor）に分ける。
 */
import { SCRAPE_JOBS, isCatchupOffset, isScheduledDate } from "./registry.js";
import {
  jstMinutesOfDay,
  slotDeadline,
  slotWindowEnd,
  toJstDateString,
} from "./time.js";
import { resolveTargetDate } from "./dailyJob.js";
import { isScrapeSchemaMissingError } from "./schemaErrors.js";
import { EXPECTED_UNPUBLISHED, firstRaceIdSet } from "./expectedUnpublished.js";

export const THRESHOLDS = Object.freeze({
  /** 窓内取得率の閾値（欠落率2%以内。完了の定義B） */
  windowRate: 0.98,
  /** 窓内取得率の通知に必要な最小の母数（朝の少数のスロットで誤報しない） */
  windowRateMinSamples: 20,
  /** last_tick_at がこの分数以上更新されていなければ、死活の異常（5分に1回しか書かないため、書き込み2回分） */
  livenessStaleMin: 10,
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

/** 死活を判定してよい時刻か（運用窓の開始から livenessStartGraceMin 経過後〜23:59） */
export function livenessCheckable(now) {
  const m = jstMinutesOfDay(now);
  return (
    m >= OPERATING_START_MIN + THRESHOLDS.livenessStartGraceMin &&
    m < OPERATING_END_MIN
  );
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
export function deadlineOf(slot) {
  const race = slot.races;
  if (!race?.start_time || !slot.race_date) return null;
  return slotDeadline(slot.race_date, race.start_time, slot.offset_min);
}

const isCancelledRace = (slot) =>
  slot.outcome === "cancelled_race" ||
  slot.races?.cancellation_status === "confirmed";

const slotKey = (slot) => `${slot.job}:${slot.race_id}:${slot.offset_min}`;

/**
 * 期限+許容幅を超えたか（expired、または、claim されないまま pending・リース切れの running で超過）。
 * now が無ければ、expired のみを超過とする
 */
function isPastWindow(slot, now, registry = SCRAPE_JOBS) {
  if (slot.status === "expired") return true;
  if (!now) return false;
  const deadline = deadlineOf(slot);
  if (!deadline) return false;
  if (
    slot.status === "pending" ||
    (slot.status === "running" &&
      slot.lease_until &&
      new Date(slot.lease_until) < now)
  ) {
    const def = registry[slot.job];
    return (
      Boolean(def) &&
      now.getTime() > slotWindowEnd(deadline, def.graceMin).getTime()
    );
  }
  return false;
}

/**
 * 想定内の未公開（朝の最初のレースの、発走60分前のオッズの未公開。定義は expectedUnpublished.js）の判定。
 * 候補は、対象のスロット（ジョブ・窓・第1レース・結果 no_values・試行1回以上・期限+許容幅を超過・未完了）だけ。
 *
 *   confirmed  後続の窓（-30・-15…）のどれかが取れている（ok・skipped_have_data）＝後で公開された。警告・欠落に数えない
 *   deferred   まだ結論が出ていない（取れた後続の窓が無く、期限+許容幅に達していない後続の窓がある）。警告も欠落も保留する
 *   （どちらでもない候補、すなわち、後続の窓が全て過ぎても取れていない・後続の窓が無いものは、戻り値に含めず、従来どおり警告する）
 *
 * @param {Array<Object>} slots 候補を含みうるスロット（重複してよい）
 * @param {{firstRaceIds?: Set<string>, siblingSlots?: Array<Object>, now?: Date, registry?: typeof SCRAPE_JOBS}} [options]
 *   siblingSlots: 後続の窓のスロットを含むオッズのスロット（races を埋め込んだ行）
 * @returns {Map<string, "confirmed"|"deferred">} key は `${job}:${race_id}:${offset_min}`
 */
export function classifyExpectedUnpublished(
  slots,
  { firstRaceIds, siblingSlots = [], now, registry = SCRAPE_JOBS } = {},
) {
  /** @type {Map<string, "confirmed"|"deferred">} */
  const result = new Map();
  if (!firstRaceIds || firstRaceIds.size === 0) return result;
  const rule = EXPECTED_UNPUBLISHED;
  /** @type {Map<string, Array<Object>>} */
  const laterByRace = new Map();
  for (const s of siblingSlots) {
    if (s.job !== rule.job || s.offset_min <= rule.offsetMin) continue;
    if (s.run_mode === "shadow") continue;
    if (!laterByRace.has(s.race_id)) laterByRace.set(s.race_id, []);
    laterByRace.get(s.race_id).push(s);
  }
  for (const slot of slots) {
    if (
      slot.job !== rule.job ||
      slot.offset_min !== rule.offsetMin ||
      slot.outcome !== rule.outcome ||
      (slot.attempts ?? 0) === 0 ||
      slot.status === "done" ||
      slot.run_mode === "shadow" ||
      isCancelledRace(slot) ||
      !firstRaceIds.has(slot.race_id) ||
      !isPastWindow(slot, now, registry)
    ) {
      continue;
    }
    const later = laterByRace.get(slot.race_id) ?? [];
    if (later.length === 0) continue;
    if (
      later.some(
        (s) =>
          s.status === "done" && rule.confirmingOutcomes.includes(s.outcome),
      )
    ) {
      result.set(slotKey(slot), "confirmed");
    } else if (
      later.some((s) => s.status !== "done" && !isPastWindow(s, now, registry))
    ) {
      result.set(slotKey(slot), "deferred");
    }
  }
  return result;
}

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
    if (slot.status !== "done" && slot.status !== "expired") continue;
    if (isCancelledRace(slot)) continue;
    // 取得の対象外で終端したスロット（ピットレポートの最終日のG1 R7〜R11 等）は、窓内取得率の分母に入れない
    if (slot.outcome === "skipped_not_target") continue;
    if (slot.run_mode === "shadow") continue;
    // 一度も claim されず expired になったスロット（run_mode が無い）は、そのジョブが live のときだけ数える
    // （off・shadow のジョブの予定表の残りを、live の欠落として数えない）
    if (
      liveJobs &&
      slot.status === "expired" &&
      !slot.run_mode &&
      !liveJobs.has(slot.job)
    ) {
      continue;
    }
    const def = registry[slot.job];
    if (!def || def.kind !== "window") continue;
    const deadline = deadlineOf(slot);
    if (!deadline) continue;
    const key = `${slot.job}|${slot.offset_min}`;
    if (!groups.has(key)) {
      groups.set(key, {
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
      });
    }
    const g = groups.get(key);
    const unpublished = expectedUnpublished?.get(slotKey(slot));
    if (unpublished === "confirmed") {
      g.expectedUnpublished++;
      continue;
    }
    if (unpublished === "deferred") {
      g.deferred++;
      continue;
    }
    g.total++;
    if (slot.status === "expired") {
      g.expired++;
      if ((slot.attempts ?? 0) === 0) g.unexecuted++;
      continue;
    }
    if (!slot.done_at) continue;
    const doneAt = new Date(slot.done_at);
    const delayMin = minutesBetween(doneAt, deadline);
    g.delays.push(delayMin);
    if (delayMin >= 0 && delayMin <= 3) g.hitTolerance++;
    if (delayMin >= 0 && doneAt <= slotWindowEnd(deadline, g.graceMin))
      g.hitGrace++;
  }
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
 * ジョブごとに窓を束ねた窓内取得率。窓の外の補完のスロット（catchupOffsets）は束ねない（ファイル冒頭の説明）
 */
export function aggregateByJob(stats, registry = SCRAPE_JOBS) {
  const byJob = new Map();
  for (const s of stats) {
    if (isCatchupOffset(registry[s.job], s.offset_min)) continue;
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

/** @typedef {{key: string, kind: string, text: string}} Alert */

/**
 * expired・未実行（1スロットごと）。確定中止のレースは除く。
 *
 * expired は claim_scrape_slots（またはscrape-cleanup）が付けるため、ジョブのCronが止まった・ブレーカーで
 * claim しなかった間は、期限+許容幅を超えても pending のまま残る。監視が claim に依存して見逃さないよう、
 * pending・リース切れの running で期限+許容幅を超えたものも、同じキーで、expired と同じく通知する
 * （後で claim が expired にしても、同じキーのため再通知しない）。
 *
 * 想定内の未公開（朝の最初のレースの、発走60分前のオッズ。classifyExpectedUnpublished の結果 expectedUnpublished）は通知しない
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
    if (isCancelledRace(slot)) continue;
    if (slot.run_mode === "shadow") continue;
    if (activeJobs && !activeJobs.has(slot.job)) continue;
    // 窓の外の補完（発走の後）は、中止・順延の疑い（tentative。確定はここまでで除いた）のレースを通知しない。
    // 中止・順延のレースは、展示が公開されないため、補完が最後まで取れないのが正常
    if (
      isCatchupOffset(registry[slot.job], slot.offset_min) &&
      slot.races?.cancellation_status
    ) {
      continue;
    }
    const deadline = deadlineOf(slot);
    if (!isPastWindow(slot, now, registry)) continue;
    // 想定内の未公開（後続の窓で公開が確認できた・確認待ち）は通知しない。後続の窓も取れなかったものは、ここに来る
    if (expectedUnpublished?.has(slotKey(slot))) continue;
    const id = slotKey(slot);
    const when = deadline ? `期限 ${toJstTimeString(deadline)}` : "期限不明";
    const detail = slot.last_error ? ` / 最終エラー: ${slot.last_error}` : "";
    const pendingNote =
      slot.status === "expired" ? "" : "（まだexpired化されていない）";
    if ((slot.attempts ?? 0) === 0) {
      alerts.push({
        key: `unexecuted:${id}`,
        kind: "unexecuted",
        text: `未実行（attempts=0のまま期限+許容幅を超過${pendingNote}。Cronの未配信・tickの死活・claimの不具合・ブレーカーの兆候） ${id}（${when}）`,
      });
    } else {
      alerts.push({
        key: `expired:${id}`,
        kind: "expired",
        text: `expired（許容幅を超えて未完了${pendingNote}） ${id}（${when}、試行${slot.attempts}回、outcome=${slot.outcome ?? "なし"}）${detail}`,
      });
    }
  }
  return alerts;
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
      ? `、分母から除外: 未公開(想定内) ${j.expectedUnpublished}件`
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

/** 死活・連続失敗・ブレーカー・日次の期限超過 */
export function evaluateJobStates(jobStates, now, registry = SCRAPE_JOBS) {
  /** @type {Alert[]} */
  const alerts = [];
  for (const row of jobStates) {
    if (isHostRow(row)) {
      if (row.breaker_open_until && new Date(row.breaker_open_until) > now) {
        alerts.push({
          key: `breaker:${row.job}`,
          kind: "breaker",
          text: `サーキットブレーカーが開いています ${row.job}（${toJstTimeString(new Date(row.breaker_open_until))}まで。直近: ${row.last_error ?? "不明"}）`,
        });
      }
      continue;
    }
    const def = registry[row.job];
    if (!def) continue;
    // 監視・保守のジョブは mode のゲートを掛けない（常に有効）。それ以外は shadow・live のみ
    const active = def.kind === "monitor" || isActiveMode(row.mode);
    if (!active) continue;

    if ((row.consecutive_failures ?? 0) >= THRESHOLDS.consecutiveFailures) {
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

    // 死活: 毎分起動する窓型と、5分ごとの監視（自分自身の鮮度は、メタ監視が見る）
    if (def.kind === "window" && livenessCheckable(now)) {
      const last = row.last_tick_at ? new Date(row.last_tick_at) : null;
      if (!last || minutesBetween(now, last) >= THRESHOLDS.livenessStaleMin) {
        alerts.push({
          key: `liveness:${row.job}`,
          kind: "liveness",
          text: `起動の死活 ${row.job}: last_tick_at が${last ? `${Math.floor(minutesBetween(now, last))}分前（${toJstTimeString(last)}）` : "未記録"}。Cronの未配信か関数の障害の可能性`,
        });
      }
    }

    // ジョブ自身が通知したい事項（last_report.alerts: [{key, text, until?}]。会場サイトの構造変化の疑い、期別成績の失敗率など）。
    // 状態が続く間は、同じ key で renotifyHours ごとに再通知される
    if (Array.isArray(row.last_report?.alerts)) {
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
    }

    // 日次ジョブ: 指定時刻から一定時間を過ぎても、その対象日を処理していない（liveのみ。shadowは記録しない）。
    // 起動する日が決まっているジョブ（月次: runDaysOfMonth）は、起動しない日の対象日を判定しない
    if (def.kind === "daily" && row.mode === "live") {
      const targetDate = resolveTargetDate(now, def.targetTimeJst);
      const targetInstant = new Date(
        `${targetDate}T${def.targetTimeJst}:00+09:00`,
      );
      if (
        isScheduledDate(def, targetDate) &&
        minutesBetween(now, targetInstant) >=
          THRESHOLDS.dailyOverdueHours * 60 &&
        row.last_target_date !== targetDate
      ) {
        alerts.push({
          key: `daily_overdue:${row.job}:${targetDate}`,
          kind: "daily_overdue",
          text: `日次ジョブが未処理 ${row.job}: 対象日 ${targetDate}（指定 ${def.targetTimeJst} JST から${THRESHOLDS.dailyOverdueHours}時間以上）。最終成功の対象日: ${row.last_target_date ?? "なし"}`,
        });
      }
    }
  }
  return alerts;
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

function toJstTimeString(date) {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${j.toISOString().slice(5, 10)} ${j.toISOString().slice(11, 16)}`;
}

/** Slackのブロックの本文の上限（3000字）に対する、本文の予算 */
const SLACK_TEXT_BUDGET = 2800;

/**
 * アラートのSlackメッセージ（Incoming Webhook。絵文字は使わない）。
 * 本文が予算を超える場合は、入り切る分だけ載せ、残りは「ほかN件（次回の実行で通知）」とする。
 * 載せなかったアラートは、通知済みとして記録してはならない（呼び出し側が includedCount で判断する）
 *
 * @returns {{message: Object, includedCount: number}}
 */
export function formatAlertMessage(
  alerts,
  now,
  { budget = SLACK_TEXT_BUDGET } = {},
) {
  const head = `*データ取得の監視: ${alerts.length}件の異常*（${toJstTimeString(now)} JST）`;
  const lines = [];
  let used = head.length;
  for (const a of alerts) {
    const line = `・${a.text.length > 400 ? `${a.text.slice(0, 399)}…` : a.text}`;
    // 「ほかN件」の行の分（最大約40字）を残す
    if (used + line.length + 1 + 40 > budget && lines.length < alerts.length) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const rest = alerts.length - lines.length;
  const body = [
    head,
    ...lines,
    ...(rest > 0 ? [`…ほか${rest}件（次回の実行で通知します）`] : []),
  ].join("\n");
  return {
    includedCount: lines.length,
    message: {
      text: `[データ取得の監視] ${alerts.length}件の異常（${toJstTimeString(now)} JST）`,
      attachments: [
        {
          color: "#c9a227",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: body } }],
        },
      ],
    },
  };
}

/** 日次サマリーのSlackメッセージ */
export function formatDailySummary({
  date,
  stats7d,
  statsDay,
  jobStates,
  now,
}) {
  const pct = (r) => (r === null ? "-" : `${(r * 100).toFixed(1)}%`);
  const min = (v) => (v === null ? "-" : v.toFixed(1));
  const day = new Map(aggregateByJob(statsDay).map((j) => [j.job, j]));
  const week = aggregateByJob(stats7d);
  const p95 = new Map();
  for (const s of stats7d) {
    const cur = p95.get(s.job);
    if (s.delayP95Min !== null && (cur === undefined || s.delayP95Min > cur)) {
      p95.set(s.job, s.delayP95Min);
    }
  }
  const rows = week.map((w) => {
    const d = day.get(w.job);
    // 想定内の未公開（分母から除外した件数）: 対象のジョブ（odds）は0件でも出す。他のジョブは、あるときだけ出す
    const unpublished =
      w.job === EXPECTED_UNPUBLISHED.job ||
      w.expectedUnpublished > 0 ||
      (d?.expectedUnpublished ?? 0) > 0
        ? ` / 未公開(想定内・分母から除外) 前日 ${d?.expectedUnpublished ?? 0}件・直近7日 ${w.expectedUnpublished}件`
        : "";
    const deferred =
      w.deferred > 0 || (d?.deferred ?? 0) > 0
        ? ` / 判定保留 前日 ${d?.deferred ?? 0}件・直近7日 ${w.deferred}件`
        : "";
    return `${w.job}: 前日 ${pct(d?.rate ?? null)}（${d?.hit ?? 0}/${d?.total ?? 0}） / 直近7日 ${pct(w.rate)}（${w.hit}/${w.total}） / expired ${w.expired}件 / 未実行 ${w.unexecuted}件${unpublished}${deferred} / 遅延p95 ${min(p95.get(w.job) ?? null)}分`;
  });
  // レジストリにある取得ジョブだけ（疑似の行 predict-code-hash 等は、モードの一覧に出さない）
  const modes = jobStates
    .filter((r) => !isHostRow(r) && SCRAPE_JOBS[r.job])
    .map((r) => `${r.job}=${r.mode}`)
    .join(" / ");
  return {
    text: `[データ取得の日次サマリー] ${date}`,
    attachments: [
      {
        color: "#2eb67d",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*データ取得の日次サマリー ${date}*（窓内取得率の閾値 ${THRESHOLDS.windowRate * 100}%）\n${rows.join("\n") || "（集計対象のスロットなし）"}\nモード: ${modes || "なし"}`.slice(
                0,
                2900,
              ),
            },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

const SLOT_COLUMNS =
  "job,race_id,offset_min,race_date,status,attempts,outcome,run_mode,done_at,last_error,races(start_time,cancellation_status)";
const PAGE = 1000;

/** ページ単位で全件を読む（Supabaseの既定の上限1000行）。エラーは例外にする（空＝正常と誤判定しない） */
async function fetchPaged(buildQuery, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) {
      const e = new Error(`${what}の読み取りに失敗しました: ${error.message}`);
      e.cause = error;
      throw e;
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const daysAgo = (now, days) =>
  toJstDateString(new Date(now.getTime() - days * 24 * 3600 * 1000));

/**
 * 監視に必要なデータを読む（読み取りのみ）。
 * level: "tick"（5分ごと。ジョブ状態・expired・当日のスロット）、"daily"（+直近7日。日次サマリー用）
 */
export async function collectMonitorInput(client, now, level) {
  const stateRes = await client.from("scrape_job_state").select("*");
  if (stateRes.error) {
    if (isScrapeSchemaMissingError(stateRes.error)) return { available: false };
    throw new Error(
      `ジョブ状態の読み取りに失敗しました: ${stateRes.error.message}`,
    );
  }
  const today = toJstDateString(now);
  const yesterday = daysAgo(now, 1);
  const slotQuery = (build) => () =>
    build(client.from("scrape_slots").select(SLOT_COLUMNS))
      .order("race_date")
      .order("job")
      .order("race_id")
      .order("offset_min");

  const expiredSlots = await fetchPaged(
    slotQuery((q) => q.eq("status", "expired").gte("race_date", yesterday)),
    "expiredのスロット",
  );
  const todaySlots = await fetchPaged(
    slotQuery((q) => q.eq("race_date", today)),
    "当日のスロット",
  );
  // 期限+許容幅を超えても、claim されず expired になっていないスロットの検知用
  const openSlots = await fetchPaged(
    slotQuery((q) =>
      q.in("status", ["pending", "running"]).gte("race_date", yesterday),
    ),
    "未完了のスロット",
  );
  const racesRes = await client
    .from("races")
    .select("race_id", { count: "exact", head: true })
    .eq("race_date", today);
  if (racesRes.error) {
    throw new Error(
      `当日のracesの件数の取得に失敗しました: ${racesRes.error.message}`,
    );
  }
  let weekSlots = null;
  if (level !== "tick") {
    weekSlots = await fetchPaged(
      slotQuery((q) =>
        q.in("status", ["done", "expired"]).gte("race_date", daysAgo(now, 6)),
      ),
      "直近7日のスロット",
    );
  }
  // 想定内の未公開（expectedUnpublished.js）の判定に要る、第1レースの一覧と、オッズの後続の窓のスロット。
  // 候補（オッズの -60 窓が no_values で未完了）が1件も無いときは、読まない（5分ごとの実行の読み取りを増やさない）
  const rule = EXPECTED_UNPUBLISHED;
  const hasCandidate = [
    ...expiredSlots,
    ...openSlots,
    ...todaySlots,
    ...(weekSlots ?? []),
  ].some(
    (s) =>
      s.job === rule.job &&
      s.offset_min === rule.offsetMin &&
      s.outcome === rule.outcome &&
      s.status !== "done",
  );
  let firstRaceIds = new Set();
  let oddsSlots = [];
  if (hasCandidate) {
    const from = level === "tick" ? yesterday : daysAgo(now, 6);
    firstRaceIds = firstRaceIdSet(
      await fetchPaged(
        () =>
          client
            .from("races")
            .select("race_id,race_date,venue_code,race_number")
            .gte("race_date", from)
            .order("race_id"),
        "第1レースの判定に使うraces",
      ),
    );
    oddsSlots = await fetchPaged(
      slotQuery((q) => q.eq("job", rule.job).gte("race_date", from)),
      "オッズのスロット（後続の窓の確認用）",
    );
  }
  return {
    available: true,
    jobStates: stateRes.data,
    expiredSlots,
    openSlots,
    todayRaceCount: racesRes.count ?? 0,
    todaySlots,
    weekSlots,
    firstRaceIds,
    oddsSlots,
  };
}

/** Slack Incoming Webhook へ投稿する。失敗は例外にする（通知できなかったことを、実行の失敗として残す） */
export async function postSlack(webhookUrl, payload, fetchImpl = fetch) {
  const res = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Slackへの通知に失敗しました: HTTP ${res.status}`);
  }
}

/**
 * scrape-monitor の本体（共通ラッパの run(ctx)）。
 * ctx.client: Supabase、ctx.query.mode: "daily" なら日次サマリー、ctx.state: 前回のジョブ状態（通知済みの記録）
 */
export async function runMonitor(
  ctx,
  { env = process.env, fetchImpl = fetch, collect = collectMonitorInput } = {},
) {
  const now = ctx.now();
  const isDaily = ctx.query?.mode === "daily";
  const level = isDaily ? "daily" : "tick";
  const input = await collect(ctx.client, now, level);
  if (!input.available) {
    return { rowsWritten: 0, body: { skipped: "scrape_schema_not_applied" } };
  }

  const activeJobs = input.jobStates.filter(
    (r) =>
      !isHostRow(r) &&
      SCRAPE_JOBS[r.job]?.kind !== "monitor" &&
      isActiveMode(r.mode),
  );
  const activeJobNames = new Set(activeJobs.map((r) => r.job));
  const liveJobs = new Set(
    input.jobStates.filter((r) => r.mode === "live").map((r) => r.job),
  );
  // 想定内の未公開（朝の最初のレースの、発走60分前のオッズ）。警告・窓内取得率・日次サマリーで同じ判定を共有する
  const expectedUnpublished = classifyExpectedUnpublished(
    [
      ...input.expiredSlots,
      ...(input.openSlots ?? []),
      ...input.todaySlots,
      ...(input.weekSlots ?? []),
    ],
    {
      firstRaceIds: input.firstRaceIds,
      siblingSlots: input.oddsSlots ?? [],
      now,
    },
  );
  const todayStats = computeWindowStats(input.todaySlots, SCRAPE_JOBS, {
    liveJobs,
    expectedUnpublished,
  });
  const alerts = [
    ...evaluateExpired([...input.expiredSlots, ...(input.openSlots ?? [])], {
      activeJobs: activeJobNames,
      now,
      expectedUnpublished,
    }),
    ...evaluateWindowRates(todayStats, toJstDateString(now)),
    ...evaluateJobStates(input.jobStates, now),
    ...(input.todayRaceCount === undefined
      ? []
      : evaluateRacesPresent({
          jobStates: input.jobStates,
          todayRaceCount: input.todayRaceCount,
          now,
        })),
  ];

  const previous = ctx.state?.last_report?.notified ?? {};
  const { toSend, notified } = applyDedupe(alerts, previous, now);

  const webhook = env.SLACK_WEBHOOK_URL;
  const messages = [];
  // 載せきれなかったアラートは、通知済みとして記録しない（次の実行で通知する）
  let notifiedFinal = notified;
  if (toSend.length > 0) {
    const { message, includedCount } = formatAlertMessage(toSend, now);
    messages.push(message);
    if (includedCount < toSend.length) {
      notifiedFinal = { ...notified };
      for (const alert of toSend.slice(includedCount)) {
        if (previous[alert.key] === undefined) delete notifiedFinal[alert.key];
        else notifiedFinal[alert.key] = previous[alert.key];
      }
    }
  }
  // 日次サマリー: 取得ジョブが1つも有効でない間（移行前）は、投稿しない
  if (isDaily && activeJobs.length > 0) {
    const summaryDate = toJstDateString(new Date(now.getTime() - 3600 * 1000));
    messages.push(
      formatDailySummary({
        date: summaryDate,
        stats7d: computeWindowStats(input.weekSlots ?? [], SCRAPE_JOBS, {
          liveJobs,
          expectedUnpublished,
        }),
        statsDay: computeWindowStats(
          (input.weekSlots ?? []).filter((s) => s.race_date === summaryDate),
          SCRAPE_JOBS,
          { liveJobs, expectedUnpublished },
        ),
        jobStates: input.jobStates,
        now,
      }),
    );
  }

  let sent = 0;
  if (messages.length > 0) {
    if (!webhook) {
      // 通知先が無いことを、成功に見せない（異常があるのに通知できない）。通知済みの記録は更新しない
      throw new Error(
        `SLACK_WEBHOOK_URL が設定されていないため、${toSend.length}件の異常を通知できません（Vercelの環境変数に設定してください）`,
      );
    }
    for (const message of messages) {
      await postSlack(webhook, message, fetchImpl);
      sent++;
    }
  }

  return {
    rowsWritten: 0,
    // 通知に成功した場合のみ、通知済みの記録を進める（失敗した通知は、次の実行で再送される）
    report: {
      notified: notifiedFinal,
      lastLevel: level,
      lastRunAt: now.toISOString(),
    },
    body: {
      level,
      activeJobs: activeJobs.length,
      alerts: alerts.length,
      sent,
      slackConfigured: Boolean(webhook),
    },
  };
}
