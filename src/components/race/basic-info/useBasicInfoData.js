import { useState, useEffect, useCallback, useMemo } from "react";
import { getRaceEntryOfficialRatesBreakdown } from "../../../services/raceQueries.js";
import { getRaceOfficialAvgSt } from "../../../services/raceQueries2.js";
import { getRacerScopedRaceStats } from "../../../services/racerQueries2.js";
import {
  getRacerAccidentRecords,
  getRacerPeriodStats,
} from "../../../services/racerQueries4.js";
import { computeAccidentStats } from "../../../utils/accidentRate";

export function useOfficialRates(raceId) {
  const [officialRates, setOfficialRates] = useState(null);

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    getRaceEntryOfficialRatesBreakdown(raceId)
      .then((data) => {
        if (!cancelled) setOfficialRates(data);
      })
      .catch((err) => {
        // catchしないとofficialRatesがnullのまま残り、loading判定
        // （officialRates === null）が永久にtrueになって勝率・連対率のセルが
        // スケルトンのまま固まる。下のensureScopedStatsと同じ扱いに揃える
        console.error("公式勝率取得エラー:", err?.message ?? String(err));
        if (!cancelled) setOfficialRates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  return officialRates;
}

// 平均ST（公式）。undefined=取得中、null=取得失敗、{period, rows}=取得済み
export function useOfficialAvgSt(raceId) {
  const [officialAvgSt, setOfficialAvgSt] = useState(undefined);
  const [officialAvgStRetry, setOfficialAvgStRetry] = useState(0);

  useEffect(() => {
    if (!raceId) return undefined;
    let cancelled = false;
    // レースが変わる・再試行したときに、前の値や失敗を「取得中」に戻す（分割前からの挙動）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOfficialAvgSt(undefined);
    getRaceOfficialAvgSt(raceId)
      .then((data) => {
        if (!cancelled) setOfficialAvgSt(data);
      })
      .catch((err) => {
        console.error("平均ST（公式）取得エラー:", err?.message ?? String(err));
        if (!cancelled) setOfficialAvgSt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raceId, officialAvgStRetry]);

  const retryOfficialAvgSt = () => setOfficialAvgStRetry((n) => n + 1);
  return { officialAvgSt, retryOfficialAvgSt };
}

// 「前期」（racer_period_stats、phase a FR-4c）。6人分を1クエリで取る。
// undefined=未取得、配列=取得済み、それ以外（{state:"forbidden"}）＝095未適用
//
// 「前期」は条件別タブを開いたときだけ要る値だが、6人分まとめて1クエリで済み
// （racer_period_stats を period_year/period_no で絞って .in() する）、
// タブを開くたびに待たせない方が読み手の体験が良いのでレース単位で先に取る。
// racerIdsKey は「6人の登録番号の並び」で、同じレース内では変わらない
export function useRacerPeriodStats(racerIdsKey, raceDate) {
  const [periodStats, setPeriodStats] = useState(undefined);
  const [periodFailed, setPeriodFailed] = useState(false);
  // 再読み込みボタン用。これを増やさないと取得effectの依存
  // （racerIdsKey / raceDate）が変わらず、再取得が起きないまま
  // 枠もエラーも消えて「失敗がデータなしに化ける」状態になる
  const [periodRetryToken, setPeriodRetryToken] = useState(0);

  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || !raceDate) return undefined;
    let cancelled = false;
    getRacerPeriodStats(ids, raceDate)
      .then((data) => {
        if (!cancelled) setPeriodStats(data);
      })
      .catch((err) => {
        // 権限エラー（095未適用）はサービス層が {state:"forbidden"} で返すので
        // ここには来ない。ここに来るのはネットワーク断・タイムアウト等で、
        // 「データが無い」と区別して扱う（.claude/rules/frontend-data-fetch.md §3）
        console.error("前期成績取得エラー:", err?.message ?? String(err));
        if (!cancelled) {
          setPeriodStats(null);
          setPeriodFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey, raceDate, periodRetryToken]);

  const retryPeriod = () => {
    setPeriodFailed(false);
    setPeriodStats(undefined);
    setPeriodRetryToken((v) => v + 1);
  };
  return { periodStats, periodFailed, retryPeriod };
}

// 今期の事故率（目安、BOA-327）の元データ。6人分を1回の RPC で取る。
// undefined=未取得、{rows, range}=取得済み、{state:"unavailable"}=126未適用（出さない）、null=取得失敗
export function useAccidentData(racerIdsKey, raceDate, sortedPlayers) {
  const [accidentRecords, setAccidentRecords] = useState(undefined);
  const [accidentRetryToken, setAccidentRetryToken] = useState(0);

  useEffect(() => {
    const ids = racerIdsKey.split(",").filter(Boolean).map(Number);
    if (ids.length === 0 || !raceDate) return undefined;
    let cancelled = false;
    getRacerAccidentRecords(ids, raceDate)
      .then((data) => {
        if (!cancelled) setAccidentRecords(data);
      })
      .catch((err) => {
        // 126 未適用はサービス層が {state:"unavailable"} で返すので、ここに来るのは通信の失敗。
        // 「事故が無い」と区別して、開いた欄に再試行つきのエラーを出す
        console.error("事故率取得エラー:", err?.message ?? String(err));
        if (!cancelled) setAccidentRecords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [racerIdsKey, raceDate, accidentRetryToken]);

  // racerId → computeAccidentStats の結果。取得前・未適用・失敗は空
  const accidentByRacer = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(accidentRecords?.rows)) return map;
    const byId = new Map(accidentRecords.rows.map((r) => [r.racer_id, r]));
    for (const p of sortedPlayers) {
      if (!p.racerId) continue;
      // 今期まだ1走もしていない選手は RPC の行が無い。出走0として扱う
      map.set(
        p.racerId,
        computeAccidentStats(
          byId.get(p.racerId) ?? { starts: 0, incidents: [] },
          accidentRecords.range,
        ),
      );
    }
    return map;
    // sortedPlayers は毎回作り直す配列なので、中身の代わりに racerIdsKey で再計算する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accidentRecords, racerIdsKey]);

  // 期間の表示（「2026-05-01〜10-02」）。to はレースの前日。同じ年なら月日だけにする
  const accidentRangeLabel = (() => {
    const range = accidentRecords?.range;
    if (!range) return null;
    const last = new Date(`${range.to}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    const lastStr = last.toISOString().slice(0, 10);
    // 期の初日のレースは、前日が期の前になる（「2026-05-01〜04-30」と逆になる。ファン評価1周目）
    if (lastStr < range.from) return { from: range.from, to: null };
    return {
      from: range.from,
      to:
        lastStr.slice(0, 4) === range.from.slice(0, 4)
          ? lastStr.slice(5)
          : lastStr,
    };
  })();

  const retryAccident = () => {
    setAccidentRecords(undefined);
    setAccidentRetryToken((v) => v + 1);
  };
  return { accidentRecords, accidentByRacer, accidentRangeLabel, retryAccident };
}

// 選手ごとの出走履歴（getRacerScopedRaceStats）。自社集計が必要なとき・艇を展開したときに取る
export function useScopedStats({
  sortedPlayers,
  raceId,
  expandedBoat,
  needsOwnAggregation,
}) {
  const [scopedStatsByRacer, setScopedStatsByRacer] = useState({});

  const ensureScopedStats = useCallback((racerId) => {
    if (!racerId) return;
    setScopedStatsByRacer((prev) => {
      if (prev[racerId]) return prev;
      getRacerScopedRaceStats(racerId)
        .then((data) => {
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: data }));
        })
        .catch((err) => {
          // withCache()はfetcher()の例外をそのまま伝播するため、ここで
          // catchしないとscopedStatsByRacer[racerId]がundefinedのまま
          // 永久に残り、「直近5走」が「読み込み中...」表示のまま固まって
          // しまう（レビュー指摘#2の調査で発見した潜在バグ）。取得失敗時は
          // 空配列にフォールバックし、「出走履歴データがありません」表示に
          // 倒す（例外を握りつぶさずログには残す）
          console.error("選手出走履歴取得エラー:", err?.message ?? String(err));
          setScopedStatsByRacer((cur) => ({ ...cur, [racerId]: [] }));
        });
      // 取得中はundefinedのまま保持し、二重取得を防ぐ
      return { ...prev, [racerId]: undefined };
    });
  }, []);

  // 自社集計が必要になった瞬間、6選手分の履歴データをまとめて取得する
  useEffect(() => {
    if (!needsOwnAggregation) return;
    sortedPlayers.forEach((p) => ensureScopedStats(p.racerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOwnAggregation, raceId]);

  // 展開中の艇が変わったら、その選手の履歴を取りに行く（withCacheで他タブと
  // 共有されるため、枠別タブが先に取っていれば再フェッチは起きない）。
  // 以前は toggleExpanded の中で呼んでいたが、共有state化（BOA-492）で
  // 枠別・今節タブからも expandedBoat が変わるようになったため、
  // 「押したとき」ではなく「変わったとき」に寄せる
  useEffect(() => {
    if (expandedBoat === null) return;
    ensureScopedStats(
      sortedPlayers.find((p) => p.number === expandedBoat)?.racerId,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedBoat, raceId]);

  return scopedStatsByRacer;
}
