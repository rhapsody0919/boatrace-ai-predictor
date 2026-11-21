/**
 * VenueGridPage - 開催場一覧ページ
 * 本日（`/`）と過去日付（`/races/:date`）の両方で使う。
 * 24会場を固定グリッドで表示し、各会場カードから会場別レース一覧へ遷移する。
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import HomeAiIntro from "../components/HomeAiIntro";
import { useFirstVisit } from "../hooks/useFirstVisit";
import { VenueGrid } from "../components/race";
import { clearCache } from "../services/core.js";
import { getRaces, getUpcomingSeries } from "../services/scheduleQueries.js";
import DataFetchError from "../components/DataFetchError";
import {
  useDatePredictions,
  FETCH_FAILED_ERROR,
  NO_DATA_ERROR,
} from "../hooks/useDatePredictions";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { useNowHHMM } from "../hooks/useNowHHMM";
import { getLanguage } from "../config/languages";
import { getTopPageMeta } from "../utils/pageMeta";
import { formatDate } from "../utils/formatters";
import { getTodayJST } from "../utils/dateUtils";
import { computeNextOpenDates } from "../utils/nextOpenDate";
import "./VenueGridPage.css";
// 過去日付ビューのレイアウト（.race-detail-page/.page-header/.back-link等）は
// 旧RaceDetail.jsxのスタイルを流用する
import "./RaceDetail.css";
import {
  TodayVenuesSection,
  HomeBlogSection,
  TodayVenueFooter,
} from "./VenueGridSections.jsx";

// getPredictions系レスポンス（フラットなraces配列）を会場別にグループ化する
function groupRacesByVenue(races) {
  const venueMap = new Map();
  for (const race of races || []) {
    if (!venueMap.has(race.venueCode)) {
      venueMap.set(race.venueCode, {
        placeCd: race.venueCode,
        placeName: race.venue,
        races: [],
      });
    }
    venueMap.get(race.venueCode).races.push({
      raceNo: race.raceNumber,
      startTime: race.startTime,
      raceGrade: race.raceGrade,
      raceTitle: race.raceTitle ?? null,
      raceStage: race.raceStage ?? null,
    });
  }
  const venues = [...venueMap.values()];
  venues.forEach((v) => v.races.sort((a, b) => a.raceNo - b.raceNo));
  return venues.sort((a, b) => a.placeCd - b.placeCd);
}

// 本日用: getRaces() で会場別データを取得
function useTodayVenues() {
  const [venuesData, setVenuesData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getRaces();
      if (!result.success || !result.data) {
        throw new Error("有効なデータが取得できませんでした");
      }
      setVenuesData(result.data);
      if (result.scrapedAt) setLastUpdated(result.scrapedAt);
    } catch (err) {
      console.error("API取得エラー:", err);
      // 失敗の判定は例外が出たかどうかで行い、メッセージの有無には依存しない。
      // 本文が空・{} の 5xx では PostgrestError の message が空文字になり、
      // err.message をそのまま入れると error が偽になって、取得失敗が
      // 「24会場すべて本日開催なし」に化けていた（BOA-668）
      setError(err?.message || FETCH_FAILED_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      clearCache();
      await fetchData();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchData]);

  return {
    venuesData,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    handleRefresh,
  };
}

// 本日用: 非開催会場の次開催日（BOA-225）。節データは補助情報なので、取得に失敗しても
// 会場グリッドは出し、次開催日だけ出さない（従来の「本日開催なし」表示に戻る）
function useNextOpenDates() {
  const [nextOpenDates, setNextOpenDates] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const today = getTodayJST();
    getUpcomingSeries(today)
      .then((rows) => {
        if (!cancelled) setNextOpenDates(computeNextOpenDates(rows, today));
      })
      .catch((err) => {
        console.error("次開催日（race_series）の取得に失敗:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return nextOpenDates;
}

// 過去日付用: getPredictionsを会場別にグループ化
function usePastVenues(date) {
  const { races, loading, error } = useDatePredictions(date);
  return { venuesData: groupRacesByVenue(races), loading, error };
}

function TodayVenueGridPage() {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  const nowHHMM = useNowHHMM(true);
  const isFirstVisit = useFirstVisit();
  const {
    venuesData,
    loading,
    error,
    lastUpdated,
    isRefreshing,
    handleRefresh,
  } = useTodayVenues();
  const nextOpenDates = useNextOpenDates();
  // title・description・canonical はボット向け HTML（ADR 0089）と同じ関数で組む
  const meta = getTopPageMeta(t, i18n.resolvedLanguage);
  useSocialMeta({
    title: meta.title,
    description: meta.description,
    url: meta.canonical,
  });

  return (
    <div className="app">
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <meta
        property="og:locale"
        content={getLanguage(i18n.resolvedLanguage).ogLocale}
      />
      <link rel="canonical" href={meta.canonical} />
      <Header />

      <div className="container">
        <main className="main-content">
          <TodayVenuesSection
            t={t}
            i18n={i18n}
            localize={localize}
            nowHHMM={nowHHMM}
            isFirstVisit={isFirstVisit}
            venuesData={venuesData}
            loading={loading}
            error={error}
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            handleRefresh={handleRefresh}
            nextOpenDates={nextOpenDates}
          />

          {/* 何のサイトかを説明する本文と実績（集客レーン Phase3。検索向けにクロールできる本文として置く） */}
          <HomeAiIntro lastUpdated={lastUpdated} />

          <HomeBlogSection t={t} i18n={i18n} localize={localize} />
        </main>
      </div>

      <TodayVenueFooter t={t} i18n={i18n} />
    </div>
  );
}

