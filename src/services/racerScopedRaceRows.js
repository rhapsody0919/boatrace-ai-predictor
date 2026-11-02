/**
 * 選手の走ごとの行（getRacerScopedRaceStats の返り値）の整形（純関数）。
 *
 * `supabaseDataService.getRacerScopedRaceStats` の中で、取得した6つの配列から返り値の行を
 * 組み立てていた部分を、手を加えずに移した（開発効率の計画 段3 の2件目、
 * `docs/design/dev-efficiency/plan.md`、BOA-1022）。入力は取得済みの配列だけで、SQL・
 * キャッシュは持たない。
 *
 * `src/pure/` に置かないのは、依存の `officialMarkOf`・`isAbsentStartRow`
 * （src/components/race/seriesPoints.js）・`deriveRaceStContext`（src/utils/stConsideration.js）・
 * `isUsableRaceResult`（src/utils/raceResultUsable.js）が共有の根の外にあり、根の中から
 * 読めないため（scripts/maintenance/verify-pure-imports.js）。依存が根に入った後に移し直す。
 *
 * scripts/maintenance/verify-racer-scoped-race-rows.js が Node から読むため、import は拡張子付き。
 */

import { deriveRaceStContext } from "../utils/stConsideration.js";
import {
  isAbsentStartRow,
  officialMarkOf,
} from "../components/race/seriesPoints.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";

/**
 * conditionRows が null（race_conditions の取得の失敗）なら waveHeight・seriesDay・
 * isFinalDay は undefined、[]（行が無い）なら null。
 *
 * @param {{ entries: Array<object>, raceRows: Array<object>, resultRows: Array<object>,
 *   startTimingRows: Array<object>, exhibitionRows: Array<object>,
 *   conditionRows: Array<object>|null }} input
 * @returns {Array<object>} raceId の昇順。races の行が無い走と、結果が使えない走
 *   （isUsableRaceResult が偽）は除く
 */
