/**
 * 選手のST統計（racer_aggregated_stats の avg_st / avg_st_last_30 / st_stddev /
 * flying_rate / total_races）の取得と算出（BOA-581）。
 *
 * 定義:
 *   - total_races: 出走表（race_entries）に対応する race_start_timings の行のうち、欠場（finish_mark='欠'）を除いた数。
 *     F・L は含む。欠場艇にも行がある（9/21 以降の結果ページの取得と、K からの補完）ため、行数をそのまま数えると
 *     欠場を出走に数えてしまう（事故率の分母と同じく、欠場は出走に入れない）
 *   - flying_rate: F の走 ÷ total_races（分母は F・L を含み、欠場を含まない）
 *   - avg_st / st_stddev: F 以外で、ST が記録されている走（L・欠場は ST が NULL のため入らない）
 *   - avg_st_last_30: 上と同じ走のうち、新しい順に30走（F 以外の直近30走）
 *
 * F の start_timing は正の値（F.03 なら 0.03）で保存されているため、そのまま平均に入れると
 * 平均STが実際より早く見える。選手ページの他の ST 表示（BOA-576）と同じく F を除く。
 */
import { fetchAll } from "./supabaseClient.js";

export const RECENT_ST_WINDOW = 30;

// .in() に渡す race_id の数。ページングで全件取るので行数の上限とは無関係で、
// URL の長さだけを抑えるための値
const RACE_ID_CHUNK_SIZE = 200;
const FETCH_ATTEMPTS = 3;

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 母標準偏差（既存の racer_aggregated_stats.st_stddev と同じ定義）
function populationStdDev(values) {
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, x) => sum + (x - avg) ** 2, 0) / values.length,
  );
}

const round = (value, digits) => Number(value.toFixed(digits));

/**
 * 出走（entries）と ST（timings）から ST 統計を算出する純粋関数。
 * 入力の並び順には依存しない（race_id 降順・boat_number 降順に並べ直す）。
 *
 * @param {Array<{race_id: string, boat_number: number}>} entries - 対象選手の出走
 * @param {Array<{race_id: string, boat_number: number, start_timing: number|string|null, is_flying: boolean|null, finish_mark?: string|null}>} timings
 * @returns {{avg_st: number|null, avg_st_last_30: number|null, st_stddev: number|null, flying_rate: number, total_races: number}|null}
 */
export function computeRacerStStats(entries, timings) {
  const entryKeys = new Set(
    entries.map((e) => `${e.race_id}_${e.boat_number}`),
  );
  const racerTimings = timings
    .filter((t) => entryKeys.has(`${t.race_id}_${t.boat_number}`))
    .filter((t) => t.finish_mark !== "欠")
    .sort(
      (a, b) =>
        b.race_id.localeCompare(a.race_id) || b.boat_number - a.boat_number,
    );

  if (racerTimings.length === 0) return null;

  const stValues = racerTimings
    .filter((t) => t.is_flying !== true && t.start_timing != null)
    .map((t) => Number(t.start_timing));
  const stLast30 = stValues.slice(0, RECENT_ST_WINDOW);
  const flyingCount = racerTimings.filter((t) => t.is_flying === true).length;
  const totalRaces = racerTimings.length;

  return {
    avg_st: stValues.length > 0 ? round(mean(stValues), 3) : null,
    avg_st_last_30: stLast30.length > 0 ? round(mean(stLast30), 3) : null,
    st_stddev:
      stValues.length >= 2 ? round(populationStdDev(stValues), 3) : null,
    flying_rate: round(flyingCount / totalRaces, 4),
    total_races: totalRaces,
  };
}

async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${label}（${FETCH_ATTEMPTS}回失敗）: ${lastError.message}`);
}

/**
 * 選手の出走（race_id 降順）を全件取得する。取得エラーは例外にする。
 */
export async function fetchRacerEntries(client, racerId) {
  return withRetry(`race_entries取得エラー (racer=${racerId})`, () =>
    fetchAll(
      "race_entries",
      "race_id, boat_number",
      (q) =>
        q
          .eq("racer_id", racerId)
          .order("race_id", { ascending: false })
          .order("boat_number", { ascending: false }),
      { throwOnError: true, client },
    ),
  );
}

/**
 * 出走に対応する race_start_timings を全件取得する。
 * race_id を .in() で渡すと1レース最大6行が返るため、1回の応答が Supabase の上限（1000行）を
 * 超えうる。主キー順（race_id, boat_number）に並べて .range() でページングし、取りこぼさない。
 * 取得エラーは例外にする。
 */
export async function fetchStartTimingsForEntries(client, entries) {
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const all = [];
  for (let i = 0; i < raceIds.length; i += RACE_ID_CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + RACE_ID_CHUNK_SIZE);
    const rows = await withRetry("race_start_timings取得エラー", () =>
      fetchAll(
        "race_start_timings",
        "race_id, boat_number, start_timing, is_flying, finish_mark",
        (q) =>
          q
            .in("race_id", chunk)
            .order("race_id", { ascending: true })
            .order("boat_number", { ascending: true }),
        { throwOnError: true, client },
      ),
    );
    all.push(...rows);
  }
  return all;
}
