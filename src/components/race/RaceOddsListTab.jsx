/**
 * RaceOddsListTab - レース詳細ページ「オッズ一覧」タブ（BOA-311）
 *
 * 日和の「オッズ一覧」タブ相当。race_odds.trifecta_all/trio_all/exacta_all/
 * quinella_all/wide_all（jsonb、ADR-0054/0057、FR-4で全券種が本番稼働済み）と
 * 単勝・複勝（odds_win_N・odds_place_N_low/high）を使い、券種タブ切替×全組み合わせの
 * 常時表示×オッズ推移のドリルダウンを提供する。
 *
 * 表示は日和に合わせ、タップ不要で全通りの数字が見える構造にしている:
 * - 3連単: 1着ごとのブロック → 2着ごとの列 → 3着ごとの行（6艇なら全120通り）。
 *   列の下に、その2着の合成オッズと1着-2着の2連単オッズを表示する
 * - 3連複: 艇番3つの組み合わせを一覧（6艇なら全20通り）
 * - 2連単: 1着ごとのブロック → 2着ごとの行（6艇なら全30通り）
 * - 2連複/拡連複: 小さい方の艇番ごとのブロック → 相手艇ごとの行（全15通り）
 * - 単勝・複勝: 艇ごとの表（BOA-487）
 * 欠場艇は表から除く（「-」だけのブロック・列・行を出さない）。
 * オッズをタップするとその組み合わせのオッズ推移（スナップショット履歴）を表示する。
 *
 * ライブ取得（BOA-487）: 当日かつ締切90分前以内のレースは、タブを開いたときに公式の最新オッズを
 * /api/odds/live から取る（単勝・複勝と3連単を並列に。他の券種はチップを切り替えたときに）。以降は
 * 「更新」ボタンで取り直す（自動更新しない）。公式の応答は1ページ8〜10秒かかるため、先にスナップショットを
 * 出して「取得中… いまは○:○○取得の値」と示し、届いたら差し替える。失敗したらスナップショットのまま
 * 取得時刻を明示する。締切後・過去のレースはライブ取得しない。
 *
 * 票0（公式の「0.0」）は「票なし」と出す。締切前は票が少なく、1.0 など確定払戻と大きくずれる値が出る
 * （BOA-496）ため、ガイド文で注意する。
 *
 * 締切時オッズ（公式、BOA-496）: 締切後に Cron が公式の「締切時オッズ」表示を取り直して保存した値
 * （race_odds_final）がある券種は、表をその値だけで出す（締切直前の記録値と1つの表に混ぜない）。状態の1行は
 * 「締切時オッズ（公式）」、推移の最後の点は「締切時（公式）」（0分前の記録は推移から外す）。取れなかった
 * レース・券種は従来の表示（記録値と注記）のまま。
 *
 * 免責文言（BOA-311指示#1）: スクレイピング取得値のため、実際の投票内容は
 * 主催者発行のものと照合するよう明記する。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import InlineFetchError from "../InlineFetchError";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";
import { parseRaceId } from "../../utils/raceId";
import { latestSnapshotWith } from "../../utils/oddsMath";
import "./RaceOddsListTab.css";
import {
  BET_TYPES,
  LIVE_WINDOW_MS,
  buildTrend,
  comboLabel,
  isNoVotes,
  liveFreshnessOf,
  snapshotLabel,
  todayJst,
} from "./odds-list/oddsListHelpers";
import { boatsOf, officialOddsNotesOf } from "./odds-list/oddsDerived";
import { OddsButton } from "./odds-list/OddsCells";
import { TrendPanel } from "./odds-list/TrendPanel";
import { FinalStatus, LiveStatus } from "./odds-list/LiveStatus";
import { OddsEmptyState } from "./odds-list/OddsEmptyState";
import { OddsBody } from "./odds-list/OddsBody";
import { useOddsListState } from "./odds-list/useOddsListState";

function RaceOddsListTabBody({ raceId, raceStartTime, players }) {
  const { t } = useTranslation();
  const {
    snapshotState,
    setSnapshotState,
    setSnapshotReloadKey,
    absentState,
    openedAtMs,
    liveEnabled,
    nowMs,
    liveState,
    betTypeId,
    setBetTypeId,
    selectedKey,
    setSelectedKey,
    startLiveFetch,
  } = useOddsListState({ raceId, raceStartTime });

  const betType = BET_TYPES.find((b) => b.id === betTypeId) ?? BET_TYPES[0];
  const livePages = liveState.raceId === raceId ? liveState.pages : {};

  const selectBetType = (id) => {
    setBetTypeId(id);
    setSelectedKey(null);
    const page = BET_TYPES.find((b) => b.id === id)?.page;
    if (liveEnabled && page && !livePages[page]) startLiveFetch(page);
  };

  // 同じ組み合わせを再タップすると推移を閉じる
  const toggleSelected = (key) =>
    setSelectedKey((prev) => (prev === key ? null : key));

  const snapshots =
    snapshotState?.raceId === raceId && !snapshotState.failed
      ? snapshotState.data
      : null;
  const snapshotsFailed =
    snapshotState?.raceId === raceId && snapshotState.failed;
  const snapshotsLoading = !snapshots && !snapshotsFailed;
  const finalOdds =
    snapshotState?.raceId === raceId && !snapshotState.failed
      ? (snapshotState.final ?? null)
      : null;
  const absentBoats = new Set(
    absentState?.raceId === raceId ? absentState.absent : [],
  );

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

  // 表示する値: 締切時オッズ（公式）があればそれ、無ければライブ値、無ければ最新スナップショット
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

  // 出走艇（全券種の最新値＋ライブ値のキーから、欠場の記録が無い過去レースの欠場艇を除く）
  const boats = boatsOf({ players, absentBoats, snapshots, livePages, finalOdds });

  const { openedAfterDeadline, officialOddsUrl, finalNote, finalPendingUntil } =
    officialOddsNotesOf({
      raceId,
      liveEnabled,
      deadline,
      openedAtMs,
      finalOdds,
      snapshots,
    });

  const retrySnapshots = () => {
    setSnapshotState(null);
    setSnapshotReloadKey((k) => k + 1);
  };
  // 3連単の表は列の下に2連単（2単）も出すため、2連単も一緒に取り直す（3連単だけ新しくなり、2単が前回の値の
  // まま同じ列に並ばないように。ファン評価1周目、BOA-532）
  const refreshLive = () => {
    startLiveFetch(betType.page);
    if (betType.id === "trifecta") startLiveFetch("2tf");
  };

  // 単勝・複勝の表はタップできない（推移なし）ため、「タップすると推移」の一文を出さない（BOA-532）
  const subtitle = t(
    betType.id === "winPlace" ? "oddsList.subtitleWinPlace" : "oddsList.subtitle",
  );
  const header = (
    <>
      <p className="rol-subtitle">{subtitle}</p>
      <p className="rol-disclaimer">⚠️ {t("oddsList.disclaimer")}</p>
    </>
  );

  // ライブ取得しないレース: 従来どおりスナップショットだけで出す
  if (!liveEnabled) {
    if (snapshotsLoading) {
      return (
        <div className="race-odds-list-tab">
          <p className="rol-subtitle">{subtitle}</p>
          <p className="rol-no-data">{t("oddsList.loading")}</p>
        </div>
      );
    }
    if (snapshotsFailed) {
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
    if (snapshots.length === 0 && !finalOdds) {
      return (
        <OddsEmptyState
          openedAfterDeadline={openedAfterDeadline}
          finalNote={finalNote}
          officialOddsUrl={officialOddsUrl}
          deadline={deadline}
          finalPendingUntil={finalPendingUntil}
        />
      );
    }
  }

  const nameByBoat = new Map(
    (players ?? []).map((p) => [p.number, p.name?.replace(/\s+/g, "")]),
  );

  // スナップショットは保存時に票0（公式の0.0）を捨てている（cron の解析）。券種の表がある以上、出走艇の
  // 組み合わせでキーが無いのは票0なので、ライブ値と同じく「票なし」として出す（ファン評価1周目）
  // レンジ型（拡連複）は {low:0, high:0} で表す（数値の 0 を渡すと formatValue が落ちる。ファン評価2周目 P0）
  // 締切時オッズ（公式）は票0を 0 のまま保存しているため、キーが無いのは欠場・未発売（「-」）
  const valueOf = (key) =>
    latestMap?.[key] ??
    (latestMap && !liveResult && !useFinal
      ? isRange
        ? { low: 0, high: 0 }
        : 0
      : null);

  const oddsButton = (comboKey, badges, value = valueOf(comboKey)) => (
    <OddsButton
      key={comboKey}
      comboKey={comboKey}
      label={comboLabel(comboKey, betType.ordered)}
      value={value}
      isRange={isRange}
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
          deadline,
          liveResult,
          useFinal ? finalMap : null,
          liveResult ? liveFreshnessOf(liveResult, nowMs, deadline) : null,
        )}
        isRange={isRange}
      />
    ) : null;

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

  return (
    <div
      className={`race-odds-list-tab${refreshing ? " is-refreshing" : ""}`}
      aria-busy={refreshing}
    >
      {header}

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

      {useFinal ? (
        <FinalStatus deadline={deadline} />
      ) : (
        !liveFailedWithoutData && (
          <LiveStatus
            entry={liveEntry}
            fallbackLabel={fallbackLabel}
            onRefresh={refreshLive}
            nowMs={nowMs}
            deadline={deadline}
            finalNote={finalNote}
            finalPendingUntil={finalPendingUntil}
          />
        )
      )}
      <OddsBody
        liveFailedWithoutData={liveFailedWithoutData}
        refreshLive={refreshLive}
        latestMap={latestMap}
        liveEntry={liveEntry}
        snapshotsLoading={snapshotsLoading}
        snapshotsFailed={snapshotsFailed}
        liveEnabled={liveEnabled}
        openedAfterDeadline={openedAfterDeadline}
        finalNote={finalNote}
        useFinal={useFinal}
        betType={betType}
        refreshing={refreshing}
        finalOdds={finalOdds}
        allNoVotes={allNoVotes}
        tableProps={{
          boats,
          nameByBoat,
          valueOf,
          oddsButton,
          trendPanel,
          selectedKey,
          liveResult,
          livePages,
          latestSnapshot,
          latestMap,
          placeMap,
          useFinal,
          finalOdds,
        }}
      />
    </div>
  );
}

// 当日・締切90分より前に開いたときは、ライブ取得の対象になる時刻（締切90分前）に中身を作り直し、その時点の
// 判断でライブ取得を始める。開いた時刻で対象かを決めるため、作り直さないと「12:54から表示します」と書いた
// まま、時刻を過ぎても表示が始まらない（ファン評価1周目、BOA-532）
function RaceOddsListTab(props) {
  const { raceId, raceStartTime } = props;
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const parsed = parseRaceId(raceId);
    const deadline = getDeadlineDate(raceId, raceStartTime);
    if (!parsed || !deadline || parsed.date !== todayJst(now)) return undefined;
    const startsInMs = deadline.getTime() - LIVE_WINDOW_MS - now;
    if (startsInMs <= 0) return undefined;
    const id = setTimeout(() => setEpoch((e) => e + 1), startsInMs + 1000);
    return () => clearTimeout(id);
  }, [raceId, raceStartTime, epoch]);
  return <RaceOddsListTabBody key={epoch} {...props} />;
}

export default RaceOddsListTab;
