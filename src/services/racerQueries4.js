// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: racer）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import {
  periodsEndedBefore,
  RECENT_PERIOD_COUNT,
} from "../components/race/basicInfoStats.js";
import { currentPeriodRange } from "../utils/accidentRate.js";
import { isPermissionDeniedError, withCache } from "./core.js";

/**
 * 選手の「前期」の期別成績を取得する（phase a FR-4c、マイグレーション095）。
 *
 * `racer_period_stats` は公式の期別成績ファイル（fan）由来で、期ごとに
 * 1選手1行。**集計はしない**——取得した値をそのまま表示する。
 *
 * ## as-of で引く（最新期で決め打ちしない）
 *
 * 083_racer_period_stats.sql:218-219 のCOMMENTどおり「レース日 > `calc_to` の
 * 最新の期」を使う。最新期で決め打ちすると、過去日のレースを開いたときに
 * **そのレースより未来の成績**を「前期」として出してしまう（2026-01-15の
 * レースに、算出期間が2026-04-30までの期を出すことになる）。
 *
 * 期の境界は 5/1 と 11/1（`period_no` 1 = 5/1〜10/31、2 = 11/1〜4/30、
 * `period_year` は算出期間の終了が4月の年）。クライアントで計算できるので、
 * 前期を含む直近4期（優出・優勝の直近2年の合計、BOA-326）だけを返す
 * （絞らないと1選手あたり約15期分が返る）。前期の行の選び出しは
 * `pickPeriodStats` が行う。
 *
 * ## 単位に注意
 *
 * `win_rate` は**公式勝率（点、実測1.07〜8.24）**で、自社集計の1着率（%）とは
 * 別物。同じ列に並べてはいけない（画面では別枠の固定3値として出す）。
 * `top3_rate` に相当する列は無い。
 *
 * 095未適用の環境では権限エラーになるので、呼び出し側は「枠ごと出さない」に
 * 倒す（getStCourseBaseline と同じ扱い）。
 *
 * @param {Array<number>} racerIds 登録番号
 * @param {string} raceDate `YYYY-MM-DD`。この日より前に終わった期を引く
 * @returns {Promise<{rows: Array<Object>, latestImported: boolean}|{state: "forbidden", rows: [], fetchFailed: true}>}
 *   rows は直近5期分。latestImported は前期の行が表に1行でもあるか（false なら前々期を出す）
 */
export function getRacerPeriodStats(racerIds, raceDate) {
    const ids = [...new Set((racerIds ?? []).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    if (ids.length === 0 || !raceDate)
      return Promise.resolve({ rows: [], latestImported: true });

    // 「前期」と、直近2年（前期を含む4期）の優出・優勝の合計に使う期（BOA-326）。
    // 前期を取り込む前（期替わり直後）は前々期で終わる4期を使うので、1期多く取る。
    // 期の求め方は periodsEndedBefore のコメント参照
    const periods = periodsEndedBefore(raceDate, RECENT_PERIOD_COUNT + 1);
    if (periods.length === 0)
      return Promise.resolve({ rows: [], latestImported: true });
    const years = [...new Set(periods.map((p) => p.periodYear))].sort();
    const [latest] = periods;

    return withCache(
      `racer-period-stats-v3-${latest.periodYear}-${latest.periodNo}-${ids.join(",")}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        try {
          // 5期は最大4つの period_year にまたがる。年で絞って取り、範囲外の期は落とす（6人×最大8行）
          const { data } = await supabase
            .from("racer_period_stats")
            .select(
              "racer_id, period_year, period_no, calc_from, calc_to, win_rate, top2_rate, avg_st, starts, finals, wins",
            )
            .in("period_year", years)
            .in("racer_id", ids);
          // 前期を「期として」取り込んだか。選手ごとの欠け（長期休場で fan に載らない等）では判定しない。
          // 公式の fan は期の終わりから15〜60日遅れて公開されるため、11/1・5/1 からしばらくは0行になる
          const { data: latestRows } = await supabase
            .from("racer_period_stats")
            .select("racer_id")
            .eq("period_year", latest.periodYear)
            .eq("period_no", latest.periodNo)
            .limit(1);
          return {
            rows: (data ?? []).filter((r) =>
              periods.some(
                (p) =>
                  r.period_year === p.periodYear && r.period_no === p.periodNo,
              ),
            ),
            latestImported: (latestRows ?? []).length > 0,
          };
        } catch (error) {
          if (isPermissionDeniedError(error)) {
            // 095（匿名へのSELECT公開）が未適用の間はここを通る
            return { state: "forbidden", rows: [], fetchFailed: true };
          }
          throw error;
        }
      },
    );
  }

/**
 * 選手の今期の事故率（目安）の元データ（BOA-327、マイグレーション126の RPC get_racer_accident_records）。
 * 選手ごとに出走回数と事故の走（F・L1・K1・S1・S2）だけを返す。点数の計算は src/utils/accidentRate.js。
 *
 * 期間は今期の初日から、表示中のレースの前日まで（過去のレースはそのレース時点の値になる）。
 * RPC が未適用（関数が無い）ときは {state: "unavailable"} を返し、画面は目印も欄も出さない
 * （取得の失敗とは区別する。失敗は例外で上に流す）。
 *
 * @param {Array<number>} racerIds 登録番号
 * @param {string} raceDate `YYYY-MM-DD`
 * @returns {Promise<{rows: Array<{racer_id: number, starts: number, incidents: Array}>, range: {from: string, to: string}}|{state: "unavailable", rows: [], fetchFailed: true}>}
 */
export function getRacerAccidentRecords(racerIds, raceDate) {
    const ids = [...new Set((racerIds ?? []).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    const range = raceDate ? currentPeriodRange(raceDate) : null;
    if (ids.length === 0 || !range) return Promise.resolve({ rows: [], range });
    return withCache(
      `racer-accident-records-v1-${range.from}-${range.to}-${ids.join(",")}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        try {
          const { data } = await supabase.rpc("get_racer_accident_records", {
            p_racer_ids: ids,
            p_from: range.from,
            p_to: range.to,
          });
          return { rows: data ?? [], range };
        } catch (error) {
          // 126 が未適用（関数が無い）: PostgREST は PGRST202、PostgreSQL は 42883
          if (
            error?.code === "PGRST202" ||
            error?.code === "42883" ||
            isPermissionDeniedError(error)
          ) {
            return { state: "unavailable", rows: [], fetchFailed: true };
          }
          throw error;
        }
      },
    );
  }
