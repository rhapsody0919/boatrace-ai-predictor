import { useEffect, useState } from "react";
import { summarizeFrontTaking } from "../utils/frontTaking";
import { getRacerScopedRaceStats } from "../services/racerQueries2.js";
import {
  getRacerPageData,
  getRacerStats,
  getRacerCurrentMotorStatus,
  getRacerAllPeriodStats,
} from "../services/racerService";
import { errorMessageOf } from "../utils/errorMessage.js";
import { NOT_FOUND_PAGE_DATA } from "./RacerProfileMeta.js";

export function useRacerPageData(racerId, validId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    // 失敗したら1回だけ取り直す。Googlebot の描画で取得が落ちると、全選手が同じ「失敗の画面」になり
    // 1ページの重複として扱われた（Search Console の URL 検査 10/25、/racer/4760 に76件）
    const load = validId
      ? getRacerPageData(racerId).catch(() => getRacerPageData(racerId))
      : Promise.resolve(NOT_FOUND_PAGE_DATA);
    load
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("選手ページの取得エラー:", errorMessageOf(err));
        setError(errorMessageOf(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId]);
  return { data, loading, error };
}

// 成績・調子セクションはprofile/grade/newsとは別経路で取得し、
// タイトル・メタ情報の表示（SEO・E2E双方に影響）をブロックしないようにする
export function useRacerStats(racerId, validId) {
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (validId ? getRacerStats(racerId) : Promise.resolve(null))
      .then((result) => {
        if (cancelled) return;
        setStats(result);
        setStatsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("選手成績データ取得エラー:", err.message);
        setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId]);
  return { stats, statsLoading };
}

export function useRacerMotor(racerId, validId) {
  const [motorLoad, setMotorLoad] = useState(null);
  useEffect(() => {
    // 取得結果を racerId と一緒に持ち、選手切替時は前選手の値を表示しない。
    let cancelled = false;
    (validId ? getRacerCurrentMotorStatus(racerId) : Promise.resolve(null))
      .then((result) => {
        if (cancelled) return;
        setMotorLoad({ racerId, state: result ? "done" : "empty", status: result });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("今節のモーター状況取得エラー:", err.message);
        setMotorLoad({ racerId, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId]);
  const motorState = motorLoad?.racerId === racerId ? motorLoad.state : "loading";
  const motorStatus = motorLoad?.racerId === racerId ? motorLoad.status : null;
  return { motorState, motorStatus };
}

// 公式の期別成績（GS00）。取得結果と失敗を racerId つきで持ち、別の選手の値を混ぜない
export function useRacerPeriodStats(racerId, validId) {
  const [periodStats, setPeriodStats] = useState(null);
  const [periodStatsFailedId, setPeriodStatsFailedId] = useState(null);
  const [periodStatsRetry, setPeriodStatsRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (validId ? getRacerAllPeriodStats(racerId) : Promise.resolve([]))
      .then((rows) => {
        if (cancelled) return;
        setPeriodStats({ racerId, rows });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("公式の期別成績の取得エラー:", err.message);
        setPeriodStatsFailedId(racerId);
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId, periodStatsRetry]);
  const periodRows =
    periodStats?.racerId === racerId ? periodStats.rows : null;
  const periodFailed = periodStatsFailedId === racerId && !periodRows;
  const retryPeriod = () => {
    setPeriodStatsFailedId(null);
    setPeriodStatsRetry((n) => n + 1);
  };
  return { periodRows, periodFailed, retryPeriod };
}

// 前付けの傾向（BOA-1422）。既存の getRacerScopedRaceStats（新しいクエリは無い）を racerId つきで持つ
export function useRacerFrontTaking(racerId, validId) {
  const [frontTakingLoad, setFrontTakingLoad] = useState(null);
  const [frontTakingRetry, setFrontTakingRetry] = useState(0);
  useEffect(() => {
    if (!validId) return undefined;
    let cancelled = false;
    getRacerScopedRaceStats(racerId)
      .then((records) => {
        if (cancelled) return;
        setFrontTakingLoad({ racerId, summary: summarizeFrontTaking(records) });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("前付けの傾向の取得エラー:", errorMessageOf(err));
        setFrontTakingLoad({ racerId, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [racerId, validId, frontTakingRetry]);
  const frontTaking =
    frontTakingLoad?.racerId === racerId && !frontTakingLoad.failed
      ? frontTakingLoad.summary
      : null;
  const frontTakingFailed =
    frontTakingLoad?.racerId === racerId && frontTakingLoad.failed === true;
  const retryFrontTaking = () => {
    setFrontTakingLoad(null);
    setFrontTakingRetry((n) => n + 1);
  };
  return { frontTaking, frontTakingFailed, retryFrontTaking };
}
