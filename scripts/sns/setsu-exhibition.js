/**
 * 節初日〜指定日の展示の材料を JSON で出す。読み取りのみ・送信なし。
 * node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>
 * 環境変数: SUPABASE_URL（または VITE_SUPABASE_URL）・SUPABASE_SERVICE_KEY
 * stdout は JSON だけ（読み手の hq が JSON として読む）。ログ・エラーは stderr。
 * exit: 0 成功 / 2 日付・設定・読み取りの失敗。本番での実行は取り込み側が行う。
 */
import { pathToFileURL } from "node:url";
import { isRaceCancelled } from "../../src/utils/raceCancellation.js";
import {
  seriesCoveringDate,
  SERIES_POSTPONE_TOLERANCE_DAYS,
} from "../../src/utils/meetPageModel.js";
import {
  getRaceStageKey,
  isFinalStage,
} from "../../src/pure/raceStageConfig.js";

const daysFrom = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
const validDate = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
const sameVenue = (a, b) => Number(a) === Number(b);
const byRace = (a, b) => a.race_id.localeCompare(b.race_id);

/** 会場ごとに、date 以前に始まったいちばん新しい節。date を含まなければ（順延の許容を過ぎていれば）出さない。 */
function latestSeriesByVenue(series, date) {
  const latest = new Map();
  for (const s of series) {
    if (s.start_date > date) continue;
    const key = Number(s.venue_code);
    if (!latest.has(key) || latest.get(key).start_date < s.start_date)
      latest.set(key, s);
  }
  return [...latest.values()]
    .map((s) => seriesCoveringDate(s, date))
    .filter(Boolean);
}

/** 締切予定時刻（races.start_time、HH:MM[:SS]）を ISO 8601 +09:00 にする。 */
const deadlineOf = (date, startTime) => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(startTime ?? "");
  return m ? `${date}T${m[1]}:${m[2]}:${m[3] ?? "00"}+09:00` : null;
};

/**
 * 優勝戦の出場者。出走表（race_entries）があればそれ、無ければ準優の各レースの1・2着（枠は未定）。
 * 着は race_results の rank1・rank2（艇番。失格・転覆等は着に入らない）。中止のレースは使わない。
 */
function finalEntriesOf(
  { finalRaces, semifinalRaces },
  { stageOf, entriesOf, resultOf, cancelled },
) {
  const finals = finalRaces.filter(
    (r) => isFinalStage(stageOf(r)) && !cancelled(r),
  );
  const finalEntries = finals
    .flatMap(entriesOf)
    .filter((e) => e.racer_id != null);
  if (finalEntries.length) {
    return finalEntries
      .sort((a, b) => a.boat_number - b.boat_number)
      .map((e) => ({
        boat_number: e.boat_number,
        racer_id: e.racer_id,
        source: "entries",
      }));
  }
  const top2 = [];
  for (const race of semifinalRaces.filter(
    (r) => getRaceStageKey(stageOf(r)) === "semifinal" && !cancelled(r),
  )) {
    const result = resultOf(race);
    if (!result || result.is_cancelled) continue;
    for (const boat of [result.rank1, result.rank2]) {
      const racerId = entriesOf(race).find(
        (e) => e.boat_number === boat,
      )?.racer_id;
      if (
        boat != null &&
        racerId != null &&
        !top2.some((t) => t.racer_id === racerId)
      )
        top2.push({
          boat_number: null,
          racer_id: racerId,
          source: "semifinal_top2",
        });
    }
  }
  return top2;
}

