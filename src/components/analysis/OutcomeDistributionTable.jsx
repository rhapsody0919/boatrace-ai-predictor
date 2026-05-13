/**
 * OutcomeDistributionTable - 出目分布テーブル
 * 会場別の3連単出現パターンを1着別に表示
 */
import { useState, useEffect } from "react";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./OutcomeDistributionTable.css";

const VENUES = [
  { code: "01", name: "桐生" },
  { code: "02", name: "戸田" },
  { code: "03", name: "江戸川" },
  { code: "04", name: "平和島" },
  { code: "05", name: "多摩川" },
  { code: "06", name: "浜名湖" },
  { code: "07", name: "蒲郡" },
  { code: "08", name: "常滑" },
  { code: "09", name: "津" },
  { code: "10", name: "三国" },
  { code: "11", name: "びわこ" },
  { code: "12", name: "住之江" },
  { code: "13", name: "尼崎" },
  { code: "14", name: "鳴門" },
  { code: "15", name: "丸亀" },
  { code: "16", name: "児島" },
  { code: "17", name: "宮島" },
  { code: "18", name: "徳山" },
  { code: "19", name: "下関" },
  { code: "20", name: "若松" },
  { code: "21", name: "芦屋" },
  { code: "22", name: "福岡" },
  { code: "23", name: "唐津" },
  { code: "24", name: "大村" },
];

function OutcomeDistributionTable({ initialVenueCode = null }) {
  const [selectedVenue, setSelectedVenue] = useState(
    initialVenueCode || "03"
  );
  const [outcomeData, setOutcomeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topPatternsExpanded, setTopPatternsExpanded] = useState(true);
  const [topPatternLimit, setTopPatternLimit] = useState(10);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const venueCode = parseInt(selectedVenue, 10);
        const data = await supabaseDataService.getOutcomeDistribution(venueCode);
        setOutcomeData(data);
      } catch (err) {
        setError(err.message || "出目分布データの取得に失敗しました");
        console.error("Failed to load outcome distribution:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedVenue]);

  if (loading) {
    return (
      <div className="outcome-distribution-container">
        <div className="loading-state">データを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="outcome-distribution-container">
        <div className="error-state">エラー: {error}</div>
      </div>
    );
  }

  if (!outcomeData || !outcomeData.data) {
    return (
      <div className="outcome-distribution-container">
        <div className="empty-state">出目分布データが見つかりません</div>
      </div>
    );
  }

  const { venue_name, total_races, last_updated, data } = outcomeData;

  return (
    <div className="outcome-distribution-container">
      <h2>📊 出目分布分析</h2>
      <p className="section-description">
        過去90日間のボートレース結果から、各ボートレース場の3連単出現パターンを分析しています。
        1着が各コースの場合に、2着・3着がどのコース組み合わせで出やすいかが一目でわかります。
      </p>

      <div className="controls-section">
        <label htmlFor="venue-select">ボートレース場:</label>
        <select
          id="venue-select"
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          className="venue-select"
        >
          {VENUES.map((venue) => (
            <option key={venue.code} value={venue.code}>
              {venue.name}
            </option>
          ))}
        </select>
      </div>

      {total_races > 0 && (
        <div className="summary-info">
          <p>
            <strong>{venue_name}</strong> - 過去90日間{" "}
            <strong>{total_races}</strong>レース
            {last_updated && (
              <span className="update-date">（最終更新: {last_updated}）</span>
            )}
          </p>
        </div>
      )}

      <div className="top-patterns-section">
        <div className="top-patterns-header">
          <button
            className="expand-button"
            onClick={() => setTopPatternsExpanded(!topPatternsExpanded)}
          >
            <span className="chevron">
              {topPatternsExpanded ? "▼" : "▶"}
            </span>
            <h3>📈 出現率ランキング</h3>
          </button>
          <div className="limit-controls">
            <label>表示件数:</label>
            {[10, 20, 50].map((limit) => (
              <button
                key={limit}
                className={`limit-button ${topPatternLimit === limit ? "active" : ""}`}
                onClick={() => setTopPatternLimit(limit)}
              >
                Top {limit}
              </button>
            ))}
          </div>
        </div>

        {topPatternsExpanded && (
          <div className="table-wrapper">
            {(() => {
              const allPatterns = [];
              for (const firstBoat in data) {
                const patterns = data[firstBoat] || [];
                patterns.forEach((pattern) => {
                  allPatterns.push({
                    firstBoat: parseInt(firstBoat),
                    secondBoat: pattern.second_boat,
                    thirdBoat: pattern.third_boat,
                    count: pattern.count,
                    probability: pattern.probability,
                    avg_payout: pattern.avg_payout,
                  });
                });
              }
              allPatterns.sort((a, b) => b.probability - a.probability);
              const topPatterns = allPatterns.slice(0, topPatternLimit);

              return (
                <table className="top-patterns-table">
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
                          {pattern.firstBoat}-{pattern.secondBoat}-
                          {pattern.thirdBoat}
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
              );
            })()}
          </div>
        )}
      </div>

      <div className="tabs-container">
        {[1, 2, 3, 4, 5, 6].map((firstBoat) => {
          const patterns = data[firstBoat] || [];

          return (
            <div key={firstBoat} className="outcome-tab">
              <div className="tab-header">
                <h3>{firstBoat}コースが1着</h3>
                <span className="pattern-count">{patterns.length}パターン</span>
              </div>

              {patterns.length > 0 ? (
                <div className="table-wrapper">
                  <table className="outcome-table">
                    <thead>
                      <tr>
                        <th>2着</th>
                        <th>3着</th>
                        <th>出現回数</th>
                        <th>出現率 (%)</th>
                        <th>平均配当 (円)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.map((pattern, idx) => (
                        <tr key={idx}>
                          <td className="boat-num">{pattern.second_boat}</td>
                          <td className="boat-num">{pattern.third_boat}</td>
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
                </div>
              ) : (
                <div className="no-patterns">データなし</div>
              )}
            </div>
          );
        })}
      </div>

      <p className="table-note">
        💡
        出現率はその1着コース内での確率です。配当が高いほど的中しづらいパターンとなります。
      </p>
    </div>
  );
}

export default OutcomeDistributionTable;
