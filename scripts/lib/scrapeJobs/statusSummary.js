/**
 * scrape-monitor の結果を、鍵なし・集計だけで読める形にする（BOA-1480、ZB15 票4）。
 * api/scrape-status/summary.js（GET の読み取り専用の面）が使う。hq の dashboard-alerts（scrape_watch）が
 * 「ジョブの last_tick_at が10分以上古い」を窓口に知らせるための入力。
 *
 * 返すのは集計だけ: 今日の JST の日付・races の件数・ジョブごとの last_tick_at と mode・開いている expired の件数・
 * scrape-monitor 自身の last_run。選手・オッズ・last_error の本文・鍵・URL は含めない（last_error は有無だけ）。
 */
import { toJstDateString } from "./time.js";
import { isScrapeSchemaMissingError } from "./schemaErrors.js";

export const MONITOR_JOB = "scrape-monitor";
const STATE_COLUMNS =
  "job,mode,last_tick_at,last_success_at,consecutive_failures,last_error";

const iso = (v) => (v ? new Date(v).toISOString() : null);

/** scrape-monitor 自身の行 → last_run（本文は出さず、失敗の有無と連続回数だけ） */
function lastRunOf(row) {
  if (!row) return null;
  return {
    last_tick_at: iso(row.last_tick_at),
    last_success_at: iso(row.last_success_at),
    consecutive_failures: row.consecutive_failures ?? 0,
    has_error: Boolean(row.last_error),
  };
}

/** 読んだ物（純粋な入力）から応答の本文を作る。DB にも時計にも触れない */
export function summarizeStatus({ now, jobStates, racesToday, expiredOpen }) {
  const rows = [...jobStates].sort((a, b) => a.job.localeCompare(b.job));
  return {
    generated_at: now.toISOString(),
    date_jst: toJstDateString(now),
    races_today: racesToday,
    expired_open: expiredOpen,
    jobs: rows.map((r) => ({
      job: r.job,
      mode: r.mode ?? null,
      last_tick_at: iso(r.last_tick_at),
    })),
    monitor_last_run: lastRunOf(rows.find((r) => r.job === MONITOR_JOB)),
  };
}

/** count だけ（head: true）を数える。エラーは例外にする（0件と誤読させない） */
async function countOf(query, what) {
  const { count, error } = await query;
  if (error) throw new Error(`${what}の件数の取得に失敗しました: ${error.message}`);
  return count ?? 0;
}

/**
 * 集計を読む（読み取りのみ）。075未適用（テーブル無し）は { available: false }。
 * expired は「開いている」＝昨日以降の status=expired（monitor の collectMonitorInput と同じ窓）。
 */
export async function readStatusSummary(client, now) {
  const stateRes = await client.from("scrape_job_state").select(STATE_COLUMNS);
  if (stateRes.error) {
    if (isScrapeSchemaMissingError(stateRes.error)) return { available: false };
    throw new Error(
      `ジョブ状態の読み取りに失敗しました: ${stateRes.error.message}`,
    );
  }
  const today = toJstDateString(now);
  const yesterday = toJstDateString(new Date(now.getTime() - 24 * 3600 * 1000));
  const racesToday = await countOf(
    client
      .from("races")
      .select("race_id", { count: "exact", head: true })
      .eq("race_date", today),
    "当日のraces",
  );
  const expiredOpen = await countOf(
    client
      .from("scrape_slots")
      .select("race_id", { count: "exact", head: true })
      .eq("status", "expired")
      .gte("race_date", yesterday),
    "expiredのスロット",
  );
  return {
    available: true,
    ...summarizeStatus({
      now,
      jobStates: stateRes.data ?? [],
      racesToday,
      expiredOpen,
    }),
  };
}
