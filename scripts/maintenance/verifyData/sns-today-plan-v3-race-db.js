// verify-sns-today-plan.js の型 v3 の PostgREST の読み取りの模型（越えの単位を分けるため移した。verify ではない）
// DATE は verify の試験の日（verify もここから読む）
export const DATE = "2037-10-17";

// 材料（races・race_conditions・race_entries・exhibition_data・race_series・racer_course_technique_stats）と、送る直前の
// 欠場・中止の読み直し（pickRaceStatus の in. の形）に答える PostgREST の読み取り
export function v3RaceDb({ absent = [], cancelled = [] } = {}) {
  const { races, conditions, entries } = v3Rows(DATE, absent, cancelled);
  const stats = v3Stats();
  return v3Reader({ races, conditions, entries, stats });
}

function v3Rows(DATE, absent, cancelled) {
  const races = [];
  const conditions = [];
  const entries = [];
  for (const [venue, stage] of [
    [15, "優勝戦"],
    [2, "予選"],
  ])
    for (let r = 1; r <= 12; r += 1) {
      const race_id = `${DATE}-${String(venue).padStart(2, "0")}-${String(r).padStart(2, "0")}`;
      races.push({
        race_id,
        race_date: DATE,
        venue_code: venue,
        race_number: r,
        start_time: `${String(8 + r).padStart(2, "0")}:${String(venue).padStart(2, "0")}:00`,
        race_grade: "ippan",
        cancellation_status: cancelled.includes(race_id) ? "confirmed" : null,
      });
      conditions.push({
        race_id,
        race_stage: r === 12 ? stage : "予選",
        series_day: r === 1 ? 4 : null,
        is_final_day: null,
        race_title: null,
      });
      for (let b = 1; b <= 6; b += 1)
        entries.push({
          race_id,
          boat_number: b,
          racer_id: venue * 1000 + r * 10 + b,
          player_name: `選手\u3000${venue}${r}${b}`,
          grade: "A1",
          is_absent: absent.includes(`${race_id}:${b}`),
        });
    }
  return { races, conditions, entries };
}

function v3Stats() {
  return [
    {
      racer_id: 2041,
      course: 1,
      window_start: "2025-12-02",
      window_end: "2037-10-16",
      runs: 50,
      nige_rate: 82.5,
    },
    {
      racer_id: 2051,
      course: 1,
      window_start: "2025-12-02",
      window_end: "2037-10-16",
      runs: 50,
      nige_rate: 80.0,
    },
    {
      racer_id: 2062,
      course: 2,
      window_start: "2025-12-02",
      window_end: "2037-10-16",
      runs: 40,
      nigashi_rate: 70.0,
    },
    {
      racer_id: 2074,
      course: 4,
      window_start: "2025-12-02",
      window_end: "2037-10-16",
      runs: 35,
      makuri_rate: 28.6,
    },
  ];
}

const inList = (path) =>
  decodeURIComponent(path)
    .match(/in\.\(([^)]*)\)/)[1]
    .split(",")
    .map((x) => x.replaceAll('"', ""));
const page = (path, rows) => {
  const offset = Number(path.match(/offset=(\d+)/)?.[1] ?? 0);
  return rows.slice(offset, offset + 1000);
};

function v3Reader({ races, conditions, entries, stats }) {
  return async (path) => {
    if (path.startsWith("races?race_date=eq.")) return page(path, races);
    if (path.startsWith("races?cancellation_status")) return [];
    if (path.startsWith("races?race_id=in."))
      return races.filter((r) => inList(path).includes(r.race_id));
    if (path.startsWith("race_conditions")) return page(path, conditions);
    if (path.startsWith("race_entries?race_id=like."))
      return page(path, entries);
    if (path.startsWith("race_entries?race_id=in."))
      return entries.filter((e) => inList(path).includes(e.race_id));
    if (path.startsWith("exhibition_data")) return [];
    if (path.startsWith("race_series"))
      return [2, 15].map((venue_code) => ({
        venue_code,
        start_date: "2037-10-14",
        end_date: "2037-10-19",
        title: null,
        grade: "ippan",
        kind: "ippan",
      }));
    if (path.startsWith("racer_course_technique_stats")) {
      const course = Number(path.match(/course=eq\.(\d)/)[1]);
      const ids = inList(path).map(Number);
      return stats.filter(
        (s) => s.course === course && ids.includes(s.racer_id),
      );
    }
    throw new Error(`想定外の読み取り: ${path}`);
  };
}
