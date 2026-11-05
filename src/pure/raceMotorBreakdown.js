/**
 * モータ情報タブの一覧表（getRaceMotorBreakdown の返り値）の行の組み立て。
 *
 * `getRaceMotorBreakdown`（`src/services/supabaseDataService.js`）の中の整形を手を加えずに
 * 移したもの（開発効率の計画 段3 の3件目）。取得（Supabase の読み）はサービスに残し、
 * 取得した行から値を作る部分だけをここに置く。
 */

/**
 * 過去レース: 出走表時点の公式値の行（BOA-329）。再計算はしない。
 * @param {Array<Object>} rows race_entries の行
 * @param {Array<Object|null|undefined>} statsAsOf getVenueMotorStats(レース日以前) の結果（rows と同じ並び）
 * @param {Map<number, Object>} pretestAsOf 選手ごとの前検の行
 * @returns {Array<Object>}
 */
export function pastMotorRows(rows, statsAsOf, pretestAsOf) {
  return rows.map((row, i) => {
    const pretest = pretestAsOf.get(row.racer_id) ?? null;
    return {
      ...row,
      rate_source: "official",
      official_2rate: row.motor_2rate ?? null,
      // 公式の2連率・3連率がどちらも 0 か（「集計前」の判定、BOA-557）
      official_3rate: row.motor_3rate ?? null,
      pretest_time: pretest?.pretest_time ?? null,
      pretest_rank: pretest?.pretest_rank ?? null,
      power_index: null,
      clipped_by_generation: false,
      final_count: statsAsOf[i]?.finalCount ?? null,
      championship_count: statsAsOf[i]?.championshipCount ?? null,
      first_place_count: statsAsOf[i]?.firstPlaceCount ?? null,
      race_count: statsAsOf[i]?.raceCount ?? null,
      venue_stats_failed: statsAsOf[i]?.fetchFailed === true,
    };
  });
}

/**
 * 当日以降のレース: 2連率/3連率を選択中の期間（過去90日/直近1ヶ月）に応じた値に差し替えた行。
 * race_entries.motor_2rate/3rateは公式サイトの「モーター抽選日からの通算」
 * 値でperiod非依存のため、そのまま使うと機力指数だけ期間が変わり
 * 2連率/3連率が変わらないという不整合が生じる（ユーザー指摘、2026-09-13）
 * @param {Array<Object>} rows race_entries の行
 * @param {Array<Object|null|undefined>} powerIndexes getMotorPowerIndex の結果（rows と同じ並び）
 * @param {Array<Object|null|undefined>} venueMotorStatsList getVenueMotorStats の結果（同上）
 * @param {Map<number, Object>} pretestByRacer 選手ごとの前検の行
 * @returns {Array<Object>}
 */
export function recalcMotorRows(
  rows,
  powerIndexes,
  venueMotorStatsList,
  pretestByRacer,
) {
  return rows.map((row, i) => {
    const pretest = pretestByRacer.get(row.racer_id) ?? null;
    return {
      ...row,
      rate_source: "recalc",
      // このレースより前に結果の出た走数（機力指数の母数）。0 なら初下ろし（BOA-513）
      sample_count: powerIndexes[i]?.sample_count ?? null,
      // 差し替える前の公式3連率（節の開始時点）。公式2連率とあわせて、新モーターで
      // 公式の累計がまだ付いていない（どちらも 0）かの判定に使う
      official_3rate: row.motor_3rate ?? null,
      clipped_by_generation: powerIndexes[i]?.clipped_by_generation ?? false,
      motor_2rate: powerIndexes[i]?.actual_rate2 ?? row.motor_2rate,
      motor_3rate: powerIndexes[i]?.actual_rate3 ?? row.motor_3rate,
      // 期間で差し替える前の公式値（節の開始時点）。追加クエリ0本
      official_2rate: row.motor_2rate ?? null,
      pretest_time: pretest?.pretest_time ?? null,
      pretest_rank: pretest?.pretest_rank ?? null,
      power_index: powerIndexes[i]?.power_index ?? null,
      final_count: venueMotorStatsList[i]?.finalCount ?? null,
      championship_count: venueMotorStatsList[i]?.championshipCount ?? null,
      first_place_count: venueMotorStatsList[i]?.firstPlaceCount ?? null,
      race_count: venueMotorStatsList[i]?.raceCount ?? null,
      venue_stats_failed: venueMotorStatsList[i]?.fetchFailed === true,
    };
  });
}

/**
 * 行に新しいモーターの最初の開催向けの列（getRaceMotorFreshness の結果）を足す（BOA-830）。
 * 会場公式のモーター成績が1艇でも取れなかったら、または自前の値の材料が取れなかったら
 * fetchFailed を付ける（呼び出し側は withCache に保存させない、BOA-740）
 * @param {Array<Object>} out pastMotorRows / recalcMotorRows の結果
 * @param {{columns: Array<Object>, freshness: Object, failed: boolean}} fresh
 * @returns {{rows: Array<Object>, freshness: Object, fetchFailed?: boolean}}
 */
export function settleMotorBreakdown(out, fresh) {
  const merged = out.map((row, i) => ({ ...row, ...fresh.columns[i] }));
  return out.some((r) => r.venue_stats_failed) || fresh.failed
    ? { rows: merged, freshness: fresh.freshness, fetchFailed: true }
    : { rows: merged, freshness: fresh.freshness };
}
