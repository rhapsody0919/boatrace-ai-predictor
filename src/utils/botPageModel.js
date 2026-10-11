/**
 * ボット向け HTML（ADR 0089）の中身を、/api/races/today の JSON から組む。
 *
 * - 人の画面の部分集合にする。人のトップ（VenueGridPage・VenueGridCard）と会場ページ（VenueRaceListPage・
 *   RaceCard）が出している文字のうち、開催の予定（会場名・節の名前・レース番号・締切時刻・グレード・中止）
 *   と、ページの見出し・最終更新時刻・title・meta description・canonical だけを入れる
 * - 整形は人の画面と同じ transformTodayRaces、文字は人の画面と同じ関数（raceListDisplay.js・pageMeta.js）と
 *   i18n のキーで作る。t は ja の i18next の t を渡す（ボットは ja 固定）
 * - 選手一覧・オッズ・払戻・着順・展開予測・荒れ度は入れない（ADR 0089 決定7）
 * - 時刻で変わる状態（次のレース・締切間近・発売中・全レース終了）は入れない（同 決定3）
 * - 形が壊れた入力は例外にする。正しく取れて0件のときだけ「開催なし」のモデルを返す（ADR 0069）
 *
 * Node から import するため、ブラウザ専用の依存を持ち込まない。検証: scripts/maintenance/verify-bot-page-model.js
 */
import { ALL_VENUE_CODES } from "../constants/index.js";
import { transformTodayRaces } from "./todayRaces.js";
import { getTopPageMeta, getTodayVenuePageMeta } from "./pageMeta.js";
import {
  venueNameOf,
  venueCardHeadline,
  gradeConfigOf,
  raceNumberLabel,
  deadlineValueText,
} from "./raceListDisplay.js";
import { isRaceCancelled } from "./raceCancellation.js";
import { getRaceId } from "./raceId.js";
import { formatDateShortLocalized, formatCapturedAtJst } from "./formatters.js";

const LANG = "ja";

/** /api/races/today の JSON が期待の形でない（取得の失敗を「開催なし」に化けさせないため、呼び出し側は 503 にする） */
export class TodayRacesShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = "TodayRacesShapeError";
  }
}

const isObject = (v) => v !== null && typeof v === "object";

/**
 * 形を確かめる。人の画面（getRaces）は success と data の有無だけを見るが、ボット向けは会場・レースの
 * 中身まで見る（壊れた行を黙って落とすと、開催中の会場が「開催なし」に見える）
 */
export function assertTodayRacesJson(json) {
  if (!isObject(json)) {
    throw new TodayRacesShapeError(
      "/api/races/today の応答がオブジェクトでない",
    );
  }
  if (json.success !== true) {
    throw new TodayRacesShapeError(
      "/api/races/today の success が true でない",
    );
  }
  if (!Array.isArray(json.data)) {
    throw new TodayRacesShapeError("/api/races/today の data が配列でない");
  }
  json.data.forEach((venue, i) => {
    const code = venue?.place_cd ?? venue?.placeCd;
    if (!Number.isInteger(code) || code < 1 || code > 24) {
      throw new TodayRacesShapeError(
        `data[${i}] の会場コードが 1〜24 の整数でない: ${code}`,
      );
    }
    if (!Array.isArray(venue.races)) {
      throw new TodayRacesShapeError(
        `data[${i}]（会場 ${code}）の races が配列でない`,
      );
    }
    venue.races.forEach((race, j) => {
      if (!Number.isInteger(race?.raceNo)) {
        throw new TodayRacesShapeError(
          `data[${i}].races[${j}]（会場 ${code}）の raceNo が整数でない`,
        );
      }
    });
  });
}

// 整形した結果を会場コード→レース（レース番号順）にする
function racesByVenue(transformed) {
  return new Map(
    transformed.data.map((venue) => [
      venue.placeCd,
      [...venue.races].sort((a, b) => a.raceNo - b.raceNo),
    ]),
  );
}

