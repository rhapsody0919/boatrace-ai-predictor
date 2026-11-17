import UpdateStatus from "./UpdateStatus";
import { VenueStatsTable } from "./hits";

function HitRacesVenueSection({
  lastUpdated,
  onRefresh,
  isRefreshing,
  selectedPeriod,
  setSelectedPeriod,
  backgroundLoading,
  venueStats,
}) {
  return (
    <section className="venue-stats-section">
      <h2>&#x1F4CA; ボートレース場別 展開予測の的中実績</h2>
      <UpdateStatus
        lastUpdated={lastUpdated}
        dataType="予想データ"
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      {/* 期間選択タブ */}
      <div className="period-selector" role="group" aria-label="期間選択">
        <button
          onClick={() => setSelectedPeriod("today")}
          className={selectedPeriod === "today" ? "active" : ""}
        >
          今日
        </button>
        <button
          onClick={() => setSelectedPeriod("yesterday")}
          className={selectedPeriod === "yesterday" ? "active" : ""}
        >
          昨日
        </button>
        <button
          onClick={() => setSelectedPeriod("all")}
          className={selectedPeriod === "all" ? "active" : ""}
        >
          全期間（14日間）
          {backgroundLoading && " ..."}
        </button>
      </div>

      <VenueStatsTable venueStats={venueStats} />
    </section>
  );
}

export default HitRacesVenueSection;
