/**
 * VenueRaceListPage の表示の部品（見出し・会場カード・一覧・出走表の後のコース別の節）。
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { isInCautionEnabled } from "../config/featureFlags";
import FavoriteStarButton from "../components/common/FavoriteStarButton.jsx";
import LoadingScreen from "../components/LoadingScreen";
import { RaceCard } from "../components/race";
import VenueCharacteristicsCard from "../components/venue/VenueCharacteristicsCard";
import VenueMeetHeading from "../components/venue/VenueMeetHeading";
import VenueSummaryLines from "../components/venue/VenueSummaryLines";
import VenueDaySummaryCard from "../components/race/VenueDaySummaryCard";
import { VENUE_SUMMARY_STATS } from "../data/venueSummaryStats";
import {
  VENUE_COURSE_SECTION_ID,
  venueCourseTableRows,
} from "../pure/venueCourseTableRows";
import DataFetchError from "../components/DataFetchError";
import { FETCH_FAILED_ERROR } from "../hooks/useDatePredictions";
import { formatDate } from "../utils/formatters";
import { holdScrollPosition } from "./VenueRaceListPageScroll";

// 次のレースの直上（または最上部）に置く会場カード。この日の水面傾向だけ。
// 直近1年の「コース別成績と特徴」は畳まずに出走表の後へ移した（BOA-1687 GS02 V1。VenueCourseSection）
export function VenueCards({ venueCode, date, showCardsInGrid }) {
  return (
    <VenueDaySummaryCard
      venueCode={venueCode}
      date={date}
      collapsible={showCardsInGrid}
    />
  );
}

// 出走表の後の「<会場>のコース別成績と特徴（直近1年）」の節（BOA-1687）。開いた状態で出す
export function VenueCourseSection({ venueCode }) {
  return <VenueCharacteristicsCard venueCode={venueCode} />;
}

// 見出しの直下の常設の要約2行（BOA-1189）と、その直下の節へのページ内リンク（375px では節が出走表12R分
// 下になるため、BOA-1687）。数字は静的な値なので読み込みを待たずに出す。節を出さない会場ではリンクを出さない
export function VenueSummaryWithLink({ venueCode }) {
  const { t } = useTranslation();
  const hasSection = venueCourseTableRows(
    VENUE_SUMMARY_STATS.venues[venueCode],
    VENUE_SUMMARY_STATS.national,
  );
  return (
    <>
      <VenueSummaryLines venueCode={venueCode} />
      {hasSection && (
        <p className="venue-race-list__course-link">
          <a
            href={`#${VENUE_COURSE_SECTION_ID}`}
            data-testid="venue-course-section-link"
          >
            {t("venueRaceList.courseSectionLink", {
              venue: t(`venues.${venueCode}`),
            })}
          </a>
        </p>
      )}
    </>
  );
}

// 「1R〜12R」の状態。本日は次の発走より前を done（次が無ければ全部）、次を next。過去日付は状態なし（approved.md）
const jumpStateOf = (i, liveNextIndex, isToday) => {
  if (!isToday) return null;
  if (liveNextIndex < 0 || i < liveNextIndex) return "done";
  return i === liveNextIndex ? "next" : "upcoming";
};

// 見出しの下の節と日目の行と「1R〜12R」のボタン。押したらそのレースの塊へ（目印の近道と同じ移り方）
function MeetHeading({
  loading,
  error,
  venueRaces,
  gridRef,
  liveNextIndex,
  isToday,
  date,
}) {
  if (loading || error || venueRaces.length === 0) return null;
  const onJump = (index) =>
    holdScrollPosition(
      () => gridRef.current?.querySelectorAll(":scope > .race-card")[index],
      gridRef.current,
    );
  const items = venueRaces.map((r, i) => ({
    id: r.id,
    raceNumber: r.raceNumber,
    state: jumpStateOf(i, liveNextIndex, isToday),
  }));
  return <VenueMeetHeading {...{ venueRaces, date, items, onJump }} />;
}

export function PageHeader({
  venueName,
  venueCode,
  isToday,
  date,
  backLink,
  t,
  heading,
}) {
  return (
    <header className="page-header">
      <div className="favorite-star-header-row">
        <h1>
          🏁 {venueName}{" "}
          {isToday
            ? t("venueRaceList.todayTitle")
            : `${t("venueRaceList.title")} (${formatDate(date)})`}
        </h1>
        <FavoriteStarButton
          type="venue"
          id={Number(venueCode)}
          name={venueName}
          entry="venue_header"
          withLabel
        />
      </div>
      <Link to={backLink} className="back-link">
        {t("venueRaceList.backToVenues")}
      </Link>
      {/* 節と日目の行と「1R〜12R」（公式の形、オーナー 2026-11-23 承認）。header の2段目に全幅で置く */}
      <MeetHeading {...heading} isToday={isToday} date={date} />
    </header>
  );
}

