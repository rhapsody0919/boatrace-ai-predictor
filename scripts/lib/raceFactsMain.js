/**
 * 本体の表（races・race_entries・race_results・race_start_timings・exhibition_data・race_conditions・race_series、2025-12-03〜）の
 * 1レースから、race_facts・run_facts の行を組み立てる（ADR-0113、docs/design/past-data-backfill/db-draft.md §1・§2）。
 * 読み書きはしない純関数。列は raceFactsKb.js の RACE_FACT_COLUMNS・RUN_FACT_COLUMNS とちょうど同じ。
 *
 * - グレードは 190 と同じ順: 書き手が渡す特別な節の補正 → races.race_grade → race_series.grade → class_code の読み替え
 *   （Lady・Takumi は G3、Rookie・Venus は ippan。ADR-0104 決定4）
 * - 優勝戦は isCareerFinalStage（190 と同じ）。進入は race_start_timings.entry_course → race_results.actual_course_N
 *   （src/services/racerRaceHistoryRows.js と同じ順）
 * - 条件の出所は行ごと（ADR-0113 決定6）: weather_observed_at が発走の時刻以後なら結果ページの値（'race_result'、
 *   raceResultPersist.js は発走の時刻を入れる）、それより前か NULL なら 'before_race'（K で埋めた行と古い行は NULL で
 *   区別できないので、条件の軸から外す側に倒す）
 * - 3連単は race_results.payout_trio、3連複は payout_trifecta（列名と中身が逆、data-columns.md 6行目）
 * - 本体に無い列（潮位・オリジナル展示）は NULL。後の段で同じ関数を通して埋める
 * - 風の扇形（wind_sector）は race_conditions.wind_direction（画面の矢印の番号）と風速から src/pure/windSector.js で決める
 */
import { isCareerFinalStage } from "../../src/pure/racerCareerStats.js";
import { finishMarkFromCode } from "./kbGapFill.js";
import { MAIN_TABLES_START } from "./kbArchiveBoundary.js";
import { RACE_FACTS_RULE_VERSION, RUN_FACTS_RULE_VERSION, racerIdsOf } from "./raceFactsKb.js";
import { windSectorOf } from "../../src/pure/windSector.js";

const CLASS_GRADE = Object.freeze({ Lady: "G3", Takumi: "G3", Rookie: "ippan", Venus: "ippan" });
const RACE_ID = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;
const orNull = (v) => (v === undefined ? null : v);
const inCourse = (v) => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : null);
const dateText = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

/** race_id と列が食い違う・本体の期間の外なら throw */
function assertMainRace(race) {
  const m = RACE_ID.exec(race.race_id ?? "");
  if (!m) throw new Error(`本体の race_id の形が違う: ${race.race_id}`);
  const date = dateText(race.race_date);
  if (m[1] !== date || Number(m[2]) !== race.venue_code || Number(m[3]) !== race.race_number) {
    throw new Error(`本体の race_id と列が食い違う: ${race.race_id}（${date}・${race.venue_code}・${race.race_number}）`);
  }
  if (date < MAIN_TABLES_START) throw new Error(`本体の期間（${MAIN_TABLES_START}〜）の外: ${race.race_id}`);
  return date;
}

/** 190 と同じ順のグレード（補正 → races → race_series → class_code） */
export function mainGradeOf(race, series, override = null) {
  return override ?? race.race_grade ?? series?.grade ?? CLASS_GRADE[series?.class_code] ?? null;
}

/** 条件の出所。値が無ければ null */
export function conditionSourceOf(conditions, race, date) {
  if (!conditions || [conditions.weather, conditions.wind_speed, conditions.wave_height].every((v) => v == null)) return null;
  const observed = conditions.weather_observed_at ? Date.parse(conditions.weather_observed_at) : NaN;
  const start = race.start_time ? Date.parse(`${date}T${race.start_time}+09:00`) : NaN;
  return Number.isFinite(observed) && Number.isFinite(start) && observed >= start ? "race_result" : "before_race";
}

/** 題・日目・種別・優勝戦（race_conditions と race_series から） */
function seriesColumns(conditions, series) {
  const c = conditions ?? {};
  return {
    race_title: c.race_title ?? series?.title ?? null,
    series_day: orNull(c.series_day),
    is_final_day: orNull(c.is_final_day),
    series_kind: orNull(series?.kind),
    stage_raw: orNull(c.race_stage),
    is_final: c.race_stage == null ? null : isCareerFinalStage(c.race_stage),
  };
}

/** 気象の列。出所が無ければ（値が無ければ）風・波・天候・風の扇形は NULL */
function weatherColumns(conditions, source, venueCode) {
  const c = conditions ?? {};
  const keep = (v) => (source ? orNull(v) : null);
  return {
    weather: keep(c.weather),
    wind_speed: keep(c.wind_speed),
    wave_height: keep(c.wave_height),
    wind_sector: windSectorOf({ era: "main", venueCode, direction: c.wind_direction ?? null, speed: c.wind_speed ?? null, hasCondition: source != null }),
    condition_source: source,
    temperature: orNull(c.temperature),
    water_temperature: orNull(c.water_temperature),
  };
}

