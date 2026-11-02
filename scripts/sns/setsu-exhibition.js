/** 節初日〜指定日の展示材料。送信・書き込みはしない。
 * node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>
 */
import { pathToFileURL } from "node:url";
import { isRaceCancelled } from "../../src/utils/raceCancellation.js";

const day = (date) => Date.parse(`${date}T00:00:00Z`);
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") &&
  Number.isFinite(day(date)) && new Date(day(date)).toISOString().slice(0, 10) === date;
const compareId = (a, b) => a.race_id.localeCompare(b.race_id);

/** DAL getSeriesOfDate と同じく、会場ごとの最新の節を優先し順延を3日許容。 */
function meetsOf(date, series, races) {
  const venues = new Set(races.filter((r) => r.race_date === date).map((r) => r.venue_code));
  const latest = new Map();
  for (const s of series) {
    if (!venues.has(s.venue_code) || s.start_date > date) continue;
    if (!latest.has(s.venue_code) || latest.get(s.venue_code).start_date < s.start_date)
      latest.set(s.venue_code, s);
  }
  return [...latest.values()].filter((s) => day(date) - day(s.end_date) <= 3 * 86400000)
    .sort((a, b) => a.venue_code - b.venue_code);
}

/** DB の行だけから JSON を作る。秒数はレースをまたいで比較しない。 */
export function setsuExhibitionOf(date, {
  series = [], races = [], conditions = [], entries = [], exhibitions = [], pretests = [],
} = {}) {
  if (!validDate(date)) throw new Error("日付は YYYY-MM-DD で指定してください");
  const conditionById = new Map(conditions.map((r) => [r.race_id, r]));
  const exhibitionByBoat = new Map(exhibitions.map((r) => [`${r.race_id}/${r.boat_number}`, r]));
  const entriesByRace = new Map();
  for (const e of entries) {
    if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
    entriesByRace.get(e.race_id).push(e);
  }
  return { date, meets: meetsOf(date, series, races).map((s) => {
    const meetRaces = races.filter((r) => r.venue_code === s.venue_code &&
      r.race_date >= s.start_date && r.race_date <= date).sort(compareId);
    const today = meetRaces.filter((r) => r.race_date === date)
      .map((r) => conditionById.get(r.race_id)).filter(Boolean);
    const days = today.map((r) => r.series_day).filter((d) => d != null);
    const racers = new Map();
    for (const r of meetRaces) {
      if (isRaceCancelled({ cancellationStatus: r.cancellation_status })) continue;
      const boats = (entriesByRace.get(r.race_id) ?? []).map((e) => {
        const x = exhibitionByBoat.get(`${r.race_id}/${e.boat_number}`);
        const time = x?.exhibition_time ?? null;
        return { e, x, time, eligible: !e.is_absent && !x?.is_absent && time != null };
      });
      for (const { e, x, time, eligible } of boats) {
        if (e.racer_id == null) throw new Error(`${r.race_id}: racer_id が無い出走があります`);
        if (!racers.has(e.racer_id)) {
          const p = pretests.find((p) => p.venue_code === s.venue_code &&
            p.race_date === s.start_date && p.racer_id === e.racer_id);
          racers.set(e.racer_id, { racer_id: e.racer_id, name: e.player_name ?? null,
            motor_number: e.motor_number ?? null, motor_2rate_at_start: p?.motor_2rate ?? null, runs: [] });
        }
        racers.get(e.racer_id).runs.push({ race_id: r.race_id, date: r.race_date,
          race_number: r.race_number, race_stage: conditionById.get(r.race_id)?.race_stage ?? null,
          boat_number: e.boat_number, exhibition_time: time,
          exhibition_rank: eligible ? 1 + boats.filter((b) => b.eligible &&
            Number(b.time) < Number(time)).length : null,
          exhibition_course: x?.exhibition_course ?? null });
      }
    }
    return { meet_id: `${s.venue_code}-${s.start_date}`, venue_code: s.venue_code,
      start_date: s.start_date, end_date: s.end_date, title: s.title ?? null, grade: s.grade ?? null,
      series_day: days.length ? Math.min(...days) : null,
      is_final_day: today.some((r) => r.is_final_day === true),
      racers: [...racers.values()].sort((a, b) => a.racer_id - b.racer_id) };
  }) };
}

/** fetchAll を注入できる読み取り。主キー順でページングし、節ごとに取得を分ける。 */
export async function readSetsuExhibition(date, fetchAll) {
  if (!validDate(date)) throw new Error("日付は YYYY-MM-DD で指定してください");
  const raceColumns = "race_id,race_date,venue_code,race_number,cancellation_status";
  const today = await fetchAll("races", raceColumns, (q) => q.eq("race_date", date).order("race_id"));
  if (!today.length) return { date, meets: [] };
  const series = await fetchAll("race_series", "venue_code,start_date,end_date,title,grade",
    (q) => q.in("venue_code", [...new Set(today.map((r) => r.venue_code))])
      .lte("start_date", date).order("venue_code").order("start_date"));
  const meets = [];
  for (const s of meetsOf(date, series, today)) {
    const races = await fetchAll("races", raceColumns, (q) => q.eq("venue_code", s.venue_code)
      .gte("race_date", s.start_date).lte("race_date", date).order("race_id"));
    const rows = { series: [s], races, conditions: [], entries: [], exhibitions: [], pretests: [] };
    // IN の URL が長くならないよう100レースずつ読む。
    for (let i = 0; i < races.length; i += 100) {
      const ids = races.slice(i, i + 100).map((r) => r.race_id);
      for (const [key, table, columns] of [
        ["conditions", "race_conditions", "race_id,series_day,is_final_day,race_stage"],
        ["entries", "race_entries", "race_id,boat_number,racer_id,player_name,motor_number,is_absent"],
        ["exhibitions", "exhibition_data", "race_id,boat_number,exhibition_time,exhibition_course,is_absent"],
      ]) rows[key].push(...await fetchAll(table, columns, (q) => {
        const ordered = q.in("race_id", ids).order("race_id");
        return key === "conditions" ? ordered : ordered.order("boat_number");
      }));
    }
    rows.pretests = await fetchAll("motor_pretest_stats", "race_date,venue_code,racer_id,motor_number,motor_2rate",
      (q) => q.eq("venue_code", s.venue_code).eq("race_date", s.start_date)
        .order("race_date").order("venue_code").order("racer_id"));
    meets.push(...setsuExhibitionOf(date, rows).meets);
  }
  return { date, meets };
}

async function main() {
  const date = process.argv[2];
  if (!validDate(date)) {
    console.error("使い方: node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }
  try {
    // 純関数の import では鍵を読むクライアントを読み込まない。
    const { fetchAll, isSupabaseEnabled } = await import("../lib/supabaseClient.js");
    if (!isSupabaseEnabled()) throw new Error("SUPABASE_URL・SUPABASE_SERVICE_KEY がありません");
    console.log(JSON.stringify(await readSetsuExhibition(date, fetchAll), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
