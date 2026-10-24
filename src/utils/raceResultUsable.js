import { getRaceOutcomeState, RACE_OUTCOME } from "./raceOutcome.js";

// race_resultsの1行が集計対象として使えるか（不成立・未確定を除外）。
// 不成立は race_results.race_status='no_race'（078）で判定する。旧フラグ is_cancelled・is_no_race は
// どのスクリプトからも書かれておらず（常に false）、除外が効いていなかった（BOA-477）。
// race_status が NULL の行は、078 の方針どおり通常として通す（raceOutcome.js の UNKNOWN）。
// 中止（races.cancellation_status）のレースは結果の行が無いか rank1 が無いため、rank1 で外れる
export function isUsableRaceResult(result) {
  return !!result && !isNoRaceResult(result) && result.rank1 !== null;
}

// 不成立（race_status='no_race'）か。返還（partial_refund）は着順が有効なので含めない
export function isNoRaceResult(result) {
  return getRaceOutcomeState(result) === RACE_OUTCOME.NO_RACE;
}
