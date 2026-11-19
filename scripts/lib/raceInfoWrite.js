/**
 * レース情報の書き込みの部品（update-race-info.js の flushRaceInfo から分けた）: races の列の更新の繰り返し・
 * race_conditions の行の組分け・race_grade の更新の計画・ログ。表に書くのは updateRacesEach だけで、
 * 呼び手（flushRaceInfo）が書く順を決める。行の形・順は分ける前と同じ
 */
import { diffRows, planWriteAll } from "./unchangedRows.js";
import { buildWeatherRows, formatWeatherStats } from "./beforeinfoWeather.js";

/**
 * races の列を1レースずつ更新する（flushRaceInfo の cancellation_status・start_time・race_grade で共通）。
 * 成功は onOk(race_id)、失敗は onError(race_id, error) に渡し、成功の件数を返す。書く順・行の形は分ける前と同じ
 */
export async function updateRacesEach(client, updates, { onOk, onError }) {
  let count = 0;
  for (const { race_id, patch } of updates) {
    const { error } = await client
      .from("races")
      .update(patch)
      .eq("race_id", race_id);
    if (!error) {
      count++;
      onOk(race_id);
    } else {
      onError(race_id, error);
    }
  }
  return count;
}

/** races.start_time の追従（N15）のログ。書き込みデータが無くても、時刻の変更は出す */
export function logDeadlineUpdates(acc, dryRun, deadlineUpdateCount) {
  if (acc.deadlineUpdates.size === 0) return;
  console.log(
    `  ${dryRun ? "[DRY-RUN] " : ""}🕒 races.start_time: ${[...acc.deadlineUpdates.values()].map((u) => `${u.race_id} ${u.previous}→${u.start_time.slice(0, 5)}`).join(", ")}` +
      (dryRun ? "" : `（更新${deadlineUpdateCount}件）`),
  );
}

/**
 * race_conditions の行を、列の組み合わせ（気象の有無・日目の有無。順延・中止のタブの日は日目の列を含めない。BOA-501）
 * ごとに分ける（[行, ラベル] の列。同じ組み合わせの行だけをまとめれば、無い列は触られない）。
 * 気象の列（観測時刻を含む）は、展示取得と同じ規則で作る（BOA-358）。気象を書ける行と、書けない行
 * （取得失敗・気象ブロックなし・発走後の観測）は、キーの組み合わせが違うため別々にupsertする
 * （PostgRESTの一括upsertは、キーの無い行に明示的にNULLを書くため）。
 * includeWeather=false（Vercel。気象は展示側）は、全行を「気象なし」の行として書く
 */
export function conditionGroups(
  acc,
  { includeWeather, date, startTimeLookup },
) {
  let weatherByRaceId = new Map();
  if (includeWeather) {
    const { rows: weatherRows, stats: weatherStats } = buildWeatherRows(
      acc.weatherFetched,
      date,
      { startTimeLookup },
    );
    console.log(`  🌤️ 気象: ${formatWeatherStats(weatherStats)}`);
    weatherByRaceId = new Map(weatherRows.map((row) => [row.race_id, row]));
  }
  const groups = new Map();
  for (const row of acc.conditionsRows) {
    const weatherRow = weatherByRaceId.get(row.race_id);
    const merged = weatherRow ? { ...row, ...weatherRow } : row;
    const key = `${weatherRow ? "w" : "-"}${"series_day" in row ? "d" : "-"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(merged);
  }
  const labelOf = (key) =>
    `race_conditions${key[0] === "w" ? "" : "（気象なし）"}${key[1] === "d" ? "" : "（日目を残す）"}`;
  return [...groups].map(([key, rows]) => [rows, labelOf(key)]);
}

/**
 * races.race_grade の更新の計画（Source of Truth = races テーブル）。
 * 既存値の取得に失敗している場合（cancellationFetchError）は全件を従来どおり更新する
 */
export function planRacesGrade(acc, cancellationRows, cancellationFetchError) {
  return cancellationFetchError
    ? planWriteAll(acc.racesGradeUpdates)
    : diffRows(cancellationRows || [], acc.racesGradeUpdates, {
        keyColumns: ["race_id"],
        writeMissing: false, // racesに行が無ければUPDATEしても0件
      });
}

/** races の更新の列（race_id と書く列）。dry-run では races を更新しない（空の列） */
export function racesUpdates(dryRun, rows, patchOf) {
  return dryRun
    ? []
    : rows.map((r) => ({ race_id: r.race_id, patch: patchOf(r) }));
}

/** races の更新の失敗: errors に集め、ログに出す */
export const logUpdateError = (errors, label) => (raceId, error) => {
  errors.push(error.message);
  console.error(`❌ races (${label}) 更新エラー [${raceId}]:`, error.message);
};