// トップの UpdateStatus と同じ文言。時刻はボットの実行環境（UTC）に左右されないよう JST で書く
// （人の画面はブラウザのローカル時刻。日本のブラウザでは同じ文字になる）
function updatedText(t, scrapedAt) {
  const time = formatCapturedAtJst(scrapedAt);
  if (!time) return null;
  return t("updateStatus.updatedLabel", { dataType: t("home.dataType"), time });
}

/**
 * トップ（/）のモデル
 *
 * @param {unknown} todayJson - /api/races/today の応答
 * @param {{t: (key: string, params?: object) => string, today: string}} options - today は JST の日付（YYYY-MM-DD）。
 *   人の画面の見出しと同じく、実行時の JST の日付を渡す（0件の日は JSON に日付が無いため）
 */
export function buildTopModel(todayJson, { t, today }) {
  assertTodayRacesJson(todayJson);
  const transformed = transformTodayRaces(todayJson);
  const byVenue = racesByVenue(transformed);

  const venues = ALL_VENUE_CODES.map((venueCode) => {
    const races = byVenue.get(venueCode) || [];
    const name = venueNameOf(t, venueCode);
    // 非開催の会場は名前だけ。人のカードの「次開催 M/D」は race_series から作るため、ここでは出さない。
    // 「本日開催なし」も、人の画面では次開催日が無い会場にしか出ないので出さない
    if (races.length === 0) return { venueCode, name, isOpen: false };
    const { gradeConfig, raceTitle } = venueCardHeadline(races);
    return {
      venueCode,
      name,
      isOpen: true,
      // 人のカードのリンク先（localize(`/venue/${code}`)。ja は接頭辞なし、会場コードは0埋めしない）
      href: `/venue/${venueCode}`,
      gradeLabel: gradeConfig?.label ?? null,
      raceTitle,
    };
  });

  return {
    meta: getTopPageMeta(t, LANG),
    heading: `🏁 ${t("home.todayRaces")} ${formatDateShortLocalized(today, LANG)}`,
    updatedText: updatedText(t, transformed.scrapedAt),
    openVenueCount: venues.filter((v) => v.isOpen).length,
    venues,
  };
}

/**
 * 会場ページ（本日分、/venue/:code）のモデル
 *
 * @param {unknown} todayJson - /api/races/today の応答
 * @param {number} venueCode - 1〜24
 * @param {{t: (key: string, params?: object) => string}} options
 */
export function buildVenueModel(todayJson, venueCode, { t }) {
  if (!Number.isInteger(venueCode) || venueCode < 1 || venueCode > 24) {
    throw new RangeError(`会場コードが 1〜24 の整数でない: ${venueCode}`);
  }
  assertTodayRacesJson(todayJson);
  const transformed = transformTodayRaces(todayJson);
  const races = racesByVenue(transformed).get(venueCode) || [];
  const venueName = venueNameOf(t, venueCode);

  return {
    meta: getTodayVenuePageMeta(t, venueCode, races),
    heading: `🏁 ${venueName} ${t("venueRaceList.todayTitle")}`,
    // 人の画面と同じく、0件なら「本日、このレース場での開催はありません」
    emptyText: races.length === 0 ? t("home.noRacesToday") : null,
    races: races.map((race) => {
      const gradeConfig = gradeConfigOf(race.raceGrade);
      const cancelled = isRaceCancelled(race);
      const raceId = getRaceId({ rawData: race });
      return {
        raceNumber: race.raceNo,
        // 人のレースカードの見出し（会場名と「9R」）
        venueName,
        raceLabel: raceNumberLabel(race.raceNo),
        gradeLabel: gradeConfig?.label ?? null,
        cancelledLabel: cancelled ? t("raceCard.cancelled") : null,
        deadline: race.startTime
          ? {
              label: t("home.deadline"),
              value: deadlineValueText(t, race.startTime),
            }
          : null,
        // 人のカードの「詳細を見る」の移動先（ja は接頭辞なし）
        href: raceId ? `/race/${raceId}` : null,
      };
    }),
  };
}