/** 結果と払戻の列（3連単は payout_trio、3連複は payout_trifecta） */
function resultColumns(result) {
  const r = result ?? {};
  const ranks = [r.rank1, r.rank2, r.rank3];
  return {
    technique: orNull(r.winning_technique),
    payout_win: orNull(r.payout_win),
    payout_place_1: orNull(r.payout_place_1),
    payout_place_2: orNull(r.payout_place_2),
    payout_3tan: orNull(r.payout_trio),
    combo_3tan: ranks.every(Number.isInteger) ? ranks.join("-") : null,
    payout_3fuku: orNull(r.payout_trifecta),
    has_result: Number.isInteger(r.rank1),
    race_status: orNull(r.race_status),
    // 1着から順の艇番（race_results.rank1〜6 のまま。選手ページの履歴の着の位置と同じ出所）
    finish_order: Number.isInteger(r.rank1) ? [r.rank1, r.rank2, r.rank3, r.rank4, r.rank5, r.rank6].map(orNull) : null,
  };
}

/**
 * @param {{ race: object, result?: object|null, conditions?: object|null, series?: object|null, override?: string|null, entries?: object[] }} input
 */
export function buildMainRaceFact({ race, result = null, conditions = null, series = null, override = null, entries = [] }) {
  const date = assertMainRace(race);
  const s = seriesColumns(conditions, series);
  const w = weatherColumns(conditions, conditionSourceOf(conditions, race, date), race.venue_code);
  const r = resultColumns(result);
  return {
    race_id: race.race_id,
    era: "main",
    race_date: date,
    venue_code: race.venue_code,
    race_number: race.race_number,
    race_title: s.race_title,
    series_day: s.series_day,
    is_final_day: s.is_final_day,
    race_grade: mainGradeOf(race, series, override),
    series_kind: s.series_kind,
    stage_raw: s.stage_raw,
    is_final: s.is_final,
    deadline_time: orNull(race.start_time),
    weather: w.weather,
    wind_speed: w.wind_speed,
    wave_height: w.wave_height,
    wind_sector: w.wind_sector,
    condition_source: w.condition_source,
    temperature: w.temperature,
    water_temperature: w.water_temperature,
    tide_cm: null,
    tide_phase: null,
    technique: r.technique,
    dead_heat: false,
    payout_win: r.payout_win,
    payout_place_1: r.payout_place_1,
    payout_place_2: r.payout_place_2,
    payout_3tan: r.payout_3tan,
    combo_3tan: r.combo_3tan,
    payout_3fuku: r.payout_3fuku,
    has_result: r.has_result,
    race_status: r.race_status,
    racer_ids: racerIdsOf(entries),
    finish_order: r.finish_order,
    rule_version: RACE_FACTS_RULE_VERSION,
  };
}

/**
 * @param {object} race races の行
 * @param {object[]} entries そのレースの race_entries の行
 * @param {{ result?: object|null, timings?: object[], exhibitions?: object[] }} parts
 */
export function buildMainRunFacts(race, entries, { result = null, timings = [], exhibitions = [] } = {}) {
  const date = assertMainRace(race);
  const timingOf = new Map(timings.map((t) => [t.boat_number, t]));
  const exhibitionOf = new Map(exhibitions.map((e) => [e.boat_number, e]));
  return entries.map((e) => {
    if (e.race_id !== race.race_id) throw new Error(`別のレースの艇が混ざった: ${e.race_id}（${race.race_id}）`);
    if (!Number.isInteger(e.boat_number) || e.boat_number < 1 || e.boat_number > 6) {
      throw new Error(`艇番が 1〜6 でない: ${race.race_id} ${e.boat_number}`);
    }
    return runRowOf(race, date, e, {
      t: timingOf.get(e.boat_number) ?? {},
      x: exhibitionOf.get(e.boat_number) ?? {},
      course: result?.[`actual_course_${e.boat_number}`],
    });
  });
}

/** 着欄と着（finish_mark → 成績コードの順。着は finish_rank → 着欄が 1〜6 のとき） */
function finishOf(t) {
  const fromCode = t.official_finish_code == null ? null : finishMarkFromCode(t.official_finish_code);
  const mark = t.finish_mark ?? fromCode?.finish_mark ?? null;
  return { mark, rank: t.finish_rank ?? (/^[1-6]$/.test(mark ?? "") ? Number(mark) : null) };
}

/** 1艇の行（t: race_start_timings、x: exhibition_data、course: actual_course_N） */
function runRowOf(race, date, e, { t, x, course }) {
  const finish = finishOf(t);
  return {
    race_id: race.race_id,
    boat_number: e.boat_number,
    era: "main",
    race_date: date,
    racer_id: orNull(e.racer_id),
    racer_class: orNull(e.grade),
    f_count: orNull(e.f_count),
    motor_number: orNull(e.motor_number),
    course: inCourse(t.entry_course ?? course),
    start_timing: orNull(t.start_timing),
    is_flying: orNull(t.is_flying),
    is_late_start: orNull(t.is_late_start),
    finish_code: orNull(t.official_finish_code),
    finish_mark: finish.mark,
    finish_rank: finish.rank,
    exhibition_time: orNull(x.exhibition_time),
    weight: orNull(x.today_weight),
    weight_source: x.today_weight == null ? null : "beforeinfo",
    tilt: orNull(x.tilt),
    parts_changed: orNull(x.parts_changed),
    oriten_lap: null,
    oriten_turn: null,
    oriten_straight: null,
    rule_version: RUN_FACTS_RULE_VERSION,
  };
}
