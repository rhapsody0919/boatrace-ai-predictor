/**
 * 記事の中身だけの PR を機械で判定する関門（純粋関数）。
 * fs・git・時計に触れない。入力は全部引数で受ける（集めるのは scripts/content/check-content-pr.js）。
 * 契約: docs/operation/content-pr-contract.md、設定: scripts/content/content-pr-gate.json
 *
 * 実体は4つに分けてある（大きさの関所のため）。ここは公開の名前をまとめて出す入口。
 * - contentPrGateCommon.js: 定数・パスの型・ハッシュ・時刻の形・JPEG の寸法・内部リンクの数え方
 * - contentPrGateText.js: 本文の検査（生 HTML・「競艇」・内部リンク・判断が要る句）
 * - contentPrGateManifest.js: manifest の検査
 * - contentPrGateEvaluate.js: 関門の本体 evaluateContentPr
 */
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
export { evaluateContentPr } from "./contentPrGateEvaluate.js";
