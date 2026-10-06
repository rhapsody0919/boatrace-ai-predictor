/**
 * 節ページ（/venue/:venueCode/meet/:startDate、BOA-682）の純関数。
 *
 * 得点率・順位・ボーダー・必要得点の計算は今節タブと同じ `seriesPoints.js` を使い、
 * ここでは書き直さない。ここにあるのは「節ページだけが要る判断」:
 * どの日が節か・いまどの段階か・どのレースを基準に数えるか・勝ち上がり・勝負駆け。
 *
 * 設計: docs/design/meet-page/plan.md §2
 * 検証: scripts/maintenance/verify-meet-page-model.js
 */
import { findMeetStartDate } from "./meetGrouping.js";
import {
  normalizeStage,
  pointsNeededForBorder,
  SCORE_POINTS,
} from "../components/race/seriesPoints.js";
import { finishPositionOf } from "../components/race/basicInfoStats.js";

/** 節ページの対象グレード */
export const MEET_PAGE_GRADES = ["SG", "G1", "G2"];

/**
 * 予選最終日の `series_day`。2025-12〜2026-09 の通常の SG/G1/G2 の節では
 * 予選最終日が4日目・準優が5日目だった（design-reviewer 指摘1の対応、spec FR-1.4）
 */
export const PRELIM_FINAL_SERIES_DAY = 4;

/**
 * 通常の得点率の節ではない開催（spec FR-1.8）。グランプリはトライアルとシリーズが
 * 同居して優勝戦が2本、クイーンズクライマックスは予選の種別に「予選」が付かない、
 * トーナメントは準優が無い。混ぜて順位・ボーダーを出すと誤った案内になる
 */
const OUT_OF_SCOPE_TITLE = /グランプリ|クイーンズクライマックス|トーナメント/;

export function isOutOfScopeMeetTitle(title) {
  if (!title) return false;
  return OUT_OF_SCOPE_TITLE.test(String(title).normalize("NFKC"));
}

const dateOf = (raceId) => String(raceId).slice(0, 10);

/**
 * 日ごとの `series_day`（その日の最小値。最終レースだけ null のことがある）と
 * 最終日の印をまとめる。
 *
 * @param {Array<{race_id: string, series_day?: number|null, is_final_day?: boolean|null}>} conditions
 * @returns {Map<string, {seriesDay: number|null, isFinalDay: boolean}>}
 */
export function seriesDayByDate(conditions) {
  const map = new Map();
  for (const c of conditions ?? []) {
    const d = dateOf(c.race_id);
    const cur = map.get(d) ?? { seriesDay: null, isFinalDay: false };
    if (
      c.series_day != null &&
      (cur.seriesDay == null || c.series_day < cur.seriesDay)
    )
      cur.seriesDay = c.series_day;
    if (c.is_final_day) cur.isFinalDay = true;
    map.set(d, cur);
  }
  return map;
}

/**
 * 節に属する日（昇順）。境目の判定は `findMeetStartDate` に任せる
 * （前日が最終日・`series_day` の巻き戻り・2日以上の空き）。
 *
 * URL の初日が節の途中の日だと、窓の先頭がその日になるので初日として通ってしまう。
 * その日の `series_day` が1より大きければ節の初日ではないので空を返す。
 *
 * @param {string} startDate URL の初日 YYYY-MM-DD
 * @param {Array<{race_id: string}>} conditions 窓（初日〜+7日）の種別
 * @param {Array<{race_id: string}>} entries 窓の出走表
 * @returns {string[]}
 */
export function meetDaysOf(startDate, conditions, entries) {
  const byDate = seriesDayByDate(conditions);
  const startDay = byDate.get(startDate)?.seriesDay ?? null;
  if (startDay != null && startDay > 1) return [];
  const dates = [
    ...new Set([
      ...(conditions ?? []).map((c) => dateOf(c.race_id)),
      ...(entries ?? []).map((e) => dateOf(e.race_id)),
    ]),
  ]
    .filter((d) => d >= startDate)
    .sort();
  const days = dates.map((d) => ({
    date: d,
    seriesDay: byDate.get(d)?.seriesDay ?? null,
    isFinalDay: byDate.has(d) ? byDate.get(d).isFinalDay : null,
  }));
  return dates.filter((d) => findMeetStartDate(days, d) === startDate);
}

const isSemifinalStage = (stage) => normalizeStage(stage).includes("準優勝戦");
const isFinalStage = (stage) => {
  const s = normalizeStage(stage);
  return s.includes("優勝戦") && !s.includes("準優");
};

