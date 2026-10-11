/**
 * モーターの使用回数と「未使用（新モーター・実績なし）」の判定（BOA-702）。
 *
 * 新モーターに切り替えた直後、一度も使われていないモーターは公式の累計実績が無く、出走表の2連率が 0.00 になる。
 * これを「0.0%」と出すと「2着以内0回」と読まれる。使用回数が0と分かるときだけ「—」＋注記にする。
 * 使用回数が1以上なら本物の0%なので「0.0%」のまま。分からないときは従来の扱い（全艇0なら「—」）に任せる。
 *
 * 使用回数の取り方（分かるもののうち大きいほう。どれも分からなければ null）:
 *   1. 会場公式サイトの出走数（venue_motor_stats.race_count。過去レースはレース日時点、当日は最新のスナップショット）。
 *      15会場だけ。桐生・浜名湖・常滑・三国・びわこ・住之江・尼崎は列が無く、戸田・平和島はページが無い
 *   2. 自社の出走数（getMotorPowerIndex の sample_count。このレースより前の、結果の出た走）。現行モーターの世代の
 *      使用開始日から数えているとき（clipped_by_generation）だけ使う。期間（90日等）で切り詰めた窓では、それより前の
 *      使用を数え漏らすため。世代が分からない会場は sample_count が0でも使わない
 *   会場公式の成績の取得に失敗した行（venue_stats_failed、BOA-740）は、1 を分からない扱いにする
 *   大きいほうを使うのは、2つの数が数えている期間が違うため。会場公式のスナップショットは節の途中の出走をまだ
 *   含まないことがあり、当日のレースの2連率（自社の再計算）は含む。どちらかが1以上なら、使われたモーターとして扱う
 *   （実際に走ったモーターを「実績なし」と隠さない側に倒す）
 */

/**
 * @param {{race_count?: number|null, sample_count?: number|null, clipped_by_generation?: boolean, venue_stats_failed?: boolean}|null|undefined} row
 *   getRaceMotorBreakdown の行
 * @returns {number|null} 使用回数。分からなければ null
 */
export function motorUsageCount(row) {
  if (!row) return null;
  const known = [];
  if (!row.venue_stats_failed && row.race_count != null) {
    known.push(Number(row.race_count));
  }
  if (row.sample_count != null && row.clipped_by_generation === true) {
    known.push(Number(row.sample_count));
  }
  return known.length > 0 ? Math.max(...known) : null;
}

/**
 * 表示する2連率が0で、使用回数が0と分かる（新モーター・実績なし）か。
 * @param {number|null} rate 表示する2連率
 * @param {Parameters<typeof motorUsageCount>[0]} row
 */
export function isUnusedMotor(rate, row) {
  return rate === 0 && motorUsageCount(row) === 0;
}
