// 読み取りのみ: 本体6表の 2026-10-06〜10-10 を export_pool.js と同じ列・書式でスクラッチに書く
import { supabase } from '/Users/terukina/boatrace-ai-predictor/.claude/worktrees/elegant-dewdney-a867e5/scripts/lib/supabaseClient.js';
import fs from 'node:fs';
const OUT = process.argv[2]; const LO = '2026-10-05'; const HI = '2026-10-11';
const T = [
 ['races','races','race_id, race_date, venue_code, race_number, race_grade, cancellation_status',['race_id']],
 ['entries','race_entries','race_id, boat_number, racer_id, grade, age, win_rate, global_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, weight_kg, branch, is_absent',['race_id','boat_number']],
 ['exhibition','exhibition_data','race_id, boat_number, exhibition_time, exhibition_course, start_timing, start_flag, is_absent',['race_id','boat_number']],
 ['conditions','race_conditions','race_id, weather, wind_direction, wind_speed, wave_height, series_day, is_final_day, race_stage',['race_id']],
 ['results','race_results','race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race, race_status, refund_boats, winning_technique, payout_trio, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6',['race_id']],
 ['start_timings','race_start_timings','race_id, boat_number, start_timing, is_flying, is_late_start, finish_mark',['race_id','boat_number']],
];
const cell = v => { if (v==null) return ''; const s = typeof v==='object'?JSON.stringify(v):String(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
for (const [name, table, cols, order] of T) {
  const rows=[]; for (let from=0;;from+=1000){ let q=supabase.from(table).select(cols).gte('race_id',LO).lt('race_id',HI); for(const c of order) q=q.order(c);
    const {data,error}=await q.range(from,from+999); if(error) throw new Error(`${table}: ${error.message}`); rows.push(...data); if(data.length<1000) break; }
  const cl = cols.split(',').map(s=>s.trim());
  fs.writeFileSync(`${OUT}/${name}.delta.csv`, rows.map(r=>cl.map(c=>cell(r[c])).join(',')).join('\n')+'\n');
  console.log(name, rows.length);
}
