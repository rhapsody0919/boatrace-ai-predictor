/**
 * 決まり手ユーティリティ（フロントエンド用）
 * アニメーションコンポーネントで使用
 */

// 英語キー→日本語マッピング
export const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};

/**
 * 展開予測が的中したレースで、「当たった候補」として見せるパターンを選ぶ。
 * 1着の艇の候補のうち、確率が一番高いもの（AI予想タブでその艇の行に出ている候補）を返す。
 *
 * 以前（PR #1197）は、実際の決まり手と同じ候補があればそちらを選んでいた。決まり手の食い違いを
 * 見せないためだったが、AIの本命が「逃げ 46%」なのに「抜き 11%」と出て、本命の%が2番手より
 * 低く見えるレースがあった（BOA-724 ファン評価3周目）。決まり手の食い違いは「（実際: 抜き）」で
 * 示すので（techniqueDiffers）、候補はAIが実際に一番に推した形のまま出す
 *
 * @param {Array<{winnerCourse: number, technique: string, probability: number}>} patterns 確率の高い順
 * @param {number} winner 1着の艇番
 * @returns {object|null}
 */
export function pickHitPattern(patterns, winner) {
  return (patterns ?? []).find((p) => p.winnerCourse === winner) ?? null;
}

/**
 * 予想した決まり手と実際の決まり手が、どちらも分かっていて食い違うか（BOA-724）。
 * 的中カードの「（実際: 差し）」と共有文の「、実際: 差し」で同じ判定を使う
 *
 * @param {string|null|undefined} predictedTechnique 日本語の決まり手名
 * @param {string|null|undefined} actualTechnique 日本語の決まり手名
 * @returns {boolean}
 */
export function techniqueDiffers(predictedTechnique, actualTechnique) {
  return (
    predictedTechnique != null &&
    actualTechnique != null &&
    predictedTechnique !== actualTechnique
  );
}

/**
 * 的中したレースが「予想どおりの展開」だったか（BOA-724）。
 *
 * 的中の判定は1着の艇だけを見る（判定と公開している的中率は変えない）。そのため、決まり手が
 * 外れていても、前付けで艇番と違うコースから勝っても「的中」になる。そうしたレースで
 * 「予想通りの展開でした」と言うと事実と違う（例: 「1号艇が2コースから1着（AIの予想: 逃げ）」）。
 * 決まり手が予想と同じで、かつ進入コースが艇番と違わないときだけ true にする。
 * 実際の決まり手が分からないときも、予想どおりとは言えないので false
 *
 * @param {object} p
 * @param {string|null|undefined} p.predictedTechnique 当たった候補の決まり手（日本語）
 * @param {string|null|undefined} p.actualTechnique 実際の決まり手（日本語）
 * @param {number|null|undefined} p.winnerBoat 1着の艇番
 * @param {number|null|undefined} p.winnerEntryCourse 1着の艇の進入コース（不明なら null）
 * @param {boolean} [p.isTopPick=true] 当たった候補が1番手（本命）か。2番手以下が当たっても
 *   「予想通り」とは言わない（本命は外れているため。BOA-724 の A-2 を (b) に）
 * @returns {boolean}
 */
export function isAsPredicted({
  predictedTechnique,
  actualTechnique,
  winnerBoat,
  winnerEntryCourse,
  isTopPick = true,
}) {
  if (!isTopPick) return false;
  if (winnerEntryCourse != null && winnerEntryCourse !== winnerBoat) {
    return false;
  }
  return (
    predictedTechnique != null &&
    actualTechnique != null &&
    predictedTechnique === actualTechnique
  );
}
