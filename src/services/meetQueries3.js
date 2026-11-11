// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: meet）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { seriesDayByDate } from "../utils/meetGrouping";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import {
  meetDaysOf,
  meetPageState,
  pickMeetAnchor,
  buildQualifiers,
  officialAsOfDate,
} from "../utils/meetPageModel.js";
import { getMeetScoreboard } from "./meetQueries2.js";

/**
 * 節ページ（`/venue/:venueCode/meet/:startDate`、BOA-682）のデータ。
 *
 * 節の日程・段階・基準のレースは `meetPageModel.js` の純関数で決め、得点率・順位・
 * ボーダー・残り走数は今節タブと同じ `getMeetScoreboard` に任せる（計算を書き直さない）。
 *
 * 窓（初日〜+7日）の種別・グレード・結果・出走表は**キャッシュしない**。結果と出走表は
 * 1日の中で増えるので、キャッシュすると基準のレースや勝ち上がりの着順が古いまま残る
 * （design-reviewer 指摘3）。各96行以下で、既定の1000行上限に当たらない。
 * `getMeetScoreboard` は基準のレース単位でキャッシュされる。
 *
 * 設計: docs/design/meet-page/plan.md §2
 *
 * @param {number} venueCode
 * @param {string} startDate 節の初日 YYYY-MM-DD（URL の値）
 * @param {string} today JST の今日 YYYY-MM-DD
 */
export async function getMeetPage(venueCode, startDate, today) {
    if (!supabase) throw new Error("Supabase client not initialized");
    const vv = String(venueCode).padStart(2, "0");
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const windowEnd = end.toISOString().slice(0, 10);
    const inWindow = (q) =>
      q
        .gte("race_id", startDate)
        .lte("race_id", `${windowEnd}-zz`)
        .like("race_id", `__________-${vv}-__`);

    const [seriesRes, condRes, racesRes, resultsRes, entriesRes, officialRes] =
      await Promise.all([
        supabase
          .from("race_series")
          .select("start_date, end_date, title, grade")
          .eq("venue_code", venueCode)
          .eq("start_date", startDate)
          .maybeSingle(),
        inWindow(
          supabase
            .from("race_conditions")
            .select(
              "race_id, race_stage, series_day, is_final_day, race_title",
            ),
        ),
        inWindow(
          supabase
            .from("races")
            .select("race_id, race_grade, cancellation_status"),
        ),
        inWindow(
          supabase
            .from("race_results")
            .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6"),
        ),
        inWindow(
          supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name"),
        ),
        // 公式の得点率一覧の取得時刻（予選中は公式の前夜時点の表を出す。plan §2.4）
        supabase
          .from("racer_series_points")
          .select("scraped_at")
          .eq("venue_code", venueCode)
          .eq("meet_start_date", startDate)
          .order("scraped_at", { ascending: false })
          .limit(1),
      ]);
    const series = seriesRes.data ?? null;
    const windowConditions = condRes.data ?? [];
    const windowEntries = entriesRes.data ?? [];
    const meetDays = meetDaysOf(startDate, windowConditions, windowEntries);
    const inMeet = (r) => meetDays.includes(r.race_id.slice(0, 10));
    const conditions = windowConditions.filter(inMeet);
    const entries = windowEntries.filter(inMeet);
    const races = (racesRes.data ?? []).filter(inMeet);
    const results = (resultsRes.data ?? []).filter(inMeet);
    const resultById = new Map(results.map((r) => [r.race_id, r]));

    const raceIds = [
      ...new Set([
        ...conditions.map((c) => c.race_id),
        ...entries.map((e) => e.race_id),
      ]),
    ].sort();
    // 済んだレース: 結果がある、または中止が確定した（判定は isRaceCancelled に集めてある）
    const doneRaceIds = new Set([
      ...results.map((r) => r.race_id),
      ...races
        .filter((r) =>
          isRaceCancelled({
            cancellationStatus: r.cancellation_status,
            result: resultById.get(r.race_id) ?? null,
          }),
        )
        .map((r) => r.race_id),
    ]);
    const grade =
      series?.grade ?? races.find((r) => r.race_grade)?.race_grade ?? null;
    const title =
      series?.title ?? conditions.find((c) => c.race_title)?.race_title ?? null;
    const endDate =
      series?.end_date ??
      conditions.find((c) => c.is_final_day)?.race_id.slice(0, 10) ??
      meetDays[meetDays.length - 1] ??
      null;

    const state = meetPageState({
      today,
      startDate,
      meetDays,
      hasEntries: entries.length > 0,
      // 節の日が空でも指定日のグレードは失わない。翌日以降の別の節は使わない。
      startDateGrade:
        (racesRes.data ?? []).find(
          (r) => r.race_id.startsWith(`${startDate}-`) && r.race_grade,
        )?.race_grade ?? null,
      grade,
      title,
      conditions,
      doneRaceIds,
      raceIds,
      // 窓の先頭が初日の日付と同じ日のレースだけを見る（翌日以降に別の節があるだけでは
      // 「見つからない」にしない。開幕前の節の窓に、同じ会場の前の節の最終日は入らない）
      windowHasRaces: [...windowConditions, ...windowEntries].some((r) =>
        r.race_id.startsWith(startDate),
      ),
    });
    const base = {
      state,
      venueCode,
      startDate,
      endDate,
      title,
      grade,
      meetDays,
      // race_series に無く出走表も無い節は、存在するか分からない（未来日の任意の URL）
      knownMeet: Boolean(series) || entries.length > 0,
      seriesDayToday: seriesDayByDate(conditions).get(today)?.seriesDay ?? null,
    };
    if (["preOpen", "notFound", "outOfScope"].includes(state)) {
      return { ...base, board: null, qualifiers: null };
    }

    // 予選中で公式の表があれば、その時点（前夜）の表をそのまま出す（ユーザー決定
    // 2026-10-06）。自社計算は減点・途中帰郷の備考を持たない（ファン評価1周目 P0・P1）
    const officialAsOf = ["prelim", "prelimFinalDay"].includes(state)
      ? officialAsOfDate(officialRes.data?.[0]?.scraped_at ?? null)
      : null;
    const anchor = pickMeetAnchor({
      today,
      meetDays,
      raceIds,
      doneRaceIds,
      venueCode,
      conditions,
      officialAsOf,
    });
    const board = anchor
      ? await getMeetScoreboard(anchor.raceId, venueCode, {
          useOfficial: anchor.useOfficial,
        })
      : null;
    // 窓の先頭を初日とみなすので、URL の初日が節の途中だと別の節と食い違う
    if (!board || board.meetStart !== startDate) {
      return { ...base, state: "notFound", board: null, qualifiers: null };
    }
    // 画面に「◯日目終了時点（公式）」と書くための日目。公式の値で出しているときだけ
    const officialAsOfDay =
      officialAsOf && anchor?.useOfficial
        ? (seriesDayByDate(conditions).get(
            meetDays.filter((d) => d <= officialAsOf).pop(),
          )?.seriesDay ?? null)
        : null;
    return {
      ...base,
      board,
      officialAsOfDay,
      // 表が今日の終了時点（その日の夜の取得後）か。画面の「今日の結果は22時ごろ反映」を
      // 出し分ける（反映済みなのに「まだ」と読めた。ファン評価3周目）
      officialAsOfIsToday:
        officialAsOfDay != null &&
        meetDays.filter((d) => d <= officialAsOf).pop() === today,
      qualifiers: buildQualifiers(conditions, entries, results),
    };
  }
