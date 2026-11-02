/**
 * 節初日〜指定日の展示の材料を JSON で出す。読み取りのみ・送信なし。
 * node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>
 * 環境変数: SUPABASE_URL（または VITE_SUPABASE_URL）・SUPABASE_SERVICE_KEY
 * exit: 0 成功 / 2 日付・設定・読み取りの失敗。本番での実行は取り込み側が行う。
 */
import { pathToFileURL } from "node:url";
import { isRaceCancelled } from "../../src/utils/raceCancellation.js";

const daysBefore = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const sameVenue = (a, b) => Number(a) === Number(b);
const byRace = (a, b) => a.race_id.localeCompare(b.race_id);

/** 行から出力を作る純粋関数。同タイムは method=min、日をまたいで秒数を比べない。 */
export function setsuExhibitionOf(date, { series = [], races = [], conditions = [], entries = [], exhibitions = [], motors = [] } = {}) {
  const active = series.filter((s) => s.start_date <= date && s.end_date >= daysBefore(date, 3) && races.some((r) => r.race_date === date && sameVenue(r.venue_code, s.venue_code)));
  const conditionById = new Map(conditions.map((c) => [c.race_id, c]));
  const exhibitionByBoat = new Map(exhibitions.map((e) => [`${e.race_id}-${e.boat_number}`, e]));
  const meets = active.sort((a, b) => Number(a.venue_code) - Number(b.venue_code) || a.start_date.localeCompare(b.start_date)).map((s) => {
    const meetRaces = races.filter((r) => sameVenue(r.venue_code, s.venue_code) && r.race_date >= s.start_date && r.race_date <= date);
    const todayConditions = meetRaces.filter((r) => r.race_date === date).map((r) => conditionById.get(r.race_id)).filter(Boolean);
    const seriesDays = todayConditions.map((c) => c.series_day).filter((d) => d != null);
    const racers = new Map();
    for (const race of meetRaces.sort(byRace)) {
      if (isRaceCancelled({ cancellationStatus: race.cancellation_status })) continue;
      const boats = entries.filter((e) => e.race_id === race.race_id);
      const timeOf = (entry) => {
        const ex = exhibitionByBoat.get(`${race.race_id}-${entry.boat_number}`);
        return entry.is_absent || ex?.is_absent || ex?.exhibition_time == null ? null : Number(ex.exhibition_time);
      };
      const times = boats.map(timeOf).filter((t) => t != null && Number.isFinite(t));
      for (const entry of boats) {
        if (entry.racer_id == null) continue;
        if (!racers.has(entry.racer_id)) {
          const motor = motors.find((m) => m.race_date === s.start_date && sameVenue(m.venue_code, s.venue_code) && m.racer_id === entry.racer_id && m.motor_number === entry.motor_number);
          racers.set(entry.racer_id, {
            racer_id: entry.racer_id, name: entry.player_name,
            motor_number: entry.motor_number, motor_2rate_at_start: motor?.motor_2rate ?? null, runs: [],
          });
        }
        const ex = exhibitionByBoat.get(`${race.race_id}-${entry.boat_number}`);
        const time = timeOf(entry);
        racers.get(entry.racer_id).runs.push({
          race_id: race.race_id, date: race.race_date, race_number: race.race_number,
          race_stage: conditionById.get(race.race_id)?.race_stage ?? null, boat_number: entry.boat_number,
          exhibition_time: ex?.exhibition_time ?? null,
          exhibition_rank: time == null || !Number.isFinite(time) ? null : 1 + times.filter((t) => t < time).length,
          exhibition_course: ex?.exhibition_course ?? null,
        });
      }
    }
    return {
      meet_id: `${s.venue_code}-${s.start_date}`, venue_code: s.venue_code,
      start_date: s.start_date, end_date: s.end_date,
      title: s.title, grade: s.grade,
      series_day: seriesDays.length ? Math.min(...seriesDays) : null,
      is_final_day: todayConditions.length ? todayConditions.some((c) => c.is_final_day === true) : null,
      racers: [...racers.values()].sort((a, b) => a.racer_id - b.racer_id),
    };
  });
  return { date, meets };
}

/** fetchAll を注入可能にして、DB に接続せず読み取り範囲も検証する。 */
export async function readSetsuExhibition(date, fetchAll) {
  const today = await fetchAll("races", "race_id,race_date,venue_code,race_number,cancellation_status", (q) => q.eq("race_date", date).order("race_id"));
  if (!today.length) return { date, meets: [] };
  const series = await fetchAll("race_series", "venue_code,start_date,end_date,title,grade", (q) => q.in("venue_code", [...new Set(today.map((r) => r.venue_code))]).lte("start_date", date).gte("end_date", daysBefore(date, 3)).order("venue_code").order("start_date"));
  const rows = { series, races: [], conditions: [], entries: [], exhibitions: [], motors: [] };
  // 節ごと・race_id は100件ずつに分け、URL 長と全件読み取りを両立する。
  for (const s of series) {
    const races = await fetchAll("races", "race_id,race_date,venue_code,race_number,cancellation_status", (q) => q.eq("venue_code", s.venue_code).gte("race_date", s.start_date).lte("race_date", date).order("race_id"));
    rows.races.push(...races);
    const ids = races.map((r) => r.race_id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      rows.conditions.push(...await fetchAll("race_conditions", "race_id,series_day,is_final_day,race_stage", (q) => q.in("race_id", batch).order("race_id")));
      rows.entries.push(...await fetchAll("race_entries", "race_id,boat_number,racer_id,player_name,motor_number,is_absent", (q) => q.in("race_id", batch).order("race_id").order("boat_number")));
      rows.exhibitions.push(...await fetchAll("exhibition_data", "race_id,boat_number,exhibition_time,exhibition_course,is_absent", (q) => q.in("race_id", batch).order("race_id").order("boat_number")));
    }
    rows.motors.push(...await fetchAll("motor_pretest_stats", "race_date,venue_code,racer_id,motor_number,motor_2rate", (q) => q.eq("venue_code", s.venue_code).eq("race_date", s.start_date).order("race_date").order("venue_code").order("racer_id")));
  }
  for (const [key, id] of [["races", "race_id"], ["conditions", "race_id"], ["entries", "boat_number"], ["exhibitions", "boat_number"]]) {
    rows[key] = [...new Map(rows[key].map((r) => [`${r.race_id}-${r[id]}`, r])).values()];
  }
  return setsuExhibitionOf(date, rows);
}

async function main() {
  const date = process.argv[2];
  if (!validDate(date)) {
    console.error("使い方: node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }
  if (!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exitCode = 2;
    return;
  }
  try {
    const { fetchAll } = await import("../lib/supabaseClient.js");
    console.log(JSON.stringify(await readSetsuExhibition(date, fetchAll), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
