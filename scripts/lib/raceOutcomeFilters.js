/**
 * 不成立（race_status='no_race'）のレースを集計から外すための共通の部品（BOA-545）。
 *
 * 旧フラグ race_results.is_no_race は全行 false で機能していない（マイグレーション078）。不成立は race_status で判定し、
 * NULL（078以前・未判定）は今までどおり通常のレースとして扱う（078 の「race_status IS DISTINCT FROM 'no_race'」）。
 * 判定は src/utils/raceOutcome.js（画面・的中判定と共有）を使う。
 */
import {
  RACE_OUTCOME,
  getRaceOutcomeState,
} from "../../src/utils/raceOutcome.js";

/** PostgREST の .or() に渡す条件: race_status が no_race でない（NULL を含む） */
export const NOT_NO_RACE_FILTER = "race_status.is.null,race_status.neq.no_race";

/** race_results の行（race_status を持つ）が不成立か */
export function isNoRaceResult(result) {
  return getRaceOutcomeState(result) === RACE_OUTCOME.NO_RACE;
}

/**
 * 1〜3着の艇番から、返還艇（refund_boats）を除いたもの（BOA-579）。
 *
 * 完走が3艇未満のレースでは、rank1〜3 の NOT NULL 制約と既存の読み手のため、取り込みが表の行順（非完走艇を含む）で
 * rank を埋める（scripts/lib/raceResultRows.js）。区別は race_status と refund_boats で行う。2着・3着を数える集計は、
 * この関数を通して返還艇の位置を「その着順の艇なし」（null）として扱う。完走した艇の着順は詰めない（公式の着順のまま）。
 * @param {{rank1?: number|null, rank2?: number|null, rank3?: number|null, refund_boats?: number[]|null}} result
 * @returns {{rank1: number|null, rank2: number|null, rank3: number|null}}
 */
export function placedRanks(result) {
  const refunded = new Set(result?.refund_boats ?? []);
  const keep = (boat) => (boat == null || refunded.has(boat) ? null : boat);
  return {
    rank1: keep(result?.rank1),
    rank2: keep(result?.rank2),
    rank3: keep(result?.rank3),
  };
}
