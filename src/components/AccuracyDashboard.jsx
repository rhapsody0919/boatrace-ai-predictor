import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import UpdateStatus from "./UpdateStatus";
import { supabaseDataService } from "../services/supabaseDataService";
import { formatPercent } from "../utils/formatters";
import { ReliabilityWarning, VolatilityAccuracySection } from "./accuracy";
import LoadingScreen from "./LoadingScreen";
import "./AccuracyDashboard.css";

function AccuracyDashboard({ onRefresh, isRefreshing }) {
  const [modelAccuracy, setModelAccuracy] = useState(null);
  const [volatilityStats, setVolatilityStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const [accuracyData, volatilityData] = await Promise.all([
          supabaseDataService.getUnifiedModelAccuracy(),
          supabaseDataService.getUnifiedVolatilityAccuracy(),
        ]);
        if (!cancelled) {
          setModelAccuracy(accuracyData);
          setVolatilityStats(volatilityData);
        }
      } catch (err) {
        console.error("Failed to load accuracy summary:", err);
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  // メタタグは loading / error 分岐でも出力する（React 19 が <head> にホイスティング）
  const pageMeta = (
    <>
      <title>成績 | 龍神レーダー</title>
      <meta
        name="description"
        content="龍神レーダーのAI予想（展開予測・イン崩れ指数）の実測精度を公開中。過去のレース結果と機械的に照合した実績データです。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/accuracy" />
    </>
  );

  if (loading) {
    return (
      <div className="accuracy-dashboard">
        {pageMeta}
        <h2>📊 成績</h2>
        <LoadingScreen
          title="実測精度データを読み込み中..."
          description="成績データを集計しています"
        />
      </div>
    );
  }

  const hasData = modelAccuracy && modelAccuracy.turn.totalRaces > 0;

  if (error || !modelAccuracy || !hasData) {
    return (
      <div className="accuracy-dashboard">
        {pageMeta}
        <h2>📊 成績</h2>
        <div className="error-message">
          <p>
            実測精度データはまだ利用できません。レース終了後に自動計算されます。
          </p>
          <button
            className="reload-button"
            onClick={() => window.location.reload()}
          >
            🔄 再読み込み
          </button>
        </div>
      </div>
    );
  }

  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const weekday = weekdays[today.getDay()];
    return `${year}年${month}月${day}日（${weekday}）`;
  };

  return (
    <>
      {pageMeta}
      <div className="accuracy-dashboard">
        <div className="dashboard-header">
          <h2>📊 成績</h2>
          <p className="last-updated">{getTodayDate()}</p>
        </div>
        <UpdateStatus
          lastUpdated={modelAccuracy.calculatedAt}
          dataType="成績データ"
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
        />

        <ReliabilityWarning races={modelAccuracy.turn.totalRaces} />

        <div className="turn-accuracy-hero">
          <h3>🌊 展開予測の実測的中率</h3>
          <p className="turn-accuracy-hero-rate">
            {formatPercent(modelAccuracy.turn.hitRate)}
          </p>
          <p className="turn-accuracy-hero-note">
            過去{modelAccuracy.turn.totalRaces}
            レースの実測値（1マーク展開の予想パターンいずれかが実際の1着コースと一致した割合）
          </p>

          {modelAccuracy.turn.byVenue &&
            modelAccuracy.turn.byVenue.length > 0 && (
              <details className="turn-accuracy-venue-details">
                <summary>会場別の的中率を見る</summary>
                <div className="table-wrapper">
                  <table className="turn-accuracy-venue-table">
                    <thead>
                      <tr>
                        <th>会場</th>
                        <th>展開予測 的中率</th>
                        <th>件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelAccuracy.turn.byVenue.map((v) => (
                        <tr
                          key={v.venueCode}
                          style={{ opacity: v.isReliable ? 1 : 0.7 }}
                        >
                          <td className="turn-accuracy-venue-table__name">
                            {v.venueName}
                          </td>
                          <td>
                            {v.hitRate.toFixed(1)}%
                            {!v.isReliable && (
                              <span className="turn-accuracy-venue-ref-note">
                                {" "}
                                ※
                              </span>
                            )}
                          </td>
                          <td>{v.totalRaces}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="turn-accuracy-venue-ref-desc">
                  ※ サンプル数が20件未満のため参考値
                </p>
              </details>
            )}
        </div>

        {volatilityStats && (
          <VolatilityAccuracySection stats={volatilityStats} />
        )}

        <div className="history-link-container">
          <Link to="/accuracy/history" className="history-link">
            📅 旧モデルの月別成績アーカイブを見る
          </Link>
        </div>

        <div className="accuracy-info">
          <h4>💡 展開予測の的中率について</h4>
          <div className="info-section">
            <p>
              展開予測は、1マーク（最初のターン）でどの艇が先頭になるかを予想する機能です。上位パターンのいずれかが実際の1着コースと一致すれば「的中」としてカウントしています。
            </p>
          </div>
          <div className="info-section">
            <p>
              複勝予想（AIの本命が2着以内に入るかの予想）の実測精度は、算出方法の見直しのため一時的に非表示にしています。
            </p>
          </div>
          <div className="info-section">
            <p>
              <strong>データ更新:</strong>{" "}
              レース終了後、自動的に的中率が再計算されます
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default AccuracyDashboard;
