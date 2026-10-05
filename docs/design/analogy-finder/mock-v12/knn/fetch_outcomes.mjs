/**
 * 近傍 800件＋今日のレースの結果を DB から読む（SELECT のみ）→ work/outcomes_raw.json
 * - 長期（race_id ≤ 2025-12-02）: kb_archive_races（stage・stage_kind・technique・payout_3tan・combo_3tan・dead_heat）、
 *   kb_archive_boats（course・start_timing・is_flying・is_late_start・finish_raw・finish_rank）
 * - 本体: race_results（着順・決まり手・3連単払戻・進入・race_status・refund_boats・remark）、race_start_timings、
 *   race_entries（is_absent・選手名）、race_conditions（race_stage）、exhibition_data（is_absent）
 */
import fs from "fs";
import { supabase } from "./supabase.mjs";

const TAG = process.env.KNN_TAG || "knn";
const WD = TAG === "knn" ? "work" : `work${TAG.slice(3)}`;

const { query, neighbors } = JSON.parse(fs.readFileSync(`${WD}/ids.json`, "utf8"));
const all = [query, ...neighbors];
const kb = all.filter((id) => id.slice(0, 10) <= "2025-12-02");
const main = all.filter((id) => id.slice(0, 10) > "2025-12-02");

async function sel(table, cols, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await supabase.from(table).select(cols).in("race_id", chunk).limit(10000);
      if (!error) {
        out.push(...data);
        break;
      }
      if (attempt >= 4) throw new Error(`${table}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return out;
}

const res = {
  query,
  kb_races: await sel("kb_archive_races", "race_id,race_date,venue_code,race_number,stage,stage_kind,technique,payout_3tan,combo_3tan,popularity_3tan,dead_heat,weather,wind_direction,wind_speed,wave_height", kb),
  kb_boats: await sel("kb_archive_boats", "race_id,boat_number,racer_id,class,course,start_timing,is_flying,is_late_start,finish_raw,finish_rank", kb),
  races: await sel("races", "race_id,race_grade,cancellation_status", main),
  results: await sel("race_results", "race_id,rank1,rank2,rank3,rank4,rank5,rank6,winning_technique,payout_trifecta,popularity_trifecta,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6,course_1,course_2,course_3,course_4,course_5,course_6,race_status,refund_boats,remark,is_cancelled,is_no_race", main),
  start_timings: await sel("race_start_timings", "race_id,boat_number,start_timing,is_flying,is_late_start", main),
  entries: await sel("race_entries", "race_id,boat_number,racer_id,player_name,grade,is_absent", main),
  conditions: await sel("race_conditions", "race_id,race_stage,weather,wind_direction,wind_speed,wave_height", main),
  exhibition: await sel("exhibition_data", "race_id,boat_number,is_absent", main),
  fetched_at: new Date().toISOString(),
};
fs.writeFileSync(`${WD}/outcomes_raw.json`, JSON.stringify(res));
console.log(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])));
