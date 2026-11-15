// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: race）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { stDeviation } from "../utils/stDeviation.js";
import { winnerEntryCourseOf } from "../utils/raceOutcome.js";
import { chunkArray, fetchAllByIn, withCache } from "./core.js";

/**
 * オッズ（race_odds・race_odds_final）のキャッシュTTL。本日以降のレースは、発走前は数分おきに、締切後は締切時オッズが
 * 後から入るため短く（3分）する（既定の30分だと、取得前に開いて得た空の結果が30分固定される）。過去レースは追加取得が
 * 無いため既定（withCache がキーの日付から推定する長いTTL）に任せる
 */
export function raceOddsCacheTtl(raceId) {
  const dateMatch = String(raceId).match(/^(\d{4}-\d{2}-\d{2})-/);
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  return dateMatch && dateMatch[1] < todayJst ? undefined : 3 * 60 * 1000;
}

// Supabaseのデフォルトlimit(1000行)を超えるin()クエリを.range()でページネーションして全件取得する
// （race_id 1件につき最大6艇分の行がある race_start_timings/exhibition_data 等、
// 「in()のキー数 × 1行あたりの行数」が1000を超えうるクエリで使用する）。
// 取得の失敗は、クライアントの .throwOnError() 既定（ADR-0069）で例外になる（途中までの結果を返さない）
/**
 * 展示STの行に、展示のフライング・出遅れの印（exhibition_data.start_flag）を足す（BOA-759）。
 * start_timing は印を外した正の数（F.01→0.01）なので、印が無いと F の艇が一番早く見え、
 * 「最良」の金枠が付いていた
 */
async function attachExhibitionStartFlags(raceId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const { data } = await supabase
    .from("exhibition_data")
    .select("boat_number, start_flag")
    .eq("race_id", raceId);
  const flagByBoat = new Map(
    (data ?? []).map((e) => [e.boat_number, e.start_flag ?? null]),
  );
  return rows.map((row) => ({
    ...row,
    exhibition_start_flag: flagByBoat.get(row.boat_number) ?? null,
  }));
}

/**
 * 終端でない状態（pending・forbidden）の戻り値のひな形。
 *
 * `fetchFailed: true` は withCache に「この結果を保存するな」と伝えるためのもので、
 * 取得自体は成功している（画面は state だけを見る）。保存してしまうと、
 * (1) 公開待ちのレースでコメントが公開されても、再読み込みでキャッシュ（本日分30分・
 *     過去分7日）が返り続けて表示が更新されない、
 * (2) マイグレーション086の適用後も、適用前に見たレースが最大7日間「権限なし＝非表示」
 *     のままになる、という不具合になる。
 */
export const NON_TERMINAL_PIT_REPORT = Object.freeze({
  state: "pending",
  reporterName: null,
  capturedAt: null,
  updatedAt: null,
  targetRange: null,
  comments: [],
  fetchFailed: true,
});

/**
 * 1着の艇と、その艇が実際に入ったコースをレースごとに返す（BOA-708）。
 * 的中判定は艇番で行い、表示だけ「N号艇（Mコース）」と添えるために使う。
 * 進入は race_results.actual_course を優先し、無いレース（当日分）だけ
 * race_start_timings.entry_course で補う。結果が無いレースは返さない。
 * @param {string[]} raceIds
 * @returns {Promise<Record<string, {boat: number, course: number|null}>>}
 */
