import React from 'react';
import './UpdateStatus.css';

export default function UpdateStatus({ lastUpdated, dataType = 'データ', onRefresh, isRefreshing }) {
  if (!lastUpdated && !onRefresh) return null;

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${month}/${day} ${hours}:${minutes}`;
  };

  const getTimeSinceUpdate = (dateStr) => {
    const now = new Date();
    const updated = new Date(dateStr);
    const diffMs = now - updated;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '更新完了';
    if (diffMins < 60) return `${diffMins}分前に更新`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}時間前に更新`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}日前に更新`;
  };

  const isStale = (dateStr) => {
    const now = new Date();
    const updated = new Date(dateStr);
    const diffHours = (now - updated) / (1000 * 60 * 60);
    return diffHours > 2; // 2時間以上経過で古いと判定
  };

  const stale = isStale(lastUpdated);

  return (
    <div className="update-status-container">
      <div className={`update-status ${stale ? 'stale' : 'fresh'}`}>
        {lastUpdated && (
          <>
            <span className="update-icon">{stale ? '⚠️' : '✅'}</span>
            <span className="update-text">
              {dataType}更新: {formatDate(lastUpdated)}
              <span className="update-relative"> ({getTimeSinceUpdate(lastUpdated)})</span>
            </span>
          </>
        )}
        {onRefresh && (
          <button
            className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`}
            onClick={onRefresh}
            disabled={isRefreshing}
            title="ブラウザのキャッシュをクリアしてデータを再読み込み"
          >
            <span className="refresh-icon">🔄</span>
            <span className="refresh-text">
              {isRefreshing ? '読み込み中...' : '再読み込み'}
            </span>
          </button>
        )}
      </div>
      {onRefresh && (
        <p className="update-info">
          💡 データは1時間ごとに自動更新されます
        </p>
      )}
    </div>
  );
}