/**
 * 節ページの状態（spec FR-1.1・FR-1.6・FR-1.8、plan §2.3）。
 *
 * @param {Object} p
 * @param {string} p.today JST の今日 YYYY-MM-DD
 * @param {string} p.startDate URL の初日
 * @param {string[]} p.meetDays `meetDaysOf` の値
 * @param {boolean} p.hasEntries 節の日に出走表があるか
 * @param {boolean} [p.windowHasRaces] 窓（初日〜+7日）に出走表か種別が1行でもあるか。
 *   あるのに節の日が無い＝URL の初日が節の途中の日なので、今日に関係なく「見つからない」
 * @param {string|null} p.grade 節のグレード（`race_series.grade`、無ければレースの `race_grade`）
 * @param {string|null} p.title 節タイトル
 * @param {Array<{race_id: string, race_stage?: string|null}>} p.conditions 節の日の種別
 * @param {Set<string>} p.doneRaceIds 結果がある、または中止が確定したレース
 * @param {string[]} p.raceIds 節の日の全レース（出走表または種別にあるもの）
 * @returns {"preOpen"|"notFound"|"outOfScope"|"prelim"|"prelimFinalDay"|"prelimDone"|"semifinalDay"|"finalDay"|"finished"}
 */
export function meetPageState({
  today,
  startDate,
  meetDays,
  hasEntries,
  grade,
  title,
  conditions,
  doneRaceIds,
  raceIds,
  windowHasRaces = false,
}) {
  if (meetDays.length === 0 && windowHasRaces) return "notFound";
  if (!hasEntries || meetDays.length === 0) {
    return today <= startDate ? "preOpen" : "notFound";
  }
  if (isOutOfScopeMeetTitle(title)) return "outOfScope";
  if (!MEET_PAGE_GRADES.includes(grade)) return "outOfScope";

  const pastDays = meetDays.filter((d) => d <= today);
  if (pastDays.length === 0) return "preOpen";
  const day = pastDays[pastDays.length - 1];
  const stagesOf = (d) =>
    (conditions ?? [])
      .filter((c) => dateOf(c.race_id) === d)
      .map((c) => c.race_stage);
  const finalRaces = (conditions ?? []).filter((c) =>
    isFinalStage(c.race_stage),
  );
  if (
    finalRaces.length > 0 &&
    finalRaces.every((c) => doneRaceIds.has(c.race_id))
  )
    return "finished";
  const stages = stagesOf(day);
  if (stages.some(isFinalStage)) return "finalDay";
  if (stages.some(isSemifinalStage)) return "semifinalDay";
  const seriesDay = seriesDayByDate(conditions).get(day)?.seriesDay ?? null;
  if (seriesDay != null && seriesDay >= PRELIM_FINAL_SERIES_DAY) {
    const dayRaces = raceIds.filter((id) => dateOf(id) === day);
    const allDone =
      dayRaces.length > 0 && dayRaces.every((id) => doneRaceIds.has(id));
    return allDone ? "prelimDone" : "prelimFinalDay";
  }
  return "prelim";
}

/**
 * 公式の得点率一覧（`racer_series_points`）の取得時刻から、それが何日の終了時点の表かを
 * 出す（JST の日付）。取得ジョブは 22:00 JST と、補足の 23:30・翌 01:30 JST に走る
 * （vercel.json）。翌 01:30 の取得は前日の表なので、6時間戻してから日付を取る。
 *
 * @param {string|null} scrapedAt ISO 文字列
 * @returns {string|null} YYYY-MM-DD
 */