export async function getRaceWinnerCourses(raceIds) {
    if (!supabase) throw new Error("Supabase client not initialized");
    const ids = [...new Set(raceIds)].filter(Boolean);
    if (ids.length === 0) return {};
    // 的中レース一覧の「全期間」は1500件を超え、.in() 1本では URL が長すぎて 400 になる
    // テーブル名はリテラルで fetchAllByIn に渡す（verify-fetch-all-by-in-order の静的検査）
    const fetchChunked = async (values, fetchChunk) =>
      (await Promise.all(chunkArray(values, 500).map(fetchChunk))).flat();
    const results = await fetchChunked(ids, (chunk) =>
      fetchAllByIn(
        "race_results",
        "race_id, rank1, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
        "race_id",
        chunk,
      ),
    );
    const missing = results
      .filter((r) => r.rank1 != null && r[`actual_course_${r.rank1}`] == null)
      .map((r) => r.race_id);
    const timings =
      missing.length > 0
        ? await fetchChunked(missing, (chunk) =>
            fetchAllByIn(
              "race_start_timings",
              "race_id, boat_number, entry_course",
              "race_id",
              chunk,
            ),
          )
        : [];
    const entryByKey = new Map(
      timings.map((t) => [`${t.race_id}#${t.boat_number}`, t.entry_course]),
    );
    return Object.fromEntries(
      results
        .filter((r) => r.rank1 != null)
        .map((r) => [
          r.race_id,
          {
            boat: r.rank1,
            course: winnerEntryCourseOf(
              r,
              entryByKey.get(`${r.race_id}#${r.rank1}`) ?? null,
            ),
          },
        ]),
    );
  }

/**
 * 指定レースの枠番別・公式集計済み成績（全国/当地の勝率・2連率・3連率）を
 * 取得する（BOA-306、レース詳細ページ「基本情報」タブ）。
 * これらはboatrace.jp側で既に算出済みの「今期」公式値であり、自社で
 * 期間集計をやり直す必要が無い最も正確な値のため、期間フィルタが
 * 「今期」かつグレード条件無し（=全レース）の場合はこの値をそのまま使う。
 * グレード・期間で絞り込む場合は別途getRacerScopedRaceStatsで自社集計する
 */
export function getRaceEntryOfficialRatesBreakdown(raceId) {
    // v2: F数バッジ（phase a T5-3）のために f_count / l_count を足したので版を上げる。
    // **v2 は raceId より前に置く**。後ろに付けると inferTtlFromKey の
    // 「末尾がYYYY-MM-DD-VV-RR」パターンにマッチしなくなり、過去レースの
    // 7日TTLが30分に落ちる
    return withCache(`race-entry-official-rates-v2-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data } = await supabase
        .from("race_entries")
        .select(
          "boat_number, win_rate, local_win_rate, global_2rate, local_2rate, global_3rate, local_3rate, f_count, l_count",
        )
        .eq("race_id", raceId)
        .order("boat_number");

      return data ?? [];
    });
  }

/**
 * 指定レースの枠番別・選手の勝率上昇/下降を取得する（BOA-152）
 * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す
 */
export function getRaceRacerFormBreakdown(raceId) {
    return withCache(`race-racer-form-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data: current } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id, win_rate, local_win_rate")
        .eq("race_id", raceId)
        .order("boat_number");

      if (!current || current.length === 0) {
        return [];
      }

      const racerIds = [...new Set(current.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) return current;

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, win_rate")
        .in("racer_id", racerIds)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false });

      // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
      const pastByRacer = new Map();
      (past ?? []).forEach((row) => {
        if (!pastByRacer.has(row.racer_id)) {
          pastByRacer.set(row.racer_id, row.win_rate);
        }
      });

      return current.map((row) => {
        const pastWinRate = pastByRacer.get(row.racer_id) ?? null;
        return {
          ...row,
          past_win_rate: pastWinRate,
          delta: pastWinRate !== null ? row.win_rate - pastWinRate : null,
        };
      });
    });
  }

// 当日の展示STだけを付け、過去のズレは無い形（出走履歴が無いときの返り値）
function withoutDeviation(entries, exhibitionByBoat) {
  return entries.map((row) => ({
    ...row,
    exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
    avg_deviation: null,
    sample_count: 0,
  }));
}

