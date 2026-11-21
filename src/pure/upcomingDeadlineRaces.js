/**
 * トップの「まもなく締切のレース」の節（PV09 T1・案 B、BOA-1690）の行を選ぶ純関数。
 *
 * 人のトップ（UpcomingDeadlineRaces.jsx）と、ボット向けのトップ（botPageModel.js の buildTopModel）の両方が使う。
 * 材料は getRaces()（/api/races/today）の今の応答だけ。新しい DB の読み・API は足さない。
 * Node から import するため、ブラウザ専用の依存を持ち込まない。import は拡張子付きで書く。
 * 試験: scripts/tests/upcomingDeadlineRaces.test.js（新しい置き場は src/pure。src/utils に新しいファイルを足さない）
 */
import { gradeConfigOf } from "../utils/raceListDisplay.js";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import { getRaceId } from "./raceId.js";
import { isFinalStage } from "./raceStageConfig.js";
import { splitRacerName } from "../utils/racerName.js";

/** 節に出す行の上限（PC は全部、3列×2段） */
export const UPCOMING_MAX_ROWS = 6;
/** スマホで「もっと見る」を押す前に見せる行の数 */
export const UPCOMING_MOBILE_VISIBLE = 3;
/** 「もっと見る」のボタンに名前を出す、隠れた行の会場の数 */
export const UPCOMING_MORE_VENUE_NAMES = 2;

const HHMM = /^\d{2}:\d{2}$/;

// 1号艇（waku 1）。欠場・出走表の前で名前が無ければ null（選手名を出さない）
function boat1Of(race) {
  const racer = (race.racers || []).find((r) => Number(r?.waku) === 1);
  const name = splitRacerName(racer?.name).join(" ");
  if (!name) return null;
  return { name, rank: racer.rank || null };
}

/**
 * 締切予定が nowHHMM（JST の HH:MM）より後のレースを、近い順に最大 max 行
 *
 * 締切を過ぎた行・中止・startTime の欠けた行は入れない。同じ時刻は会場コード → レース番号の順。
 * cautionHigh はイン崩れ注意度の段が「高」の行だけ真（段は朝の生成が保存した値をそのまま使う）。
 * 札を出すかは呼び出し側が機能の公開の状態（featureFlags）で決める
 *
 * @param {{placeCd: number, races?: object[]}[]} venuesData - transformTodayRaces の data
 * @param {string|null} nowHHMM
 * @param {{max?: number}} [options]
 * @returns {{raceId: string, venueCode: number, raceNo: number, startTime: string, gradeLabel: string|null,
 *   gradeColor: string|null, isFinal: boolean, boat1: {name: string, rank: string|null}|null, cautionHigh: boolean}[]}
 */
export function pickUpcomingDeadlineRaces(
  venuesData,
  nowHHMM,
  { max = UPCOMING_MAX_ROWS } = {},
) {
  if (!isHHMM(nowHHMM)) return [];
  const rows = (venuesData || []).flatMap((venue) => {
    const venueCode = Number(venue.placeCd ?? venue.place_cd);
    return (venue.races || [])
      .filter((race) => isUpcoming(race, nowHHMM))
      .map((race) => toRow(race, venueCode))
      .filter((row) => row.raceId);
  });
  rows.sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.venueCode - b.venueCode ||
      a.raceNo - b.raceNo,
  );
  return rows.slice(0, max);
}

const isHHMM = (v) => typeof v === "string" && HHMM.test(v);

// 締切予定が nowHHMM より後で、中止でない（startTime の欠けた行は入れない）
const isUpcoming = (race, nowHHMM) =>
  isHHMM(race.startTime) && race.startTime > nowHHMM && !isRaceCancelled(race);

function toRow(race, venueCode) {
  const grade = gradeConfigOf(race.raceGrade);
  return {
    raceId: getRaceId({
      rawData: { ...race, placeCd: race.placeCd ?? venueCode },
    }),
    venueCode,
    raceNo: race.raceNo,
    startTime: race.startTime,
    gradeLabel: grade?.label ?? null,
    gradeColor: grade?.color ?? null,
    isFinal: isFinalStage(race.raceStage),
    boat1: boat1Of(race),
    cautionHigh: race.inCaution?.level === "high",
  };
}

/**
 * スマホで隠れる行（visible 行目より後）と、「もっと見る」に名前を出す会場（隠れた行の先頭から重ねずに最大 names 会場）
 *
 * @returns {{hidden: object[], venues: {venueCode: number, isFinal: boolean}[], hasOthers: boolean}}
 *   isFinal はその会場の隠れた行に優勝戦があるか。hasOthers は名前を出さない会場が隠れた行に残るか
 */
export function moreButtonVenues(
  rows,
  { visible = UPCOMING_MOBILE_VISIBLE, names = UPCOMING_MORE_VENUE_NAMES } = {},
) {
  const hidden = rows.slice(visible);
  const byVenue = new Map();
  for (const row of hidden) {
    const seen = byVenue.get(row.venueCode);
    byVenue.set(row.venueCode, {
      venueCode: row.venueCode,
      isFinal: Boolean(seen?.isFinal || row.isFinal),
    });
  }
  const all = [...byVenue.values()];
  return {
    hidden,
    venues: all.slice(0, names),
    hasOthers: all.length > names,
  };
}
