import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { OverviewTab, VenueTab } from "./AdminRulesOverviewVenue";
import {
  getTodaysMatchingRaces,
  getAvailableVenues,
} from "../../services/ruleMatchService";
import { getRuleApplicationHistory } from "../../services/adminRuleService";
import { fetchRulePerformance } from "../../services/adminRulePerformance";
import "./AdminRules.css";
import { errorMessageOf } from "../../utils/errorMessage.js";
import { TodayTab, HistoryTab } from "./AdminRulesTodayHistory";

// タブ定義
const TABS = [
  { id: "overview", label: "概要" },
  { id: "venue", label: "会場別" },
  { id: "today", label: "本日" },
  { id: "history", label: "履歴" },
];

const HISTORY_PAGE_SIZE = 300;

// ローカル日付を YYYY-MM-DD にする
function formatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 初期データ（成績・本日のレース）の取得
function useInitialRulesData(today) {
  const [allRules, setAllRules] = useState([]);
  const [overallPerformance, setOverallPerformance] = useState(null);
  const [todaysRaces, setTodaysRaces] = useState([]);
  const [weeklyData, setWeeklyData] = useState([]);
  const [venuePerformance, setVenuePerformance] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // loadInitialData は useCallback で参照を安定させ、
  // 依存するuseEffectに正しく含められるようにする（exhaustive-deps対応、BOA-676）。
  // today は値が変わらない限り同じ参照を保つため、挙動は変えない
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 運用成績（全体・ルール別・週別）は /api/admin/rules/performance の1回の取得にまとめた（BOA-567）
      const [performance, todaysData] = await Promise.all([
        fetchRulePerformance(),
        getTodaysMatchingRaces(today),
      ]);

      setAllRules(performance.rules);
      setOverallPerformance(performance.overall);
      setTodaysRaces(todaysData);
      setWeeklyData(performance.weekly);
      // 会場別タブの成績カードもこの1回の取得から出す（会場を切り替えても再取得しない。BOA-574）
      setVenuePerformance(performance.byVenue);
    } catch (err) {
      console.error("データ読み込みエラー:", err);
      setError(errorMessageOf(err));
    } finally {
      setLoading(false);
    }
  }, [today]);

  // 初期データ読み込み
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    allRules,
    overallPerformance,
    todaysRaces,
    weeklyData,
    venuePerformance,
    loading,
    error,
    loadInitialData,
  };
}

// 履歴タブのデータと絞り込み状態
function useHistoryRulesData(activeTab, today, yesterday) {
  const [historyData, setHistoryData] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyError, setHistoryError] = useState(null);
  // 履歴フィルタ（デフォルトは前日）
  const [historyPage, setHistoryPage] = useState(0);
  const [historyStartDate, setHistoryStartDate] = useState(yesterday);
  const [historyEndDate, setHistoryEndDate] = useState(yesterday);

  // 取得失敗を「対象期間に履歴なし」に化けさせない（BOA-676）。
  // 履歴タブ単位の失敗なので、ページ全体をreloadするDataFetchErrorではなく、
  // 他タブの状態を保ったままセクション単位で再取得できるInlineFetchErrorを使う
  // （.claude/rules/frontend-data-fetch.md の3、RaceResult.jsx等の既存実装と同じ扱い）
  const loadHistoryData = useCallback(async () => {
    setHistoryError(null);
    try {
      const result = await getRuleApplicationHistory(
        historyStartDate || "2026-01-16",
        historyEndDate || today,
        HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      );
      setHistoryData(result.data);
      setHistoryTotal(result.total);
    } catch (err) {
      console.error("履歴データ読み込みエラー:", err);
      setHistoryError(errorMessageOf(err));
    }
  }, [historyStartDate, historyEndDate, historyPage, today]);

  // 履歴タブ切り替え時のデータ読み込み
  useEffect(() => {
    if (activeTab === "history") {
      // 外部（API）からの取得を履歴タブ表示に同期する。取得の前の state 初期化は元の挙動のまま
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadHistoryData();
    }
  }, [activeTab, loadHistoryData]);

  return {
    historyData,
    historyTotal,
    historyError,
    historyPage,
    setHistoryPage,
    historyStartDate,
    setHistoryStartDate,
    historyEndDate,
    setHistoryEndDate,
    loadHistoryData,
  };
}