/** 行から出力を作る純粋関数。同タイムは method=min、日をまたいで秒数を比べない。 */
export function setsuExhibitionOf(
  date,
  {
    series = [],
    races = [],
    conditions = [],
    entries = [],
    exhibitions = [],
    motors = [],
    results = [],
  } = {},
) {
  const venuesToday = races.filter((r) => r.race_date === date);
  const active = latestSeriesByVenue(series, date).filter((s) =>
    venuesToday.some((r) => sameVenue(r.venue_code, s.venue_code)),
  );
  const conditionById = new Map(conditions.map((c) => [c.race_id, c]));
  const resultById = new Map(results.map((r) => [r.race_id, r]));
  const exhibitionByBoat = new Map(
    exhibitions.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
  );
  const entriesOf = (race) => entries.filter((e) => e.race_id === race.race_id);
  const cancelled = (race) =>
    isRaceCancelled({
      cancellationStatus: race.cancellation_status,
      result: resultById.get(race.race_id) ?? null,
    });
  const meets = active
    .sort((a, b) => Number(a.venue_code) - Number(b.venue_code))
    .map((s) => {
      // s はその会場で date 以前に始まったいちばん新しい節なので、start_date 以降の走は全部この節のもの。
      // 翌日の分は優勝戦の出走表（前夜の時点で入っていれば）を拾うためだけに使う。
      const meetRacesWithNext = races
        .filter(
          (r) =>
            sameVenue(r.venue_code, s.venue_code) &&
            r.race_date >= s.start_date &&
            r.race_date <= daysFrom(date, 1),
        )
        .sort(byRace);
      const meetRaces = meetRacesWithNext.filter((r) => r.race_date <= date);
      const todayRaces = meetRaces.filter((r) => r.race_date === date);
      const todayConditions = todayRaces
        .map((r) => conditionById.get(r.race_id))
        .filter(Boolean);
      const seriesDays = todayConditions
        .map((c) => c.series_day)
        .filter((d) => d != null);
      const racers = new Map();
      for (const race of meetRaces) {
        if (cancelled(race)) continue;
        const boats = entriesOf(race);
        const timeOf = (entry) => {
          const ex = exhibitionByBoat.get(
            `${race.race_id}-${entry.boat_number}`,
          );
          return entry.is_absent || ex?.is_absent || ex?.exhibition_time == null
            ? null
            : Number(ex.exhibition_time);
        };
        const times = boats
          .map(timeOf)
          .filter((t) => t != null && Number.isFinite(t));
        for (const entry of boats) {
          if (entry.racer_id == null) continue;
          if (!racers.has(entry.racer_id)) {
            const motor = motors.find(
              (m) =>
                m.race_date === s.start_date &&
                sameVenue(m.venue_code, s.venue_code) &&
                m.racer_id === entry.racer_id &&
                m.motor_number === entry.motor_number,
            );
            racers.set(entry.racer_id, {
              racer_id: entry.racer_id,
              name: entry.player_name,
              class: entry.grade ?? null,
              motor_number: entry.motor_number,
              motor_2rate_at_start: motor?.motor_2rate ?? null,
              runs: [],
            });
          }
          const racer = racers.get(entry.racer_id);
          if (entry.grade != null) racer.class = entry.grade; // 走は race_id の昇順なので、最後に入るのがいちばん新しい級
          const ex = exhibitionByBoat.get(
            `${race.race_id}-${entry.boat_number}`,
          );
          const time = timeOf(entry);
          racer.runs.push({
            race_id: race.race_id,
            date: race.race_date,
            race_number: race.race_number,
            race_stage: conditionById.get(race.race_id)?.race_stage ?? null,
            boat_number: entry.boat_number,
            exhibition_time: ex?.exhibition_time ?? null,
            exhibition_rank:
              time == null || !Number.isFinite(time)
                ? null
                : 1 + times.filter((t) => t < time).length,
            exhibition_course: ex?.exhibition_course ?? null,
          });
        }
      }
      const firstRace = todayRaces.find((r) => Number(r.race_number) === 1);
      return {
        meet_id: `${s.venue_code}-${s.start_date}`,
        venue_code: s.venue_code,
        start_date: s.start_date,
        end_date: s.end_date,
        title: s.title,
        grade: s.grade,
        series_day: seriesDays.length ? Math.min(...seriesDays) : null,
        is_final_day: todayConditions.length
          ? todayConditions.some((c) => c.is_final_day === true)
          : null,
        first_race_deadline: deadlineOf(date, firstRace?.start_time),
        final_entries: finalEntriesOf(
          { finalRaces: meetRacesWithNext, semifinalRaces: meetRaces },
          {
            stageOf: (r) => conditionById.get(r.race_id)?.race_stage ?? null,
            entriesOf,
            cancelled,
            resultOf: (r) => resultById.get(r.race_id) ?? null,
          },
        ),
        racers: [...racers.values()].sort((a, b) => a.racer_id - b.racer_id),
      };
    });
  return { date, meets };
}

