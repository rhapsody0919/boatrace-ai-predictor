/**
 * RaceDetailPage - レース詳細ページ（ディープリンク対応）
 * `/race/:raceId`（raceId = YYYY-MM-DD-VV-RR、本日・過去日付共通）。
 * 中身は既存のPredictionSection（PredictionPanel/RaceResult/RaceReview）を流用する。
 */
import { useState, useEffect, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import {
  PredictionSection,
  RaceBottomNav,
  RaceNavCard,
} from "../components/race";
import { useDatePredictions } from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { parseRaceId } from "../utils/raceId";
import { getTodayJST } from "../utils/dateUtils";
import { getRaceStatus } from "../utils/raceStatus";
import { formatDateLocalized } from "../utils/formatters";
import "./RaceDetailPage.css";

// rawData（getPredictionsのrace）からPredictionSection用のprediction objectを構築
// （RaceDetail.jsxのprocessRacePredictionと同じロジック）
function buildPrediction(racePrediction, notFoundMessage) {
  const players =
    racePrediction?.players || racePrediction?.unified?.players || [];

  if (players.length === 0) {
    return {
      error: true,
      errorMessage: notFoundMessage,
      // 中止・順延（BOA-254）で選手情報が存在しないレースも、この分岐に入る。
      // PredictionPanel側でcancellationStatusを見て専用メッセージに出し分ける
      cancellationStatus: racePrediction?.cancellationStatus ?? null,
    };
  }

  const unified = racePrediction?.unified || null;
  const topPickPlayer = unified
    ? players.find((p) => p.number === unified.topPick)
    : null;

  return {
    topPick: topPickPlayer,
    allPlayers: players,
    top3: unified ? [unified.topPick, unified.top2nd].filter(Boolean) : [],
    result: racePrediction.result,
    cancellationStatus: racePrediction?.cancellationStatus ?? null,
    turnPrediction: unified?.turnPrediction ?? null,
    volatilityPercentile: unified?.volatilityPercentile ?? null,
    volatilityPercentileIsFallback:
      unified?.volatilityPercentileIsFallback ?? null,
    volatilityReasons: unified?.volatilityReasons ?? [],
    racerStats: racePrediction.racerStats || null,
    exhibitionData: racePrediction.exhibitionData || null,
  };
}

function RaceDetailPage() {
  const { raceId } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const localize = useLocalizedPath();
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  // raceIdが変わった瞬間、レンダー中に即座にisAnalyzingをtrueへ戻す
  // （Reactの「レンダー中に前回値と比較して状態を調整する」公式パターン。
  // useEffectでのsetState呼び出しは無駄な再レンダーを1回挟むため避ける）
  const [prevRaceId, setPrevRaceId] = useState(raceId);
  if (raceId !== prevRaceId) {
    setPrevRaceId(raceId);
    setIsAnalyzing(true);
  }

  const parsed = parseRaceId(raceId);
  const date = parsed?.date;
  const isToday = date === getTodayJST();

  const { races: allRaces, loading, error } = useDatePredictions(date);
  const nowHHMM = useNowHHMM(isToday);

  // AI分析中の演出（500ms後に解除。raceId変更のたびに再セットされる）
  useEffect(() => {
    const timer = setTimeout(() => setIsAnalyzing(false), 500);
    return () => clearTimeout(timer);
  }, [raceId]);

  const racePrediction = useMemo(
    () => allRaces.find((r) => r.raceId === raceId) || null,
    [allRaces, raceId],
  );

  const venueRaces = useMemo(() => {
    if (!parsed) return [];
    return allRaces
      .filter((r) => r.venueCode === parsed.venueCode)
      .sort((a, b) => a.raceNumber - b.raceNumber)
      .map((race) => ({
        id: race.raceId,
        venue: race.venue,
        venueCode: race.venueCode,
        raceNumber: race.raceNumber,
        startTime: race.startTime,
        rawData: race,
      }));
  }, [allRaces, parsed]);

  const venues = useMemo(() => {
    const codes = [...new Set(allRaces.map((r) => r.venueCode))].sort(
      (a, b) => a - b,
    );
    return codes.map((code) => ({
      placeCd: code,
      placeName: allRaces.find((r) => r.venueCode === code)?.venue || "",
    }));
  }, [allRaces]);

  if (!parsed) {
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

  const venueName = t(`venues.${parsed.venueCode}`);
  const raceListLink = isToday
    ? localize(`/venue/${parsed.venueCode}`)
    : `/races/${date}/${parsed.venueCode}`;

  const selectedRace = racePrediction
    ? {
        id: racePrediction.raceId,
        venue: venueName,
        venueCode: racePrediction.venueCode,
        raceNumber: racePrediction.raceNumber,
        startTime: racePrediction.startTime,
        rawData: racePrediction,
      }
    : null;

  const prediction = racePrediction
    ? buildPrediction(racePrediction, t("errors.noPredictionData"))
    : null;
  const status = getRaceStatus(
    { startTime: racePrediction?.startTime, result: racePrediction?.result },
    nowHHMM,
  );

  const navigateToRace = (race) => {
    navigate(localize(`/race/${race.id}`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navigateToVenue = (placeCd) => {
    navigate(
      isToday ? localize(`/venue/${placeCd}`) : `/races/${date}/${placeCd}`,
    );
  };

  const breadcrumbItems = [
    { name: t("analysisPage.breadcrumbHome"), url: localize("/") },
    ...(isToday
      ? []
      : [
          {
            name: t("raceDetailPage.pastPredictionsBreadcrumb"),
            url: "/races",
          },
          {
            name: formatDateLocalized(date, i18n.resolvedLanguage),
            url: `/races/${date}`,
          },
        ]),
    { name: venueName, url: raceListLink },
    {
      name: `${parsed.raceNo}R`,
      url: localize(`/race/${raceId}`),
    },
  ];

  return (
    <>
      <title>
        {t("raceDetailPage.metaTitle", {
          venue: venueName,
          race: parsed.raceNo,
        })}
      </title>
      <meta
        name="description"
        content={t("raceDetailPage.metaDescription", {
          venue: venueName,
          race: parsed.raceNo,
        })}
      />
      <link rel="canonical" href={`https://www.boat-ai.jp/race/${raceId}`} />
      <Header />

      <div className="race-detail-page-v2">
        <Breadcrumb items={breadcrumbItems} />

        <div className="race-detail-page-v2__container">
          <header className="page-header">
            <h1>
              🚤 {venueName} {parsed.raceNo}R
              {!isToday &&
                ` (${formatDateLocalized(date, i18n.resolvedLanguage)})`}
            </h1>
            <Link to={raceListLink} className="back-link">
              {t("raceDetailPage.backToList")}
            </Link>
          </header>

          {loading ? (
            <LoadingScreen
              title={t("home.loadingTitle")}
              description={t("home.loadingDesc")}
            />
          ) : error === "no-data" ? (
            <div className="race-detail-page-v2__empty">
              <p>{t("raceDetailPage.noDataForDate")}</p>
              <Link to={raceListLink} className="back-link">
                {t("raceDetailPage.backToList")}
              </Link>
            </div>
          ) : error || !racePrediction ? (
            <div className="race-detail-page-v2__empty">
              <p>{t("raceDetailPage.notFound")}</p>
              <Link to={raceListLink} className="back-link">
                {t("raceDetailPage.backToList")}
              </Link>
            </div>
          ) : (
            <>
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
                onNavigate={navigateToRace}
                venues={venues}
                selectedVenueId={parsed.venueCode}
                onVenueChange={navigateToVenue}
              />
            </>
          )}
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

export default RaceDetailPage;
