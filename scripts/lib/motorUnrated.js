import { findMeetStartDate } from "../../src/utils/meetGrouping.js";

/**
 * モーター2連率 0 が「実績なし（新モーターで、このレースより前に一度も使われていない）」かを、
 * 自社の race_entries から判定する（BOA-702）。本日のデータ一覧（generate-morning-digest.js）で使う。
 *
 * 公式の2連率は節の初日の値に固定され、新モーターの最初の節で一度も使われなかったモーターは
 * 公式の累計が無く 0 になる（唐津 9/16 切替の実測。全会場で切替直後に同じ現象）。
 * 本当に 0%（走って2着以内0回）と区別するため、切替日（venue_motor_start_dates）以降・
 * **この節の初日より前**の、そのモーターの出走（欠場を除く）を数える。公式の2連率は節の初日の値で
 * 固定されるので、節の途中の出走（今節の1〜3日目）は数えない（数えると、今節で走ったモーターの
 * 公式 0 を「本当に0%」と誤る。2026-10-02 唐津61号機: 今節3走・公式 0）。
 * 画面側の判定（src/utils/motorGeneration.js の isMotorUnrated）と同じ考え方で、取得元だけ違う。
 */

/**
 * @param {number|null} motor2rate 公式の2連率
 * @param {number|null} priorRuns 切替日以降・この節の初日より前の出走数（不明なら null）
 * @returns {boolean} 実績なし（0 を「—」で出すべき）か
 */
export function isUnratedMotor(motor2rate, priorRuns) {
  return motor2rate === 0 && priorRuns === 0;
}

/**
 * 切替日以降・beforeDate（この節の初日）より前の、その会場・モーター番号の出走数を数える。
 * 切替日が分からなければ null（判定しない）。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{venueCode: number, motorNumber: number, beforeDate: string,
 *   startDateByVenue: Map<number, string>}} args
 * @returns {Promise<number|null>}
 */
export async function countPriorMotorRuns(
  client,
  { venueCode, motorNumber, beforeDate, startDateByVenue },
) {
  const start = startDateByVenue.get(venueCode);
  if (!start || motorNumber === null || motorNumber === undefined) return null;
  const vv = String(venueCode).padStart(2, "0");
  const { count, error } = await client
    .from("race_entries")
    .select("race_id", { count: "exact", head: true })
    .eq("motor_number", motorNumber)
    .gte("race_id", start)
    .lt("race_id", beforeDate)
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

/**
 * その会場の、date を含む節の初日（src/utils/meetGrouping.js の findMeetStartDate。
 * 今節タブと同じ判定）。直近21日の開催日と種別（series_day・is_final_day）から求める。
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {number} venueCode
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<string>} 節の初日（分からなければ date）
 */
export async function fetchMeetStartDate(client, venueCode, date) {
  const vv = String(venueCode).padStart(2, "0");
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 21);
  const windowStart = from.toISOString().slice(0, 10);
  const { data, error } = await client
    .from("race_conditions")
    .select("race_id, series_day, is_final_day")
    .gte("race_id", windowStart)
    .lte("race_id", `${date}-zz`)
    .like("race_id", `__________-${vv}-__`);
  if (error) {
    throw new Error(
      `race_conditions の取得に失敗（会場${venueCode}）: ${error.message}`,
    );
  }
  const byDate = new Map();
  for (const c of data ?? []) {
    const d = c.race_id.slice(0, 10);
    const cur = byDate.get(d) ?? {
      date: d,
      seriesDay: null,
      isFinalDay: false,
    };
    if (
      c.series_day != null &&
      (cur.seriesDay == null || c.series_day < cur.seriesDay)
    )
      cur.seriesDay = c.series_day;
    if (c.is_final_day) cur.isFinalDay = true;
    byDate.set(d, cur);
  }
  if (!byDate.has(date))
    byDate.set(date, { date, seriesDay: null, isFinalDay: null });
  return findMeetStartDate([...byDate.values()], date) ?? date;
}
