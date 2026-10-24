// 数字のページ（/admin/sns-hub/metrics）。48h・7d の観測。
// 戦略メモ（insights）の採否の口は、直近30日の利用が0件のため撤去した（2026-10-24、hq SH01 R2）
import SnsHubLayout from "./SnsHubLayout.jsx";
import MetricsTab from "./MetricsTab.jsx";
import PostObservationList from "./PostObservationList.jsx";

export default function MetricsPage() {
  return (
    <SnsHubLayout>
      <div className="sns-hub-tab-content">
        <MetricsTab />
        <PostObservationList />
      </div>
    </SnsHubLayout>
  );
}
