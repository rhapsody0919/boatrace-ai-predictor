import { useEffect, useMemo, useRef, useState } from "react";
import { aggregateRacerCrossStats } from "../services/core.js";
import {
  getRacerRaceHistory,
  getRacerScopedRaceStats,
} from "../services/racerQueries2.js";
import {
  buildMeetResults,
  getRecentRaces,
} from "../components/race/basicInfoStats";
import { finishedRuns, meetAnchorOf, statLineOf } from "../pure/favoriteRuns";

/** 同時に成績・今節を取る選手の数 */
const CONCURRENCY = 3;

/**
 * トップの区画「お気に入り選手の出走」の各行の、成績の一言と今節の着順（GS04-7、BOA-1273）。
 *
 * - 取るのは区画が画面に入ってから（visible が真になってから）、行にいる選手（重複なし）だけ
 * - 成績の一言は選手ページの枠番別成績と同じ取り方・計算（RacerPerformanceStats の historyCourseStats:
 *   getRacerRaceHistory を aggregateRacerCrossStats(rows, {}, "boat", null, null) で数え、その号艇の行）
 * - 今節はレース詳細の今節タブと同じ（RaceMeetTab: getRacerScopedRaceStats を buildMeetResults で切り、
 *   getRecentRaces で着順の欄にする）
 * - 取得の失敗は console.error に出し、その選手だけ error にする（ほかの選手は出す）
 *
 * @param {Array<{racerId: number, raceId: string, venueCode: number, boat: number}>} rows
 * @param {boolean} visible
 * @returns {(row: object) => {loading: boolean, error: boolean, stat: object|null, meet: object[]|null}}
 */
export function useFavoriteRunStats(rows, visible) {
  const racerIds = useMemo(
    () => [...new Set(rows.map((row) => row.racerId))],
    [rows],
  );
  const racerKey = racerIds.join(",");
  // racerId → {status: "loading"|"ready"|"failed", history, records}
  const [byRacer, setByRacer] = useState({});

  // 取り始めた選手（同じ選手を2回取らない。行が増えたときは増えた選手だけ取る）
  const started = useRef(new Set());

  useEffect(() => {
    if (!visible || racerKey === "") return;
    const targets = racerKey
      .split(",")
      .map(Number)
      .filter((id) => !started.current.has(id));
    if (targets.length === 0) return;
    for (const id of targets) started.current.add(id);
    setByRacer((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = { status: "loading" };
      return next;
    });
    // 同時に取るのは CONCURRENCY 人まで（1人で2本の2年分の読み。☆は30人まで入るので、
    // トップを開いた瞬間に数十本を並べて DB に負荷をかけない）
    const queue = [...targets];
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        try {
          const [history, records] = await Promise.all([
            getRacerRaceHistory(id),
            getRacerScopedRaceStats(id),
          ]);
          setByRacer((prev) => ({
            ...prev,
            [id]: { status: "ready", history, records },
          }));
        } catch (error) {
          console.error(
            `お気に入り選手の出走: 選手 ${id} の成績・今節の取得に失敗した`,
            error,
          );
          setByRacer((prev) => ({ ...prev, [id]: { status: "failed" } }));
        }
      }
    };
    for (let i = 0; i < Math.min(CONCURRENCY, targets.length); i += 1) worker();
  }, [visible, racerKey]);

  // 号艇別の行（選手ごとに1回だけ数える）
  const statsByRacer = useMemo(() => {
    const result = {};
    for (const [id, state] of Object.entries(byRacer)) {
      if (state.status !== "ready") continue;
      result[id] = new Map(
        aggregateRacerCrossStats(
          state.history ?? [],
          {},
          "boat",
          null,
          null,
        ).map((row) => [row.key, row]),
      );
    }
    return result;
  }, [byRacer]);

  // 行ごとの欄（分の時計で描き直すたびに今節を切り直さない）
  const infoByRow = useMemo(() => {
    const result = new Map();
    for (const row of rows) {
      const state = byRacer[row.racerId];
      let info;
      if (!state || state.status === "loading")
        info = { loading: true, error: false, stat: null, meet: null };
      else if (state.status === "failed")
        info = { loading: false, error: true, stat: null, meet: null };
      else {
        // 目印はその日のその会場の最後より後ろ。締切後の行もそのレースの着を含める
        const meet = buildMeetResults(state.records ?? [], {
          raceId: meetAnchorOf(row.raceId),
          venueCode: row.venueCode,
        });
        info = {
          loading: false,
          error: false,
          stat: statLineOf(statsByRacer[row.racerId]?.get(row.boat)),
          meet: finishedRuns(getRecentRaces(meet, meet.length)),
        };
      }
      result.set(`${row.raceId}|${row.racerId}`, info);
    }
    return result;
  }, [rows, byRacer, statsByRacer]);

  return (row) =>
    infoByRow.get(`${row.raceId}|${row.racerId}`) ?? {
      loading: true,
      error: false,
      stat: null,
      meet: null,
    };
}