export function officialAsOfDate(scrapedAt) {
  if (!scrapedAt) return null;
  const t = new Date(scrapedAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + (9 - 6) * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * `getMeetScoreboard` に渡す基準のレース（plan §2.4）。
 *
 * **予選中で公式の得点率一覧があるとき**（`officialAsOf`。ユーザー決定 2026-10-06）:
 * 公式の表（前夜の時点）をそのまま出す。自社計算は減点・途中帰郷の備考を持たず、
 * 三国G1 10/6 に白井英治（公式14位・減点10）を2位と出した（ファン評価1周目 P0）。
 * - 基準は「表の時点の翌日の最初のレース」。それより前（表の時点まで）を済んだ走、
 *   以後を残りの走として数える。予選最終日はその日の予選の全レースが「残り」になり、
 *   公式の得点率早見が朝に出す「◯日目終了時点」と同じ考え方になる
 * - 翌日の出走表がまだ無ければ、表の時点の日の架空ID `{日付}-{会場}-99`
 * - 当日の結果は夜の取得まで反映しない（代わりに画面に「◯日目終了時点（公式）」と書く）
 *
 * **それ以外**（予選後・公式の表が無い節）:
 * - 今日が節の日で、まだ済んでいないレースがある → その最初のレース（昼間）
 * - それ以外 → 今日以前で最後の節の日 D の架空ID `{D}-{会場}-99`。D の全レースを
 *   済みとして扱う。実在の「最後のレース」を基準にすると `race_id < 基準` で
 *   そのレースの結果が落ちる
 * - 架空IDのときは種別が無く、予選最終日の夜に公式の得点率一覧が使われない
 *   （`countsForSeriesScore(null, …)` が真）。D が予選最終日以降なら `useOfficial`
 *   で公式値を使わせる
 *
 * @param {Object} p
 * @param {string|null} [p.officialAsOf] 公式の表の時点（`officialAsOfDate`）。予選中の
 *   状態で、公式の表があるときだけ渡す
 * @returns {{raceId: string, useOfficial: boolean|undefined}|null}
 */
export function pickMeetAnchor({
  today,
  meetDays,
  raceIds,
  doneRaceIds,
  venueCode,
  conditions,
  officialAsOf = null,
}) {
  const vv = String(venueCode).padStart(2, "0");
  // 表の時点が今日より後（時計を戻して開いたとき等）の表は、まだ存在しないはずの値なので使わない
  if (officialAsOf && officialAsOf <= today) {
    // 表の時点が節の日でなければ（取得の日付の推定が外れた等）、節の日の中で直前の日に寄せる
    const asOf = meetDays.filter((d) => d <= officialAsOf).pop();
    if (asOf) {
      const nextDay = meetDays.find((d) => d > asOf && d <= today);
      const first = nextDay
        ? [...raceIds].filter((id) => dateOf(id) === nextDay).sort()[0]
        : null;
      return {
        raceId: first ?? `${asOf}-${vv}-99`,
        useOfficial: true,
      };
    }
  }
  if (meetDays.includes(today)) {
    const next = [...raceIds]
      .filter((id) => dateOf(id) === today && !doneRaceIds.has(id))
      .sort()[0];
    if (next) return { raceId: next, useOfficial: undefined };
  }
  const past = meetDays.filter((d) => d <= today);
  if (past.length === 0) return null;
  const day = past[past.length - 1];
  const seriesDay = seriesDayByDate(conditions).get(day)?.seriesDay ?? null;
  return {
    raceId: `${day}-${vv}-99`,
    useOfficial: seriesDay != null && seriesDay >= PRELIM_FINAL_SERIES_DAY,
  };
}

/**
 * 勝ち上がり（準優勝戦・優勝戦の番組と着順、spec FR-1.5）。番組が正で、
 * 予選の順位との一致は見ない。
 *
 * @param {Array<{race_id: string, race_stage?: string|null}>} conditions
 * @param {Array<{race_id: string, boat_number: number, racer_id: number|null, player_name: string|null}>} entries
 * @param {Array<{race_id: string}>} results race_results の行（rank1〜6）
 */
export function buildQualifiers(conditions, entries, results) {
  const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
  const toRace = (c) => {
    const result = resultById.get(c.race_id) ?? null;
    return {
      raceId: c.race_id,
      raceNumber: Number(c.race_id.slice(-2)),
      date: dateOf(c.race_id),
      boats: (entries ?? [])
        .filter((e) => e.race_id === c.race_id)
        .sort((a, b) => a.boat_number - b.boat_number)
        .map((e) => ({
          boatNumber: e.boat_number,
          racerId: e.racer_id,
          playerName: e.player_name,
          finish: result
            ? finishPositionOf({ ...result, boatNumber: e.boat_number })
            : null,
        })),
      hasResult: Boolean(result),
    };
  };
  const sorted = [...(conditions ?? [])].sort((a, b) =>
    a.race_id.localeCompare(b.race_id),
  );
  return {
    semifinals: sorted
      .filter((c) => isSemifinalStage(c.race_stage))
      .map(toRace),
    finals: sorted.filter((c) => isFinalStage(c.race_stage)).map(toRace),
  };
}

/**
 * 勝負駆けの選手（予選最終日だけ、spec FR-1.4・plan §2.6）。
 *
 * - 枠外: 今日の残りを全部1着でボーダーの得点率に届く
 * - 枠内: 今日の残りを全部6着にするとボーダーの得点率を下回る
 *
 * ボーダーは「今の `slots` 位の得点率」（今節タブと同じ推定）。最低点は6着の1点で
 * 数える（予選最終日の番組は通常の配点）。
 *
 * @param {Array<{racerId: number, rank: number|null, points: number, runs: number, rate: number, withdrawn?: boolean}>} ranking `buildMeetRanking` の値
 * @param {number|null} border ボーダーの得点率
 * @param {number} slots 準優の枠数
 * @param {Object<number, number>} remainingRuns 今日の残り予選走数
 * @param {Object<number, number>} remainingMax 今日の残りの最大点
 * @returns {Set<number>} racerId
 */
export function pickShobugake(
  ranking,
  border,
  slots,
  remainingRuns,
  remainingMax,
) {
  const picked = new Set();
  if (border == null) return picked;
  for (const r of ranking ?? []) {
    if (r.rank == null || r.withdrawn) continue;
    const remaining = remainingRuns?.[r.racerId] ?? 0;
    if (remaining <= 0) continue;
    if (r.rank <= slots) {
      const worst =
        (r.points + SCORE_POINTS[6] * remaining) / (r.runs + remaining);
      if (worst < border) picked.add(r.racerId);
    } else {
      const need = pointsNeededForBorder(
        r,
        border,
        remaining,
        remainingMax?.[r.racerId] ?? null,
      );
      if (need?.reachable) picked.add(r.racerId);
    }
  }
  return picked;
}
