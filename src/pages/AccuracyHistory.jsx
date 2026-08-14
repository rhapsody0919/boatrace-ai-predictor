import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { dataService } from "../services/dataService";
import { MODEL_NAMES } from "../constants";
import ModelComparisonTable from "../components/ModelComparisonTable";
import "./AccuracyHistory.css";

function AccuracyHistory() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);
        // Supabaseから精度データを取得
        const data = await dataService.getAccuracy();
        setSummary(data);
      } catch (err) {
        console.error("Failed to load accuracy summary:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, []);

  if (loading) {
    return (
      <div className="accuracy-history-page">
        <div className="page-header">
          <Link to="/accuracy" className="back-link">
            ← 成績ページへ戻る
          </Link>
          <h1>月別成績アーカイブ</h1>
        </div>
        <div className="loading">データを読み込み中...</div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="accuracy-history-page">
        <div className="page-header">
          <Link to="/accuracy" className="back-link">
            ← 成績ページへ戻る
          </Link>
          <h1>月別成績アーカイブ</h1>
        </div>
        <div className="error-message">
          <p>データの読み込みに失敗しました。</p>
        </div>
      </div>
    );
  }

  // 月別データを収集
  const getMonthlyData = () => {
    const monthsMap = {};
    const models = ["standard", "safeBet", "upsetFocus"];

    // lastMonth データを追加
    models.forEach((model) => {
      if (summary.models && summary.models[model]?.lastMonth) {
        const lastMonth = summary.models[model].lastMonth;
        if (lastMonth.totalRaces > 0) {
          const key = `${lastMonth.year}-${String(lastMonth.month).padStart(2, "0")}`;
          if (!monthsMap[key]) {
            monthsMap[key] = {
              key,
              year: lastMonth.year,
              month: lastMonth.month,
              models: {},
            };
          }
          monthsMap[key].models[model] = lastMonth;
        }
      }
    });

    // monthlyHistory データを追加（将来用）
    models.forEach((model) => {
      if (summary.models && summary.models[model]?.monthlyHistory) {
        summary.models[model].monthlyHistory.forEach((monthData) => {
          if (monthData.totalRaces > 0) {
            const key = `${monthData.year}-${String(monthData.month).padStart(2, "0")}`;
            if (!monthsMap[key]) {
              monthsMap[key] = {
                key,
                year: monthData.year,
                month: monthData.month,
                models: {},
              };
            }
            monthsMap[key].models[model] = monthData;
          }
        });
      }
    });

    // 新しい月順にソート
    return Object.values(monthsMap).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  };

  const monthlyData = getMonthlyData();

  // 月ごとのモデル比較データを生成
  const getModelComparisonForMonth = (monthInfo) => {
    const modelIds = ["standard", "safeBet", "upsetFocus"];
    return modelIds.map((key) => {
      const name = MODEL_NAMES[key] || key;
      const data = monthInfo.models[key];
      if (!data) {
        return {
          key,
          name,
          races: 0,
        };
      }
      return {
        key,
        name,
        races: data.totalRaces || 0,
        winHitRate: data.topPickHitRate || 0,
        winRecoveryRate: data.actualRecovery?.win?.recoveryRate || 0,
        placeHitRate: data.topPickPlaceRate || 0,
        placeRecoveryRate: data.actualRecovery?.place?.recoveryRate || 0,
        trifectaHitRate: data.top3HitRate || 0,
        trifectaRecoveryRate: data.actualRecovery?.trifecta?.recoveryRate || 0,
        trioHitRate: data.top3IncludedRate || 0,
        trioRecoveryRate: data.actualRecovery?.trio?.recoveryRate || 0,
      };
    });
  };

  return (
    <>
      <title>月別成績アーカイブ | BoatAI</title>
      <meta
        name="description"
        content="BoatAIのAI予測モデル別の月別成績アーカイブ。過去の予測精度と回収率の推移を確認できます。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/accuracy/history" />
      <div className="accuracy-history-page">
        <div className="page-header">
          <Link to="/accuracy" className="back-link">
            ← 成績ページへ戻る
          </Link>
          <h1>月別成績アーカイブ</h1>
        </div>
        <p className="archive-note">
          以下はスタンダード・本命狙い・穴狙いの3モデル（2026年8月運用終了）の実績アーカイブです。
          現在提供中の新AI予想モデルの実績は「成績」ページをご確認ください。
        </p>

        {monthlyData.length === 0 ? (
          <div className="no-data">
            <p>まだ月別データがありません。</p>
            <p>月が終わるとここに成績が記録されます。</p>
          </div>
        ) : (
          monthlyData.map((monthInfo) => {
            const modelComparison = getModelComparisonForMonth(monthInfo);
            return (
              <div key={monthInfo.key} className="model-comparison-section">
                <ModelComparisonTable
                  data={modelComparison}
                  showRaceCount
                  title={`📊 ${monthInfo.year}年${monthInfo.month}月 モデル間パフォーマンス比較`}
                />
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

export default AccuracyHistory;
