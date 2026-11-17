/**
 * VenueRaceListPage の表示の部品。VenueRaceListPage.jsx から移しただけで、DOM は変えない。
 */
import { Link } from "react-router-dom";
import { isInCautionEnabled } from "../config/featureFlags";
import FavoriteStarButton from "../components/common/FavoriteStarButton.jsx";
import LoadingScreen from "../components/LoadingScreen";
import { RaceCard } from "../components/race";
import VenueCharacteristicsCard from "../components/venue/VenueCharacteristicsCard";
import VenueDaySummaryCard from "../components/race/VenueDaySummaryCard";
import DataFetchError from "../components/DataFetchError";
import { FETCH_FAILED_ERROR } from "../hooks/useDatePredictions";
import { formatDate } from "../utils/formatters";
import { holdScrollPosition } from "./VenueRaceListPageScroll";

// 次のレースの直上に差し込むときは、見出しと要約1行に折りたたむ（会場カードと次のレースを1画面に入れる。
// ファン評価3周目を受けたユーザー判断）。最上部に置くときは従来どおり全部を出す
export function VenueCards({ venueCode, date, showCardsInGrid }) {
  return (
    <>
      {/* 会場の特徴は、どの位置でも最初は畳む（見出しと要約1行）。見出しの直下に要約2行があるので、
          出走表・「開催なし」を1画面目に近づける（BOA-1189 ファン評価 P2、Orchestrate の判断） */}
      <VenueCharacteristicsCard
        venueCode={venueCode}
        collapsible
      />

      {/* この日の水面傾向（phase a FR-5 / BOA-222）。直上の
          VenueCharacteristicsCard は直近1年（BOA-1189）で、
          こちらはこの日1日分。カードの注記で日付とレース数を明示する */}
      <VenueDaySummaryCard
        venueCode={venueCode}
        date={date}
        collapsible={showCardsInGrid}
      />
    </>
  );
}

export function PageHeader({ venueName, venueCode, isToday, date, backLink, t }) {
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
