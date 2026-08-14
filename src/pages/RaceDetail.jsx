import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import {
  VenueSelector,
  RaceCard,
  PredictionSection,
  RaceBottomNav,
  RaceNavCard,
} from "../components/race";
import { dataService } from "../services/dataService";
import { STADIUM_NAMES } from "../constants";
import { formatDate } from "../utils/formatters";
import { getTodayJST } from "../utils/dateUtils";
import "./RaceDetail.css";

function RaceDetail() {
  const { date } = useParams();
  const { t } = useTranslation();
  const [raceData, setRaceData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [venuesData, setVenuesData] = useState([]);
  const [selectedVenueId, setSelectedVenueId] = useState(null);
  const [selectedRace, setSelectedRace] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [raceListCollapsed, setRaceListCollapsed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const predictionRef = useRef(null);

  // 会場・レースマップを構築する共通関数
  const applyRaceData = (data) => {
    setRaceData(data);

    const venueMap = {};
    data.races?.forEach((race) => {
      const venueCode = race.venueCode;
      if (!venueMap[venueCode]) {
        venueMap[venueCode] = {
          placeCd: venueCode,
          placeName: race.venue,
          races: [],
        };
      }
      venueMap[venueCode].races.push({
        id: race.raceId,
        venue: race.venue,
        raceNumber: race.raceNumber,
        venueCode: race.venueCode,
        rawData: race,
      });
    });

    Object.values(venueMap).forEach((venue) => {
      venue.races.sort((a, b) => a.raceNumber - b.raceNumber);
    });

    return Object.values(venueMap).sort((a, b) => a.placeCd - b.placeCd);
  };

  // レースデータを取得（2段階ロード: 軽量版 → フル版）
  useEffect(() => {
    let cancelled = false;

    const fetchRaceData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Phase 1: 軽量版で即座に一覧表示
        const lightData = await dataService.getPredictions(date, {
          light: true,
        });
        if (cancelled) return;

        if (!lightData.races || lightData.races.length === 0) {
          throw new Error("データが見つかりません");
        }

        const venues = applyRaceData(lightData);
        setVenuesData(venues);
        if (venues.length > 0) {
          setSelectedVenueId(venues[0].placeCd);
        }
        setLoading(false);

        // Phase 2: バックグラウンドでフル版を取得（turnPrediction/racerStats含む）
        const fullData = await dataService.getPredictions(date);
        if (cancelled) return;

        if (fullData.races && fullData.races.length > 0) {
          const fullVenues = applyRaceData(fullData);
          setVenuesData(fullVenues);
        }
      } catch (err) {
        console.error("データ取得エラー:", err);
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchRaceData();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // フル版到着時 or レース選択時に selectedRace を最新データと同期
  // （2段階ロードで軽量版 → フル版に切り替わった時の自動リフレッシュ）
  useEffect(() => {
    if (!raceData?.races || !selectedRace) return;

    const latestRawData = raceData.races.find(
      (r) => r.raceId === selectedRace.id,
    );
    // 参照が同じなら何もしない（無限ループ防止 & 不要な再描画防止）
    if (!latestRawData || latestRawData === selectedRace.rawData) return;

    // 新しい rawData で selectedRace を更新
    const upgradedRace = { ...selectedRace, rawData: latestRawData };
    setSelectedRace(upgradedRace);

    // prediction が表示中なら新データで再計算（turnPrediction / racerStats 反映）
    if (prediction && !prediction.error && !isAnalyzing) {
      processRacePrediction(upgradedRace);
    }
    // raceData と selectedRace.id を監視し、最新の state を closure で取得
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceData, selectedRace?.id]);

  // レース分析
  const analyzeRace = useCallback((race) => {
    setSelectedRace(race);
    setIsAnalyzing(true);
    setPrediction(null);
    // レース選択後は一覧を折りたたんでページ全長を抑える
    setRaceListCollapsed(true);

    setTimeout(() => {
      setIsAnalyzing(false);
      processRacePrediction(race);
      setTimeout(() => {
        predictionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }, 500);
  }, []);

  const handleVenueChange = useCallback(
    (placeCd) => {
      setSelectedVenueId(placeCd);
      // 新会場の最初のレースを自動選択
      const venue = venuesData.find((v) => v.placeCd === placeCd);
      if (venue?.races?.length > 0) {
        analyzeRace(venue.races[0]);
      }
    },
    [venuesData, analyzeRace],
  );

  const processRacePrediction = (race) => {
    const racePrediction = race.rawData;
    // データ出走表（DataRaceTable）はモデル非依存のため、race_entriesがあれば
    // unifiedモデルの予測データが無い過去日付（2026-08-11より前）でも表示できるようにする
    const players =
      racePrediction?.players || racePrediction?.unified?.players || [];

    if (players.length === 0) {
      setPrediction({
        error: true,
        errorMessage: "予想データがありません",
      });
      return;
    }

    const unified = racePrediction?.unified || null;
    const topPickPlayer = unified
      ? players.find((p) => p.number === unified.topPick)
      : null;

    setPrediction({
      topPick: topPickPlayer,
      allPlayers: players,
      top3: unified ? [unified.topPick, unified.top2nd].filter(Boolean) : [],
      result: racePrediction.result,
      turnPrediction: unified?.turnPrediction ?? null,
      volatilityPercentile: unified?.volatilityPercentile ?? null,
      volatilityPercentileIsFallback:
        unified?.volatilityPercentileIsFallback ?? null,
      volatilityReasons: unified?.volatilityReasons ?? [],
      racerStats: racePrediction.racerStats || null,
    });
  };

  const breadcrumbItems = [
    { label: "ホーム", path: "/" },
    { label: "過去の予想", path: "/races" },
    { label: formatDate(date), path: `/races/${date}` },
  ];

  const selectedVenue = venuesData.find((v) => v.placeCd === selectedVenueId);
  const races = selectedVenue?.races || [];

  return (
    <>
      <title>{`${formatDate(date)}のAI予想データ - BoatAI`}</title>
      <meta
        name="description"
        content={`${formatDate(date)}のボートレースAI予想データと的中実績。各レース場の予想結果を確認できます。`}
      />
      <link rel="canonical" href={`https://www.boat-ai.jp/races/${date}`} />

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
          ) : error ? (
            <div className="error-container">
              <h3>エラー</h3>
              <p>{error}</p>
              <Link to="/races" className="btn-primary">
                日付一覧に戻る
              </Link>
            </div>
          ) : (
            <>
              <VenueSelector
                venuesData={venuesData}
                selectedVenueId={selectedVenueId}
                onVenueChange={setSelectedVenueId}
              />

              <section className="race-list-section">
                <h2>🏁 レース一覧</h2>

                {races.length === 0 ? (
                  <div
                    style={{
                      padding: "2rem",
                      textAlign: "center",
                      color: "#fff",
                    }}
                  >
                    <p>このレース場のデータはありません</p>
                  </div>
                ) : raceListCollapsed ? (
                  <button
                    type="button"
                    className="race-list-toggle"
                    onClick={() => setRaceListCollapsed(false)}
                  >
                    {t("raceList.show")}
                  </button>
                ) : (
                  <>
                    <div className="race-grid">
                      {races.map((race) => (
                        <RaceCard
                          key={race.id}
                          race={race}
                          onAnalyzeRace={analyzeRace}
                        />
                      ))}
                    </div>
                    {selectedRace && races.length > 0 && (
                      <button
                        type="button"
                        className="race-list-toggle"
                        onClick={() => setRaceListCollapsed(true)}
                      >
                        {t("raceList.hide")}
                      </button>
                    )}
                  </>
                )}
              </section>

              {selectedRace && (
                <PredictionSection
                  ref={predictionRef}
                  prediction={prediction}
                  selectedRace={selectedRace}
                  isAnalyzing={isAnalyzing}
                  date={date}
                />
              )}

              {selectedRace && date === getTodayJST() && (
                <div className="analysis-tools-link-section">
                  <Link
                    to={`/winning-technique?venue_code=${selectedRace.venueCode}&race_id=${selectedRace.id}&tab=motor`}
                    className="analysis-tools-link"
                  >
                    📊 {t("panel.analysisToolsLink")}
                  </Link>
                </div>
              )}

              {selectedRace && (
                <RaceNavCard
                  races={races}
                  selectedRace={selectedRace}
                  onNavigate={analyzeRace}
                  venues={venuesData.map((v) => ({
                    placeCd: v.placeCd,
                    placeName: v.placeName,
                  }))}
                  selectedVenueId={selectedVenueId}
                  onVenueChange={handleVenueChange}
                />
              )}
            </>
          )}
        </div>
      </div>

      {selectedRace && (
        <RaceBottomNav
          races={races}
          selectedRace={selectedRace}
          onNavigate={analyzeRace}
          venues={venuesData.map((v) => ({
            placeCd: v.placeCd,
            placeName: v.placeName,
          }))}
          selectedVenueId={selectedVenueId}
          onVenueChange={handleVenueChange}
        />
      )}
    </>
  );
}

export default RaceDetail;
