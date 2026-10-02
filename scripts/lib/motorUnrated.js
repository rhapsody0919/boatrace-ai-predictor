/**
 * モーター2連率 0 が「実績なし（新モーターで、このレースより前に一度も使われていない）」かを、
 * 自社の race_entries から判定する（BOA-702）。本日のデータ一覧（generate-morning-digest.js）で使う。
 *
 * 公式の2連率は節の初日の値に固定され、新モーターの最初の節で一度も使われなかったモーターは
 * 公式の累計が無く 0 になる（唐津 9/16 切替の実測。全会場で切替直後に同じ現象）。
 * 本当に 0%（走って2着以内0回）と区別するため、切替日（venue_motor_start_dates）以降・
 * このレースの日より前の、そのモーターの出走（欠場を除く）を数える。
 * 画面側の判定（src/utils/motorGeneration.js の isMotorUnrated）と同じ考え方で、取得元だけ違う。
 */

/**
 * @param {number|null} motor2rate 公式の2連率
 * @param {number|null} priorRuns 切替日以降・このレースの日より前の出走数（不明なら null）
 * @returns {boolean} 実績なし（0 を「—」で出すべき）か
 */
export function isUnratedMotor(motor2rate, priorRuns) {
  return motor2rate === 0 && priorRuns === 0;
}

/**
 * 切替日以降・raceDate より前の、その会場・モーター番号の出走数を数える。
 * 切替日が分からなければ null（判定しない）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{venueCode: number, motorNumber: number, raceDate: string,
 *   startDateByVenue: Map<number, string>}} args
 * @returns {Promise<number|null>}
 */
export async function countPriorMotorRuns(
  client,
  { venueCode, motorNumber, raceDate, startDateByVenue },
) {
  const start = startDateByVenue.get(venueCode);
  if (!start || motorNumber === null || motorNumber === undefined) return null;
  const vv = String(venueCode).padStart(2, "0");
  const { count, error } = await client
    .from("race_entries")
    .select("race_id", { count: "exact", head: true })
    .eq("motor_number", motorNumber)
    .gte("race_id", start)
    .lt("race_id", raceDate)
    .like("race_id", `%-${vv}-__`)
    .or("is_absent.is.null,is_absent.eq.false");
  if (error) {
    throw new Error(
      `モーターの出走数の取得に失敗（会場${venueCode}・${motorNumber}号機）: ${error.message}`,
    );
  }
  return count ?? 0;
}

/**
 * 会場ごとの最新のモーター切替日（venue_motor_start_dates の start_date の最大）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} asOfDate この日以前の切替日だけを見る
 * @returns {Promise<Map<number, string>>}
 */
export async function fetchMotorStartDates(client, asOfDate) {
  const { data, error } = await client
    .from("venue_motor_start_dates")
    .select("venue_code, start_date")
    .lte("start_date", asOfDate);
  if (error) {
    throw new Error(`venue_motor_start_dates の取得に失敗: ${error.message}`);
  }
  const map = new Map();
  for (const r of data ?? []) {
    const cur = map.get(r.venue_code);
    if (!cur || r.start_date > cur) map.set(r.venue_code, r.start_date);
  }
  return map;
}
