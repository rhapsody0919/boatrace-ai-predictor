/**
 * VenueRaceListPage の画面本体（head 要素・見出し・会場カード・一覧）。
 * VenueRaceListPage.jsx から移しただけで、DOM は変えない。
 */
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import VenueSummaryLines from "../components/venue/VenueSummaryLines";
import VenueMeetBanner from "../components/venue/VenueMeetBanner";
import { PageHeader, RaceListBody, VenueCards } from "./VenueRaceListPageParts";

export default function VenueRaceListView({
  t,
  localize,
  isToday,
  date,
  venueCode,
  venueName,
  backLink,
  loading,
  error,
  pageMeta,
  breadcrumbItems,
  venueRaces,
  cardsBeforeIndex,
  liveNextIndex,
  liveNextRace,
  nowHHMM,
  cautionNoteRef,
  gridRef,
  markerRef,
}) {
  const noRacesMessage = isToday
    ? t("home.noRacesToday")
    : "このレース場のデータはありません";

  const showCardsInGrid = !loading && !error && cardsBeforeIndex != null;
  const venueCards = (
    <VenueCards
      venueCode={venueCode}
      date={date}
      showCardsInGrid={showCardsInGrid}
    />
  );

  return (
    <>
      <title>{pageMeta.title}</title>
      <meta name="description" content={pageMeta.description} />
      <link rel="canonical" href={pageMeta.canonical} />
      <Header />

      <div className="venue-race-list-page">
        <Breadcrumb items={breadcrumbItems} />

        <div className="venue-race-list-container">
          <PageHeader
            venueName={venueName}
            venueCode={venueCode}
            isToday={isToday}
            date={date}
            backLink={backLink}
            t={t}
          />

          {/* 会場の常設の要約2行（直近1年、BOA-1189 GS02-b）。数字は静的な値なので読み込みを待たずに出す */}
          {isToday && <VenueSummaryLines venueCode={venueCode} />}
          {/* SG・G1・G2 の開催中だけ、節のページ（得点率ランキング・勝ち上がり）への帯（BOA-1189） */}
          {isToday && !loading && !error && (
            <VenueMeetBanner
              venueCode={venueCode}
              races={venueRaces.map((r) => r.rawData)}
              today={date}
            />
          )}

          {/* 本日ビューでは、レースの並びが決まるまで会場カードを出さない（最上部に出してから次の発走レースの
              直前へ移すと、カードが飛んで見える＝レイアウトシフト） */}
          {!(isToday && loading) && !showCardsInGrid && venueCards}

          <RaceListBody
            loading={loading}
            error={error}
            noRacesMessage={noRacesMessage}
            backLink={backLink}
            t={t}
            cautionNoteRef={cautionNoteRef}
            venueRaces={venueRaces}
            showCardsInGrid={showCardsInGrid}
            cardsBeforeIndex={cardsBeforeIndex}
            venueCards={venueCards}
            gridRef={gridRef}
            markerRef={markerRef}
            liveNextRace={liveNextRace}
            liveNextIndex={liveNextIndex}
            venueName={venueName}
            nowHHMM={nowHHMM}
            localize={localize}
          />
        </div>
      </div>
    </>
  );
}
