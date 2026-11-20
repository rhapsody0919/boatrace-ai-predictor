/**
 * RaceDetailPage - レース詳細ページ（ディープリンク対応）
 * `/race/:raceId`（raceId = YYYY-MM-DD-VV-RR、本日・過去日付共通）。
 * 中身は既存のPredictionSection（PredictionPanel。基本情報/モータ情報/結果タブを
 * 内包するRaceTabsを含む、BOA-305〜312）を流用する。
 */
import { useState, useEffect, useMemo } from "react";
import {
  useParams,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useTranslation } from "react-i18next";

import { isThinkingAssistEnabled } from "../config/featureFlags";
import {
  hasViewQuery,
  readRaceView,
  shouldOpenAssist,
} from "../utils/raceView";

import {
  useDatePredictions,
  FETCH_FAILED_ERROR,
} from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { parseRaceId } from "../utils/raceId";
import { getTodayJST } from "../utils/dateUtils";
import { getRaceStatus } from "../utils/raceStatus";
import { isRaceCancelled } from "../utils/raceCancellation";

// 見出し・title・description・canonical・パンくずは、ボット向け HTML（ADR 0089 第2段）と同じ関数で組む
import {
  getRaceDetailHeading,
  getRaceDetailMeta,
  getRaceDetailBreadcrumbItems,
  getRaceListLink,
} from "../utils/raceDetailHeading";
import "./RaceDetailPage.css";

import { InvalidUrlView, RaceDetailView } from "./RaceDetailView";
// rawData（getPredictionsのrace）からPredictionSection用のprediction objectを構築
// （RaceDetail.jsxのprocessRacePredictionと同じロジック）
function buildNoPlayersPrediction(racePrediction, notFoundMessage) {
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

// unified（統合予想）に由来する項目
function buildUnifiedFields(unified) {
  return {
    turnPrediction: unified?.turnPrediction ?? null,
    volatilityPercentile: unified?.volatilityPercentile ?? null,
    volatilityPercentileIsFallback:
      unified?.volatilityPercentileIsFallback ?? null,
    volatilityReasons: unified?.volatilityReasons ?? [],
  };
}

// 本命の選手と上位2艇
function buildPickFields(unified, players) {
  const topPickPlayer = unified
    ? players.find((p) => p.number === unified.topPick)
    : null;
  return {
    topPick: topPickPlayer,
    allPlayers: players,
    top3: unified ? [unified.topPick, unified.top2nd].filter(Boolean) : [],
  };
}

function buildPrediction(racePrediction, notFoundMessage) {
  const players =
    racePrediction?.players || racePrediction?.unified?.players || [];

  if (players.length === 0) {
    return buildNoPlayersPrediction(racePrediction, notFoundMessage);
  }

  const unified = racePrediction?.unified || null;

  return {
    ...buildPickFields(unified, players),
    result: racePrediction.result,
    cancellationStatus: racePrediction?.cancellationStatus ?? null,
    ...buildUnifiedFields(unified),
    // BOA-822 イン崩れ注意度（transformEdgeResponse がレース直下に通した値）
    inCaution: racePrediction.inCaution ?? null,
    racerStats: racePrediction.racerStats || null,
    exhibitionData: racePrediction.exhibitionData || null,
    // 直前情報タブの気象カード用（BOA-304）
    weather: racePrediction.weather || null,
  };
}

function buildVenueRaces(allRaces, parsed) {
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
}

function buildVenues(allRaces) {
  const codes = [...new Set(allRaces.map((r) => r.venueCode))].sort(
    (a, b) => a - b,
  );
  return codes.map((code) => ({
    placeCd: code,
    placeName: allRaces.find((r) => r.venueCode === code)?.venue || "",
  }));
}

function buildSelectedRace(racePrediction, venueName, heading) {
  const { seriesDayLabel, seriesTitle } = heading;
  return racePrediction
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
}

function buildPageMeta(t, raceKey, lang, racePrediction) {
  return raceKey
    ? getRaceDetailMeta(t, raceKey, lang, {
        cancelled: isRaceCancelled(racePrediction),
        finished: !!racePrediction?.result,
      })
    : {};
}

function shouldNoindex(parsed, loading, error, racePrediction) {
  return (
    !parsed ||
    (!loading && error !== FETCH_FAILED_ERROR && !!(error || !racePrediction))
  );
}

function getStatusOf(racePrediction, nowHHMM) {
  return getRaceStatus(
    { startTime: racePrediction?.startTime, result: racePrediction?.result },
    nowHHMM,
  );
}

// データの取得・選択中レース・会場の一覧（hooks の呼ぶ順は元のまま）
function useRaceDetailData(raceId) {
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

  const venueRaces = useMemo(
    () => buildVenueRaces(allRaces, parsed),
    [allRaces, parsed],
  );

  const venues = useMemo(() => buildVenues(allRaces), [allRaces]);

  return {
    parsed,
    date,
    isToday,
    loading,
    error,
    nowHHMM,
    isAnalyzing,
    racePrediction,
    venueRaces,
    venues,
  };
}

function RaceDetailPage({ showViewSwitch = false }) {
  const { raceId } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const localize = useLocalizedPath();
  const {
    parsed,
    date,
    isToday,
    loading,
    error,
    nowHHMM,
    isAnalyzing,
    racePrediction,
    venueRaces,
    venues,
  } = useRaceDetailData(raceId);

  const lang = i18n.resolvedLanguage;
  const raceKey = parsed
    ? { raceId, venueCode: parsed.venueCode, raceNo: parsed.raceNo, date }
    : null;
  const pageMeta = buildPageMeta(t, raceKey, lang, racePrediction);
  // 中身の無い枝（URLの形が不正・NO_DATA・見つからない）だけ noindex。
  // 読み込み中と取得の失敗は一時的な状態なので noindex にしない（枝の並びは下の描画と同じ）
  useRobotsMeta(shouldNoindex(parsed, loading, error, racePrediction));
  useSocialMeta({
    title: pageMeta.title,
    description: pageMeta.description,
    url: pageMeta.canonical,
  });

  if (!parsed) return <InvalidUrlView t={t} localize={localize} />;

  const venueName = t(`venues.${parsed.venueCode}`);
  const raceListLink = getRaceListLink(raceKey, isToday, lang);

  const prediction = racePrediction
    ? buildPrediction(racePrediction, t("errors.noPredictionData"))
    : null;
  // 取得失敗時は racePrediction が null になり、ページ全体が DataFetchError を出す。
  // ここでの null は「取得できたが値が無い」だけなので、何も出さない
  const heading = getRaceDetailHeading(
    racePrediction,
    venueRaces.map((r) => r.rawData),
    t,
  );
  const selectedRace = buildSelectedRace(racePrediction, venueName, heading);
  const status = getStatusOf(racePrediction, nowHHMM);

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

  return (
    <RaceDetailView
      showViewSwitch={showViewSwitch}
      raceId={raceId}
      pageMeta={pageMeta}
      breadcrumbItems={breadcrumbItems}
      heading={heading}
      t={t}
      i18n={i18n}
      venueName={venueName}
      parsed={parsed}
      isToday={isToday}
      status={status}
      racePrediction={racePrediction}
      date={date}
      raceListLink={raceListLink}
      loading={loading}
      error={error}
      prediction={prediction}
      selectedRace={selectedRace}
      venueRaces={venueRaces}
      venues={venues}
      isAnalyzing={isAnalyzing}
      navigateToRace={navigateToRace}
      navigateToVenue={navigateToVenue}
    />
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
