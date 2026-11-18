// 数字と戦略メモのページ（/admin/sns-hub/metrics）。48h・7d の観測と、そこから出た戦略メモの採否
import { useEffect, useState } from "react";
import SnsHubLayout from "./SnsHubLayout.jsx";
import MetricsTab from "./MetricsTab.jsx";
import PostObservationList from "./PostObservationList.jsx";
import InsightTab from "./InsightTab.jsx";
import Toast, { useToast } from "../../../components/Toast";
import { actionFeedback } from "./actionFeedback";
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

// 戦略メモ・直近の改訂を読む。reload が進むたびに読み直す
function useInsightsLoader(reload, setInsights, setRevisions, setError) {
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
  }, [reload, setInsights, setRevisions, setError]);
}

async function runInsightAction(
  actionFn,
  args,
  { setActionMessages, showToast, load },
) {
  // 採用の応答にはリスク警告（riskWarnings）が載る。トーストは2秒で消えるので、消えない通知に残す
  try {
    const messages = actionFeedback(await actionFn(...args));
    setActionMessages((previous) => [...previous, ...messages]);
    showToast(
      messages.length ? "操作結果に警告があります" : "操作を反映しました",
      messages.length ? "error" : "success",
    );
  } catch (err) {
    console.error("戦略メモの操作エラー:", err);
    setActionMessages((previous) => [
      ...previous,
      "操作に失敗しました。最新状態を確認してください。",
    ]);
    showToast("操作に失敗しました。最新状態を確認してください。", "error");
  }
  load();
}

function ActionMessages({ actionMessages, onClose }) {
  if (actionMessages.length === 0) return null;
  return (
    <div className="sns-hub-error-state" role="alert">
      {actionMessages.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
      <button onClick={onClose}>通知を閉じる</button>
    </div>
  );
}

function TabNavigation({ activeTab, setActiveTab, proposedCount }) {
  return (
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
  );
}

function InsightsPane({ error, load, insights, revisions, act }) {
  if (error) {
    return (
      <div className="sns-hub-error-state" role="alert">
        <p>{error}</p>
        <button onClick={load}>再読み込み</button>
      </div>
    );
  }
  return (
    <InsightTab
      insights={insights}
      revisions={revisions}
      onApprove={(insightId) => act(approveInsight, [insightId])}
      onReject={(insightId, reason) => act(rejectInsight, [insightId, reason])}
    />
  );
}

export default function MetricsPage() {
  const [activeTab, setActiveTab] = useState("metrics");
  const [insights, setInsights] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState("");
  const [actionMessages, setActionMessages] = useState([]);
  const { toast, showToast } = useToast();
  // 操作のあとに読み直すときは reload を進める
  const [reload, setReload] = useState(0);
  useInsightsLoader(reload, setInsights, setRevisions, setError);
  const load = () => setReload((n) => n + 1);
  const act = (actionFn, args) =>
    runInsightAction(actionFn, args, { setActionMessages, showToast, load });
  const proposedCount = insights.filter((i) => i.status === "proposed").length;
  return (
    <SnsHubLayout>
      <ActionMessages
        actionMessages={actionMessages}
        onClose={() => setActionMessages([])}
      />
      <TabNavigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        proposedCount={proposedCount}
      />
      <div className="sns-hub-tab-content">
        {activeTab === "metrics" ? (
          <>
            <MetricsTab />
            <PostObservationList />
          </>
        ) : (
          <InsightsPane
            error={error}
            load={load}
            insights={insights}
            revisions={revisions}
            act={act}
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
