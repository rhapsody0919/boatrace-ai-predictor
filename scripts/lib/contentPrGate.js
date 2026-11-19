/**
 * 記事の中身だけの PR を機械で判定する関門（純粋関数）。
 * fs・git・時計に触れない。入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。
 * 契約: docs/operation/content-pr-contract.md、設定: scripts/content/content-pr-gate.json
 *
 * 実体は4つに分けてある（大きさの関所のため）。ここは公開の名前をまとめて出す入口。
 * - contentPrGateCommon.js: 定数・パスの型・ハッシュ・時刻の形・JPEG の寸法・内部リンクの数え方
 * - contentPrGateText.js: 本文の検査（生 HTML・「競艇」・内部リンク・判断が要る句）
 * - contentPrGateManifest.js: manifest の検査
 * - contentPrGateEvaluate.js: 関門の本体（e2e-scope.js の部品はこの入口から渡す。scripts/lib から e2e-scope.js への依存の辺を入口の1本に保つ）
 */
import {
  GATE_CONFIG_PATH,
  grandfatherRemovals,
} from "../maintenance/e2e-scope.js";
import { evaluateContentPrWith } from "./contentPrGateEvaluate.js";

export {
  MANIFEST_SCHEMA,
  REVIEW_ROLES,
  computeContentSha256,
  countInternalLinks,
  readJpegSize,
  sha256Hex,
} from "./contentPrGateCommon.js";
export {
  changedJsonStrings,
  changedMdLines,
  changedMdParagraphs,
  checkInternalLinks,
  checkKyoteiJson,
  checkKyoteiMd,
  checkRawHtml,
  findJudgementPhrases,
  findRateClaims,
  normalizeForJudgement,
  referencedImagePaths,
} from "./contentPrGateText.js";

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
