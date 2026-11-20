/**
 * 記事の中身だけの PR の関門の本体を、e2e-scope.js の部品つきで出す入口側の包み（純粋関数）。
 * e2e-scope.js は Node の組み込み以外を import しない決まり（.github/workflows/e2e-smoke-test.yml が
 * base 側の1本を git show で取り出して単独で動かす）ので scripts/lib へ下ろせない。
 * scripts/lib から入口（scripts/maintenance）を読まないよう（lib-no-entry）、包みを入口側のここに置く。
 * 使うのは scripts/content/check-content-pr.js と scripts/maintenance/verify-content-pr-gate.js
 */
import {
  GATE_CONFIG_PATH,
  grandfatherRemovals,
} from "../maintenance/e2e-scope.js";
import { evaluateContentPrWith } from "../lib/contentPrGateEvaluate.js";

/**
 * 関門の本体（contentPrGateEvaluate.js の evaluateContentPrWith）に、e2e-scope.js の設定のパスと免除の一覧の差の判定を渡す。
 * 入力と戻り値は contentPrGateEvaluate.js の説明のとおり
 */
export function evaluateContentPr(input) {
  return evaluateContentPrWith(input, {
    gatePath: GATE_CONFIG_PATH,
    grandfatherRemovals,
  });
}
