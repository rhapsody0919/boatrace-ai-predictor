/**
 * RaceBeforeInfoTab の取得フック群（RaceBeforeInfoTab.jsx から移しただけ）。
 * 呼び出し順は RaceBeforeInfoTab 側で元のまま保つ。
 */
import { useState, useEffect, useMemo } from "react";
import {
  getMeetOriginalExhibitionByRaceBoat,
  getRacerMeetExhibitionTrendBefore,
} from "../../services/meetQueries.js";
import { getMeetScoreboard } from "../../services/meetQueries2.js";
import { getRaceEntryWeights } from "../../services/raceQueries2.js";
import { getRaceOriginalExhibition } from "../../services/raceQueries4.js";
import { getRacerScopedRaceStats } from "../../services/racerQueries2.js";

/** レース遷移直後の「まだ何も取れていない」状態。毎回新しい {} を作ると
 *  useMemo の依存が毎レンダー変わってしまうため、定数を使い回す
 *  （今節展示情報・選手の出走履歴の両方で使う） */
const EMPTY_TREND = Object.freeze({});

// 展示タイム1位勝率・この枠からの進入コース用: 基本情報タブ(BOA-306)と同じgetRacerScopedRaceStats
// を選手ごとに取得する（withCacheで基本情報タブと同一キャッシュを共有するため、
// 既にどちらかのタブを開いていれば再取得は発生しない）
//
// **raceIdとセットで持つ**（今節展示情報の fetchedMeetTrend と同じ。BOA-485）。
// 失敗も空配列に倒さず、同じ箱の failed に残す（「この枠からの進入コース」が
// 失敗時に「出走なし」と誤表示しないため。.claude/rules/frontend-data-fetch.md §3）。
// 再試行は reloadKey でこのセクションだけ取り直す
export function useScopedStats(raceId, sortedPlayers) {
  const [fetchedScopedStats, setFetchedScopedStats] = useState({
    raceId: null,
    byRacer: {},
    failed: false,
  });
  const [scopedStatsReloadKey, setScopedStatsReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const apply = (racerId, data, didFail) =>
      setFetchedScopedStats((prev) => {
        // 別のレースの結果が遅れて届いても混ぜない
        const base =
          prev.raceId === raceId
            ? prev
            : { raceId, byRacer: {}, failed: false };
        return {
          raceId,
          byRacer: { ...base.byRacer, [racerId]: data },
          failed: base.failed || didFail,
        };
      });
    sortedPlayers.forEach((p) => {
      if (!p.racerId) return;
      getRacerScopedRaceStats(p.racerId)
        .then((data) => {
          if (!cancelled) apply(p.racerId, data, false);
        })
        .catch((err) => {
          // catchしないとbyRacer[p.racerId]がundefinedのまま残り、
          // 「展示タイム1位勝率」「この枠からの進入」が読み込み中のまま固まる
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          // null＝取得失敗（undefined＝取得中、配列＝取得済みと区別する）
          if (!cancelled) apply(p.racerId, null, true);
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, scopedStatsReloadKey]);
  const scopedStatsCurrent = fetchedScopedStats.raceId === raceId;
  const scopedStatsByRacer = scopedStatsCurrent
    ? fetchedScopedStats.byRacer
    : EMPTY_TREND;
  const scopedStatsFailed = scopedStatsCurrent && fetchedScopedStats.failed;
  const retryScopedStats = () => {
    setFetchedScopedStats({ raceId: null, byRacer: {}, failed: false });
    setScopedStatsReloadKey((n) => n + 1);
  };
  return { scopedStatsByRacer, scopedStatsFailed, retryScopedStats };
}

// 別のレースの結果が遅れて届いても混ぜない
const mergeMeetTrend = (prev, raceId, racerId, data) =>
  prev.raceId === raceId
    ? { raceId, byRacer: { ...prev.byRacer, [racerId]: data } }
    : { raceId, byRacer: { [racerId]: data } };

// 今節展示情報用: 選手ごとに「このレースより前・同一モーターの今節」の展示タイム推移を取得する。
//
// **raceIdとセットで持つ**（2026-09-28、BOA-473のレビューで修正）。以前は
// `prev` にマージするだけでレース遷移時にクリアしていなかった。未確定レース同士を
// 行き来すると RaceTabs はタブをリセットしないので、前のレースの節（古い
// beforeRaceId で計算されたもの）がそのまま残る。すると
//   1. 「前走」が1走ずれた値になる（同じ節の2レースなら、ずれるのは1走分）
//   2. 下の meetRaceKeys が古い集合で確定してしまい、オリジナル展示の取得を
//      余分に1本投げる（「1本に絞る」という設計がレース遷移で崩れる）
export function useMeetTrend(raceId, sortedPlayers) {
  const [fetchedMeetTrend, setFetchedMeetTrend] = useState({
    raceId: null,
    byRacer: {},
  });
  useEffect(() => {
    let cancelled = false;
    sortedPlayers.forEach((p) => {
      if (!p.racerId || !p.motorNumber || !raceId) return;
      getRacerMeetExhibitionTrendBefore(p.racerId, p.motorNumber, raceId)
        .then((data) => {
          if (cancelled) return;
          setFetchedMeetTrend((prev) =>
            mergeMeetTrend(prev, raceId, p.racerId, data),
          );
        })
        .catch((err) => {
          // catchしないとmeetTrendByRacer[p.racerId]がundefinedのまま残り、
          // 今節展示情報のセルがスケルトンのまま固まる（上のscopedStatsと同じ扱い）
          console.error("今節展示情報取得エラー:", err?.message ?? String(err));
          if (cancelled) return;
          setFetchedMeetTrend((prev) =>
            mergeMeetTrend(prev, raceId, p.racerId, []),
          );
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);
  return fetchedMeetTrend.raceId === raceId
    ? fetchedMeetTrend.byRacer
    : EMPTY_TREND;
}

// オリジナル展示（一周/半周ラップ/まわり足/直線、BOA-452 / FR-4b）。
// BOATCAST由来の生値なので、表示するときは必ず出典を添える（ADR-0067）。
// 096が未適用の間は state==="forbidden" が返り、行も出典も出さない
// **raceIdとセットで持つ**（RacePitReportSection と同じ）。レース詳細は
// ボトムナビで次のレースへ移ってもこのコンポーネントが再マウントされず、
// raceId プロップだけが変わる。値だけを持つと、新しい取得が返るまでの間、
// 展示ST・展示タイムは新レース・一周/まわり足/直線は前レース、という
// 1つの表の中で別レースの数字が混ざった状態になる
export function useOriginalExhibition(raceId) {
  const [fetchedExhibition, setFetchedExhibition] = useState(null);
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    getRaceOriginalExhibition(raceId)
      .then((data) => {
        if (!cancelled) setFetchedExhibition({ raceId, data });
      })
      .catch((err) => {
        // 取得失敗でこのタブの他の行まで巻き込まない。行が出ないだけにする
        console.error("オリジナル展示取得エラー:", err?.message ?? String(err));
        if (!cancelled) setFetchedExhibition({ raceId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);
  return fetchedExhibition?.raceId === raceId ? fetchedExhibition.data : null;
}

// 6選手ぶんが出揃うまでは空（揃う前に投げるとキャッシュキーが育つたびに投げ直す）
function computeMeetRaceKeys(sortedPlayers, meetTrendByRacer) {
  const targets = sortedPlayers.filter((p) => p.racerId && p.motorNumber);
  if (targets.length === 0) return [];
  const allResolved = targets.every(
    (p) => meetTrendByRacer[p.racerId] !== undefined,
  );
  if (!allResolved) return [];
  const ids = new Set();
  targets.forEach((p) => {
    (meetTrendByRacer[p.racerId] ?? []).forEach((e) => {
      if (e?.raceId) ids.add(e.raceId);
    });
  });
  return [...ids].sort();
}

// 今節のオリジナル展示（BOA-473）。6選手の今節はほぼ同じレース集合なので、
// 選手ごとではなく**IDを束ねて1クエリ**で引く（選手ごとに引くと+6本になり、
// 非機能要件の「1タブあたり+3本以内」を超える）。
//
// **6選手ぶんが出揃うまで発火させない**のが肝。meetTrendByRacer は選手ごとに
// 非同期で埋まるため、揃う前に投げるとIDの集合が育つたびに別のキャッシュキーで
// 投げ直し、束ねた意味が消えて結局6本になる（2026-09-28に本番ビルドで実測。
// ids=7→15→20→27→32→37 と6回投げていた）。E2Eで1本であることを固定してある
export function useMeetOriginal(raceId, sortedPlayers, meetTrendByRacer) {
  const meetRaceKeys = useMemo(
    () => computeMeetRaceKeys(sortedPlayers, meetTrendByRacer),
    // sortedPlayers は毎レンダー新しい配列になるため raceId で代表させる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meetTrendByRacer, raceId],
  );
  const meetRaceKeysSignature = meetRaceKeys.join(",");

  const [fetchedMeetOriginal, setFetchedMeetOriginal] = useState(null);
  useEffect(() => {
    if (meetRaceKeys.length === 0) return undefined;
    let cancelled = false;
    getMeetOriginalExhibitionByRaceBoat(meetRaceKeys)
      .then((data) => {
        if (!cancelled) setFetchedMeetOriginal({ raceId, data });
      })
      .catch((err) => {
        // 失敗しても今節展示情報の展示タイム行は出る。行が増えないだけにする
        console.error(
          "今節オリジナル展示取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setFetchedMeetOriginal({ raceId, data: null });
      });
    return () => {
      cancelled = true;
    };
    // meetRaceKeys は毎回新しい配列になるため、中身を文字列化した signature で見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, meetRaceKeysSignature]);
  // raceId とセットで持つ（RacePitReportSection と同じ。レース遷移で前のレースの
  // 値が残らないようにする）
  return fetchedMeetOriginal?.raceId === raceId
    ? fetchedMeetOriginal.data
    : null;
}

// 今節の足の推移と着順（BOA-885）の着順と、その日の会場平均。今節タブと同じ
// getMeetScoreboard（節単位のキャッシュを共有するので、今節タブを開いていれば再取得しない）。
// 失敗してもカードの線は出し、着順が取れなかったことをカードの中で示して再試行できるようにする
export function useMeetBoard(raceId, venueCode) {
  const [fetchedBoard, setFetchedBoard] = useState(null);
  const [boardReloadKey, setBoardReloadKey] = useState(0);
  useEffect(() => {
    if (!raceId || venueCode === null || venueCode === undefined)
      return undefined;
    let cancelled = false;
    getMeetScoreboard(raceId, venueCode)
      .then((data) => {
        if (!cancelled) setFetchedBoard({ raceId, data, failed: false });
      })
      .catch((err) => {
        console.error(
          "今節の足（着順）の取得エラー:",
          err?.message ?? String(err),
        );
        if (!cancelled) setFetchedBoard({ raceId, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, venueCode, boardReloadKey]);
  const boardCurrent = fetchedBoard?.raceId === raceId;
  const meetBoard = boardCurrent ? fetchedBoard.data : null;
  const meetBoardFailed = boardCurrent && fetchedBoard.failed;
  const retryBoard = () => {
    setFetchedBoard(null);
    setBoardReloadKey((n) => n + 1);
  };
  return { meetBoard, meetBoardFailed, retryBoard };
}

// 展示前の体重（出走表の体重、BOA-484）。オリジナル展示と同じく raceId とセットで持ち、
// 失敗も state として残す（取得失敗を「未公開」「値なし」に化けさせない。frontend-data-fetch.md）。
// reloadKey は InlineFetchError の再試行用（RacePitReportSection と同じ方式）
export function useEntryWeights(raceId) {
  const [fetchedEntryWeights, setFetchedEntryWeights] = useState(null);
  const [entryWeightsReloadKey, setEntryWeightsReloadKey] = useState(0);
  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    getRaceEntryWeights(raceId)
      .then((data) => {
        if (!cancelled) setFetchedEntryWeights({ raceId, data });
      })
      .catch((err) => {
        console.error("出走表の体重の取得エラー:", err?.message ?? String(err));
        if (!cancelled)
          setFetchedEntryWeights({ raceId, data: { state: "error" } });
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, entryWeightsReloadKey]);
  const entryWeights =
    fetchedEntryWeights?.raceId === raceId
      ? fetchedEntryWeights.data
      : { state: "loading" };
  const retryEntryWeights = () => setEntryWeightsReloadKey((k) => k + 1);
  return { entryWeights, retryEntryWeights };
}

// 取得フックを元の順に呼ぶ（呼び出し順は RaceBeforeInfoTab.jsx にあった頃のまま）
export function useBeforeInfoFetches(raceId, venueCode, sortedPlayers) {
  const scoped = useScopedStats(raceId, sortedPlayers);
  const meetTrendByRacer = useMeetTrend(raceId, sortedPlayers);
  const originalExhibition = useOriginalExhibition(raceId);
  const meetOriginal = useMeetOriginal(raceId, sortedPlayers, meetTrendByRacer);
  const board = useMeetBoard(raceId, venueCode);
  const weights = useEntryWeights(raceId);
  return {
    ...scoped,
    meetTrendByRacer,
    originalExhibition,
    meetOriginal,
    ...board,
    ...weights,
  };
}
