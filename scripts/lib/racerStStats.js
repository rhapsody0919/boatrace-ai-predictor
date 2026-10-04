/**
 * 選手のST統計（racer_aggregated_stats の avg_st / avg_st_last_30 / st_stddev /
 * flying_rate / total_races）の取得と算出（BOA-581）。
 *
 * 定義:
 *   - total_races: 公式の出走回数と同じ定義（countsAsStart）。成績コード（official_finish_code、K ファイルの着欄）が
 *     01〜06・F・L1・K1・S1・S2 の走を数え、S0・L0・K0（選手責任の無い失格・出遅れ・欠場）と 00 は数えない
 *     （選手データ拡充レーンが BOA-327 の調査で確かめた。2026年前期で1,625人全員が公式の出走回数と一致）。
 *     成績コードが NULL の行（K の同期の前の直近の分）は、着欄で判定し、欠場（finish_mark='欠'）だけを除く
 *   - flying_rate: F の走 ÷ total_races（分母は上と同じ）
 *   - avg_st / st_stddev: F 以外で、ST が記録されている走（L・欠場は ST が NULL のため入らない）
 *   - avg_st_last_30: 上と同じ走のうち、新しい順に30走（F 以外の直近30走）
 *
 * F の start_timing は正の値（F.03 なら 0.03）で保存されているため、そのまま平均に入れると
 * 平均STが実際より早く見える。選手ページの他の ST 表示（BOA-576）と同じく F を除く。
 */
import { fetchAll } from "./supabaseClient.js";

export const RECENT_ST_WINDOW = 30;

/** 公式の出走回数に数える成績コード（K ファイルの着欄） */
const OFFICIAL_START_CODE_RE = /^(0[1-6]|F|L1|K1|S1|S2)$/;

/**
 * その走が、公式の出走回数に数えられるか。
 * @param {{official_finish_code?: string|null, finish_mark?: string|null}} t race_start_timings の行
 */
export function countsAsStart(t) {
  if (t.official_finish_code != null)
    return OFFICIAL_START_CODE_RE.test(t.official_finish_code);
  return t.finish_mark !== "欠";
}

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
 * @param {Array<{race_id: string, boat_number: number, start_timing: number|string|null, is_flying: boolean|null, finish_mark?: string|null, official_finish_code?: string|null}>} timings
 * @returns {{avg_st: number|null, avg_st_last_30: number|null, st_stddev: number|null, flying_rate: number, total_races: number}|null}
 */
export function computeRacerStStats(entries, timings) {
  const entryKeys = new Set(
    entries.map((e) => `${e.race_id}_${e.boat_number}`),
  );
  const racerTimings = timings
    .filter((t) => entryKeys.has(`${t.race_id}_${t.boat_number}`))
    .filter(countsAsStart)
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
        "race_id, boat_number, start_timing, is_flying, finish_mark, official_finish_code",
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
