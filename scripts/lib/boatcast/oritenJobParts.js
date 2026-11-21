/**
 * BOATCASTのオリジナル展示ジョブ（oritenJob.js）から分けた部品（リファクタ。振る舞いは変えない）。
 * - buildOritenWarnings: 公開マップとの照合の通知文（純関数）
 * - deleteStaleValues: 新しい内容に無い値の行を消す（DB）
 * - tick（起動ごとの通知の材料）と mergeReport（last_report の更新内容。純関数）
 * - 予定表（createOritenStore.ensureSlots）の入力の読み取りと、スロットの追加（DB）・通知の記録（DB）
 * oritenJob.js を import しない（循環させない）。oritenJob.js が tick・mergeReport を再公開する。
 */
import { compareLabelsToMap } from "./oritenRows.js";
import { addSeconds } from "../scrapeJobs/time.js";

/** 通知の持続時間 */
const CANARY_ALERT_MIN = 60;
const ANOMALY_ALERT_HOURS = 6;
const VENUE_ALERT_HOURS = 12;

/**
 * 公開マップとの照合（位置ではなくラベル）。既知でないラベル・マップと違う項目名の通知文を返す（純関数）。
 */
export function buildOritenWarnings({ jo, entry, raceId, parsed }) {
  const cmp = compareLabelsToMap(parsed.labels, entry.items);
  const warnings = [];
  if (parsed.unknownLabels.length > 0) {
    warnings.push(
      `${jo}${entry.name} ${raceId}: 未知の項目名 ${parsed.unknownLabels.join(",")}`,
    );
  }
  if (cmp.unexpected.length > 0 || cmp.missing.length > 0) {
    warnings.push(
      `${jo}${entry.name} ${raceId}: 公開マップと項目名が違います（マップに無い: ${cmp.unexpected.join(",") || "なし"} / ファイルに無い: ${cmp.missing.join(",") || "なし"}）`,
    );
  }
  return warnings;
}

