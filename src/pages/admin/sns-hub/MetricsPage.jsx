// 数字と戦略メモのページ（/admin/sns-hub/metrics）。48h・7d の観測と、そこから出た戦略メモの採否
import { useEffect, useState } from "react";
import SnsHubLayout from "./SnsHubLayout.jsx";
import MetricsTab from "./MetricsTab.jsx";
import PostObservationList from "./PostObservationList.jsx";
import InsightTab from "./InsightTab.jsx";
import Toast, { useToast } from "../../../components/Toast";
import {
  getInsights,
  getRecentRevisions,
  approveInsight,
  rejectInsight,
} from "../../../services/snsHubService";

const TABS = [
  { id: "metrics", label: "48h / 7d 観測" },
  { id: "insights", label: "戦略メモ" },
];

export default function MetricsPage() {
  const [activeTab, setActiveTab] = useState("metrics");
  const [insights, setInsights] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState("");
  const { toast, showToast } = useToast();
  // 操作のあとに読み直すときは reload を進める
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([getInsights(), getRecentRevisions()])
      .then(([nextInsights, nextRevisions]) => {
        if (!active) return;
        setInsights(nextInsights);
        setRevisions(nextRevisions);
        setError("");
      })
      .catch((err) => {
        console.error("戦略メモ取得エラー:", err);
        if (active)
          setError("戦略メモを取得できませんでした。再読み込みしてください。");
      });
    return () => {
      active = false;
    };
  }, [reload]);
  const load = () => setReload((n) => n + 1);
  async function act(actionFn, args) {
    try {
      await actionFn(...args);
      showToast("操作を反映しました", "success");
    } catch (err) {
      console.error("戦略メモの操作エラー:", err);
      showToast("操作に失敗しました。最新状態を確認してください。", "error");
    }
    load();
  }
  const proposedCount = insights.filter((i) => i.status === "proposed").length;
  return (
    <SnsHubLayout>
      <div className="tab-navigation-row">
        <div className="sns-hub-tab-navigation">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`sns-hub-tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "insights" && ` (${proposedCount})`}
            </button>
          ))}
        </div>
      </div>
      <div className="sns-hub-tab-content">
        {activeTab === "metrics" ? (
          <>
            <MetricsTab />
            <PostObservationList />
          </>
        ) : error ? (
          <div className="sns-hub-error-state" role="alert">
            <p>{error}</p>
            <button onClick={load}>再読み込み</button>
          </div>
        ) : (
          <InsightTab
            insights={insights}
            revisions={revisions}
            onApprove={(insightId) => act(approveInsight, [insightId])}
            onReject={(insightId, reason) =>
              act(rejectInsight, [insightId, reason])
            }
          />
        )}
      </div>
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </SnsHubLayout>
  );
}