export function buildRacerScopedRaceRows({
  entries,
  raceRows,
  resultRows,
  startTimingRows,
  exhibitionRows,
  conditionRows,
}) {
  const raceById = new Map(raceRows.map((r) => [r.race_id, r]));
  const resultById = new Map(resultRows.map((r) => [r.race_id, r]));
  const startTimingByKey = new Map(
    startTimingRows.map((r) => [`${r.race_id}-${r.boat_number}`, r]),
  );
  // ST考察（FR-1）用: レース単位で全艇分のSTをまとめ、Fを除いた
  // 「ST順1位」「ST順位」「内側艇の最速ST」を求める。生の6艇分の配列は
  // 返り値に出さず、派生値だけを各行に載せる（返り値のサイズを増やさないため。
  // Fの除外規則は src/utils/stConsideration.js に閉じ込める）
  const stRowsByRace = new Map();
  startTimingRows.forEach((r) => {
    if (!stRowsByRace.has(r.race_id)) stRowsByRace.set(r.race_id, []);
    stRowsByRace.get(r.race_id).push(r);
  });
  const stContextByRace = new Map();
  stRowsByRace.forEach((rows, raceId) => {
    stContextByRace.set(
      raceId,
      deriveRaceStContext(rows, resultById.get(raceId)),
    );
  });
  // conditionRows が null＝取得失敗。Mapを作らず、各行の派生値を
  // undefined のままにして「未取得」を下流へ伝える
  const conditionsUnavailable = conditionRows === null;
  const conditionById = new Map(
    (conditionRows ?? []).map((r) => [r.race_id, r]),
  );
  const exhibitionRowsByRace = new Map();
  exhibitionRows.forEach((r) => {
    if (r.exhibition_time === null || r.exhibition_time === undefined)
      return;
    if (!exhibitionRowsByRace.has(r.race_id))
      exhibitionRowsByRace.set(r.race_id, []);
    exhibitionRowsByRace.get(r.race_id).push(r);
  });

  // レースごとに「単独最速だった艇番」を判定する（同着は対象艇なしとしてスキップ、
  // scripts/daily/update-exhibition-time-top-stats.jsと同じ規約）
  const soleFastestBoatByRace = new Map();
  exhibitionRowsByRace.forEach((rows, raceId) => {
    const minTime = Math.min(...rows.map((r) => r.exhibition_time));
    const fastest = rows.filter((r) => r.exhibition_time === minTime);
    if (fastest.length === 1) {
      soleFastestBoatByRace.set(raceId, fastest[0].boat_number);
    }
  });

  return entries
    .map((entry) => {
      const race = raceById.get(entry.race_id);
      const result = resultById.get(entry.race_id);
      if (!race || !isUsableRaceResult(result)) return null;
      const st = startTimingByKey.get(
        `${entry.race_id}-${entry.boat_number}`,
      );
      const hasExhibitionData = exhibitionRowsByRace.has(entry.race_id);
      const soleFastestBoat = soleFastestBoatByRace.get(entry.race_id);
      const condition = conditionById.get(entry.race_id);
      const stContext = stContextByRace.get(entry.race_id);
      const stDerived = stContext?.byBoat.get(entry.boat_number);
      return {
        raceId: entry.race_id,
        date: race.race_date,
        venueCode: race.venue_code,
        boatNumber: entry.boat_number,
        // racesの約76%のみrace_grade取得済み（2026-09-15確認）。
        // 未取得レースはグレードフィルタ「全レース」時のみ集計対象に含める
        raceGrade: race.race_grade ?? null,
        raceTitle: condition?.race_title ?? null,
        raceStage: condition?.race_stage ?? null,
        // 条件別タブ（phase a FR-2）。取得失敗時は undefined のままにして
        // 「未取得」を伝え、欠測（null）と区別する
        waveHeight: conditionsUnavailable
          ? undefined
          : (condition?.wave_height ?? null),
        // 節の何日目か／最終日か。公式サイトの日程タブ由来（BOA-226）で
        // 2026-02-03以降99.0%が埋まっている。race_series（月間スケジュール）
        // とは3,014 venue-dayで100%一致することを実装前に確認済み
        seriesDay: conditionsUnavailable
          ? undefined
          : (condition?.series_day ?? null),
        isFinalDay: conditionsUnavailable
          ? undefined
          : (condition?.is_final_day ?? null),
        rank1: result.rank1,
        rank2: result.rank2,
        rank3: result.rank3,
        rank4: result.rank4 ?? null,
        rank5: result.rank5 ?? null,
        rank6: result.rank6 ?? null,
        // 決まり手・単勝配当（「直近5走」表示用、BOA-333レビュー指摘）。
        // 1着以外では意味を持たないが、判定はRaceHistoryTable側（finishRank
        // ===1の行のみ表示）に委ね、ここでは生値をそのまま渡す
        winningTechnique: result.winning_technique ?? null,
        payoutWin: result.payout_win ?? null,
        // フライング・出遅れは平均ST計算から除外する（RaceResult.jsx等と
        // 同じ扱い）。未計測・未取得レースはnullのまま
        // 欠場（本番STの行の着順が「欠」）。履歴の表で「着外」と区別する（BOA-504）
        // 本番STの行そのものが無い欠場もある（他の艇の行はあるのに自艇だけ無い。
        // 2026-06-13 浜名湖5R・12Rの中岡正彦）。着順が付いた走は表示側が着順を
        // 優先するので、ここで欠場扱いにしても「着順あり」の走は変わらない
        // 着順が付かない走の公式の記号（落・転・妨など）。履歴の表で「着外」と
        // 書かずに記号で出す（BOA-537）
        finishMark: officialMarkOf(st?.finish_mark),
        absent:
          isAbsentStartRow(st) || (!st && stRowsByRace.has(entry.race_id)),
        startTiming:
          st &&
          !st.is_flying &&
          st.is_late_start !== true &&
          st.start_timing != null
            ? st.start_timing
            : null,
        // フライングの走の ST。startTiming（平均・ST考察の母数）には入れず、表に「F.01」と
        // 出すためだけに別に持つ（BOA-583。以前は直近10走・今節の表で「-」だった）
        flyingStartTiming:
          st?.is_flying && st.start_timing != null ? st.start_timing : null,
        // 出遅れの ST は平均から外し、履歴の表に出すためだけに残す（BOA-1052）
        lateStartTiming:
          st?.is_late_start === true && st.start_timing != null
            ? st.start_timing
            : null,
        // 実進入コース（BOA-257）。2025-12-04より前のレースや欠場艇はnull
        actualCourse: result[`actual_course_${entry.boat_number}`] ?? null,
        // 表示用の進入コース（BOA-623）。本番STの進入（当日のうちに入る）を先に、
        // 無ければ Kファイルの actualCourse。actualCourse 自体はコース別の集計に
        // 使っているので変えない（集計の母数が変わる）
        entryCourse:
          st?.entry_course ??
          result[`actual_course_${entry.boat_number}`] ??
          null,
        // 級別（そのレース時点の値）。ST考察のベースラインを(course, grade)で引く
        grade: entry.grade ?? null,
        // 自艇の展示タイム。展示1位判定のために同レース全艇分を既に
        // 取得しているので、そこから拾うだけ（追加クエリ0本）。
        // 今節タブの「展示タイムの推移」（FR-3 Phase A）で使う
        exhibitionTime:
          exhibitionRowsByRace
            .get(entry.race_id)
            ?.find((r) => r.boat_number === entry.boat_number)
            ?.exhibition_time ?? null,
        // 同じレースの中での展示タイム順位（1が最速）。
        // **絶対値の推移は水面の影響を拾う**——桐生の会場平均は
        // 2026-09-20〜25で 6.763〜6.865 と日によって0.10秒動いており、
        // 「+0.03で下向き」のような判定は水面が重い日に全艇へ出てしまう。
        // 同じレース内の順位なら、その日の水面の影響が相殺される
        exhibitionRank: (() => {
          const rows = exhibitionRowsByRace.get(entry.race_id);
          const mine = rows?.find(
            (r) => r.boat_number === entry.boat_number,
          )?.exhibition_time;
          if (!rows || mine === null || mine === undefined) return null;
          // 同着は同順位（1,1,3…）。展示は小数2桁で同着が起きる
          return rows.filter((r) => r.exhibition_time < mine).length + 1;
        })(),
        // そのレース時点の出走表に載っていた今期のF数（phase a FR-2の
        // 「F持ち時」「F無し時」の行）。null の走は母数から落ちる。
        // 充足の内訳（2026-09-25実測）:
        //   2025-12-03〜2026-02-14 … N19（racelist-backfill.js）が夜間に実行中
        //   2026-02-15〜2026-09-20 … **埋める計画が無い**（BOA-417で起票）
        //   2026-09-21〜           … 日次の生取得でほぼ100%
        // K/Bアーカイブからは埋められない（Kファイルは今期F数のような累積を
        // 持たず、レース限りのF/Lフラグだけ。導出を試して完全一致率約5%で
        // 不採用になっている。pre-race-full-fields/plan.md §6.1）
        fCount: entry.f_count ?? null,
        // ST考察（FR-1）の派生値。Fは stForRank を null にし、raceBestSt /
        // innerMinSt / stRank の算出からも外す（符号反転はしない。ADR-0068 却下5）
        isFlying: st?.is_flying === true,
        stForRank: stDerived?.stForRank ?? null,
        raceBestSt: stContext?.raceBestSt ?? null,
        innerMinSt: stDerived?.innerMinSt ?? null,
        stRank: stDerived?.stRank ?? null,
        // 当該レースで自艇の展示タイムが単独最速だったか。同着・データ欠落は
        // nullにし、集計時に分母から除外する（isFastestExhibition===trueの
        // 件数のみで「展示1位だった時の1着率」等を計算する）
        isFastestExhibition: hasExhibitionData
          ? soleFastestBoat !== undefined
            ? soleFastestBoat === entry.boat_number
            : null
          : null,
      };
    })
    .filter(Boolean)
    // race_id（YYYY-MM-DD-VV-RR の固定長）で古い順に並べる。日付だけで
    // 並べると、同じ日の2走が取得順（新しい順）のまま残り、直近10走が
    // 「9/22 9R → 9/22 1R」と日の中だけ逆になっていた（BOA-588）
    .sort((a, b) => a.raceId.localeCompare(b.raceId));
}
