/**
 * 1Rの発走時刻から開催時間帯（モーニング/デイ/サマータイム/ナイター/ミッドナイト）を
 * 近似判定する。
 *
 * 公式の開催区分ラベルはDBに存在しないため発走時刻からの逆算で分類する（近似）。
 * 境界値は各時間帯の1R発走時刻の実勢（モーニング8:30前後、デイ10:30前後、
 * サマータイム11:30〜12:30、ナイター14:30〜15:20、ミッドナイト17:00以降）から決定。
 * 実データ（2026-08-28: 桐生ナイター1R14:57、平和島サマータイム1R11:48、
 * 三国モーニング1R8:30台）との一致を確認済み。
 */

export const TIME_OF_DAY = {
  MORNING: "morning",
  DAY: "day",
  SUMMER: "summer",
  NIGHTER: "nighter",
  MIDNIGHT: "midnight",
};

// "HH:MM" → 分に変換。不正値はnull
function toMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const m = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * 1Rの発走時刻（"HH:MM"）から時間帯を判定する。
 * 判定不能（不正値・null）の場合はnullを返す。
 */
export function getTimeOfDay(firstRaceStartTime) {
  const minutes = toMinutes(firstRaceStartTime);
  if (minutes == null) return null;

  if (minutes <= 9 * 60 + 30) return TIME_OF_DAY.MORNING; // 〜9:30
  if (minutes <= 11 * 60 + 15) return TIME_OF_DAY.DAY; // 〜11:15
  if (minutes <= 14 * 60) return TIME_OF_DAY.SUMMER; // 〜14:00
  if (minutes <= 16 * 60 + 30) return TIME_OF_DAY.NIGHTER; // 〜16:30
  return TIME_OF_DAY.MIDNIGHT;
}

/**
 * 会場の races 配列（raceNo/startTime を持つ）から時間帯を判定する。
 * 1R（最小レース番号）の発走時刻を基準にする。
 */
export function getVenueTimeOfDay(races) {
  if (!Array.isArray(races) || races.length === 0) return null;
  const first = races.reduce((min, r) =>
    (r.raceNo ?? r.raceNumber ?? 99) < (min.raceNo ?? min.raceNumber ?? 99)
      ? r
      : min,
  );
  return getTimeOfDay(first.startTime);
}
