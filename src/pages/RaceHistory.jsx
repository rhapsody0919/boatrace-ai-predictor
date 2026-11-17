import { isInCautionEnabled } from "../config/featureFlags";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import LoadingScreen from "../components/LoadingScreen";
import { useRaceHistoryData } from "./RaceHistoryData";
import { MonthGroup } from "./RaceHistoryMonthGroup";
import "./RaceHistory.css";

function RaceHistory() {
  const { groupedDates, loading, expandedMonths, toggleMonth } =
    useRaceHistoryData();

  // Breadcrumb は {name, url} を読む。以前は {label, path} で渡していて、画面のパンくずが空になり、
  // BreadcrumbList の JSON-LD も item が ".../undefined" になっていた（集客レーン、2026-10-02）
  const breadcrumbItems = [
    { name: "ホーム", url: "/" },
    { name: "過去の予想", url: "/races" },
  ];

  // BOA-822（機能フラグの側、task 25・screens S-6）: 展開予測の的中率を外し、開催日ごとのレース一覧への入口にする
  const inCaution = isInCautionEnabled();

  return (
    <>
      <title>過去のAI予想データ - 龍神レーダー</title>
      <meta
        name="description"
        content={
          inCaution
            ? "龍神レーダーの過去のレースを開催日ごとに確認できます。日付を選ぶと、その日の会場ごとのレース一覧と結果を見られます。"
            : "龍神レーダーの過去のレース予想データと的中実績を確認できます。日別の展開予測的中率をチェックして、AIの精度を検証してください。"
        }
      />
      <link rel="canonical" href="https://www.boat-ai.jp/races" />

      <Header />

      <div className="race-history-page">
        <Breadcrumb items={breadcrumbItems} />

        <div className="race-history-container">
          <header className="page-header">
            <h1>📅 過去の予想データ</h1>
            <p className="page-description">
              {inCaution
                ? "過去のレースを開催日ごとに確認できます。日付を選ぶと、その日の会場ごとのレース一覧と結果を見られます。"
                : "過去のレース予想と展開予測の的中実績を日付別に確認できます。"}
            </p>
          </header>

          {/* 月別日付一覧 */}
          <div className="dates-section">
            {loading ? (
              <LoadingScreen
                title="過去の予想データを読み込み中..."
                description="過去90日分のデータを確認しています"
              />
            ) : Object.keys(groupedDates).length === 0 ? (
              <div className="no-data">
                <p>利用可能なデータがありません</p>
              </div>
            ) : (
              <div className="month-groups">
                {Object.keys(groupedDates)
                  .sort()
                  .reverse()
                  .map((yearMonth) => (
                    <MonthGroup
                      key={yearMonth}
                      dates={groupedDates[yearMonth]}
                      isExpanded={expandedMonths[yearMonth]}
                      inCaution={inCaution}
                      onToggle={() => toggleMonth(yearMonth)}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default RaceHistory;
