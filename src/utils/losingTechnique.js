/**
 * 会場の負けの決まり手（losing_technique_stats、90日・会場×枠）の行を枠ごとにまとめる（純関数）。
 *
 * `supabaseDataService.getLosingTechniqueStats`（画面は src/components/analysis/LosingTechniqueChart.jsx）の
 * 整形を手を加えずに移した（2026-10-25 hq 依頼、FT01。全貌動画の材料と同じ値にするため）。
 * 行は boat_number・percentage の降順で並んでいる前提（取得側の order と同じ）。
 *
 * @param {Array<{boat_number: number, losing_technique: string, count_90days: number,
 *   total_losses_90days: number, percentage: number, last_updated: string}>} rows
 * @returns {{last_updated: string|null, data: Record<number, {total_races: number,
 *   techniques: Array<{technique: string, count: number, percentage: number}>}>}}
 *   last_updated は先頭の行の値（表は1回の集計で全行を書く）
 */
export function groupLosingTechniqueRows(rows) {
  const techniqueData = {};
  let lastUpdated = null;

  (rows ?? []).forEach((row) => {
    const boatNumber = row.boat_number;
    if (!techniqueData[boatNumber]) {
      techniqueData[boatNumber] = {
        total_races: row.total_losses_90days,
        techniques: [],
      };
    }

    techniqueData[boatNumber].techniques.push({
      technique: row.losing_technique,
      count: row.count_90days,
      percentage: row.percentage,
    });

    if (!lastUpdated) {
      lastUpdated = row.last_updated;
    }
  });

  return { last_updated: lastUpdated, data: techniqueData };
}
