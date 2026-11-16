import InlineFetchError from "../InlineFetchError";
import { latestSnapshotWith } from "../../utils/oddsMath";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";
import { isNoVotes, snapshotLabel } from "./odds-list/oddsListHelpers";
import { boatsOf, officialOddsNotesOf } from "./odds-list/oddsDerived";
import { OddsEmptyState } from "./odds-list/OddsEmptyState";

// スナップショット・欠場艇の state から、このレースの分だけを取り出す
export function pickSnapshotView(snapshotState, absentState, raceId) {
  const mine = snapshotState?.raceId === raceId;
  const snapshots = mine && !snapshotState.failed ? snapshotState.data : null;
  const snapshotsFailed = mine && snapshotState.failed;
  const finalOdds =
    mine && !snapshotState.failed ? (snapshotState.final ?? null) : null;
  const absentBoats = new Set(
    absentState?.raceId === raceId ? absentState.absent : [],
  );
  return {
    snapshots,
    snapshotsFailed,
    snapshotsLoading: !snapshots && !snapshotsFailed,
    finalOdds,
    absentBoats,
  };
}

// 表示する値: 締切時オッズ（公式）があればそれ、無ければライブ値、無ければ最新スナップショット
function pickLatestMaps({
  betType,
  useFinal,
  finalMap,
  finalOdds,
  liveResult,
  latestSnapshot,
}) {
  const latestMap = useFinal
    ? finalMap
    : liveResult
      ? (liveResult.data?.[betType.dataKey] ?? null)
      : (latestSnapshot?.[betType.dataKey] ?? null);
  const placeMap =
    betType.id === "winPlace"
      ? useFinal
        ? (finalOdds.place ?? null)
        : liveResult
          ? (liveResult.data?.place ?? null)
          : (latestSnapshot?.place ?? null)
      : null;
  return { latestMap, placeMap };
}

// 表示の状態の旗（全て票0・ライブ失敗でデータ無し・更新中）
function pickFlags({ liveEnabled, liveEntry, liveResult, latestMap, useFinal, isRange }) {
  // 表示中の値が全て票0か（締切前の早い時間に起きる）
  const allNoVotes =
    latestMap &&
    Object.keys(latestMap).length > 0 &&
    Object.values(latestMap).every((v) => isNoVotes(v, isRange));
  const liveFailedWithoutData =
    liveEnabled && liveEntry?.status === "error" && !liveResult && !latestMap;
  // 最新を取得中で、表はいったん前回の値（スナップショット・前回のライブ値）を出しているとき。値を薄くし、
  // 取得後に変わる値だと分かるようにする（3連複・拡連複は切り替えてから8〜11秒かかる。BOA-532）
  const refreshing =
    !useFinal && liveEntry?.status === "loading" && !!latestMap;
  return { allNoVotes, liveFailedWithoutData, refreshing };
}

// 画面に出す値を state から導く（純粋）
export function deriveOddsView({
  t,
  raceId,
  raceStartTime,
  players,
  betType,
  liveEnabled,
  livePages,
  openedAtMs,
  snap,
}) {
  const { snapshots, finalOdds, absentBoats } = snap;
  const liveEntry = liveEnabled ? (livePages[betType.page] ?? null) : null;
  // 締切時オッズ（公式）がこの券種にあれば、表・推移をその値で出す（ライブ取得・スナップショットより優先）
  const finalMap = finalOdds?.[betType.dataKey] ?? null;
  const useFinal = !!finalMap;
  const liveResult = useFinal ? null : (liveEntry?.result ?? null);
  const deadline = getDeadlineDate(raceId, raceStartTime);
  const isRange = !!betType.isRange;
  const latestSnapshot = snapshots
    ? latestSnapshotWith(snapshots, betType.dataKey)
    : null;
  const fallbackLabel = latestSnapshot
    ? snapshotLabel(t, latestSnapshot, deadline)
    : null;
  const { latestMap, placeMap } = pickLatestMaps({
    betType,
    useFinal,
    finalMap,
    finalOdds,
    liveResult,
    latestSnapshot,
  });
  // 出走艇（全券種の最新値＋ライブ値のキーから、欠場の記録が無い過去レースの欠場艇を除く）
  const boats = boatsOf({ players, absentBoats, snapshots, livePages, finalOdds });
  const notes = officialOddsNotesOf({
    raceId,
    liveEnabled,
    deadline,
    openedAtMs,
    finalOdds,
    snapshots,
  });
  const flags = pickFlags({
    liveEnabled,
    liveEntry,
    liveResult,
    latestMap,
    useFinal,
    isRange,
  });
  return {
    ...snap,
    ...notes,
    ...flags,
    liveEntry,
    finalMap,
    useFinal,
    liveResult,
    deadline,
    isRange,
    latestSnapshot,
    fallbackLabel,
    latestMap,
    placeMap,
    boats,
  };
}

// ライブ取得しないレース: 従来どおりスナップショットだけで出す。出す物が無ければ null（通常の表へ進む）
export function snapshotGate(t, v, header, subtitle, retrySnapshots) {
  if (v.snapshotsLoading) {
    return (
      <div className="race-odds-list-tab">
        <p className="rol-subtitle">{subtitle}</p>
        <p className="rol-no-data">{t("oddsList.loading")}</p>
      </div>
    );
  }
  if (v.snapshotsFailed) {
    return (
      <div className="race-odds-list-tab">
        {header}
        <InlineFetchError
          message={t("oddsList.fetchFailed")}
          onRetry={retrySnapshots}
        />
      </div>
    );
  }
  if (v.snapshots.length === 0 && !v.finalOdds) {
    return (
      <OddsEmptyState
        openedAfterDeadline={v.openedAfterDeadline}
        finalNote={v.finalNote}
        officialOddsUrl={v.officialOddsUrl}
        deadline={v.deadline}
        finalPendingUntil={v.finalPendingUntil}
      />
    );
  }
  return null;
}
