/**
 * facts の main 層（race_facts・run_facts の era='main'、2025-12-03〜）を本体の表から組み立て直す Cron の本体
 * （api/cron/race-facts-main.js、ADR-0113 決定3）。外部サイトへの通信は無い（DB の中の組み立て。ADR-0066 改訂1）。
 *
 * - 毎回（30分ごと）: 前日と当日を組み立て直す（選手ページの今節の着順を夜まで遅らせない）
 * - JST 01〜05時の起動では、加えて main の古い半月を1つずつ順に組み立て直す（後からの訂正を拾う）。進みは cursor
 *   （共通ラッパの scrape_job_state.cursor）に「次の半月の始まりの日」で持ち、末まで行ったら最初に戻る
 * - 変わった行だけを書き、窓の中で組み立て直した行に無い facts の main の行を消す。消える行が窓の既存の2割を超えたら書かずに止める
 * 読み書きは deps で受ける（verify は偽の関数で確かめる）
 */
import { MAIN_TABLES_START } from "./kbArchiveBoundary.js";
import { halfMonthRanges, addDays } from "./racerCareerSeries.js";
import { MAX_STALE_RATIO } from "./racerCareerCore.js";
import { buildMainRaceFact, buildMainRunFacts } from "./raceFactsMain.js";
import { fetchAll } from "./supabaseClient.js";
import { upsertChangedRows } from "./unchangedRows.js";
import { loadJudgeInputs } from "./racerCareerDb.js";

/** 窓の既存の行のキーのうち、組み立てた行に無い物 */
export const staleKeysOf = (existing, built) => {
  const set = new Set(built);
  return existing.filter((k) => !set.has(k));
};

export const NIGHT_HOURS_JST = Object.freeze({ from: 1, to: 5 });

/**
 * その起動で組み立てる窓（[from, to)）と、次の cursor
 * @param {{ today: string, hourJst: number, cursor: string|null }} input
 */
export function windowsFor({ today, hourJst, cursor }) {
  const recentFrom = addDays(today, -1) < MAIN_TABLES_START ? MAIN_TABLES_START : addDays(today, -1);
  const windows = [{ from: recentFrom, to: addDays(today, 1) }];
  if (hourJst < NIGHT_HOURS_JST.from || hourJst >= NIGHT_HOURS_JST.to || recentFrom <= MAIN_TABLES_START) {
    return { windows, nextCursor: cursor };
  }
  const halves = halfMonthRanges(MAIN_TABLES_START, addDays(recentFrom, -1));
  const i = Math.max(0, halves.findIndex((h) => h.from === cursor));
  windows.push(halves[i]);
  return { windows, nextCursor: halves[(i + 1) % halves.length].from };
}

/** 1つの窓の行（純関数）。parts は race_id ごとの本体の行 */
export function buildMainWindowRows({ races, entries, results, timings, exhibitions, conditions, seriesOf }, overrideGrades) {
  const by = (rows, key = "race_id") => {
    const m = new Map();
    for (const r of rows) m.set(r[key], [...(m.get(r[key]) ?? []), r]);
    return m;
  };
  const [entriesOf, timingsOf, exhibitionsOf] = [by(entries), by(timings), by(exhibitions)];
  const resultOf = new Map(results.map((r) => [r.race_id, r]));
  const conditionsOf = new Map(conditions.map((c) => [c.race_id, c]));
  const raceRows = [];
  const runRows = [];
  for (const race of races) {
    const result = resultOf.get(race.race_id) ?? null;
    raceRows.push(buildMainRaceFact({
      race, result, conditions: conditionsOf.get(race.race_id) ?? null, series: seriesOf(race), override: overrideGrades.get(race.race_id) ?? null,
    }));
    runRows.push(...buildMainRunFacts(race, entriesOf.get(race.race_id) ?? [], {
      result, timings: timingsOf.get(race.race_id) ?? [], exhibitions: exhibitionsOf.get(race.race_id) ?? [],
    }));
  }
  return { raceRows, runRows };
}

/**
 * @param {{ today: string, hourJst: number, cursor: string|null, allowMassDelete?: boolean, log?: (s: string) => void,
 *   loadOverrides: (range: object) => Promise<{raceIds: string[], grades: string[]}>,
 *   fetchWindow: (range: object) => Promise<object>, fetchExistingKeys: (range: object) => Promise<{race: string[], run: string[]}>,
 *   writeWindow: (plan: object) => Promise<{written: number}> }} deps
 */