// i18n-allow-start: 過去日付の一覧（/races/:date）は ja専用（TRANSLATED_PATHS 未登録）
function PastVenueGridPage({ date }) {
  const { venuesData, loading, error } = usePastVenues(date);
  // /races/{today}のように「過去日付ビュー」経由で本日の日付が指定された場合も
  // 時刻比較を有効にする（無効のままだと本日の未終了レースが「全レース終了」と
  // 誤表示される）。真に過去の日付ではnullのまま（時刻比較不要）
  const nowHHMM = useNowHHMM(date === getTodayJST());
  const title = `${formatDate(date)}のAI予想データ - 龍神レーダー`;
  const description = `${formatDate(date)}のボートレースAI予想データと的中実績。各レース場の予想結果を確認できます。`;
  const canonical = `https://www.boat-ai.jp/races/${date}`;
  useSocialMeta({ title, description, url: canonical });

  const breadcrumbItems = [
    { name: "ホーム", url: "/" },
    { name: "過去の予想", url: "/races" },
    { name: formatDate(date), url: `/races/${date}` },
  ];

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <Header />

      <div className="race-detail-page">
        <Breadcrumb items={breadcrumbItems} />
        <div className="race-detail-container">
          <header className="page-header">
            <h1>📅 {formatDate(date)}</h1>
            <Link to="/races" className="back-link">
              ← 日付一覧に戻る
            </Link>
          </header>

          {loading ? (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>データを読み込み中...</p>
            </div>
          ) : error === FETCH_FAILED_ERROR ? (
            <DataFetchError />
          ) : error ? (
            <div className="error-container">
              <h3>エラー</h3>
              <p>
                {error === NO_DATA_ERROR ? "データが見つかりません" : error}
              </p>
              <Link to="/races" className="btn-primary">
                日付一覧に戻る
              </Link>
            </div>
          ) : (
            <VenueGrid
              venuesData={venuesData}
              getVenueLink={(code) => `/races/${date}/${code}`}
              nowHHMM={nowHHMM}
            />
          )}
        </div>
      </div>
    </>
  );
}
// i18n-allow-end

function VenueGridPage() {
  const { date } = useParams();
  if (date) {
    return <PastVenueGridPage date={date} />;
  }
  return <TodayVenueGridPage />;
}

export default VenueGridPage;
