// オッズ一覧タブの state と取得の effect（RaceOddsListTabBody から、hooks の順を保ったまま移しただけ）
import { useState, useEffect, useRef } from "react";
import { getRaceMotorMaintenanceBreakdown } from "../../../services/motorQueries6.js";
import { getRaceOddsSnapshots } from "../../../services/raceQueries2.js";
import { getRaceFinalOdds } from "../../../services/raceQueries3.js";
import { fetchLiveOdds } from "../../../services/liveOddsService";
import { BET_TYPES, INITIAL_LIVE_PAGES, isLiveOddsTarget } from "./oddsListHelpers";

// state と ref と30秒ごとの現在時刻
function useOddsBaseState({ raceId, raceStartTime }) {
  // スナップショット（DB）の取得結果。raceId とセットで持つ（frontend-data-fetch.md §3）
  const [snapshotState, setSnapshotState] = useState(null);
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  // 欠場艇（直前情報の is_absent）
  const [absentState, setAbsentState] = useState(null);
  // タブを開いた時刻でライブ取得の対象かを決める（表示中に締切を過ぎても、開いた時点の判断を保つ）
  const [openedAtMs] = useState(() => Date.now());
  const liveEnabled = isLiveOddsTarget(raceId, raceStartTime, openedAtMs);
  // 状態の1行の「最新」「○分前の値」「締切済み」を時間とともに言い換えるための現在時刻（30秒ごと）
  const [nowMs, setNowMs] = useState(openedAtMs);
  useEffect(() => {
    if (!liveEnabled) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, [liveEnabled]);
  // ライブ取得の結果（page → {status, result, requestId}）。result は直近の成功（取り直し中・失敗時も保持）。
  // 開いたときに取るページは、初期値から loading にしておく（効果の中で同期的に setState しないため）。
  // requestId は、取り直しが重なったときに最後の要求の結果だけを使うための番号
  const [liveState, setLiveState] = useState(() => ({
    raceId,
    pages: liveEnabled
      ? Object.fromEntries(
          INITIAL_LIVE_PAGES.map((p, i) => [
            p,
            { status: "loading", result: null, requestId: i + 1 },
          ]),
        )
      : {},
  }));
  const requestSeq = useRef(INITIAL_LIVE_PAGES.length);
  const mounted = useRef(true);
  // 初回取得を1回だけにする（開発時の StrictMode は効果を2回走らせ、公式へ同じページを2回取りに行くため）
  const initialFetchStarted = useRef(false);
  const [betTypeId, setBetTypeId] = useState(BET_TYPES[0].id);
  // 推移を表示中の組み合わせキー（券種内で一意。例: "1-2-3"）
  const [selectedKey, setSelectedKey] = useState(null);
  return {
    snapshotState,
    setSnapshotState,
    snapshotReloadKey,
    setSnapshotReloadKey,
    absentState,
    setAbsentState,
    openedAtMs,
    liveEnabled,
    nowMs,
    liveState,
    setLiveState,
    requestSeq,
    mounted,
    initialFetchStarted,
    betTypeId,
    setBetTypeId,
    selectedKey,
    setSelectedKey,
  };
}

// マウント印・スナップショット（と締切時オッズ）・欠場艇の取得
function useOddsFetchEffects({
  raceId,
  mounted: mountedRef,
  snapshotReloadKey,
  setSnapshotState,
  setAbsentState,
}) {
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef]);

  // PredictionPanel側でRaceTabsに`key={analysisRaceId}`を付けているため、
  // レースが変わるとこのコンポーネント自体が再マウントされ、stateは自然に
  // 初期化される（react-hooks/set-state-in-effect: 効果本体での同期的なsetState呼び出しを
  // 避け、非同期コールバック内でのみ呼ぶ）
  useEffect(() => {
    let cancelled = false;
    if (!raceId) return undefined;
    // 締切時オッズ（公式、BOA-496）も同時に取る。どちらかの失敗は「データなし」にせず、まとめて再取得できるようにする
    Promise.all([
      getRaceOddsSnapshots(raceId),
      getRaceFinalOdds(raceId),
    ])
      .then(([data, final]) => {
        if (!cancelled) {
          setSnapshotState({ raceId, data, final, failed: false });
        }
      })
      .catch((err) => {
        // 取得失敗を「データなし」にしない。失敗として持ち、再取得できるようにする
        console.error("オッズ一覧取得エラー:", err?.message ?? String(err));
        if (!cancelled) setSnapshotState({ raceId, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, snapshotReloadKey, setSnapshotState]);

  useEffect(() => {
    let cancelled = false;
    if (!raceId) return undefined;
    getRaceMotorMaintenanceBreakdown(raceId)
      // 戻り値は { state, rows }（BOA-497）。欠場は state によらず rows の is_absent で見る
      .then(({ rows }) => {
        if (cancelled) return;
        const absent = rows
          .filter((r) => r.is_absent === true)
          .map((r) => Number(r.boat_number));
        setAbsentState({ raceId, absent, failed: false });
      })
      .catch((err) => {
        // 欠場の判定は補助（出走表とオッズのキーでも判定できる）。取れなくても表は出す
        console.error("欠場情報の取得エラー:", err?.message ?? String(err));
        if (!cancelled) setAbsentState({ raceId, absent: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, setAbsentState]);
}

// ライブ取得（ページ1つの取得・取り直し・開いたときの初回取得）
function useLiveFetch({
  raceId,
  liveEnabled,
  setLiveState,
  requestSeq,
  mounted,
  initialFetchStarted,
}) {
  // ページ1つをライブ取得する。状態は非同期のコールバックでだけ更新する
  const runLiveFetch = (page, requestId) => {
    const settle = (patch) => {
      if (!mounted.current) return;
      setLiveState((prev) => {
        const current = prev.pages[page];
        // 取り直しが重なったときは、最後に始めた要求の結果だけを使う
        if (current?.requestId !== requestId) return prev;
        return {
          ...prev,
          pages: {
            ...prev.pages,
            [page]: {
              ...current,
              ...(typeof patch === "function" ? patch(current) : patch),
            },
          },
        };
      });
    };
    fetchLiveOdds(raceId, page)
      .then((result) =>
        // 取り直しても CDN（30秒）から同じ応答が返ると見た目が変わらないため、「変化なし」を出す
        settle((current) => ({
          status: "ok",
          result,
          unchanged:
            current?.result?.fetchedAt != null &&
            current.result.fetchedAt === result.fetchedAt,
        })),
      )
      .catch((err) => {
        // 失敗は state に持つ（スナップショットへのフォールバックと「取得に失敗しました」を出す）
        console.error(
          `オッズのライブ取得エラー（${page}）:`,
          err?.message ?? String(err),
        );
        settle({ status: "error" });
      });
  };

  // チップの切り替え・「更新」ボタンから呼ぶ（イベントハンドラ）
  const startLiveFetch = (page) => {
    const requestId = ++requestSeq.current;
    setLiveState((prev) => ({
      ...prev,
      pages: {
        ...prev.pages,
        [page]: {
          result: prev.pages[page]?.result ?? null,
          status: "loading",
          requestId,
        },
      },
    }));
    runLiveFetch(page, requestId);
  };

  // 開いたときの初回取得（単勝・複勝と3連単を並列に）。以降は「更新」ボタンで取り直す（自動更新しない）
  useEffect(() => {
    if (!liveEnabled || initialFetchStarted.current) return;
    initialFetchStarted.current = true;
    INITIAL_LIVE_PAGES.forEach((page, i) => runLiveFetch(page, i + 1));
    // 開いたときの1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { startLiveFetch };
}

export function useOddsListState({ raceId, raceStartTime }) {
  const base = useOddsBaseState({ raceId, raceStartTime });
  useOddsFetchEffects({ raceId, ...base });
  const { startLiveFetch } = useLiveFetch({ raceId, ...base });
  return {
    snapshotState: base.snapshotState,
    setSnapshotState: base.setSnapshotState,
    setSnapshotReloadKey: base.setSnapshotReloadKey,
    absentState: base.absentState,
    openedAtMs: base.openedAtMs,
    liveEnabled: base.liveEnabled,
    nowMs: base.nowMs,
    liveState: base.liveState,
    betTypeId: base.betTypeId,
    setBetTypeId: base.setBetTypeId,
    selectedKey: base.selectedKey,
    setSelectedKey: base.setSelectedKey,
    startLiveFetch,
  };
}
