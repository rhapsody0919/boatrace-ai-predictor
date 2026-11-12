// ライブ取得・締切時オッズの状態の1行。RaceOddsListTab.jsx から移しただけ
import { useTranslation } from "react-i18next";
import {
  formatJstTime,
  formatOfficialTime,
  liveFreshnessOf,
} from "./oddsListHelpers";

// 締切時オッズ（公式）を表示しているときの状態の1行（BOA-496）。更新ボタンは出さない（値はもう変わらない）
export function FinalStatus({ deadline }) {
  const { t } = useTranslation();
  const time = deadline ? formatJstTime(deadline.toISOString()) : null;
  return (
    <div
      className="rol-status is-official"
      data-testid="odds-live-status"
      data-state="final"
    >
      <span className="rol-official-dot" aria-hidden="true" />
      <span className="rol-status-strong">{t("oddsList.liveFinal")}</span>
      {time && <b>{t("oddsList.finalDeadlineAt", { time })}</b>}
      <span className="rol-status-sub">{t("oddsList.finalSource")}</span>
    </div>
  );
}

// ライブ取得の状態の1行（取得中・最新・失敗）。スナップショットだけのときは取得時刻の注記。
// 取得から時間がたつと「最新」を「○分前の値」に、締切を過ぎたら「締切済み」に言い換える（BOA-532）
export function LiveStatus({
  entry,
  fallbackLabel,
  onRefresh,
  nowMs,
  deadline,
  finalNote,
  finalPendingUntil,
}) {
  const { t } = useTranslation();
  if (!entry) {
    // DB のスナップショットは「取得した時点の公式表示」。公式のオッズ更新は数分遅れることがあり、
    // 締切直前に取った値でも締切時オッズとは一致しない（BOA-496、ファン評価1周目）
    // 締切直後〜締切時オッズ（公式）の保存まで（締切5分後から最大60分後まで取り直す）は、あとで締切時オッズに
    // 切り替わることを予告する。予告は長い注意書きに埋もれないよう先頭に置き、この券種の記録が無いときも出す
    // （BOA-547、ファン評価1周目）。取り直しの期間を過ぎても無ければ、取得できなかったと書く
    if (!fallbackLabel && !finalNote) return null;
    return (
      <div className="rol-status is-snapshot" data-testid="odds-live-status">
        {finalNote && (
          <span
            className="rol-status-strong"
            data-testid={`odds-final-${finalNote}`}
          >
            {finalNote === "pending"
              ? t("oddsList.finalPendingNote", { time: finalPendingUntil })
              : t("oddsList.finalUnavailableNote")}
          </span>
        )}
        {fallbackLabel && (
          <>
            <span>{t("oddsList.snapshotValues", { label: fallbackLabel })}</span>
            <span className="rol-status-sub">
              {t("oddsList.snapshotLagNote")}
            </span>
          </>
        )}
      </div>
    );
  }
  // 取得中・失敗の「いまは○○の値」は、表示中だった状態の1行と同じく取得時刻で書く（公式更新時刻にすると、
  // 「更新」を押した瞬間に時刻が前に戻ったように見える。ファン評価1周目、BOA-532）
  const liveLabel = entry.result
    ? t("oddsList.fetchedAt", { time: formatJstTime(entry.result.fetchedAt) })
    : fallbackLabel;
  if (entry.status === "loading") {
    return (
      <div
        className="rol-status is-loading"
        role="status"
        data-testid="odds-live-status"
      >
        <span className="rol-spinner" aria-hidden="true" />
        <span>
          {liveLabel
            ? t("oddsList.liveLoadingWith", { label: liveLabel })
            : t("oddsList.liveLoading")}
        </span>
      </div>
    );
  }
  if (entry.status === "error") {
    return (
      <div
        className="rol-status is-error"
        role="alert"
        data-testid="odds-live-status"
      >
        <span>{t("oddsList.liveFailed", { label: liveLabel })}</span>
        <button type="button" className="rol-status-btn" onClick={onRefresh}>
          {t("oddsList.liveRetry")}
        </button>
      </div>
    );
  }
  const { result } = entry;
  const ageMs = nowMs - Date.parse(result.fetchedAt);
  const freshness = liveFreshnessOf(result, nowMs, deadline);
  const afterDeadline =
    freshness === "after-deadline" || freshness === "after-deadline-pending";
  return (
    <div
      // 「○分前の値」「締切済み」は緑の「最新」の見た目（is-live）にしない。ライブで取れた締切時オッズは、
      // DB の締切時オッズ（FinalStatus）と同じ公式の見た目にする（ファン評価1周目）
      className={`rol-status${freshness === "fresh" ? " is-live" : freshness === "final" ? " is-official" : ""}`}
      data-testid="odds-live-status"
      data-freshness={freshness}
    >
      {freshness === "fresh" && (
        <span className="rol-live-dot" aria-hidden="true" />
      )}
      {freshness === "final" && (
        <span className="rol-official-dot" aria-hidden="true" />
      )}
      <span className="rol-status-strong">
        {result.final
          ? t("oddsList.liveFinal")
          : afterDeadline
            ? t("oddsList.liveAfterDeadline")
            : freshness === "stale"
              ? t("oddsList.liveStale", { n: Math.floor(ageMs / 60000) })
              : t("oddsList.liveLatest")}
      </span>
      {/* 取得した時刻を主に出す。取得中の「いまは○:○○取得の値」から時刻が戻ったように見えないよう、
          公式の「オッズ更新時間」は補足にする（ファン評価2周目） */}
      <b>
        {t("oddsList.fetchedAt", { time: formatJstTime(result.fetchedAt) })}
      </b>
      {result.officialUpdatedAt && (
        <span className="rol-status-sub">
          {t("oddsList.officialUpdated")}{" "}
          {formatOfficialTime(result.officialUpdatedAt)}
        </span>
      )}
      {entry.unchanged && (
        <span className="rol-status-sub" data-testid="odds-live-unchanged">
          {t("oddsList.liveUnchanged")}
        </span>
      )}
      {afterDeadline && (
        <span className="rol-status-sub">
          {t(
            freshness === "after-deadline-pending"
              ? "oddsList.liveAfterDeadlinePendingNote"
              : "oddsList.liveAfterDeadlineNote",
          )}
        </span>
      )}
      {!result.final && (
        <button type="button" className="rol-status-btn" onClick={onRefresh}>
          {t("oddsList.liveRefresh")}
        </button>
      )}
    </div>
  );
}
