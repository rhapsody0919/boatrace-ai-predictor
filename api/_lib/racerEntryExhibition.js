/**
 * 6艇の「進入傾向」と「今節の展示タイム順位」（BOA-855。毎日の全貌 Shorts の場面6〜7が使う）。
 *
 * /api/analogy/facts/{raceId}?include=racers のときだけ読む。画面は include を渡さないので、
 * ソナー・思考アシストの応答と負荷は変わらない。
 *
 * - 進入傾向: racer_aggregated_stats.course_entry_tendency（venue_code=0 の行、直近1年。
 *   scripts/lib/courseEntryTendency.js）。全会場の枠番→実進入コースの回数と、このレースの会場の分
 * - 今節の展示: 節の初日からこのレースより前の各走で、そのレースの中での展示タイムの順位（1が最速、
 *   同着は同順位）。今節タブ（getMeetScoreboard の meetRunsByRacer・展示の順位）と同じ定義で、
 *   このレース自身の展示は含まない
 */
import { findMeetStartDate } from "../../src/utils/meetGrouping.js";
import { rest } from "./analogyV16.js";

// 節は最長でも7日程度。表示日から9日前までを見れば前節との境目が入る（getMeetScoreboard と同じ窓）。
// 出走表は10日 × 12R × 6艇 = 最大720行で、PostgREST の既定上限1000行に収まる
const WINDOW_DAYS = 9;

function shiftDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 窓の開催日ごとの種別から節の初日を決める（getMeetScoreboard と同じ材料の組み方） */
export function meetStartOf(windowEntries, windowConditions, date) {
  const conditionByDate = new Map();
  for (const c of windowConditions) {
    const d = c.race_id.slice(0, 10);
    const cur = conditionByDate.get(d) ?? {
      seriesDay: null,
      isFinalDay: false,
    };
    if (
      c.series_day != null &&
      (cur.seriesDay == null || c.series_day < cur.seriesDay)
    )
      cur.seriesDay = c.series_day;
    if (c.is_final_day) cur.isFinalDay = true;
    conditionByDate.set(d, cur);
  }
  const days = [...new Set(windowEntries.map((r) => r.race_id.slice(0, 10)))];
  return (
    findMeetStartDate(
      days.map((d) => ({
        date: d,
        seriesDay: conditionByDate.get(d)?.seriesDay ?? null,
        // 種別が1行も取れていない日は「分からない」（false＝最終日でない、と区別する）
        isFinalDay: conditionByDate.has(d)
          ? conditionByDate.get(d).isFinalDay
          : null,
      })),
      date,
    ) ?? date
  );
}

/**
 * 取得済みの行から6艇ぶんを組み立てる（純関数）
 * @returns {{meet_start: string, boats: object[]}|null} このレースの出走表が無ければ null
 */
export function buildRacers({
  raceId,
  windowEntries,
  windowConditions,
  stats,
  exhibitionRows,
}) {
  const own = windowEntries
    .filter((e) => e.race_id === raceId)
    .sort((a, b) => a.boat_number - b.boat_number);
  if (own.length === 0) return null;
  const date = raceId.slice(0, 10);
  const venueKey = String(Number(raceId.slice(11, 13)));
  const meetStart = meetStartOf(windowEntries, windowConditions, date);

  const timesByRace = new Map();
  for (const r of exhibitionRows) {
    if (r.exhibition_time === null || r.exhibition_time === undefined) continue;
    if (!timesByRace.has(r.race_id)) timesByRace.set(r.race_id, new Map());
    timesByRace.get(r.race_id).set(r.boat_number, Number(r.exhibition_time));
  }
  const tendencyByRacer = new Map(
    stats.map((s) => [s.racer_id, s.course_entry_tendency]),
  );

  const boats = own.map((e) => {
    const tendency = tendencyByRacer.get(e.racer_id) ?? null;
    // racer_id が NULL の行どうしを同じ選手とみなさない（NULL の行が節の他の艇の走を拾う）
    const meetRuns = windowEntries
      .filter(
        (r) =>
          e.racer_id != null &&
          r.racer_id === e.racer_id &&
          r.race_id.slice(0, 10) >= meetStart &&
          r.race_id < raceId,
      )
      .sort((a, b) => a.race_id.localeCompare(b.race_id))
      .map((r) => {
        const times = timesByRace.get(r.race_id);
        const mine = times?.get(r.boat_number) ?? null;
        const field = times ? [...times.values()] : [];
        return {
          race_id: r.race_id,
          boat_number: r.boat_number,
          exhibition_time: mine,
          // 同着は同順位（1,1,3…）。展示は小数2桁で同着が起きる
          exhibition_rank:
            mine === null ? null : field.filter((v) => v < mine).length + 1,
          // 順位の母数（展示タイムがあった艇の数。欠場があると6未満）
          exhibition_field: field.length,
        };
      });
    return {
      boat_number: e.boat_number,
      racer_id: e.racer_id,
      course_entry: tendency
        ? {
            since: tendency.since,
            all: tendency.all ?? {},
            venue: tendency.venues?.[venueKey] ?? null,
          }
        : null,
      meet_runs: meetRuns,
    };
  });
  return { meet_start: meetStart, boats };
}

/** 本番の行を読んで buildRacers に渡す（往復2回: 窓の出走表・種別 → 進入傾向・今節の展示） */
export async function loadRacers(raceId) {
  const date = raceId.slice(0, 10);
  const like = `like.__________-${raceId.slice(11, 13)}-__`;
  const windowRange = `race_id=gte.${shiftDays(date, -WINDOW_DAYS)}&race_id=lte.${date}-zz&race_id=${like}`;
  const [windowEntries, windowConditions] = await Promise.all([
    rest(`race_entries?select=race_id,boat_number,racer_id&${windowRange}`),
    rest(
      `race_conditions?select=race_id,series_day,is_final_day&${windowRange}`,
    ),
  ]);
  const racerIds = [
    ...new Set(
      windowEntries
        .filter((e) => e.race_id === raceId && e.racer_id != null)
        .map((e) => e.racer_id),
    ),
  ];
  if (racerIds.length === 0) return null;
  const meetStart = meetStartOf(windowEntries, windowConditions, date);
  const [stats, exhibitionRows] = await Promise.all([
    rest(
      `racer_aggregated_stats?select=racer_id,course_entry_tendency&venue_code=eq.0&racer_id=in.(${racerIds.join(",")})`,
    ),
    // 節は最長7日 × 12R × 6艇 = 504行で、既定上限1000行に収まる
    rest(
      `exhibition_data?select=race_id,boat_number,exhibition_time&race_id=gte.${meetStart}&race_id=lt.${encodeURIComponent(raceId)}&race_id=${like}`,
    ),
  ]);
  return buildRacers({
    raceId,
    windowEntries,
    windowConditions,
    stats,
    exhibitionRows,
  });
}
