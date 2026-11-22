// 領域: racer。レースの頁の「イン屋」の札（前付けの割合）の読み

import { supabase } from "./supabaseClient";
import { withCache } from "./core.js";
import { getRacerScopedRaceStats } from "./racerQueries2.js";
import { fetchRacerFrontTakingCountsOrNull } from "./racerQueries4.js";
import {
  frontTakingOfCounts,
  summarizeFrontTaking,
} from "../utils/frontTaking.js";
import { racerHistoryCutoff } from "../utils/racerVenueBoatStats.js";
import { buildRacerTodayRuns } from "../pure/racerTodayRuns.js";

// 1表の読み。失敗は throw（「データなし」にしない）
async function selectByRaceIds(table, columns, raceIds) {
  const { data, error } = await supabase.from(table).select(columns).in("race_id", raceIds);
  if (error) throw new Error(`${table} の取得に失敗: ${error.message}`);
  return data ?? [];
}

/**
 * 選手の JST の今日（today、YYYY-MM-DD）の出走（BOA-1691 R2）。1日の走は十数行までで1000行の切りに当たらない。
 * 今節のモーターの取得（getRacerCurrentMotorStatus）は直近1走の会場・モーターから節の走を引く別の形で、重ねない
 * @returns {Promise<ReturnType<typeof buildRacerTodayRuns>>} race_id の昇順の行。走が無ければ []
 */
export async function getRacerTodayRuns(racerId, today) {
  if (!supabase) throw new Error("Supabase client not initialized");
  const { data: entries, error } = await supabase
    .from("race_entries").select("race_id, boat_number").eq("racer_id", racerId).like("race_id", `${today}-%`);
  if (error) throw new Error(`race_entries の取得に失敗: ${error.message}`);
  if (!entries?.length) return [];
  const ids = entries.map((e) => e.race_id);
  const ranks = [1, 2, 3, 4, 5, 6].map((n) => `rank${n}`).join(", ");
  const [races, results, conditions] = await Promise.all([
    selectByRaceIds("races", "race_id, start_time", ids),
    selectByRaceIds("race_results", `race_id, ${ranks}, race_status, refund_boats`, ids),
    selectByRaceIds("race_conditions", "race_id, series_day", ids),
  ]);
  return buildRacerTodayRuns({ today, entries, races, results, conditions });
}

// 203 が本番に当たるまでの読み: 選手ごとの全走（getRacerScopedRaceStats）から数える。
// 1人の取得の失敗は、その選手だけ外す（札なし。今までの札と同じ）
async function frontTakingFromScopedRuns(racerIds, beforeRaceId) {
  const settled = await Promise.allSettled(
    racerIds.map((racerId) => getRacerScopedRaceStats(racerId)),
  );
  const byRacer = {};
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error("前付けの傾向の取得エラー:", result.reason?.message);
      return;
    }
    const { runs, taken } = summarizeFrontTaking(result.value, {
      beforeRaceId,
    });
    byRacer[String(racerIds[i])] = frontTakingOfCounts(runs, taken);
  });
  return byRacer;
}

/**
 * 出走の選手それぞれの、表示中のレースより前の走での前付けの件数・割合・「イン屋」の判定。
 *
 * DB 側で数えた件数だけを受け取る（マイグレーション 203 の RPC。1頁で6行・要求1本）。以前は、この札のためだけに
 * 6選手の全走を6表の生の行で読んでいて（1頁で約2万行・要求 約50本）、頁を開いただけで走るので
 * Supabase の Egress・Log Ingestion の主因になっていた（2026-11-19）。
 * 窓（730日）・数え方・下限は今までと同じ（src/utils/frontTaking.js）。
 *
 * @param {Array<string|number>} racerIds 登録番号
 * @param {string} beforeRaceId 表示中のレース（これより前の走だけを数える）
 * @returns {Promise<Record<string, {runs: number, taken: number, rate: number|null, isInya: boolean}>>}
 *   登録番号 → 判定。取得に失敗した選手（203 が当たるまでの読みのときだけ）は入らない
 */
export async function getRaceFrontTakingByRacer(racerIds, beforeRaceId) {
  if (!supabase) {
    console.error("Supabase client not initialized");
    return {};
  }
  const ids = racerIds.map(String);
  // キャッシュに持つのは DB 側で数えた件数だけ（203 が当たるまでの読みは、選手ごとの全走のキャッシュに任せる）。
  // キーは race_id で終えない（終えると過去のレースは7日持つ。実進入コースは翌日に入る走があるので30分のまま）
  const counts = await withCache(
    `race-front-taking-v1-${beforeRaceId}|${ids.join(",")}`,
    () =>
      fetchRacerFrontTakingCountsOrNull(
        ids.map(Number),
        racerHistoryCutoff(),
        beforeRaceId,
      ),
  );
  if (counts === null) return frontTakingFromScopedRuns(racerIds, beforeRaceId);
  const byId = new Map(counts.map((row) => [String(row.racer_id), row]));
  return Object.fromEntries(
    ids.map((id) => [
      id,
      frontTakingOfCounts(byId.get(id)?.runs ?? 0, byId.get(id)?.taken ?? 0),
    ]),
  );
}
