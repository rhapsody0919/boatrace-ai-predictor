import { Link } from "react-router-dom";
import UpdateStatus from "./UpdateStatus";
import { ReliabilityWarning, VolatilityAccuracySection } from "./accuracy";
import useAccuracySummary from "./AccuracyDashboardSummary";
import {
  AccuracyDashboardLoading,
  AccuracyDashboardUnavailable,
} from "./AccuracyDashboardStates";
import AccuracyDashboardHero from "./AccuracyDashboardHero";
import AccuracyDashboardInfo from "./AccuracyDashboardInfo";
import "./AccuracyDashboard.css";
import { formatTodayHeadingJST } from "../utils/dateUtils.js";
import { isInCautionEnabled } from "../config/featureFlags";
import InCautionAccuracyChart from "./analysis/InCautionAccuracyChart";

const PAGE_TITLE = "成績 | 龍神レーダー";
const HISTORY_LINK = (
  <div className="history-link-container">
    <Link to="/accuracy/history" className="history-link">
      📅 旧モデルの月別成績アーカイブを見る
    </Link>
  </div>
);

/**
 * BOA-822（機能フラグの側、task 24・screens S-5）: 展開予測の的中率・会場別の表・旧イン崩れ指数の実績を外し、
 * イン崩れ注意度の段ごとの実績だけにする。旧3モデルの月別アーカイブへのリンクは残す（plan「URL」）
 */
function InCautionAccuracyDashboard() {
  return (
    <>
      <title>{PAGE_TITLE}</title>
      <meta
        name="description"
        content="龍神レーダーのイン崩れ注意度を、段ごとに実際の結果（1号艇が1着を逃した割合）と照らし合わせた実績を公開中。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/accuracy" />
      <div className="accuracy-dashboard">
        <div className="dashboard-header">
          <h2>📊 成績</h2>
        </div>
        <InCautionAccuracyChart />
        {HISTORY_LINK}
      </div>
    </>
  );
}

function AccuracyDashboard(props) {
  return isInCautionEnabled() ? (
    <InCautionAccuracyDashboard />
  ) : (
    <LegacyAccuracyDashboard {...props} />
  );
}

function LegacyAccuracyDashboard({ onRefresh, isRefreshing }) {
  const { modelAccuracy, volatilityStats, loading, error } =
    useAccuracySummary();

  // メタタグは loading / error 分岐でも出力する（React 19 が <head> にホイスティング）
  const pageMeta = (
    <>
      <title>{PAGE_TITLE}</title>
      <meta
        name="description"
        content="龍神レーダーのAI予想（展開予測・イン崩れ指数）の実測精度を公開中。過去のレース結果と機械的に照合した実績データです。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/accuracy" />
    </>
  );

  if (loading) return <AccuracyDashboardLoading pageMeta={pageMeta} />;

  const hasData = modelAccuracy && modelAccuracy.turn.totalRaces > 0;

  if (error || !modelAccuracy || !hasData) {
    return <AccuracyDashboardUnavailable pageMeta={pageMeta} />;
  }

  return (
    <>
      {pageMeta}
      <div className="accuracy-dashboard">
        <div className="dashboard-header">
          <h2>📊 成績</h2>
          <p className="last-updated">{formatTodayHeadingJST()}</p>
        </div>
        <UpdateStatus
          lastUpdated={modelAccuracy.calculatedAt}
          dataType="成績データ"
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
        />

        <ReliabilityWarning races={modelAccuracy.turn.totalRaces} />

        <AccuracyDashboardHero turn={modelAccuracy.turn} />

        {volatilityStats && (
          <VolatilityAccuracySection stats={volatilityStats} />
        )}

        {HISTORY_LINK}

        <AccuracyDashboardInfo />
      </div>
    </>
  );
}

export default AccuracyDashboard;
