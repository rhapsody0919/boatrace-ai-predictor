/**
 * トップの会場カード（VenueGridCard）と会場ページのレースカード（RaceCard）が出す文字の組み方。
 *
 * ボット向け HTML（ADR 0089）が人の画面と同じ文字を出せるよう、人の部品とボットのモデル
 * （botPageModel.js）の両方がここを通す。Node からも import するため、ブラウザ専用の依存を持ち込まない。
 */
import { GRADE_CONFIG } from "../constants/gradeConfig.js";

/** 会場名（人の画面は会場コードの i18n キーで出す） */
export function venueNameOf(t, venueCode) {
  return t(`venues.${venueCode}`);
}

/**
 * 会場カードの代表値。グレードはレース単位だが、会場単位の代表値として先頭レースの値を使う
 * （SG/G1等の節では全レース同一グレード）。節の名前も先頭レースの値
 *
 * @param {{raceGrade?: string|null, raceTitle?: string|null}[]} races - レース番号順
 * @returns {{gradeConfig: {label: string, color: string}|null, raceTitle: string|null}}
 */
export function venueCardHeadline(races) {
  return {
    gradeConfig: GRADE_CONFIG[races[0]?.raceGrade] ?? null,
    raceTitle: races[0]?.raceTitle || null,
  };
}

/** レースのグレードの表示（SG・G1・G2・G3 だけ。一般戦は null） */
export function gradeConfigOf(raceGrade) {
  return GRADE_CONFIG[raceGrade] ?? null;
}

/** レース番号の表示（例 "9R"） */
export function raceNumberLabel(raceNumber) {
  return `${raceNumber}R`;
}

/** 締切予定時刻の値の表示（時刻＋言語ごとの注記。ja の注記は空） */
export function deadlineValueText(t, startTime) {
  return `${startTime}${t("home.jstNote")}`;
}
