/**
 * RaceDetailPage の見た目の部品（URL が違う・見出し・本体・空の知らせ。RaceDetailPage.jsx から字のまま移した。越えの単位を割るため）
 */

import { Link } from "react-router-dom";

import Header from "../components/Header";
import AssistViewSwitch from "../components/race/assist/AssistViewSwitch";

import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import {
  PredictionSection,
  RaceBottomNav,
  RaceNavCard,
  RaceNumberStrip,
  RaceEntrantsSummary,
} from "../components/race";
import DataFetchError from "../components/DataFetchError";
import { FETCH_FAILED_ERROR, NO_DATA_ERROR } from "../hooks/useDatePredictions";

import { RACE_STATUS } from "../utils/raceStatus";
import { isRaceCancelled } from "../utils/raceCancellation";
import { formatDateLocalized } from "../utils/formatters";

export function InvalidUrlView({ t, localize }) {
  return (
    <>
      <title>{t("meta.title")}</title>
      <Header />
      <div className="race-detail-page-v2">
        <div className="race-detail-page-v2__container">
          <div className="race-detail-page-v2__empty">
            <p>{t("raceDetailPage.invalidUrl")}</p>
            <Link to={localize("/")} className="back-link">
              {t("raceDetailPage.backToHome")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function RaceKicker({ gradeConfig, seriesTitle }) {
  return gradeConfig || seriesTitle ? (
    <p className="race-detail-kicker">
      {gradeConfig && (
        <span
          className="race-detail-grade"
          style={{ backgroundColor: gradeConfig.color }}
          translate="no"
        >
          {gradeConfig.label}
        </span>
      )}
      {seriesTitle && (
        <span
          className="race-detail-kicker__title"
          title={seriesTitle}
          translate="no"
        >
          {seriesTitle}
        </span>
      )}
    </p>
  ) : null;
}

function StageChipView({ stageChip }) {
  return stageChip ? (
    <>
      {" "}
      <span
        className={`race-detail-stage race-detail-stage--${stageChip.variant}`}
        title={stageChip.title}
        translate={stageChip.isOfficial ? "no" : undefined}
      >
        {stageChip.emoji && <span aria-hidden="true">{stageChip.emoji} </span>}
        {stageChip.label}
      </span>
    </>
  ) : null;
}

function RaceDetailHeader({
  t,
  i18n,
  venueName,
  parsed,
  stageChip,
  seriesDayLabel,
  isToday,
  status,
  racePrediction,
  date,
  raceListLink,
}) {
  return (
    <header className="page-header">
      <h1>
        🚤 {venueName} {parsed.raceNo}R
        <StageChipView stageChip={stageChip} />
        {seriesDayLabel && (
          <>
            {" "}
            <span className="race-detail-series-day">{seriesDayLabel}</span>
          </>
        )}
        {/* 本日の締切前は締切時刻を見出しにも出す。タブの上に帯と要約を置いたので、下の
            「データ分析結果（締切 …）」が375pxの最初の画面から外れた（BOA-1189 ファン評価2周目 指摘2） */}
        {isToday &&
          status === RACE_STATUS.UPCOMING &&
          racePrediction?.startTime && (
            <>
              {" "}
              <span
                className="race-detail-deadline"
                data-testid="race-detail-deadline"
              >
                {t("section.resultTitleDeadline", {
                  time: racePrediction.startTime,
                })}
              </span>
            </>
          )}
        {!isToday && ` (${formatDateLocalized(date, i18n.resolvedLanguage)})`}
      </h1>
      <Link to={raceListLink} className="back-link">
        {t("raceDetailPage.backToList")}
      </Link>
    </header>
  );
}

function EmptyNotice({ message, raceListLink, t }) {
  return (
    <div className="race-detail-page-v2__empty">
      <p>{message}</p>
      <Link to={raceListLink} className="back-link">
        {t("raceDetailPage.backToList")}
      </Link>
    </div>
  );
}

function RaceDetailLoaded({
  t,
  raceId,
  parsed,
  date,
  isToday,
  status,
  racePrediction,
  prediction,
  selectedRace,
  venueRaces,
  venues,
  isAnalyzing,
  loading,
  onNavigate,
  onVenueChange,
}) {
  return (
    <>
      {/* 1R〜12R の帯と出走6艇の1〜2行（BOA-1189 GS01-c、2026-10-31 オーナー決定、11-01 A案で要約を縮めた）。タブの上に置く */}
      <RaceNumberStrip
        races={venueRaces}
        currentRaceId={raceId}
        venueCode={parsed.venueCode}
        date={date}
        raceGrade={racePrediction.raceGrade ?? null}
        raceTitle={racePrediction.raceTitle ?? null}
      />
      {/* 中止のレースは出走6艇を出さない。中止の知らせを最初の画面に残す（ファン評価1周目 指摘1） */}
      {!prediction?.error && !isRaceCancelled(prediction) && (
        <RaceEntrantsSummary players={prediction?.allPlayers} raceId={raceId} />
      )}
      <PredictionSection
        prediction={prediction}
        selectedRace={selectedRace}
        isAnalyzing={isAnalyzing || loading}
        date={isToday ? undefined : date}
        status={status}
      />

      {isToday && (
        <div className="analysis-tools-link-section">
          <Link
            to={`/winning-technique?venue_code=${parsed.venueCode}&race_id=${raceId}&tab=motor`}
            className="analysis-tools-link"
          >
            📊 {t("panel.analysisToolsLink")}
          </Link>
        </div>
      )}

      <RaceNavCard
        races={venueRaces}
        selectedRace={selectedRace}
        onNavigate={onNavigate}
        venues={venues}
        selectedVenueId={parsed.venueCode}
        onVenueChange={onVenueChange}
      />
    </>
  );
}

function RaceDetailBody({
  loading,
  error,
  racePrediction,
  raceListLink,
  t,
  ...rest
}) {
  if (loading) {
    return (
      <LoadingScreen
        title={t("home.loadingTitle")}
        description={t("home.loadingDesc")}
      />
    );
  }
  if (error === FETCH_FAILED_ERROR) return <DataFetchError />;
  if (error === NO_DATA_ERROR) {
    return (
      <EmptyNotice
        message={t("raceDetailPage.noDataForDate")}
        raceListLink={raceListLink}
        t={t}
      />
    );
  }
  if (error || !racePrediction) {
    return (
      <EmptyNotice
        message={t("raceDetailPage.notFound")}
        raceListLink={raceListLink}
        t={t}
      />
    );
  }
  return (
    <RaceDetailLoaded
      t={t}
      loading={loading}
      racePrediction={racePrediction}
      {...rest}
    />
  );
}

export function RaceDetailView({
  showViewSwitch,
  raceId,
  pageMeta,
  breadcrumbItems,
  heading,
  t,
  i18n,
  venueName,
  parsed,
  isToday,
  status,
  racePrediction,
  date,
  raceListLink,
  loading,
  error,
  prediction,
  selectedRace,
  venueRaces,
  venues,
  isAnalyzing,
  navigateToRace,
  navigateToVenue,
}) {
  const { gradeConfig, seriesTitle, stageChip, seriesDayLabel } = heading;
  return (
    <>
      {/* 開催日を入れる。無いと同じ会場・同じR番号の全日付で title・description が同じになり、
          検索結果で重複扱いになる（集客レーン、2026-10-02） */}
      <title>{pageMeta.title}</title>
      <meta name="description" content={pageMeta.description} />
      {/* 4言語で出すページなので、canonical は表示中の言語の URL（hreflang と合わせる） */}
      <link rel="canonical" href={pageMeta.canonical} />
      <Header />
      {/* 上部の切り替え（BOA-430 PR6、D-22）。サイトのヘッダーの直下、パンくずの上（承認モック pr6-switch） */}
      {showViewSwitch && <AssistViewSwitch current="race" raceId={raceId} />}

      <div className="race-detail-page-v2">
        <Breadcrumb items={breadcrumbItems} />

        <div className="race-detail-page-v2__container">
          <RaceKicker gradeConfig={gradeConfig} seriesTitle={seriesTitle} />
          <RaceDetailHeader
            t={t}
            i18n={i18n}
            venueName={venueName}
            parsed={parsed}
            stageChip={stageChip}
            seriesDayLabel={seriesDayLabel}
            isToday={isToday}
            status={status}
            racePrediction={racePrediction}
            date={date}
            raceListLink={raceListLink}
          />

          <RaceDetailBody
            loading={loading}
            error={error}
            racePrediction={racePrediction}
            raceListLink={raceListLink}
            t={t}
            raceId={raceId}
            parsed={parsed}
            date={date}
            isToday={isToday}
            status={status}
            prediction={prediction}
            selectedRace={selectedRace}
            venueRaces={venueRaces}
            venues={venues}
            isAnalyzing={isAnalyzing}
            onNavigate={navigateToRace}
            onVenueChange={navigateToVenue}
          />
        </div>
      </div>

      {selectedRace && (
        <RaceBottomNav
          races={venueRaces}
          selectedRace={selectedRace}
          onNavigate={navigateToRace}
          venues={venues}
          selectedVenueId={parsed.venueCode}
          onVenueChange={navigateToVenue}
        />
      )}
    </>
  );
}
