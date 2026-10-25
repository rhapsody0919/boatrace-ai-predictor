import { useTranslation } from 'react-i18next';
import { formatCapturedAtJst } from '../utils/formatters.js';
import './UpdateStatus.css';

export default function UpdateStatus({ lastUpdated, dataType = 'データ', onRefresh, isRefreshing }) {
  const { t } = useTranslation();

  if (!lastUpdated && !onRefresh) return null;

  const getTimeSinceUpdate = (dateStr) => {
    const now = new Date();
    const updated = new Date(dateStr);
    const diffMs = now - updated;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('updateStatus.justUpdated');
    if (diffMins < 60) return t('updateStatus.minutesAgo', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('updateStatus.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('updateStatus.daysAgo', { count: diffDays });
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
              {t('updateStatus.updatedLabel', { dataType, time: `${formatCapturedAtJst(lastUpdated)}${t('home.jstNote')}` })}
              <span className="update-relative"> ({getTimeSinceUpdate(lastUpdated)})</span>
            </span>
          </>
        )}
        {onRefresh && (
          <button
            className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`}
            onClick={onRefresh}
            disabled={isRefreshing}
            title={t('updateStatus.refreshTooltip')}
          >
            <span className="refresh-icon">🔄</span>
            <span className="refresh-text">
              {isRefreshing ? t('updateStatus.refreshing') : t('updateStatus.refresh')}
            </span>
          </button>
        )}
      </div>
      {onRefresh && (
        <p className="update-info">
          {t('updateStatus.autoUpdateNote')}
        </p>
      )}
    </div>
  );
}