// ソート状態とソート済みルール一覧
function useSortedRules(allRules) {
  const [sortKey, setSortKey] = useState("recovery");
  const [sortDesc, setSortDesc] = useState(true);

  const sortedRules = useMemo(() => {
    const sorted = [...allRules];
    sorted.sort((a, b) => {
      let aVal = a[sortKey];
      let bVal = b[sortKey];
      if (sortKey === "ruleId") {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
    return sorted;
  }, [allRules, sortKey, sortDesc]);

  // ソートハンドラ
  function handleSort(key) {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return { sortKey, sortDesc, sortedRules, handleSort };
}

// ページ見出し（読み込み中・エラー表示で共通）
function AdminRulesTitle() {
  return (
    <div className="admin-header">
      <h1>ルール成績ダッシュボード</h1>
      <p className="admin-badge">管理者用</p>
    </div>
  );
}

// ヘッダー
function AdminRulesHeader({ overallPerformance }) {
  return (
    <div className="admin-header">
      <Link to="/" className="back-link">
        ← トップへ戻る
      </Link>
      <h1>ルール成績ダッシュボード</h1>
      <p className="admin-badge">管理者用</p>
      {overallPerformance && (
        <p className="operation-period">
          運用期間: {overallPerformance.startDate} 〜 現在
        </p>
      )}
    </div>
  );
}

// 累積成績サマリー
function OverallSummaryCard({ overallPerformance }) {
  return (
    <div className="overall-summary-card">
      <div className="summary-main">
        <span className="summary-label">累積成績:</span>
        <span className="summary-value">
          投資 {overallPerformance.totalInvestment.toLocaleString()}円
        </span>
        <span className="summary-arrow">→</span>
        <span className="summary-value">
          回収 {overallPerformance.totalPayout.toLocaleString()}円
        </span>
        <span
          className={`recovery-badge ${overallPerformance.recovery >= 100 ? "positive" : "negative"}`}
        >
          回収率 {overallPerformance.recovery}%
        </span>
      </div>
      <div className="summary-detail">
        対象件数: {overallPerformance.samples} / 的中数:{" "}
        {overallPerformance.hits} ({overallPerformance.hitRate}%)
      </div>
    </div>
  );
}

// タブナビゲーション
function TabNavigation({ activeTab, onTabChange }) {
  return (
    <div className="admin-rules-tab-navigation">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`admin-rules-tab-btn ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// タブコンテンツ
function TabContent({ activeTab, data, sort, history, venueState }) {
  return (
    <div className="admin-rules-tab-content">
      {activeTab === "overview" && (
        <OverviewTab
          rules={sort.sortedRules}
          sortKey={sort.sortKey}
          sortDesc={sort.sortDesc}
          onSort={sort.handleSort}
          weeklyData={data.weeklyData}
        />
      )}
      {activeTab === "venue" && (
        <VenueTab
          venues={venueState.venues}
          selectedVenue={venueState.selectedVenue}
          onVenueChange={venueState.setSelectedVenue}
          venueTotal={data.venuePerformance[venueState.selectedVenue]}
          allRules={data.allRules}
        />
      )}
      {activeTab === "today" && <TodayTab races={data.todaysRaces} />}
      {activeTab === "history" && (
        <HistoryTab
          historyData={history.historyData}
          historyTotal={history.historyTotal}
          historyError={history.historyError}
          onRetryHistory={history.loadHistoryData}
          historyPage={history.historyPage}
          pageSize={HISTORY_PAGE_SIZE}
          onPageChange={history.setHistoryPage}
          startDate={history.historyStartDate}
          endDate={history.historyEndDate}
          onStartDateChange={history.setHistoryStartDate}
          onEndDateChange={history.setHistoryEndDate}
        />
      )}
    </div>
  );
}

function AdminRules() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedVenue, setSelectedVenue] = useState("all");

  // 今日の日付
  const today = useMemo(() => formatLocalDate(new Date()), []);

  // 前日の日付
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatLocalDate(d);
  }, []);

  // 利用可能な会場リスト
  const venues = useMemo(() => getAvailableVenues(), []);

  const data = useInitialRulesData(today);
  const history = useHistoryRulesData(activeTab, today, yesterday);
  const sort = useSortedRules(data.allRules);

  if (data.loading) {
    return (
      <div className="admin-rules-page">
        <AdminRulesTitle />
        <div className="admin-rules-loading-state">
          <div className="spinner" />
          <p>データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="admin-rules-page">
        <AdminRulesTitle />
        <div className="admin-rules-error-state">
          <p>エラーが発生しました: {data.error}</p>
          <button onClick={data.loadInitialData}>再読み込み</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-rules-page">
      {/* ヘッダー */}
      <AdminRulesHeader overallPerformance={data.overallPerformance} />

      {/* 累積成績サマリー */}
      {data.overallPerformance && (
        <OverallSummaryCard overallPerformance={data.overallPerformance} />
      )}

      {/* タブナビゲーション */}
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* タブコンテンツ */}
      <TabContent
        activeTab={activeTab}
        data={data}
        sort={sort}
        history={history}
        venueState={{ venues, selectedVenue, setSelectedVenue }}
      />
    </div>
  );
}

export default AdminRules;