// 過去の出走ごとに |本番ST - 展示ST| を選手別に集める
async function collectDeviationsByRacer(pastEntries, pastRaceIds) {
  // race_id 1件につき最大6艇分の行があるため、in()のキー数だけでなく取得行数も
  // 1000行を超えうる。chunkArrayだけでは不十分なため.range()ページネーションで全件取得する
  const [actualRows, exhibitionRows] = await Promise.all([
    fetchAllByIn(
      "race_start_timings",
      "race_id, boat_number, start_timing, is_flying",
      "race_id",
      pastRaceIds,
    ),
    fetchAllByIn(
      "exhibition_data",
      "race_id, boat_number, start_timing",
      "race_id",
      pastRaceIds,
    ),
  ]);

  const actualByKey = new Map();
  actualRows.forEach((r) => {
    if (r.is_flying) return; // フライングは異常値のためズレ計算から除外
    actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
  });

  const exhibitionByKey = new Map();
  exhibitionRows.forEach((e) => {
    exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
  });

  // 選手ごとに過去の |本番ST - 展示ST| を集計
  const deviationsByRacer = new Map();
  (pastEntries ?? []).forEach((e) => {
    const key = `${e.race_id}-${e.boat_number}`;
    const actual = actualByKey.get(key);
    const exhibition = exhibitionByKey.get(key);
    // 欠場艇の行（ST が NULL）・展示STの無い走は比べない（stDeviation が null）
    const deviation = stDeviation(actual, exhibition);
    if (deviation === null) return;
    if (!deviationsByRacer.has(e.racer_id)) {
      deviationsByRacer.set(e.racer_id, []);
    }
    deviationsByRacer.get(e.racer_id).push(deviation);
  });
  return deviationsByRacer;
}

// 旧クライアント集計（RPC 未適用環境のフォールバック）
async function computeStPredictabilityClientSide(raceId) {
  const { data: entries } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, racer_id")
    .eq("race_id", raceId)
    .order("boat_number");

  if (!entries || entries.length === 0) {
    return [];
  }

  const { data: todaysExhibition } = await supabase
    .from("exhibition_data")
    .select("boat_number, start_timing")
    .eq("race_id", raceId);
  const exhibitionByBoat = new Map(
    (todaysExhibition ?? []).map((e) => [e.boat_number, e.start_timing]),
  );

  const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
    (id) => id !== null,
  );
  if (racerIds.length === 0) {
    return withoutDeviation(entries, exhibitionByBoat);
  }

  // 過去90日、当該レースより前の出走を選手ごとに収集
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

  const { data: pastEntries } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, racer_id")
    .in("racer_id", racerIds)
    .gte("race_id", cutoffStr)
    .lt("race_id", raceId);

  const pastRaceIds = [...new Set((pastEntries ?? []).map((e) => e.race_id))];

  if (pastRaceIds.length === 0) {
    return withoutDeviation(entries, exhibitionByBoat);
  }

  const deviationsByRacer = await collectDeviationsByRacer(
    pastEntries,
    pastRaceIds,
  );

  return entries.map((row) => {
    const deviations = deviationsByRacer.get(row.racer_id) ?? [];
    const avgDeviation =
      deviations.length > 0
        ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length
        : null;
    return {
      ...row,
      exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
      avg_deviation: avgDeviation,
      sample_count: deviations.length,
    };
  });
}

async function fetchStPredictabilityRows(raceId) {
  if (!supabase) {
    console.error("Supabase client not initialized");
    return [];
  }

  // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
  // 未適用環境では旧クライアント集計にフォールバックする
  const { data: rpcData } = await supabase.rpc("get_race_st_predictability", {
    p_race_id: raceId,
  });
  if (Array.isArray(rpcData)) {
    return rpcData;
  }
  return computeStPredictabilityClientSide(raceId);
}

/**
 * 指定レースの枠番別・展示ST/本番STのズレ（安定度）を取得する（BOA-153）
 * 展示STが本番の参考になるか（ズレが小さいほど安定）を選手ごとの過去実績から示す
 */
export function getRaceStPredictabilityBreakdown(raceId) {
  // 印を足した形をキャッシュする（印の無い旧い形と混ざらないよう、キーを変えた）
  return withCache(`race-st-predictability-v2-${raceId}`, async () =>
    attachExhibitionStartFlags(raceId, await fetchStPredictabilityRows(raceId)),
  );
}
