import LoadingScreen from "./LoadingScreen";

export function AccuracyDashboardLoading({ pageMeta }) {
  return (
    <div className="accuracy-dashboard">
      {pageMeta}
      <h2>📊 成績</h2>
      <LoadingScreen
        title="実測精度データを読み込み中..."
        description="成績データを集計しています"
      />
    </div>
  );
}

export function AccuracyDashboardUnavailable({ pageMeta }) {
  return (
    <div className="accuracy-dashboard">
      {pageMeta}
      <h2>📊 成績</h2>
      <div className="error-message">
        <p>
          実測精度データはまだ利用できません。レース終了後に自動計算されます。
        </p>
        <button
          className="reload-button"
          onClick={() => window.location.reload()}
        >
          🔄 再読み込み
        </button>
      </div>
    </div>
  );
}
