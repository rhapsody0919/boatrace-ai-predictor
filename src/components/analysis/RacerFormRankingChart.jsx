/**
 * RacerFormRankingChart - 本日の好調・不調選手ランキング（BOA-166）
 * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
 * 急上昇/急下降ランキングを表示する。既存の「選手調子」（会場・レース選択→6選手比較）
 * とは異なり、レース選択前の発見導線として本日カード全体を横断する。
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabaseDataService } from "../../services/supabaseDataService";
import "./MotorConditionChart.css";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function RankingTable({ title, rows, emptyMessage }) {
  return (
    <div className="table-wrapper">
      <h3 className="selected-motor-heading">{title}</h3>
      {rows.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <table className="motor-ranking-table">
          <thead>
            <tr>
              <th>選手名</th>
              <th>ボートレース場</th>
              <th>現在の全国勝率</th>
              <th>約90日前</th>
              <th>変化</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.racer_id} className="motor-ranking-row">
                <td>
                  <Link
                    to={`/winning-technique?venue_code=${row.venue_code}&race_id=${row.race_id}&tab=racer`}
                  >
                    {row.player_name?.replace(/\s+/g, "")}
                  </Link>
                </td>
                <td>
                  {VENUE_NAMES[row.venue_code] || ""} {row.race_number}R
                </td>
                <td className="rate">{row.win_rate?.toFixed(2)}</td>
                <td className="rate">{row.past_win_rate?.toFixed(2)}</td>
                <td className="rate">
                  <span className={row.delta > 0 ? "delta-up" : "delta-down"}>
                    {row.delta > 0 ? "↑" : "↓"} {Math.abs(row.delta).toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RacerFormRankingChart() {
  const [ranking, setRanking] = useState({ rising: [], falling: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRanking = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await supabaseDataService.getTodaysRacerFormRanking(10);
        setRanking(data);
      } catch (err) {
        setError(err.message || "選手ランキングの取得に失敗しました");
        console.error("Failed to load today's racer form ranking:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRanking();
  }, []);

  const isEmpty = ranking.rising.length === 0 && ranking.falling.length === 0;

  return (
    <div className="motor-condition-container">
      <h2>🔥 本日の好調・不調選手ランキング</h2>
      <p className="section-description">
        本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率を比較し、変化量が大きい選手をランキング表示します。他のタブと異なり、会場・レースを選ばず本日のカード全体から注目選手を発見できます。
      </p>

      {loading && <div className="loading-state">データを読み込み中...</div>}
      {error && <div className="error-state">エラー: {error}</div>}

      {!loading && !error && isEmpty && (
        <div className="empty-state">本日開催しているレースがありません</div>
      )}

      {!loading && !error && !isEmpty && (
        <>
          <RankingTable
            title="🔥 急上昇選手 TOP10"
            rows={ranking.rising}
            emptyMessage="対象データがありません"
          />
          <RankingTable
            title="📉 急下降選手 TOP10"
            rows={ranking.falling}
            emptyMessage="対象データがありません"
          />
        </>
      )}

      <p className="table-note">
        💡
        選手名をクリックすると、その選手が出走する本日のレースの「選手調子」タブで詳細を確認できます。「約90日前」は当該時期にデータが存在する選手のみランキング対象です。デビュー直後の新人選手は勝率0%からの上昇となり急上昇ランキングに出やすいため、その点にご注意ください。
      </p>
    </div>
  );
}

export default RacerFormRankingChart;