const RACE_COLUMNS =
  "race_id,race_date,venue_code,race_number,start_time,cancellation_status";

/** fetchAll を注入可能にして、DB に接続せず読み取り範囲も検証する。 */
export async function readSetsuExhibition(date, fetchAll) {
  const today = await fetchAll("races", RACE_COLUMNS, (q) =>
    q.eq("race_date", date).order("race_id"),
  );
  if (!today.length) return { date, meets: [] };
  // end_date の下限は読む量を絞るためだけ。どの節を使うかは setsuExhibitionOf（会場ごとに最新の1つ）が決める。
  const allSeries = await fetchAll(
    "race_series",
    "venue_code,start_date,end_date,title,grade",
    (q) =>
      q
        .in("venue_code", [...new Set(today.map((r) => r.venue_code))])
        .lte("start_date", date)
        .gte("end_date", daysFrom(date, -SERIES_POSTPONE_TOLERANCE_DAYS))
        .order("venue_code")
        .order("start_date"),
  );
  const series = latestSeriesByVenue(allSeries, date);
  const rows = {
    series,
    races: [],
    conditions: [],
    entries: [],
    exhibitions: [],
    motors: [],
    results: [],
  };
  // 節ごと・race_id は100件ずつに分け、URL 長と全件読み取りを両立する。
  for (const s of series) {
    const races = await fetchAll("races", RACE_COLUMNS, (q) =>
      q
        .eq("venue_code", s.venue_code)
        .gte("race_date", s.start_date)
        .lte("race_date", daysFrom(date, 1))
        .order("race_id"),
    );
    rows.races.push(...races);
    const ids = races.map((r) => r.race_id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      rows.conditions.push(
        ...(await fetchAll(
          "race_conditions",
          "race_id,series_day,is_final_day,race_stage",
          (q) => q.in("race_id", batch).order("race_id"),
        )),
      );
      rows.entries.push(
        ...(await fetchAll(
          "race_entries",
          "race_id,boat_number,racer_id,player_name,grade,motor_number,is_absent",
          (q) => q.in("race_id", batch).order("race_id").order("boat_number"),
        )),
      );
      rows.exhibitions.push(
        ...(await fetchAll(
          "exhibition_data",
          "race_id,boat_number,exhibition_time,exhibition_course,is_absent",
          (q) => q.in("race_id", batch).order("race_id").order("boat_number"),
        )),
      );
      rows.results.push(
        ...(await fetchAll(
          "race_results",
          "race_id,rank1,rank2,is_cancelled",
          (q) => q.in("race_id", batch).order("race_id"),
        )),
      );
    }
    rows.motors.push(
      ...(await fetchAll(
        "motor_pretest_stats",
        "race_date,venue_code,racer_id,motor_number,motor_2rate",
        (q) =>
          q
            .eq("venue_code", s.venue_code)
            .eq("race_date", s.start_date)
            .order("race_date")
            .order("venue_code")
            .order("racer_id"),
      )),
    );
  }
  return setsuExhibitionOf(date, rows);
}

async function main() {
  const date = process.argv[2];
  if (!validDate(date)) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/setsu-exhibition.js <YYYY-MM-DD>",
    );
    process.exitCode = 2;
    return;
  }
  if (
    !(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) ||
    !process.env.SUPABASE_SERVICE_KEY
  ) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exitCode = 2;
    return;
  }
  try {
    // supabaseClient.js の dotenv.config() は既定で stdout に注入のログを出す。stdout を JSON だけにするため止める。
    process.env.DOTENV_CONFIG_QUIET = "true";
    const { fetchAll } = await import("../lib/supabaseClient.js");
    process.stdout.write(
      `${JSON.stringify(await readSetsuExhibition(date, fetchAll), null, 2)}\n`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
