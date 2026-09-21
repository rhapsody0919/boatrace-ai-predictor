/**
 * 日次の照合（N29、daily_reconcile）の共通ラッパ向けハンドラー（tasks.md T4b-21）。
 * api/cron/daily-reconcile.js が createScrapeCronHandler の run に渡す。
 *
 * 完了の定義Cの「独立した突合先」: 前日（D）の結果・払戻・着順・進入を、DB（races・race_results・race_payouts）と、
 * 公式のKファイル（競走成績。別ドメイン www1.mbrace.or.jp。LZH）で突き合わせ、不一致を last_report と alerts に出す。
 * 新しい取得先・新しいテーブルは作らない（当初案の resultlist・pay の新規パーサーは、独立レビューで「新規パーサーが最重で、
 * pay は日付指定が未確認」と指摘され、既存の Kファイルの突合に変更した）。突合の本体は scripts/lib/dailyReconcile.js。
 *
 * 書き込みは無い（読み取りと、scrape_job_state への実行記録のみ）。shadow と live の違いは、
 *   shadow  通知（last_report.alerts）を出さない（would_alert に記録する）。対象日を処理済みにしない
 *   live    通知を出す。対象日を処理済みにする
 *
 * 対象日: 共通ラッパが「07:50 JST の指定時刻」から解決した日付（ctx.targetDate）の前日。cron は 08:00・12:30・17:30 JST。
 * Kファイル同期（kfile_sync。07:00・12:00 JST）の後に、その同期の結果（rank4〜6・進入）まで含めて照合する。
 *
 * 分類（不一致に混ぜない）:
 *   照合不能   Kが未取得（404）・会場が未展開（プレースホルダ）・Kに会場が無い。別に数える
 *   除外       確定中止（races.cancellation_status='confirmed'）。除外した件数を報告する
 *   同期待ち   rank4〜6・進入が全て NULL（Kファイル同期の前）。最後の照合（17:30 JST）までは不一致に数えない
 *
 * 再照合（incomplete）: 最後の照合より前に、照合不能・同期待ちが残るときは、対象日を処理済みにせず、次の起動がもう一度処理する。
 * 最後の照合では、同期待ちを不一致に数え、照合不能は通知して、対象日を処理済みにする（翌日以降は再照合しない）。
 *
 * Kファイルの共有: ダウンロードは、kfile_sync（進入コース・rank4〜6の同期で、未同期のレースがある日のみ）とは別の
 * 呼び出しのため、同じ日のKファイルを1日に1回、追加でダウンロードする（www1.mbrace.or.jp への1リクエスト/日）。
 * 関数の呼び出しをまたいで共有する手段（保管先）が無く、kfile_sync に保管を足すと、live 並走中のジョブを変えることになる。
 * kfile_sync は、未同期のレースが無い日はダウンロードしないため、これが「同期が空振りの日も、照合は必ず動く」独立性にもなる。
 */
import { fetchAll } from "./supabaseClient.js";
import { fetchKFileText } from "./kfileParser.js";
import { reconcileDay, parseKDay } from "./dailyReconcile.js";
import { jstMinutesOfDay } from "./scrapeJobs/time.js";

/** この時刻（JST、分）以降の起動は、最後の照合（cron の 17:30） */
export const FINAL_ATTEMPT_MINUTES_OF_DAY = 17 * 60;

/** 不一致のレースが、この件数以上ならば通知する（1件でも、独立した突合先との食い違いは調査に値する） */
export const MISMATCH_ALERT_MIN_RACES = 1;

/** 通知は1回きり（last_report にこの分だけ残す。monitor は5分ごとに評価し、同じキーは6時間再通知しない） */
const ONE_SHOT_ALERT_MINUTES = 30;

/** last_report に残す日次の履歴の日数 */
export const HISTORY_DAYS = 14;

