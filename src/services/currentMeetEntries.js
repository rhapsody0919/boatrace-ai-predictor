/**
 * 選手の今節の走（同じ会場・同じモーター）を特定する取得（BOA-861）。
 *
 * クライアントを引数で受け取るのは、検証（scripts/maintenance/verify-meet-start-date.js）が
 * 本番のクライアントを読まずに偽のクライアントで本体をそのまま実行するため。画面からは
 * racerService が `supabaseClient.js` の `supabase`（throwOnError が既定）を渡す。
 * 取得の失敗は例外のまま上に流す（.claude/rules/frontend-data-fetch.md）。
 */
import { groupCurrentMeetFromRows } from "../utils/meetGrouping.js";
import { shiftDate } from "../utils/pretestRows.js";

/**
 * 選手の直近出走と同じ会場・モーターの走を、種別（race_conditions の series_day・is_final_day）
 * から決めた節の初日で切る。種別の行が無い（未取得の日）ときは、従来の日付の連続性による推定に戻す。
 * @param {{ from: (table: string) => unknown }} client throwOnError を適用したクライアント
 * @param {number|string} racerId
 * @param {number} motorNumber
 * @returns {Promise<{ race_id: string, boat_number: number }[]>} race_id の昇順
 */
export async function fetchCurrentMeetRaceEntries(
  client,
  racerId,
  motorNumber,
) {
  const { data: entries } = await client
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId)
    .eq("motor_number", motorNumber)
    .order("race_id", { ascending: false })
    .limit(30);

  if (!entries || entries.length === 0) return [];

  // 最新の走と同じ会場に絞る（BOA-591）。モーター番号は会場ごとに振られるので、
  // 番号だけだと別会場の同じ番号のモーターの節が地続きのときに繋がる
  const venue = entries[0].race_id.slice(11, 13);
  const sorted = entries
    .filter((e) => e.race_id.slice(11, 13) === venue)
    .sort((a, b) => a.race_id.localeCompare(b.race_id));
  const targetDate = sorted.at(-1).race_id.slice(0, 10);
  // 12日窓・1会場で最大13日×12R。Supabase の1000行上限には届かない。
  const { data: conditions } = await client
    .from("race_conditions")
    .select("race_id, series_day, is_final_day")
    .gte("race_id", shiftDate(targetDate, -12))
    .lte("race_id", `${targetDate}-zz`)
    .like("race_id", `__________-${venue}-__`);
  return groupCurrentMeetFromRows(sorted, conditions);
}
