// 表の上の注記と券種ごとの表（RaceOddsListTabBody の renderBody を部品にしただけ）
import { useTranslation } from "react-i18next";
import InlineFetchError from "../../InlineFetchError";
import { OddsTables } from "./OddsTables";

// 表の上の案内・取得中・締切時オッズの注記
function OddsNotices({ useFinal, betType, refreshing, finalOdds, allNoVotes }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 締切時オッズ（公式）の単勝・複勝では、「締切前は…ずれる」の注意を出さない（ファン評価2周目 P2） */}
      <p className="rol-guide">
        {t(
          useFinal && betType.id === "winPlace"
            ? "oddsList.guide.winPlaceFinal"
            : `oddsList.guide.${betType.id}`,
        )}
      </p>
      {/* 取得中の薄い表示の意味は、表の上（状態の1行の近く）で示す（ファン評価1周目） */}
      {refreshing && (
        <p className="rol-callout" data-testid="odds-refreshing-note">
          {t("oddsList.refreshingNote")}
        </p>
      )}
      {/* 締切時オッズ（公式）が一部の券種だけ取れなかったとき、表示が切り替わる理由を示す（ファン評価1周目 P2） */}
      {finalOdds && !useFinal && (
        <p className="rol-callout" data-testid="odds-final-missing">
          {t("oddsList.finalMissingForBetType")}
        </p>
      )}
      {useFinal && betType.id === "trifecta" && !finalOdds.exactaAll && (
        <p className="rol-callout" data-testid="odds-final-missing">
          {t("oddsList.finalExactaMissing")}
        </p>
      )}
      {allNoVotes && (
        <p className="rol-callout">
          {betType.id === "winPlace"
            ? t("oddsList.winAllNoVotes")
            : t("oddsList.allNoVotes")}
        </p>
      )}
    </>
  );
}

export function OddsBody({
  liveFailedWithoutData,
  refreshLive,
  latestMap,
  liveEntry,
  snapshotsLoading,
  snapshotsFailed,
  liveEnabled,
  openedAfterDeadline,
  finalNote,
  useFinal,
  betType,
  refreshing,
  finalOdds,
  allNoVotes,
  tableProps,
}) {
  const { t } = useTranslation();
  if (liveFailedWithoutData) {
    return (
      <InlineFetchError
        message={t("oddsList.liveFailedNoData")}
        onRetry={refreshLive}
      />
    );
  }
  if (!latestMap) {
    if (liveEntry?.status === "loading" || snapshotsLoading) return null;
    if (snapshotsFailed && !liveEnabled) return null;
    // 締切時オッズがもう入らない締切後は「まだ」と書かない（BOA-547 ファン評価2周目）
    return (
      <p className="rol-no-data">
        {t(
          openedAfterDeadline && finalNote !== "pending"
            ? "oddsList.noBetTypeDataAfterDeadline"
            : "oddsList.noBetTypeData",
        )}
      </p>
    );
  }
  return (
    <>
      <OddsNotices
        useFinal={useFinal}
        betType={betType}
        refreshing={refreshing}
        finalOdds={finalOdds}
        allNoVotes={allNoVotes}
      />
      <OddsTables betType={betType} {...tableProps} />
      {betType.id !== "winPlace" && (
        <p className="rol-legend">💡 {t("oddsList.legend")}</p>
      )}
    </>
  );
}
