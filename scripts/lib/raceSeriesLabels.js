/**
 * 1レース分の「締切・グレード・何日目・大会名」を DB の行から取る（BOA-1309）。全貌・人気薄の1着・/today の SNS が同じ部品を使う。
 * 文と規則は src/utils/raceSeriesText.js（画面の getSeriesDayLabel と共有）。supabase に直接つながず、読み取りは呼び側の get(table, query) で行う
 * （PostgREST のクエリ文字列。全貌は fetch-materials.mjs の sbGet、人気薄の1着は upset-win/materials.mjs の sbGet と同じ形）。
 * 読み取りの失敗は握りつぶさず、メッセージを付けて投げる。
 * 検証: scripts/maintenance/verify-sns-race-labels.js
 */
import {
  seriesDayTextOf,
  seriesTitleOf,
} from "../../src/utils/raceSeriesText.js";

/** 読む列（races・race_conditions・race_series） */
export const RACE_LABEL_COLUMNS = {
  races:
    "race_id,race_date,venue_code,race_number,start_time,race_grade,cancellation_status",
  race_conditions: "race_id,series_day,is_final_day,race_title",
  race_series: "venue_code,start_date,end_date,title,grade",
};

const RACE_ID = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/** "14:37:00" → "14:37"。読めなければ null（全貌の締切と同じ読み方） */
export const deadlineOf = (startTime) =>
  /^\d{1,2}:\d{2}/.exec(startTime ?? "")?.[0] ?? null;

/**
 * 読んだ行 → ラベル（純関数）。同じ会場・同じ日の races と race_conditions、その日を含む節（race_series、0〜1行）から作る
 * @param {string} raceId
 * @param {{races: object[], race_conditions: object[], race_series: object[]}} rows
 * @returns {{raceId: string, deadline: string|null, grade: string|null, seriesDayText: string|null, seriesTitle: string|null}}
 */
export function raceLabelsFromRows(
  raceId,
  { races, race_conditions: conditions, race_series: series },
) {
  const cond = new Map(conditions.map((c) => [c.race_id, c]));
  const venueRaces = races
    .map((r) => ({
      raceId: r.race_id,
      raceNumber: r.race_number,
      cancellationStatus: r.cancellation_status ?? null,
      seriesDay: cond.get(r.race_id)?.series_day ?? null,
      isFinalDay: cond.get(r.race_id)?.is_final_day ?? null,
      // 空の文字列は無いものとして扱う（他のレース・節の名前で補う）
      raceTitle: cond.get(r.race_id)?.race_title?.trim() || null,
    }))
    .sort((a, b) => a.raceNumber - b.raceNumber);
  const race = races.find((r) => r.race_id === raceId) ?? null;
  const self = venueRaces.find((r) => r.raceId === raceId) ?? null;
  const meet = series[0] ?? null;
  // グレードはレース単位の races.race_grade を優先し、無ければ節の grade（084_race_series.sql の COALESCE と同じ）
  const grade = race?.race_grade ?? meet?.grade ?? null;
  // 大会名は自レースに無ければ同じ会場の他のレースで補う（画面の見出し getRaceDetailHeading と同じ）
  const raceTitle =
    self?.raceTitle ??
    venueRaces.find((r) => r.raceTitle != null)?.raceTitle ??
    null;
  return {
    raceId,
    deadline: deadlineOf(race?.start_time),
    grade,
    seriesDayText: seriesDayTextOf(venueRaces, raceId),
    seriesTitle: seriesTitleOf({
      grade,
      raceTitle,
      seriesTitle: meet?.title ?? null,
    }),
  };
}

/**
 * 1レース分を読む。同じ会場・同じ日は race_id の like（upset-win/materials.mjs と同じ絞り方）
 * @param {(table: string, query: string) => Promise<object[]>} get
 * @param {string} raceId YYYY-MM-DD-VV-RR
 */
export async function fetchRaceLabels(get, raceId) {
  const m = RACE_ID.exec(raceId ?? "");
  if (!m) throw new Error(`fetchRaceLabels: race_id の形が違う: ${raceId}`);
  const [, date, vv] = m;
  const like = `race_id=like.${encodeURIComponent(`${date}-${vv}-*`)}`;
  const read = async (table, query) => {
    try {
      const rows = await get(table, query);
      if (!Array.isArray(rows)) throw new Error("配列でない応答");
      return rows;
    } catch (e) {
      throw new Error(
        `fetchRaceLabels ${raceId}: ${table} を読めない（${e instanceof Error ? e.message : String(e)}）`,
      );
    }
  };
  const [races, conditions, series] = await Promise.all([
    read(
      "races",
      `${like}&select=${RACE_LABEL_COLUMNS.races}&order=race_number`,
    ),
    read(
      "race_conditions",
      `${like}&select=${RACE_LABEL_COLUMNS.race_conditions}`,
    ),
    read(
      "race_series",
      `venue_code=eq.${Number(vv)}&start_date=lte.${date}&end_date=gte.${date}&select=${RACE_LABEL_COLUMNS.race_series}&limit=1`,
    ),
  ]);
  if (!races.some((r) => r.race_id === raceId))
    throw new Error(`fetchRaceLabels ${raceId}: races にこのレースが無い`);
  return raceLabelsFromRows(raceId, {
    races,
    race_conditions: conditions,
    race_series: series,
  });
}
