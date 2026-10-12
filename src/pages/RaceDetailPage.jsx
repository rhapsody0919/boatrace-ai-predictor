/**
 * RaceDetailPage - レース詳細ページ（ディープリンク対応）
 * `/race/:raceId`（raceId = YYYY-MM-DD-VV-RR、本日・過去日付共通）。
 * 中身は既存のPredictionSection（PredictionPanel。基本情報/モータ情報/結果タブを
 * 内包するRaceTabsを含む、BOA-305〜312）を流用する。
 */
import { useState, useEffect, useMemo } from "react";
import {
  useParams,
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import AssistViewSwitch from "../components/race/assist/AssistViewSwitch";
import { isThinkingAssistEnabled } from "../config/featureFlags";
import {
  hasViewQuery,
  readRaceView,
  shouldOpenAssist,
} from "../utils/raceView";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import {
  PredictionSection,
  RaceBottomNav,
  RaceNavCard,
} from "../components/race";
import DataFetchError from "../components/DataFetchError";
import {
  useDatePredictions,
  FETCH_FAILED_ERROR,
  NO_DATA_ERROR,
} from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { parseRaceId } from "../utils/raceId";
import { getTodayJST } from "../utils/dateUtils";
import { getRaceStatus } from "../utils/raceStatus";
import { formatDateLocalized } from "../utils/formatters";
// 見出し・title・description・canonical・パンくずは、ボット向け HTML（ADR 0089 第2段）と同じ関数で組む
import {
  getRaceDetailHeading,
  getRaceDetailMeta,
  getRaceDetailBreadcrumbItems,
  getRaceListLink,
} from "../utils/raceDetailHeading";
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
      // 結果があれば中止扱いしない（isRaceCancelled、BOA-525）ため、こちらにも渡す
      result: racePrediction?.result ?? null,
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
    // 直前情報タブの気象カード用（BOA-304）
    weather: racePrediction.weather || null,
  };
}

function RaceDetailPage({ showViewSwitch = false }) {
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
  const lang = i18n.resolvedLanguage;
  const raceKey = {
    raceId,
    venueCode: parsed.venueCode,
    raceNo: parsed.raceNo,
    date,
  };
  const raceListLink = getRaceListLink(raceKey, isToday, lang);

  const prediction = racePrediction
    ? buildPrediction(racePrediction, t("errors.noPredictionData"))
    : null;
  // 取得失敗時は racePrediction が null になり、ページ全体が DataFetchError を出す。
  // ここでの null は「取得できたが値が無い」だけなので、何も出さない
  const { gradeConfig, seriesTitle, stageChip, seriesDayLabel } =
    getRaceDetailHeading(
      racePrediction,
      venueRaces.map((r) => r.rawData),
      t,
    );
  const selectedRace = racePrediction
    ? {
        id: racePrediction.raceId,
        venue: venueName,
        venueCode: racePrediction.venueCode,
        raceNumber: racePrediction.raceNumber,
        startTime: racePrediction.startTime,
        // 「AI用にコピー」の前提の行に、見出しと同じ日目・節タイトルを入れる（BOA-770）
        seriesDayLabel,
        seriesTitle,
        rawData: racePrediction,
      }
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

  const breadcrumbItems = getRaceDetailBreadcrumbItems(
    t,
    raceKey,
    isToday,
    lang,
  );
  const pageMeta = getRaceDetailMeta(t, raceKey, lang);

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
          {(gradeConfig || seriesTitle) && (
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
          )}
          <header className="page-header">
            <h1>
              🚤 {venueName} {parsed.raceNo}R
              {stageChip && (
                <>
                  {" "}
                  <span
                    className={`race-detail-stage race-detail-stage--${stageChip.variant}`}
                    title={stageChip.title}
                    translate={stageChip.isOfficial ? "no" : undefined}
                  >
                    {stageChip.emoji && (
                      <span aria-hidden="true">{stageChip.emoji} </span>
                    )}
                    {stageChip.label}
                  </span>
                </>
              )}
              {seriesDayLabel && (
                <>
                  {" "}
                  <span className="race-detail-series-day">
                    {seriesDayLabel}
                  </span>
                </>
              )}
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
          ) : error === FETCH_FAILED_ERROR ? (
            <DataFetchError />
          ) : error === NO_DATA_ERROR ? (
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

/**
 * レース詳細の入口（BOA-430 PR6、D-22・D-36 (6)）。思考アシストを選んだ端末では、ja で URL に tab・boat の指定が
 * 無いとき、データを取り始める前に思考アシストへ置き換えで移る。切り替えはフラグがあり ja で、tab・boat の指定が無いときだけ出す
 */
function RaceDetailRoute() {
  const { raceId } = useParams();
  const { i18n } = useTranslation();
  const { search } = useLocation();
  const enabled = isThinkingAssistEnabled();
  const lang = i18n.resolvedLanguage;
  if (shouldOpenAssist({ saved: readRaceView(), search, lang, enabled }))
    return <Navigate to={`/race/${raceId}/assist`} replace />;
  return (
    <RaceDetailPage
      showViewSwitch={enabled && lang === "ja" && !hasViewQuery(search)}
    />
  );
}

export default RaceDetailRoute;
