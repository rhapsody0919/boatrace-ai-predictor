// 取得済みでオッズが空のときの表示（ライブ取得しないレース）。RaceOddsListTabBody から移しただけ
import { useTranslation } from "react-i18next";
import { LIVE_WINDOW_MS, formatJstTime } from "./oddsListHelpers";

export function OddsEmptyState({
  openedAfterDeadline,
  finalNote,
  officialOddsUrl,
  deadline,
  finalPendingUntil,
}) {
  const { t } = useTranslation();
  return (
    <div className="race-tabs-empty">
      {/* 締切後に「発走が近づくと…」「まだありません」とは書かない（もう入らないのに待てば出るように読める）。
          締切時オッズがあとで入る期間なら予告し、期間を過ぎたら記録が無いと言い切る（BOA-547）。
          当日で締切90分より前は、いつ出るか（時刻）と公式への導線を示す（ファン評価2周目、BOA-532） */}
      <p data-testid="odds-empty-title">
        {openedAfterDeadline && finalNote !== "pending"
          ? t("oddsList.emptyTitleAfterDeadline")
          : t("oddsList.emptyTitle")}
      </p>
      {officialOddsUrl ? (
        <p
          className="race-tabs-empty-body"
          data-testid="odds-before-window"
        >
          {t("oddsList.liveFromTime", {
            time: formatJstTime(
              new Date(deadline.getTime() - LIVE_WINDOW_MS).toISOString(),
            ),
          })}{" "}
          <a
            href={officialOddsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("oddsList.officialOddsLink")}
          </a>
        </p>
      ) : (
        (!openedAfterDeadline || finalNote) && (
          <p className="race-tabs-empty-body" data-testid="odds-empty-body">
            {finalNote === "pending"
              ? t("oddsList.finalPendingNote", { time: finalPendingUntil })
              : finalNote === "unavailable"
                ? t("oddsList.finalUnavailableNote")
                : t("oddsList.emptyBody")}
          </p>
        )
      )}
    </div>
  );
}