export const RESULT_COLUMNS = [
  "race_id",
  "rank1",
  "rank2",
  "rank3",
  "rank4",
  "rank5",
  "rank6",
  "payout_win",
  "payout_place_1",
  "payout_place_2",
  "payout_trifecta",
  "payout_trio",
  "payout_exacta",
  "payout_quinella",
  "payout_wide_1",
  "payout_wide_2",
  "payout_wide_3",
  "actual_course_1",
  "actual_course_2",
  "actual_course_3",
  "actual_course_4",
  "actual_course_5",
  "actual_course_6",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD に日数を足す（暦日。実行環境のタイムゾーンに依存しない） */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 照合に使うDBの行（読み取りのみ）。読み取りに失敗したら例外（空＝正常と誤判定しない）。
 * race_payouts（マイグレーション079）が無いDBでは、払戻明細の突合を省く。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} date
 */
export async function loadReconcileInputs(client, date) {
  const races = await fetchAll(
    "races",
    "race_id, venue_code, cancellation_status",
    (q) => q.eq("race_date", date).order("race_id"),
    { throwOnError: true, client },
  );
  const results = await fetchAll(
    "race_results",
    RESULT_COLUMNS.join(","),
    (q) => q.like("race_id", `${date}-%`).order("race_id"),
    { throwOnError: true, client },
  );
  let payouts = [];
  let payoutsAvailable = true;
  try {
    payouts = await fetchAll(
      "race_payouts",
      "race_id, bet_type, seq, combination, payout, payout_status",
      (q) =>
        q
          .like("race_id", `${date}-%`)
          .order("race_id")
          .order("bet_type")
          .order("seq"),
      { throwOnError: true, client },
    );
  } catch (error) {
    if (!/Could not find the table|does not exist/i.test(error.message)) {
      throw error;
    }
    payoutsAvailable = false;
  }
  return { races, results, payouts, payoutsAvailable };
}

/** 一件の不一致の、通知用の短い表記 */
function formatMismatch(m) {
  const show = (v) => (Array.isArray(v) ? `[${v.join(",")}]` : String(v));
  return `${m.race_id} ${m.kind}${m.field && m.field !== "rank" ? `(${m.field})` : ""} DB=${show(m.db)} K=${show(m.k)}`;
}

/**
 * 通知を作る（純関数）。
 *
 * @param {ReturnType<typeof reconcileDay>} result
 * @param {{final: boolean, now: Date}} options
 */
