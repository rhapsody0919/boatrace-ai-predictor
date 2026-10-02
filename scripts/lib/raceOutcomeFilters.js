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
