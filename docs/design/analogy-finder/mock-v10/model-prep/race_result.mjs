// 計算1 の例のレースの実際の結果（SELECT のみ）→ work/race_result.json
import fs from "fs";
import { supabase } from "../master-src/scripts/lib/supabaseClient.js";
const RID = process.argv[2] || "2026-09-27-20-12";
const one = async (t, cols) => {
  const { data, error } = await supabase.from(t).select(cols).eq("race_id", RID);
  if (error) throw new Error(`${t}: ${error.message}`);
  return data;
};
const out = {
  race_id: RID,
  races: await one("races", "race_id,race_date,venue_code,race_number,race_grade,cancellation_status"),
  conditions: await one("race_conditions", "race_stage,series_day,is_final_day,weather,wind_direction,wind_speed,wave_height"),
  results: await one("race_results", "rank1,rank2,rank3,rank4,rank5,rank6,winning_technique,is_cancelled,is_no_race"),
  entries: (await one("race_entries", "boat_number,player_name,racer_id,grade,win_rate,global_2rate,local_win_rate,motor_2rate,boat_2rate,is_absent")).sort((a, b) => a.boat_number - b.boat_number),
  exhibition: (await one("exhibition_data", "boat_number,exhibition_time,is_absent")).sort((a, b) => a.boat_number - b.boat_number),
  start_timings: (await one("race_start_timings", "boat_number,start_timing,is_flying,is_late_start")).sort((a, b) => a.boat_number - b.boat_number),
};
fs.mkdirSync("work", { recursive: true });
fs.writeFileSync("work/race_result.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.results));
