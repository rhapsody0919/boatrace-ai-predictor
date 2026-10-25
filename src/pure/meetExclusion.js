/**
 * 今節の順位の対象から外す選手と、その理由（途中帰郷・賞典除外）の判定（純関数）。
 *
 * `supabaseDataService.getMeetScoreboard` の中にあった即時関数を、手を加えずに移した
 * （開発効率の計画 段3 の1件目、`docs/design/dev-efficiency/plan.md`）。入力は取得済みの
 * 配列だけで、SQL・キャッシュは持たない。
 *
 * 最初は `src/services/meetExclusion.js` に仮置きし（#1837）、共有の根の守りの verify
 * （verify-pure-imports.js、#1842）が入った後に `src/pure/` へ移した。旧の置き場は再 export を残す。
 *
 * scripts/maintenance/verify-meet-exclusion.js が Node から読むため、import は拡張子付き。
 */

import {
  prelimEndRaceIdOf,
  flyingRacerIdsInMeet,
  lateStartL1RacerIdsInMeet,
  withdrawnByAbsence,
} from "./seriesPoints.js";

/**
 * @param {Object} input
 * @param {boolean} input.usesOfficialSeries 公式の得点率一覧を丸ごと使うか（予選の後、または節ページが決めたとき）
 * @param {Array<{racer_id: number, remarks?: string|null}>|null} input.officialSeries `racer_series_points` の行
 * @param {Array<{race_id: string, race_stage?: string|null}>|null} input.conditions 節の種別の行
 * @param {Array<Object>|null} input.meetStarts 本番STの行（節の頭〜表示中レースの直前）
 * @param {Array<{race_id: string, boat_number: number, racer_id: number}>} input.meetRows 節の出走表（表示日まで）
 * @param {{withdrawnRacerIds?: number[]}|null} input.prelimOfficial `prelimOfficialAdjustments` の値（予選中だけ）
 * @param {string} input.date 表示日（YYYY-MM-DD）
 * @returns {{withdrawnRacerIds: number[], exclusionReasonByRacer: Object<string, "awardExcluded"|"officialWithdrawn"|"flying"|"lateStart"|"withdrawn">}}
 */
export function meetExclusionsOf({
  usesOfficialSeries,
  officialSeries,
  conditions,
  meetStarts,
  meetRows,
  prelimOfficial,
  date,
}) {
  // 公式の備考が取れていればそれが正（推定より確実）。
  // 「賞典除外」「途中帰郷」など、公式が順位を付けていない選手
  // （rank/score_rate が NULL）を除く
  // **予選が終わった後のレースでだけ使う**（得点率の officialByRacer と同じ条件）。
  // 公式の行は節に1行で、取得した時点（予選の最終日の夜）の備考が入る。予選中の
  // 日に使うと、まだ走っている選手を「途中帰郷」で外した（児島G1 10/1 9R の
  // 丸野一樹。PR #1149 ファン評価2周目）
  // 節ページが公式値を使うと決めたとき（useOfficial）もそれに従う
  const official = usesOfficialSeries
    ? (officialSeries ?? []).filter((r) => r.remarks)
    : [];
  if (official.length > 0) {
    return {
      withdrawnRacerIds: official.map((r) => r.racer_id),
      exclusionReasonByRacer: Object.fromEntries(
        official.map((r) => [
          r.racer_id,
          r.remarks.includes("賞典除外")
            ? "awardExcluded"
            : // 公式の備考による途中帰郷。当社の推定と説明を分ける
              "officialWithdrawn",
        ]),
      ),
    };
  }

  // 備考が無い節は推定する。**今節F（表示中のレースより前）は賞典除外**
  // （flyingRacerIdsInMeet のコメント参照、BOA-587）。`meetStarts` は
  // 節の頭〜表示中レースの直前なので、まだ切っていないFは入らない。
  // **予選が終わった後のレースでは、予選終了までのFだけで判定する**。
  // 順位は予選終了で確定しているのに、準優・優勝戦のFで最終日の
  // レースごとに節内順位が動いていた（ファン評価1周目: 桐生9/24で
  // 1〜8Rは47人、9〜12Rは45人）
  // 選手責任の出遅れ（L1）も、F と同じ範囲で賞典除外にする（BOA-1072）。
  const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
  const startsForExclusion = (meetStarts ?? []).filter(
    (r) => !prelimEnd || r.race_id <= prelimEnd,
  );
  const flying = flyingRacerIdsInMeet(startsForExclusion, meetRows);
  const reasons = Object.fromEntries(flying.map((id) => [id, "flying"]));
  for (const id of lateStartL1RacerIdsInMeet(startsForExclusion, meetRows)) {
    if (!reasons[id]) reasons[id] = "lateStart";
  }

  // **途中帰郷**: 前の日まで走っていたのに、表示日に1走も組まれていない選手。
  // 予選中でも予選の後でも、その日から外す（withdrawnByAbsence の実測を参照）。
  // 以前は最終日まで待っていたため、予選中に帰った選手が予選の最終日の
  // 準優の目安の計算に残っていた
  // 予選中は前夜の公式の備考の途中帰郷を先に入れる（BOA-782）。推定より確実で、
  // 推定では表示日にまだ番組が残っている選手を拾えない（三国G1 10/6 の安河内将）
  for (const id of prelimOfficial?.withdrawnRacerIds ?? []) {
    if (!reasons[id]) reasons[id] = "officialWithdrawn";
  }
  for (const id of withdrawnByAbsence(meetRows, date)) {
    if (!reasons[id]) reasons[id] = "withdrawn";
  }
  return {
    withdrawnRacerIds: Object.keys(reasons).map(Number),
    exclusionReasonByRacer: reasons,
  };
}
