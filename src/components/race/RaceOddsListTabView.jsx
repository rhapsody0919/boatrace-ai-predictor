import { useTranslation } from "react-i18next";
import {
  BET_TYPES,
  buildTrend,
  comboLabel,
  liveFreshnessOf,
} from "./odds-list/oddsListHelpers";
import { OddsButton } from "./odds-list/OddsCells";
import { TrendPanel } from "./odds-list/TrendPanel";
import { FinalStatus, LiveStatus } from "./odds-list/LiveStatus";
import { OddsBody } from "./odds-list/OddsBody";

function BetTypeTabs({ betTypeId, selectBetType }) {
  const { t } = useTranslation();
  return (
    <div className="rol-bet-type-tabs" role="tablist">
      {BET_TYPES.map((bt) => (
        <button
          key={bt.id}
          type="button"
          role="tab"
          aria-selected={bt.id === betTypeId}
          className={`rol-chip${bt.id === betTypeId ? " is-active" : ""}`}
          onClick={() => selectBetType(bt.id)}
        >
          {bt.id === "winPlace"
            ? t("oddsList.winPlaceChip")
            : t(`result.payoutType.${bt.id}`)}
        </button>
      ))}
    </div>
  );
}

function StatusLine({ v, refreshLive, nowMs }) {
  if (v.useFinal) return <FinalStatus deadline={v.deadline} />;
  if (v.liveFailedWithoutData) return null;
  return (
    <LiveStatus
      entry={v.liveEntry}
      fallbackLabel={v.fallbackLabel}
      onRefresh={refreshLive}
      nowMs={nowMs}
      deadline={v.deadline}
      finalNote={v.finalNote}
      finalPendingUntil={v.finalPendingUntil}
    />
  );
}

// 券種の表に渡す、値・ボタン・推移パネルの作り手
function makeCells({ v, betType, selectedKey, toggleSelected, snapshots, nowMs }) {
  // スナップショットは保存時に票0（公式の0.0）を捨てている（cron の解析）。券種の表がある以上、出走艇の
  // 組み合わせでキーが無いのは票0なので、ライブ値と同じく「票なし」として出す（ファン評価1周目）
  // レンジ型（拡連複）は {low:0, high:0} で表す（数値の 0 を渡すと formatValue が落ちる。ファン評価2周目 P0）
  // 締切時オッズ（公式）は票0を 0 のまま保存しているため、キーが無いのは欠場・未発売（「-」）
  const valueOf = (key) =>
    v.latestMap?.[key] ??
    (v.latestMap && !v.liveResult && !v.useFinal
      ? v.isRange
        ? { low: 0, high: 0 }
        : 0
      : null);

  const oddsButton = (comboKey, badges, value = valueOf(comboKey)) => (
    <OddsButton
      key={comboKey}
      comboKey={comboKey}
      label={comboLabel(comboKey, betType.ordered)}
      value={value}
      isRange={v.isRange}
      selected={comboKey === selectedKey}
      onSelect={toggleSelected}
      badges={badges}
    />
  );

  const trendPanel = () =>
    selectedKey ? (
      <TrendPanel
        key="trend"
        combo={comboLabel(selectedKey, betType.ordered)}
        trend={buildTrend(
          snapshots ?? [],
          betType,
          selectedKey,
          v.deadline,
          v.liveResult,
          v.useFinal ? v.finalMap : null,
          v.liveResult ? liveFreshnessOf(v.liveResult, nowMs, v.deadline) : null,
        )}
        isRange={v.isRange}
      />
    ) : null;

  return { valueOf, oddsButton, trendPanel };
}

export function OddsListView({
  v,
  header,
  betType,
  betTypeId,
  selectBetType,
  refreshLive,
  nowMs,
  selectedKey,
  toggleSelected,
  livePages,
  players,
}) {
  const nameByBoat = new Map(
    (players ?? []).map((p) => [p.number, p.name?.replace(/\s+/g, "")]),
  );
  const { valueOf, oddsButton, trendPanel } = makeCells({
    v,
    betType,
    selectedKey,
    toggleSelected,
    snapshots: v.snapshots,
    nowMs,
  });

  return (
    <div
      className={`race-odds-list-tab${v.refreshing ? " is-refreshing" : ""}`}
      aria-busy={v.refreshing}
    >
      {header}

      <BetTypeTabs betTypeId={betTypeId} selectBetType={selectBetType} />

      <StatusLine v={v} refreshLive={refreshLive} nowMs={nowMs} />
      <OddsBody
        liveFailedWithoutData={v.liveFailedWithoutData}
        refreshLive={refreshLive}
        latestMap={v.latestMap}
        liveEntry={v.liveEntry}
        snapshotsLoading={v.snapshotsLoading}
        snapshotsFailed={v.snapshotsFailed}
        liveEnabled={v.liveEnabled}
        openedAfterDeadline={v.openedAfterDeadline}
        finalNote={v.finalNote}
        useFinal={v.useFinal}
        betType={betType}
        refreshing={v.refreshing}
        finalOdds={v.finalOdds}
        allNoVotes={v.allNoVotes}
        tableProps={{
          boats: v.boats,
          nameByBoat,
          valueOf,
          oddsButton,
          trendPanel,
          selectedKey,
          liveResult: v.liveResult,
          livePages,
          latestSnapshot: v.latestSnapshot,
          latestMap: v.latestMap,
          placeMap: v.placeMap,
          useFinal: v.useFinal,
          finalOdds: v.finalOdds,
        }}
      />
    </div>
  );
}