export async function runRaceFactsMainJob({
  today, hourJst, cursor, loadOverrides, fetchWindow, fetchExistingKeys, writeWindow, allowMassDelete = false, log = console.log,
}) {
  const { windows, nextCursor } = windowsFor({ today, hourJst, cursor });
  const totals = { races: 0, runs: 0, written: 0, stale: 0 };
  for (const range of windows) {
    const overrides = await loadOverrides(range);
    const overrideGrades = new Map(overrides.raceIds.map((id, i) => [id, overrides.grades[i]]));
    const { raceRows, runRows } = buildMainWindowRows(await fetchWindow(range), overrideGrades);
    const existing = await fetchExistingKeys(range);
    const staleRace = staleKeysOf(existing.race, raceRows.map((r) => r.race_id));
    const staleRun = staleKeysOf(existing.run, runRows.map((r) => `${r.race_id}|${r.boat_number}`));
    const before = existing.race.length + existing.run.length;
    const stale = staleRace.length + staleRun.length;
    if (!allowMassDelete && before > 0 && stale / before > MAX_STALE_RATIO) {
      throw new Error(`${range.from}〜${range.to}: 消える行が既存の ${stale}/${before} で ${MAX_STALE_RATIO * 100}% を超える。書かずに止める`);
    }
    const { written } = await writeWindow({ range, raceRows, runRows, staleRace, staleRun });
    Object.assign(totals, {
      races: totals.races + raceRows.length, runs: totals.runs + runRows.length, written: totals.written + written, stale: totals.stale + stale,
    });
    log(`${range.from}〜${range.to}: レース ${raceRows.length}・艇 ${runRows.length}・書く ${written}・消す ${stale}`);
  }
  return { totals, windows, nextCursor };
}

/** 同じ会場で日付を含む節（始まりの遅い方）。race_series は節ごとの1行 */
export function seriesFinder(series) {
  return (race) =>
    series
      .filter((s) => s.venue_code === race.venue_code && s.start_date <= race.race_date && race.race_date <= s.end_date)
      .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0] ?? null;
}

const byRange = (q, { from, to }) => q.gte("race_id", from).lt("race_id", to);
const MAIN_PARTS = [
  ["races", "race_id,race_date,venue_code,race_number,start_time,race_grade", ["race_id"]],
  ["race_entries", "race_id,boat_number,racer_id,grade,f_count,motor_number", ["race_id", "boat_number"]],
  ["race_results", "*", ["race_id"]],
  ["race_start_timings", "race_id,boat_number,entry_course,start_timing,is_flying,is_late_start,finish_mark,finish_rank,official_finish_code", ["race_id", "boat_number"]],
  ["exhibition_data", "race_id,boat_number,exhibition_time,today_weight,tilt,parts_changed", ["race_id", "boat_number"]],
  ["race_conditions", "race_id,weather,wind_speed,wave_height,temperature,water_temperature,race_title,series_day,is_final_day,race_stage,weather_observed_at", ["race_id"]],
];

/** 本番の読み書き（api/cron/race-facts-main.js が渡す）。dryRun（shadow）は書かず、書く予定の数だけを返す */
export function mainJobDeps(client, { dryRun }) {
  const all = (table, select, order, build) =>
    fetchAll(table, select, (q) => order.reduce((acc, c) => acc.order(c), build(q)), { client });
  return {
    loadOverrides: async (range) => (await loadJudgeInputs({ client, era: "main", ranges: [range] })).overrides,
    fetchWindow: async (range) => {
      const [races, entries, results, timings, exhibitions, conditions] = await Promise.all(
        MAIN_PARTS.map(([t, sel, order]) => all(t, sel, order, (q) => byRange(q, range))),
      );
      const series = await all("race_series", "venue_code,start_date,end_date,title,class_code,grade,kind", ["venue_code", "start_date"],
        (q) => q.lte("start_date", addDays(range.to, -1)).gte("end_date", range.from));
      return { races, entries, results, timings, exhibitions, conditions, seriesOf: seriesFinder(series) };
    },
    fetchExistingKeys: async (range) => ({
      race: (await all("race_facts", "race_id", ["race_id"], (q) => byRange(q, range).eq("era", "main"))).map((r) => r.race_id),
      run: (await all("run_facts", "race_id,boat_number", ["race_id", "boat_number"], (q) => byRange(q, range).eq("era", "main")))
        .map((r) => `${r.race_id}|${r.boat_number}`),
    }),
    writeWindow: async ({ raceRows, runRows, staleRace, staleRun }) => {
      let written = 0;
      for (const [table, rows, keyColumns] of [["race_facts", raceRows, ["race_id"]], ["run_facts", runRows, ["race_id", "boat_number"]]]) {
        const res = await upsertChangedRows(client, table, rows, { keyColumns, onConflict: keyColumns.join(","), dryRun, failOnFetchError: true, ignoreColumns: ["built_at"] });
        if (res.error) throw res.error;
        written += dryRun ? res.toWrite.length : res.written;
      }
      if (dryRun) return { written };
      for (const key of staleRun) {
        const [raceId, boat] = key.split("|");
        const { error } = await client.from("run_facts").delete().eq("race_id", raceId).eq("boat_number", Number(boat));
        if (error) throw new Error(`run_facts の消去エラー（${key}）: ${error.message}`);
      }
      if (staleRace.length > 0) {
        const { error } = await client.from("race_facts").delete().in("race_id", staleRace);
        if (error) throw new Error(`race_facts の消去エラー: ${error.message}`);
      }
      return { written };
    },
  };
}
