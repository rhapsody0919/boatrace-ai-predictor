/**
 * VenueRaceListPage の純な計算（一覧の整形・次の発走レースの位置・過去日付のパンくずと meta）。
 * VenueRaceListPage.jsx から移しただけで、挙動は変えない。
 */
import { getRaceStatus, RACE_STATUS } from "../utils/raceStatus";
import { formatDate } from "../utils/formatters";
import { getTodayVenueBreadcrumbItems } from "../utils/pageMeta";

function buildVenueRaces(allRaces, venueCode, venueName) {
  return allRaces
    .filter((r) => r.venueCode === venueCode)
    .sort((a, b) => a.raceNumber - b.raceNumber)
    .map((race) => ({
      id: race.raceId,
      venue: venueName,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime,
      rawData: race,
    }));
}

// 指定時刻で最初の発走前（UPCOMING）のレースの位置。時刻が無い・該当が無いときは -1
function firstUpcomingIndex(venueRaces, hhmm) {
  return hhmm == null
    ? -1
    : venueRaces.findIndex(
        (race) =>
          getRaceStatus(
            { startTime: race.startTime, result: race.rawData?.result },
            hhmm,
          ) === RACE_STATUS.UPCOMING,
      );
}

function pastBreadcrumbItems(t, date, venueCode, venueName) {
  return [
    { name: t("analysisPage.breadcrumbHome"), url: "/" },
    { name: "過去の予想", url: "/races" },
    { name: formatDate(date), url: `/races/${date}` },
    { name: venueName, url: `/races/${date}/${venueCode}` },
  ];
}

export function pastPageMeta(venueName, date, venueCode) {
  return {
    title: `${venueName} ${formatDate(date)}のレース一覧・AIデータ分析 - 龍神レーダー`,
    description: `${venueName}ボートレース場の${formatDate(date)}の全レース一覧。各レースのAIデータ分析・結果を確認できます。`,
    canonical: `https://www.boat-ai.jp/races/${date}/${venueCode}`,
  };
}

// 本日分のパンくずは、ボット向け HTML（ADR 0089）の BreadcrumbList と同じ関数で組む
export function venueBreadcrumbItems({ isToday, t, date, venueCode, venueName, lang }) {
  return isToday
    ? getTodayVenueBreadcrumbItems(t, venueCode, lang)
    : pastBreadcrumbItems(t, date, venueCode, venueName);
}

// 一覧と、次の発走レースの位置の組
export function buildListState(allRaces, venueCode, venueName, openedHHMM, nowHHMM) {
  const venueRaces = buildVenueRaces(allRaces, venueCode, venueName);
  // 会場カード2枚（この会場の特徴・この日の水面傾向）を差し込む位置（BOA-546）。本日ビューで、最初の
  // 発走前（UPCOMING）のレースの直前。締切後・結果待ちのレースはその上に残る（もう舟券を買えないため）。
  // 1Rが発走前（先頭）・発走前のレースが無い（全レース締切後）・過去日付は、従来どおり最上部
  const nextRaceIndex = firstUpcomingIndex(venueRaces, openedHHMM);
  const cardsBeforeIndex = nextRaceIndex > 0 ? nextRaceIndex : null;
  // 目印の「次の締切」は、いまの時刻で決める（位置は固定だが、開いたまま時間がたつと、開いた時点の「次」は
  // 締切を過ぎている。ファン評価2周目 P1）
  const liveNextIndex = firstUpcomingIndex(venueRaces, nowHHMM);
  const liveNextRace = liveNextIndex >= 0 ? venueRaces[liveNextIndex] : null;
  return { venueRaces, cardsBeforeIndex, liveNextIndex, liveNextRace };
}