export function buildReconcileAlerts(result, { final, now }) {
  const until = new Date(now.getTime() + ONE_SHOT_ALERT_MINUTES * 60 * 1000);
  const alerts = [];
  if (result.mismatchRaces >= MISMATCH_ALERT_MIN_RACES) {
    const kinds = Object.entries(result.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind}×${n}`)
      .join(", ");
    const examples = result.mismatches.slice(0, 3).map(formatMismatch);
    alerts.push({
      key: `reconcile:${result.date}`,
      text: `日次照合: ${result.date} のDBとKファイルの不一致 ${result.mismatchRaces}レース（照合${result.compared}レース中。内訳: ${kinds}）。例: ${examples.join(" / ")}`,
      until: until.toISOString(),
    });
  }
  if (final && result.unverifiable.total > 0) {
    alerts.push({
      key: `reconcile_unverifiable:${result.date}`,
      text: `日次照合: ${result.date} の照合不能 ${result.unverifiable.total}レース（Kが会場未展開 ${result.unverifiable.kVenuePending}・Kに会場なし ${result.unverifiable.kVenueAbsent}。未展開の会場: ${result.kVenuesPending.join(",") || "なし"}）`,
      until: until.toISOString(),
    });
  }
  return alerts;
}

/** 日次の履歴（直近 HISTORY_DAYS 日）に、この日の要約を入れる（同じ日は置き換える） */
export function updateHistory(previous, entry) {
  return [...(previous ?? []).filter((h) => h.date !== entry.date), entry]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-HISTORY_DAYS);
}

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx。targetDate は日次ジョブで解決済み）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runDailyReconcileJob(
  ctx,
  { fetchText = fetchKFileText, load = loadReconcileInputs } = {},
) {
  const base = ctx.targetDate;
  if (!base || !DATE_RE.test(base)) {
    throw new Error(`対象日を解決できません: ${String(base)}`);
  }
  const date = addDays(base, -1);
  const now = ctx.now();
  const final = jstMinutesOfDay(now) >= FINAL_ATTEMPT_MINUTES_OF_DAY;
  const live = ctx.mode === "live";
  const previous = ctx.state?.last_report ?? null;
  const history = previous?.history ?? [];
  const head = { date, base, mode: ctx.mode, final };

  const inputs = await load(ctx.client, date);
  const candidates = inputs.races.filter(
    (r) => r.cancellation_status !== "confirmed",
  );
  if (inputs.races.length === 0) {
    // その日にレースが無い（全会場の休催）。照合するものが無い
    return {
      rowsWritten: 0,
      report: { ...head, kStatus: "not_needed", racesInDb: 0, history },
      body: { date, racesInDb: 0 },
    };
  }

  // 1) Kファイル（404 = 未公開。会場ごとの未展開は、parseKDay が pending として返す）
  const text = await fetchText(date, { fetchImpl: ctx.politeFetch });
  const kDay = text === null ? null : parseKDay(text, date);
  if (kDay === null || (kDay.facts.size === 0 && kDay.pendingVenues.size > 0)) {
    const kStatus = kDay === null ? "unpublished" : "all_venues_pending";
    const result = reconcileDay({
      date,
      kDay: kDay ?? {
        facts: new Map(),
        completeVenues: new Set(),
        pendingVenues: new Set(),
      },
      races: inputs.races,
      results: inputs.results,
      payouts: inputs.payouts,
      final,
    });
    const alerts = buildReconcileAlerts(result, { final, now });
    return {
      rowsWritten: 0,
      // 最後の照合まで、対象日を処理済みにせず、次の起動がもう一度処理する
      incomplete: !final,
      report: {
        ...head,
        kStatus,
        summary: summaryOf(result),
        history: final ? updateHistory(history, historyEntry(result)) : history,
        alerts: live ? alerts : [],
        wouldAlert: live ? undefined : alerts,
      },
      body: { date, kStatus, incomplete: !final },
    };
  }

  // 0件エラー: 照合するレースがあるのに、Kファイルからレースを1件も抽出できない（構造の変化）は、共通ラッパが失敗にする
  const rowsExpected = candidates.length;
  const rowsParsed = kDay.facts.size;

  const result = reconcileDay({
    date,
    kDay,
    races: inputs.races,
    results: inputs.results,
    payouts: inputs.payoutsAvailable ? inputs.payouts : [],
    final,
  });
  const alerts = buildReconcileAlerts(result, { final, now });
  const incomplete =
    !final && (result.unverifiable.total > 0 || result.syncPending.races > 0);
  return {
    rowsWritten: 0,
    rowsExpected,
    rowsParsed,
    incomplete,
    report: {
      ...head,
      kStatus: "ok",
      payoutTable: inputs.payoutsAvailable ? "checked" : "unavailable",
      summary: summaryOf(result),
      mismatches: result.mismatches,
      history: incomplete
        ? history
        : updateHistory(history, historyEntry(result)),
      alerts: live ? alerts : [],
      wouldAlert: live ? undefined : alerts,
    },
    body: {
      date,
      final,
      incomplete,
      compared: result.compared,
      matched: result.matched,
      mismatchRaces: result.mismatchRaces,
      unverifiable: result.unverifiable.total,
      syncPending: result.syncPending.races,
      excludedCancelled: result.excludedCancelled,
      alerts: alerts.length,
    },
  };
}

/** last_report に残す要約（不一致の明細は別に持つ） */
function summaryOf(result) {
  const { mismatches: _mismatches, ...summary } = result;
  return summary;
}

/** 日次の履歴の1件（継続監視・データ健全性レポートが読む） */
function historyEntry(result) {
  return {
    date: result.date,
    racesInDb: result.racesInDb,
    excluded: result.excludedCancelled,
    compared: result.compared,
    matched: result.matched,
    mismatchRaces: result.mismatchRaces,
    unverifiable: result.unverifiable.total,
    syncPending: result.syncPending.races,
  };
}
