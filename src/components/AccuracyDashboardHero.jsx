import { formatPercent } from "../utils/formatters";
import AccuracyDashboardVenueDetails from "./AccuracyDashboardVenueDetails";

/** 展開予測の実測の大きい数字と会場別の表 */
export default function AccuracyDashboardHero({ turn }) {
  return (
    <div className="turn-accuracy-hero">
      <h3>🌊 展開予測の実測的中率</h3>
      <p className="turn-accuracy-hero-rate">{formatPercent(turn.hitRate)}</p>
      <p className="turn-accuracy-hero-note">
        過去{turn.totalRaces}
        レースの実測値（1マーク展開の予想パターンのいずれかの艇が実際に1着になった割合）
      </p>

      {turn.byVenue && turn.byVenue.length > 0 && (
        <AccuracyDashboardVenueDetails byVenue={turn.byVenue} />
      )}
    </div>
  );
}