// 次のレースの目印（自動スクロールの着地点）。会場名と、いまの時刻で決めた次の締切を出し、
// そのレースのカードへの近道を置く。会場カードは縦に長いため、目印は会場カードの下＝次の
// レースのカードの直上に置き、着いた1画面目に次のレースが入るようにする（ファン評価2周目）
function NextRaceMarker({
  markerRef,
  gridRef,
  liveNextRace,
  liveNextIndex,
  venueName,
  t,
}) {
  return (
    <p
      ref={markerRef}
      className="venue-race-list__next-race-marker"
      data-testid="venue-next-race-marker"
    >
      <span>
        {liveNextRace
          ? t("venueRaceList.nextDeadlineMarker", {
              venue: venueName,
              race: liveNextRace.raceNumber,
              time: liveNextRace.startTime,
            })
          : t("venueRaceList.allClosedMarker", {
              venue: venueName,
            })}
      </span>
      {liveNextRace && (
        <button
          type="button"
          className="venue-race-list__next-race-jump"
          onClick={() =>
            holdScrollPosition(
              () =>
                gridRef.current?.querySelectorAll(":scope > .race-card")[
                  liveNextIndex
                ],
              gridRef.current,
            )
          }
        >
          {t("venueRaceList.jumpToNextRace", {
            race: liveNextRace.raceNumber,
          })}
        </button>
      )}
    </p>
  );
}

function RaceGrid({
  venueRaces,
  showCardsInGrid,
  cardsBeforeIndex,
  venueCards,
  gridRef,
  markerRef,
  liveNextRace,
  liveNextIndex,
  venueName,
  nowHHMM,
  localize,
  t,
}) {
  return (
    <div className="race-grid" ref={gridRef}>
      {venueRaces.map((race, index) => [
        showCardsInGrid && index === cardsBeforeIndex && (
          <div
            key="venue-cards"
            className="venue-race-list__next-race-cards"
            data-testid="venue-next-race-cards"
          >
            {venueCards}
            <NextRaceMarker
              markerRef={markerRef}
              gridRef={gridRef}
              liveNextRace={liveNextRace}
              liveNextIndex={liveNextIndex}
              venueName={venueName}
              t={t}
            />
          </div>
        ),
        <RaceCard
          key={race.id}
          race={race}
          nowHHMM={nowHHMM}
          raceHref={localize(`/race/${race.id}`)}
          linkRacerNames
        />,
      ])}
    </div>
  );
}

// 読み込み中・取得失敗・開催なし・一覧の出し分け
export function RaceListBody({
  loading,
  error,
  noRacesMessage,
  backLink,
  cautionNoteRef,
  t,
  ...gridProps
}) {
  if (loading) {
    return (
      <LoadingScreen
        title={t("home.loadingTitle")}
        description={t("home.loadingDesc")}
      />
    );
  }
  // 取得失敗（DBタイムアウト等）を「開催なし」と誤表示しない
  if (error === FETCH_FAILED_ERROR) return <DataFetchError />;
  if (error || gridProps.venueRaces.length === 0) {
    return (
      <div className="venue-race-list-page__empty">
        <p>{noRacesMessage}</p>
        <Link to={backLink} className="back-link">
          {t("venueRaceList.backToVenues")}
        </Link>
      </div>
    );
  }
  return (
    <section className="race-list-section">
      {/* BOA-822（機能フラグの側）: 札の割合が何か（全国の勝率差の帯）を一覧の上に1行。会場の「この会場の特徴」と
          並ぶので、当地の割合と読み違えない（#1602 ファン評価1周目 指摘1） */}
      {isInCautionEnabled() && (
        <p className="venue-race-list__in-caution-note" ref={cautionNoteRef}>
          {t("inCaution.listNote")}
        </p>
      )}
      <RaceGrid {...gridProps} t={t} />
    </section>
  );
}
