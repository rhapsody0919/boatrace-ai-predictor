/**
 * 6艇の「進入傾向」と「今節の展示タイム順位」（BOA-855。毎日の全貌 Shorts の場面6〜7が使う）。
 *
 * /api/analogy/facts/{raceId}?include=racers のときだけ読む。画面は include を渡さないので、
 * ソナー・思考アシストの応答と負荷は変わらない。
 *
 * - 進入傾向: racer_aggregated_stats.course_entry_tendency（venue_code=0 の行、直近1年。
 *   scripts/lib/courseEntryTendency.js）。全会場の枠番→実進入コースの回数と、このレースの会場の分。
 *   行は毎晩 23:00 JST に上書きされ、実進入コースは翌日に入るため、集計の対象期間の終わりは
 *   calculated_at の JST 日付の前日（2026-10-12 の実測: 10/12 に走った13人とも 10/11 までの件数と一致）。
 *   レースの日付がその終わりの日以前なら、このレース自身や後の出走が混ざるので course_entry=null・
 *   after_race=true にする（BOA-860。終わりの日のレースは自分の結果が入っているので「以前」に含める）
 * - 今節の展示: 節の初日からこのレースより前の各走で、そのレースの中での展示タイムの順位（1が最速、
 *   同着は同順位）。今節タブ（getMeetScoreboard の meetRunsByRacer・展示の順位）と同じ定義で、
 *   このレース自身の展示は含まない。中止が確定したレース（races.cancellation_status='confirmed'）のうち
 *   展示も無いものは外す（出走表は残るため、外さないと展示の無い走として並ぶ）。展示の後に中止になった
 *   レース（実例: 2026-09-21 三国10R）は展示の値があるので残す（今節タブも展示の点として出す）
 * - 各走の state（BOA-860）: ok（展示タイムあり）・absent（exhibition_data.is_absent）・missing（締切後・
 *   中止でない・展示の行が無い、欠場でもない＝取得漏れか取り込み前）。締切前のレース（同じ日のまだ
 *   走っていないレース）は「今節の各走」に入れない（実例: 2026-10-13 朝の 12-06 で 12-01 が展示なしで並んだ）。
 *   応答が時刻で変わるが、締切前の応答のキャッシュは60秒なので遅れても60秒。このレースの締切後は
 *   前のレースもすべて締切後なので、1日のキャッシュでも古くならない
 */
import { findMeetStartDate } from "../../src/utils/meetGrouping.js";
import { deadlineOf, rest } from "./analogyV16.js";

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

/** timestamptz を JST の日付（YYYY-MM-DD）に */
function jstDate(timestamp) {
  return new Date(new Date(timestamp).getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 進入傾向の集計の対象期間の終わり（calculated_at の JST 日付の前日）。calculated_at が無ければ null
 */
export function tendencyThrough(calculatedAt) {
  return calculatedAt ? shiftDays(jstDate(calculatedAt), -1) : null;
}

/**
 * 取得済みの行から6艇ぶんを組み立てる（純関数）
 * @param {object} p
 * @param {Array<{race_id:string, race_date?:string, start_time?:string, cancellation_status?:string|null}>} [p.raceRows]
 *   節のこのレースより前のレース（締切と中止の判定に使う）
 * @param {Date} p.now 締切前かの判定に使う時刻
 * @returns {{meet_start: string, boats: object[]}|null} このレースの出走表が無ければ null
 */
export function buildRacers({
  raceId,
  windowEntries,
  windowConditions,
  stats,
  exhibitionRows,
  raceRows = [],
  now = new Date(),
}) {
  const raceById = new Map(raceRows.map((r) => [r.race_id, r]));
  const cancelled = (id) =>
    raceById.get(id)?.cancellation_status === "confirmed";
  // 締切が分からないレース（races の行や発走時刻が無い）は締切後として扱う（過去の日の行は揃っている）
  const beforeDeadline = (id) => {
    const deadline = deadlineOf(raceById.get(id));
    return deadline !== null && now.getTime() <= deadline.getTime();
  };
  const own = windowEntries
    .filter((e) => e.race_id === raceId)
    .sort((a, b) => a.boat_number - b.boat_number);
  if (own.length === 0) return null;
  const date = raceId.slice(0, 10);
  const venueKey = String(Number(raceId.slice(11, 13)));
  const meetStart = meetStartOf(windowEntries, windowConditions, date);

  const timesByRace = new Map();
  const absent = new Set();
  for (const r of exhibitionRows) {
    if (r.is_absent) absent.add(`${r.race_id}#${r.boat_number}`);
    if (r.exhibition_time === null || r.exhibition_time === undefined) continue;
    if (!timesByRace.has(r.race_id)) timesByRace.set(r.race_id, new Map());
    timesByRace.get(r.race_id).set(r.boat_number, Number(r.exhibition_time));
  }
  const statByRacer = new Map(stats.map((s) => [s.racer_id, s]));

  const boats = own.map((e) => {
    const stat = statByRacer.get(e.racer_id) ?? null;
    const tendency = stat?.course_entry_tendency ?? null;
    const through = tendencyThrough(stat?.calculated_at);
    const afterRace = tendency !== null && through !== null && date <= through;
    // racer_id が NULL の行どうしを同じ選手とみなさない（NULL の行が節の他の艇の走を拾う）
    const meetRuns = windowEntries
      .filter(
        (r) =>
          e.racer_id != null &&
          r.racer_id === e.racer_id &&
          r.race_id.slice(0, 10) >= meetStart &&
          r.race_id < raceId &&
          !(cancelled(r.race_id) && !timesByRace.has(r.race_id)) &&
          // 締切前（まだ走っていない）レースは今節の走に入れない
          !beforeDeadline(r.race_id),
      )
      .sort((a, b) => a.race_id.localeCompare(b.race_id))
      .map((r) => {
        const times = timesByRace.get(r.race_id);
        const mine = times?.get(r.boat_number) ?? null;
        const field = times ? [...times.values()] : [];
        const state =
          mine !== null
            ? "ok"
            : absent.has(`${r.race_id}#${r.boat_number}`)
              ? "absent"
              : "missing";
        return {
          race_id: r.race_id,
          boat_number: r.boat_number,
          state,
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
      // after_race のときは、集計がこのレース以後の出走を含むので出さない
      course_entry:
        tendency && !afterRace
          ? {
              since: tendency.since,
              calculated_at: stat.calculated_at,
              all: tendency.all ?? {},
              venue: tendency.venues?.[venueKey] ?? null,
            }
          : null,
      after_race: afterRace,
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
  const meetRange = `race_id=gte.${meetStart}&race_id=lt.${encodeURIComponent(raceId)}&race_id=${like}`;
  const [stats, exhibitionRows, raceRows] = await Promise.all([
    rest(
      `racer_aggregated_stats?select=racer_id,course_entry_tendency,calculated_at&venue_code=eq.0&racer_id=in.(${racerIds.join(",")})`,
    ),
    // 節は最長7日 × 12R × 6艇 = 504行で、既定上限1000行に収まる
    rest(
      `exhibition_data?select=race_id,boat_number,exhibition_time,is_absent&${meetRange}`,
    ),
    // 節のこのレースより前のレース（最長7日 × 12R = 84行）。締切と中止の判定に使う
    rest(
      `races?select=race_id,race_date,start_time,cancellation_status&${meetRange}`,
    ),
  ]);
  return buildRacers({
    raceId,
    windowEntries,
    windowConditions,
    stats,
    exhibitionRows,
    raceRows,
    now: new Date(),
  });
}
