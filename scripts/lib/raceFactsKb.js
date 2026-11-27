/**
 * kb_archive_*（K/B ファイル、〜2025-12-02）の1レースから、race_facts・run_facts の行を組み立てる（ADR-0113、
 * docs/design/past-data-backfill/db-draft.md §1・§2）。読み書きはしない純関数。書き手（CLI）が kb_archive を読んで渡す。
 *
 * - 全行が同じ列を持つ（RACE_FACT_COLUMNS・RUN_FACT_COLUMNS。キーのそろわない行で PostgREST が NULL を書く事故を避ける）
 * - グレードと種別は書き手が決めて渡す（ADR-0104 決定4 の補正は racerCareerSeries.js の gradeOverridesOf）
 * - 優勝戦は isFinalStage（v2）だけで決める（kb_archive_races.stage_kind・is_final_day は使わない。ADR-0104 決定3）
 * - 着は成績コード（finish_raw）から finishMarkFromCode で出す（本体の結果ページの着欄と 8,805艇で一致）
 * - kb に無い列（気温・水温・潮位・複勝の払戻・チルト・オリジナル展示・風の扇形）は NULL。後の段で書き手が同じ関数を通して埋める
 */
import { isFinalStage } from "../../src/pure/raceStageConfig.js";
import { finishMarkFromCode } from "./kbGapFill.js";
import { KB_FIRST_DATE, KB_LAST_DATE } from "./kbArchiveBoundary.js";

/** 組み立ての規則を変えたら上げる（facts の行の rule_version） */
export const RACE_FACTS_RULE_VERSION = 1;

export const RACE_FACT_COLUMNS = Object.freeze([
  "race_id", "era", "race_date", "venue_code", "race_number", "race_title", "series_day", "is_final_day",
  "race_grade", "series_kind", "stage_raw", "is_final", "deadline_time", "weather", "wind_speed", "wave_height",
  "wind_sector", "condition_source", "temperature", "water_temperature", "tide_cm", "tide_phase", "technique",
  "dead_heat", "payout_win", "payout_place_1", "payout_place_2", "payout_3tan", "combo_3tan", "payout_3fuku",
  "has_result", "race_status", "rule_version",
]);

export const RUN_FACT_COLUMNS = Object.freeze([
  "race_id", "boat_number", "era", "race_date", "racer_id", "racer_class", "f_count", "motor_number", "course",
  "start_timing", "is_flying", "is_late_start", "finish_code", "finish_mark", "finish_rank", "exhibition_time",
  "weight", "weight_source", "tilt", "parts_changed", "oriten_lap", "oriten_turn", "oriten_straight", "rule_version",
]);

const RACE_ID = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;
const dateText = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const orNull = (v) => (v === undefined ? null : v);
const inCourse = (v) => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : null);

/** race_id と列が食い違う・kb の期間の外なら、意味のある文で throw する（facts の CHECK に当たる前に止める） */
function assertKbRace(race) {
  const m = RACE_ID.exec(race.race_id ?? "");
  if (!m) throw new Error(`kb の race_id の形が違う: ${race.race_id}`);
  const date = dateText(race.race_date);
  if (m[1] !== date || Number(m[2]) !== race.venue_code || Number(m[3]) !== race.race_number) {
    throw new Error(`kb の race_id と列が食い違う: ${race.race_id}（${date}・${race.venue_code}・${race.race_number}）`);
  }
  if (date < KB_FIRST_DATE || date > KB_LAST_DATE) {
    throw new Error(`kb の期間（${KB_FIRST_DATE}〜${KB_LAST_DATE}）の外: ${race.race_id}`);
  }
  return date;
}

/**
 * @param {object} race kb_archive_races の行
 * @param {object|null} venueDay kb_archive_venue_days の行（無ければ題・日目は NULL）
 * @param {{ grade: string|null, seriesKind: string|null }} meta 書き手が決めたグレードと種別
 */
export function buildKbRaceFact(race, venueDay, { grade, seriesKind }) {
  const date = assertKbRace(race);
  const hasCondition = [race.weather, race.wind_speed, race.wave_height].some((v) => v != null);
  return {
    race_id: race.race_id,
    era: "kb",
    race_date: date,
    venue_code: race.venue_code,
    race_number: race.race_number,
    race_title: orNull(venueDay?.title),
    series_day: orNull(venueDay?.series_day),
    is_final_day: orNull(venueDay?.is_final_day),
    race_grade: orNull(grade),
    series_kind: orNull(seriesKind),
    stage_raw: orNull(race.stage),
    is_final: race.stage == null ? null : isFinalStage(race.stage),
    deadline_time: orNull(race.deadline_time),
    weather: orNull(race.weather),
    wind_speed: orNull(race.wind_speed),
    wave_height: orNull(race.wave_height),
    wind_sector: null,
    condition_source: hasCondition ? "k_file" : null,
    temperature: null,
    water_temperature: null,
    tide_cm: null,
    tide_phase: null,
    technique: orNull(race.technique),
    dead_heat: race.dead_heat === true,
    payout_win: orNull(race.payout_win),
    payout_place_1: null,
    payout_place_2: null,
    payout_3tan: orNull(race.payout_3tan),
    combo_3tan: orNull(race.combo_3tan),
    payout_3fuku: orNull(race.payout_3fuku),
    has_result: race.has_result === true,
    race_status: null,
    rule_version: RACE_FACTS_RULE_VERSION,
  };
}

/**
 * @param {object} race kb_archive_races の行
 * @param {object[]} boats そのレースの kb_archive_boats の行
 */
export function buildKbRunFacts(race, boats) {
  const date = assertKbRace(race);
  return boats.map((b) => {
    if (b.race_id !== race.race_id) throw new Error(`別のレースの艇が混ざった: ${b.race_id}（${race.race_id}）`);
    if (!Number.isInteger(b.boat_number) || b.boat_number < 1 || b.boat_number > 6) {
      throw new Error(`艇番が 1〜6 でない: ${race.race_id} ${b.boat_number}`);
    }
    const mark = b.finish_raw == null ? null : finishMarkFromCode(b.finish_raw);
    return {
      race_id: race.race_id,
      boat_number: b.boat_number,
      era: "kb",
      race_date: date,
      racer_id: orNull(b.racer_id),
      racer_class: orNull(b.class),
      f_count: null,
      motor_number: orNull(b.motor_number),
      course: inCourse(b.course),
      start_timing: orNull(b.start_timing),
      is_flying: orNull(b.is_flying),
      is_late_start: orNull(b.is_late_start),
      finish_code: orNull(b.finish_raw),
      finish_mark: mark?.finish_mark ?? null,
      finish_rank: mark?.finish_rank ?? null,
      exhibition_time: orNull(b.exhibition_time),
      weight: orNull(b.weight),
      weight_source: b.weight == null ? null : "b_file",
      tilt: null,
      parts_changed: null,
      oriten_lap: null,
      oriten_turn: null,
      oriten_straight: null,
      rule_version: RACE_FACTS_RULE_VERSION,
    };
  });
}