/** 新しい内容に無い（艇, 項目）の既存行を消す。失敗なら、エラーメッセージ */
export async function deleteStaleValues(client, raceId, newValues) {
  const { data, error } = await client
    .from("race_original_exhibition_values")
    .select("boat_number, kind")
    .eq("race_id", raceId);
  if (error) return `既存の値の読み取りに失敗しました: ${error.message}`;
  const keep = new Set(newValues.map((v) => `${v.boat_number}|${v.kind}`));
  for (const row of data ?? []) {
    if (keep.has(`${row.boat_number}|${row.kind}`)) continue;
    const { error: deleteError } = await client
      .from("race_original_exhibition_values")
      .delete()
      .eq("race_id", raceId)
      .eq("boat_number", row.boat_number)
      .eq("kind", row.kind);
    if (deleteError) {
      return `古い値の削除に失敗しました: ${deleteError.message}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// tick（1回の起動）ごとの通知の材料。ハンドラー（スロットごと）と、ストア（起動の終わりの記録）が共有する。
// 起動ごとに一意な ctx.worker（cronWrapper の defaultWorker）を鍵にする（関数インスタンスが複数の起動を並行して
// 処理しても、混ざらない）。
// ---------------------------------------------------------------------------
/** @type {Map<string, ReturnType<typeof newTick>>} */
const ticks = new Map();
const TICK_RETENTION_MS = 10 * 60 * 1000;

function newTick(worker, nowMs) {
  return {
    worker,
    startedMs: nowMs,
    canary: null,
    canaryPromise: null,
    anomalies: [],
    warnings: [],
    venueAlerts: [],
  };
}

/** 起動の通知の材料を、無ければ作る。古いものは捨てる */
export function tickOf(worker, nowMs = Date.now()) {
  for (const [key, t] of ticks) {
    if (nowMs - t.startedMs > TICK_RETENTION_MS) ticks.delete(key);
  }
  let t = ticks.get(worker);
  if (!t) {
    t = newTick(worker, nowMs);
    ticks.set(worker, t);
  }
  return t;
}

/** 起動の通知の材料を取り出して、消す */
export function takeTick(worker) {
  const t = ticks.get(worker);
  ticks.delete(worker);
  return t ?? null;
}

/** テスト用 */
export function clearTicks() {
  ticks.clear();
}

const iso = (date) => date.toISOString();

/**
 * scrape_job_state.last_report（monitor が alerts を Slack に通知する）の更新内容を作る（純関数）。
 * 前回の通知のうち有効期限（until）内のものは残し、canary が正常なら canary_failed を外す。変化が無ければ undefined
 * （書かない）。
 *
 * @param {{alerts?: Array<{key: string, text: string, until?: string}>}|null|undefined} previous
 * @param {ReturnType<typeof newTick>} tick
 * @param {Date} now
 */
export function mergeReport(previous, tick, now) {
  const prevAlerts = Array.isArray(previous?.alerts) ? previous.alerts : [];
  let alerts = prevAlerts.filter(
    (a) => a?.until && new Date(a.until).getTime() > now.getTime(),
  );
  const drop = (key) => {
    alerts = alerts.filter((a) => a.key !== key);
  };
  const put = (alert) => {
    drop(alert.key);
    alerts.push(alert);
  };

  if (tick.canary) {
    if (tick.canary.ok) {
      drop("canary_failed");
    } else {
      put({
        key: "canary_failed",
        text: `BOATCASTのカナリアが失敗しました（アクセス拒否・接続の異常の疑い。取得を止めています）: ${tick.canary.detail}`,
        until: iso(addSeconds(now, CANARY_ALERT_MIN * 60)),
      });
    }
  }
  const anomalyCount = tick.anomalies.length + tick.warnings.length;
  if (anomalyCount > 0) {
    const example = tick.anomalies[0] ?? tick.warnings[0];
    put({
      key: "parse_anomaly",
      text: `解析の異常 ${anomalyCount}件（構造の異常${tick.anomalies.length}件・項目名の不一致${tick.warnings.length}件。BOATCAST側の形式変更・公開マップの古さの疑い）: ${example}`,
      until: iso(addSeconds(now, ANOMALY_ALERT_HOURS * 3600)),
    });
  }
  for (const alert of tick.venueAlerts) {
    put({ ...alert, until: iso(addSeconds(now, VENUE_ALERT_HOURS * 3600)) });
  }

  const next = { alerts };
  const before = { alerts: prevAlerts };
  if (JSON.stringify(next) === JSON.stringify(before)) return undefined;
  return next;
}

/** 予定表の対象日の races と、既にこのジョブのスロットがあるレースの集合を読む。DBエラーは例外 */
export async function loadSlotInputs(client, job, date) {
  const { data, error } = await client
    .from("races")
    .select("race_id, race_date, start_time")
    .eq("race_date", date)
    .not("start_time", "is", null);
  if (error) {
    throw new Error(`予定表の対象レースの取得に失敗しました: ${error.message}`);
  }
  // 既にこのジョブのスロットがあるレース（offset を変えた日の旧 offset のスロットを含む）には作らない。
  // 1レース1本の再試行の列にして、窓の取得を二重にしない（offsets が1つの前提。verify-boatcast-job.js が固定する）
  const { data: existing, error: existingError } = await client
    .from("scrape_slots")
    .select("race_id")
    .eq("job", job)
    .eq("race_date", date);
  if (existingError) {
    throw new Error(
      `予定表の既存スロットの取得に失敗しました: ${existingError.message}`,
    );
  }
  const hasSlot = new Set((existing ?? []).map((s) => s.race_id));
  return { data, hasSlot };
}

/** スロットを追加し、追加できた件数を返す。DBエラーは例外 */
export async function insertSlots(client, rows) {
  const { data: inserted, error: insertError } = await client
    .from("scrape_slots")
    .upsert(rows, {
      onConflict: "job,race_id,offset_min",
      ignoreDuplicates: true,
    })
    .select("race_id");
  if (insertError) {
    throw new Error(`予定表の生成に失敗しました: ${insertError.message}`);
  }
  return inserted?.length ?? 0;
}

/** last_report だけを書き込む（失敗は警告にとどめる） */
export async function saveLastReport(client, job, report) {
  const { error } = await client
    .from("scrape_job_state")
    .update({ last_report: report })
    .eq("job", job);
  if (error) {
    console.warn(`⚠️ ${job}: 通知の記録に失敗: ${error.message}`);
  }
}
