/**
 * OutcomePatternPreview - レース詳細ページ内の出現パターンプレビュー
 * AIデータ予想の下に、モデルが予測した1着コースの出現パターンを表示
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./OutcomePatternPreview.css";

function OutcomePatternPreview({
  venueCode,
  venueName,
  prediction,
  selectedModel,
}) {
  const [expanded, setExpanded] = useState(false);
  const [outcomeData, setOutcomeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firstBoat, setFirstBoat] = useState(null);

  // prediction から topPick を取得し、1着コースを抽出
  useEffect(() => {
    if (!prediction) {
      setFirstBoat(null);
      return;
    }

    // prediction.topPick は選手オブジェクト { number: 1-6, name, ... } の形式
    const topPick = prediction.topPick;

    if (!topPick) {
      setFirstBoat(null);
      return;
    }

    // topPick.number から艇番を取得
    if (topPick.number) {
      setFirstBoat(topPick.number);
    } else {
      setFirstBoat(null);
    }
  }, [prediction, selectedModel]);

  // expanded が true になったとき、データを取得
  useEffect(() => {
    if (!expanded || !venueCode || firstBoat === null) {
      return;
    }

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data =
          await supabaseDataService.getOutcomeDistribution(venueCode);
        setOutcomeData(data);
      } catch (err) {
        setError(err.message || "データ取得に失敗しました");
        console.error("Failed to load outcome data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [expanded, venueCode, firstBoat]);

  // firstBoat がない場合は表示しない
  if (firstBoat === null) {
    return null;
  }

  const patterns = outcomeData?.data?.[firstBoat] || [];
  const topPatterns = patterns.slice(0, 10);

  return (
    <div className="outcome-pattern-preview">
      <button className="expand-button" onClick={() => setExpanded(!expanded)}>
        <span className="chevron">{expanded ? "▼" : "▶"}</span>
        <h3>📊 参考：{firstBoat}コースが1着の場合の出現パターン</h3>
      </button>

      {expanded && (
        <div className="preview-content">
          {loading && <div className="loading">データを読み込み中...</div>}

          {error && <div className="error">エラー: {error}</div>}

          {!loading && !error && topPatterns.length > 0 && (
            <div className="table-wrapper">
              <table className="pattern-table">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>3連単</th>
                    <th>出現回数</th>
                    <th>出現率 (%)</th>
                    <th>平均配当 (円)</th>
                  </tr>
                </thead>
                <tbody>
                  {topPatterns.map((pattern, idx) => (
                    <tr key={idx}>
                      <td className="rank">{idx + 1}</td>
                      <td className="trifecta">
                        {firstBoat}-{pattern.second_boat}-{pattern.third_boat}
                      </td>
                      <td className="count">{pattern.count}</td>
                      <td className="probability">
                        {pattern.probability.toFixed(2)}%
                      </td>
                      <td className="payout">
                        {pattern.avg_payout
                          ? `¥${pattern.avg_payout.toLocaleString()}`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Link
                to={`/outcome-distribution?venue_code=${venueCode}`}
                className="detail-link"
              >
                → {venueName}の詳細分析を見る
              </Link>
            </div>
          )}

          {!loading && !error && topPatterns.length === 0 && (
            <div className="no-data">
              このコースのパターンデータがありません
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default OutcomePatternPreview;
