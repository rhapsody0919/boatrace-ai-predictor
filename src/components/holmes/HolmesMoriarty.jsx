import { useState, useEffect } from "react";
import {
  getMoriartyStats,
  getMoriartyROIHistory,
  getMoriartyVenueBreakdown,
  getMoriartyCalibrationData,
} from "../../services/moriartyService";
import MoriartyStatsHeader from "./MoriartyStatsHeader";
import MoriartyDataMaturity from "./MoriartyDataMaturity";
import MoriartyROIChart from "./MoriartyROIChart";
import MoriartyVenueBreakdown from "./MoriartyVenueBreakdown";
import MoriartyCalibrationDiagram from "./MoriartyCalibrationDiagram";
import { MoriartyExplanation } from "./explanations";
import "./HolmesMoriarty.css";

function getStage(totalBets) {
  if (totalBets < 30) return "starting";
  if (totalBets < 100) return "gathering";
  if (totalBets < 300) return "growing";
  return "mature";
}

/**
 * 推奨の提示を止めている理由（docs/issues/moriarty-post-hoc-generation-and-odds-drift.md）。
 * 2026-09〜10 の実測で、推奨の72%がレース発走後に作られていた（買えない買い目）こと、
 * 取得時オッズが締切時オッズと大きくずれ期待値を過大評価していたことが分かったため、
 * 「本日の推奨レース」を出さない。成績の蓄積（バッチ）は検証用に続けている。
 */
function MoriartyVerificationNotice() {
  return (
    <div className="moriarty-verification-notice" role="status">
      <p className="moriarty-verification-title">
        買い目の提示を止めています（検証中）
      </p>
      <ul className="moriarty-verification-reasons">
        <li>
          推奨が1日1回まとめて作られていて、約7割はレースが終わった後に作られていた（買えない買い目だった）
        </li>
        <li>
          期待値の計算に使う発売中のオッズが、払戻を決める締切時オッズと大きくずれていた（20倍以上の艇は締切までに半分以下になる）
        </li>
      </ul>
      <p className="moriarty-verification-footer">
        発走前に作った推奨だけで回収率が100%を超えることを確かめるまで、買い目は出しません。下の成績は、これまでの推奨（後出し分を含む）の記録です。
      </p>
    </div>
  );
}

function HolmesMoriarty() {
  const [stats, setStats] = useState({});
  const [roiHistory, setRoiHistory] = useState([]);
  const [venueBreakdown, setVenueBreakdown] = useState([]);
  const [calibrationData, setCalibrationData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      getMoriartyStats(),
      getMoriartyROIHistory(30),
      getMoriartyVenueBreakdown(30),
      getMoriartyCalibrationData(),
    ])
      .then(([s, roi, venue, cal]) => {
        setStats(s || {});
        setRoiHistory(roi || []);
        setVenueBreakdown(venue || []);
        setCalibrationData(cal || []);
      })
      .catch((err) => {
        console.error("[HolmesMoriarty] fetch error:", err);
        setError("データの取得に失敗しました");
      })
      .finally(() => setLoading(false));
  }, []);

  const totalBets = stats.total_bets ?? 0;
  const stage = getStage(totalBets);

  if (loading) {
    return (
      <div className="holmes-detective-card moriarty-card">
        <div className="moriarty-loading">データを読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="holmes-detective-card moriarty-card">
        <div className="moriarty-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="holmes-detective-card moriarty-card">
      <div className="holmes-detective-header">
        <div
          className="holmes-detective-icon"
          style={{ background: "#1f2937" }}
        >
          🎩
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">モリアーティ予想</div>
          <div className="holmes-detective-title">
            犯罪界のナポレオン - 数学的最適化の教授
          </div>
          <div className="holmes-detective-tech">
            技術: <code>Probability Calibration + Kelly Criterion</code>
          </div>
        </div>
        {/* 推奨停止中は .moriarty-status-badge（緑）を付けず、共通の .holmes-status-badge（アンバー）で出す */}
        <div className="holmes-status-badge">検証中（推奨停止）</div>
      </div>

      <section className="holmes-section">
        <MoriartyVerificationNotice />
      </section>

      {stage === "starting" && (
        <div className="moriarty-stage-starting">
          <section className="holmes-section">
            <h3>⏳ データ蓄積中</h3>
            <p className="moriarty-stage-desc">
              運用 {stats.operation_days ?? 0} 日目 / 推奨レース {totalBets} 件
            </p>
            <MoriartyDataMaturity totalBets={totalBets} stage={stage} />
            <div className="moriarty-notice moriarty-notice--warning">
              初期段階のため数値は参考程度です。30件到達でチャートが表示されます。
            </div>
          </section>
        </div>
      )}

      {stage === "gathering" && (
        <>
          <section className="holmes-section">
            <MoriartyStatsHeader stats={stats} />
          </section>
          <section className="holmes-section">
            <MoriartyDataMaturity totalBets={totalBets} stage={stage} />
          </section>
          <section className="holmes-section">
            <h3>累積回収率推移</h3>
            <MoriartyROIChart data={roiHistory} showSampleWarning />
          </section>
        </>
      )}

      {stage === "growing" && (
        <>
          <section className="holmes-section">
            <MoriartyStatsHeader stats={stats} />
          </section>
          <section className="holmes-section">
            <h3>累積回収率推移</h3>
            <MoriartyROIChart data={roiHistory} />
          </section>
          <section className="holmes-section">
            <h3>会場別回収率</h3>
            <MoriartyVenueBreakdown data={venueBreakdown} />
          </section>
        </>
      )}

      {stage === "mature" && (
        <>
          <section className="holmes-section">
            <MoriartyStatsHeader stats={stats} />
          </section>
          <section className="holmes-section">
            <h3>累積回収率推移</h3>
            <MoriartyROIChart data={roiHistory} />
          </section>
          <section className="holmes-section">
            <h3>会場別回収率</h3>
            <MoriartyVenueBreakdown data={venueBreakdown} />
          </section>
          <section className="holmes-section">
            <h3>予測キャリブレーション</h3>
            <MoriartyCalibrationDiagram data={calibrationData} />
          </section>
        </>
      )}
      <MoriartyExplanation />
    </div>
  );
}

export default HolmesMoriarty;
