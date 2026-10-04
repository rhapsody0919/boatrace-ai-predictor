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
 *
 * 的中の判定は1着の艇だけを見る（決まり手は見ない）。同じ艇の候補が複数あるとき（例: 2号艇の
 * まくり 9% と 差し 7%）、先頭の候補を選ぶと、実際の決まり手（差し）と違う決まり手を出してしまう。
 * 的中の15〜20%で、カード・共有文の決まり手が公式の結果と食い違っていた（PR #1197 ファン評価3周目）。
 * 実際の決まり手と同じ候補があればそれを、無ければ同じ艇の最初の候補を返す
 *
 * @param {Array<{winnerCourse: number, technique: string, probability: number}>} patterns
 * @param {number} winner 1着の艇番
 * @param {string|null|undefined} winningTechnique 実際の決まり手（日本語。例: "差し"）
 * @returns {object|null}
 */
export function pickHitPattern(patterns, winner, winningTechnique) {
  const sameBoat = (patterns ?? []).filter((p) => p.winnerCourse === winner);
  const exact = sameBoat.find(
    (p) => TECHNIQUE_NAMES[p.technique] === winningTechnique,
  );
  return exact ?? sameBoat[0] ?? null;
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
