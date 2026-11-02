import { getRaceStageKey } from "./raceStageConfig.js";

/**
 * 準優勝戦に名前が載った回数（当社集計、BOA-1155）。欠場の走も含める。
 * 日付は YYYY-MM-DD、選手IDは数値で渡す。開始日を含め、上限日は呼び出し側で絞る。
 * racerIds に指定した選手は行が無くても0、それ以外は対象の走がある選手だけ返す。
 *
 * @param {Array<{race_id: string, race_date: string, race_stage: string|null,
 *   racer_id: number, is_absent: boolean|null}>} rows
 * @param {string} startDate 集計開始日
 * @param {number[]} racerIds 0件も返す選手の一覧
 * @returns {Map<number, number>} 選手IDごとの回数
 */
export function countSemifinalsByRacer(rows, startDate, racerIds = []) {
  const counts = new Map(racerIds.map((id) => [id, 0]));
  const racesByRacer = new Map();
  for (const row of rows) {
    if (
      row.racer_id == null ||
      !row.race_id ||
      !row.race_date ||
      row.race_date < startDate ||
      getRaceStageKey(row.race_stage) !== "semifinal"
    )
      continue;
    let races = racesByRacer.get(row.racer_id);
    if (!races) {
      races = new Set();
      racesByRacer.set(row.racer_id, races);
    }
    races.add(row.race_id);
    counts.set(row.racer_id, races.size);
  }
  return counts;
}
