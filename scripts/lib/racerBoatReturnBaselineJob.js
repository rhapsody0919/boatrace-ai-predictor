/**
 * 選手ページの回収率の全国の基準（racer_boat_return_baseline）を毎晩数え直す（api/cron/racer-boat-return-baseline.js）。
 * 窓（選手ページの履歴と同じ730日、昨日まで）を月ごとに分けて RPC compute_racer_boat_return_baseline（service_role だけ）を呼び、
 * 艇ごとの合計を足して、主キー (scope, boat_number) で値の変わった行だけを書く。差分を足す方式は取らない（重複配信で倍にならない）。
 * 外部サイトへの通信は無い（DB の中の集計。ADR-0066 改訂1）。案と SQL: docs/design/racer-return-baseline/db-draft.md
 * 使い道は選手ページの通算の比べに限る（窓の全体で数えるので後の結果を含む）。
 */
import { upsertChangedRows } from "./unchangedRows.js";
import { addDaysIso, monthRanges, racerHistoryWindowStart } from "../../src/pure/racerHistoryWindow.js";

export const BASELINE_TABLE = "racer_boat_return_baseline";
export const BASELINE_RPC = "compute_racer_boat_return_baseline";
export const BASELINE_SCOPE = "national";
// 数え方を変えたら上げる（db-draft.md の rule_version）
export const BASELINE_RULE_VERSION = 1;

const SUM_KEYS = [
  "runs", "unranked_runs", "win_sum", "win_sumsq", "place_sum", "place_sumsq",
  "tri_pos1_sum", "tri_pos1_sumsq", "tri_pos2_sum", "tri_pos2_sumsq", "tri_pos3_sum", "tri_pos3_sumsq", "tri_paid_missing",
];

/**
 * 月ごとの RPC の行（艇 0〜6）を艇ごとに足す。二乗の合計は 2^53 を超えうるので BigInt で足して最後に Number にする
 * （RPC の bigint は JSON の数で届く。精度は二乗の合計の下の桁だけが落ちうる＝標準偏差にはほぼ効かない）
 * @returns {Map<number, Object<string, number>>}
 */
export function sumByBoat(parts) {
  const acc = new Map();
  for (const row of parts) {
    const boat = Number(row.boat_number);
    const a = acc.get(boat) ?? Object.fromEntries(SUM_KEYS.map((k) => [k, 0n]));
    for (const k of SUM_KEYS) a[k] += BigInt(Math.round(Number(row[k] ?? 0)));
    acc.set(boat, a);
  }
  return new Map([...acc].map(([boat, a]) => [boat, Object.fromEntries(SUM_KEYS.map((k) => [k, Number(a[k])]))]));
}

/** 表に書く行（艇 0〜6）。窓は実測の列に持つ */
export function buildBaselineRows(sums, { from, to, today }) {
  const windowDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return [...sums.keys()]
    .sort((a, b) => a - b)
    .map((boat) => ({
      scope: BASELINE_SCOPE,
      boat_number: boat,
      window_start: from,
      window_end: to,
      window_days: windowDays,
      ...sums.get(boat),
      rule_version: BASELINE_RULE_VERSION,
      last_updated: today,
    }));
}

/**
 * @param {{client: object, today: string, dryRun: boolean, shouldStop?: () => boolean,
 *   upsert?: typeof upsertChangedRows, log?: (s: string) => void}} opts
 */
export async function runRacerBoatReturnBaselineJob({
  client,
  today,
  dryRun,
  shouldStop = () => false,
  upsert = upsertChangedRows,
  log = console.log,
}) {
  const to = addDaysIso(today, -1);
  const from = racerHistoryWindowStart(new Date(`${today}T00:00:00Z`));
  const parts = [];
  for (const [pFrom, pTo] of monthRanges(from, to)) {
    // 途中で時間切れなら、数えかけの合計を書かない（補足の起動が窓の全部を数え直す）
    if (shouldStop()) return { outcome: "ok", incomplete: true, rowsWritten: 0, report: { stoppedAt: pFrom } };
    const { data, error } = await client.rpc(BASELINE_RPC, { p_from: pFrom, p_to: pTo });
    if (error) return { outcome: "error", error: `${BASELINE_RPC}(${pFrom}〜${pTo}) が失敗: ${error.message ?? error}` };
    parts.push(...(data ?? []));
  }
  const sums = sumByBoat(parts);
  const total = sums.get(0)?.runs ?? 0;
  // 期待は0でない（窓に1走も無いのは取り込みか RPC の誤り）
  if (total === 0) return { outcome: "error", error: `窓 ${from}〜${to} で数えた走が0（RPC の行 ${parts.length}）` };
  const rows = buildBaselineRows(sums, { from, to, today });
  const res = await upsert(client, BASELINE_TABLE, rows, {
    onConflict: "scope,boat_number",
    keyColumns: ["scope", "boat_number"],
    label: BASELINE_TABLE,
    dryRun,
  });
  if (res.error) return { outcome: "error", error: `${BASELINE_TABLE} の書き込みが失敗: ${res.error.message ?? res.error}` };
  const report = { from, to, months: monthRanges(from, to).length, runs: total, rows: rows.length, written: res.written };
  log(`racer_boat_return_baseline: ${JSON.stringify(report)}`);
  // 値の変わらない日は書き込み0件が正常（window_end が変わる日は全行を書く）。行は艇 0〜6 の7行が期待
  return { outcome: "ok", rowsWritten: res.written, rowsParsed: rows.length, rowsExpected: 1, report };
}
