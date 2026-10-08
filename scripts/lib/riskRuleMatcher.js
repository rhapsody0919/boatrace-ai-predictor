/** SNSリスクルールの部分一致判定（Node・Edge共通の純粋関数）。 */

/**
 * ルール順・patternsの最初の一致を維持する。platform未指定時は全ルールを適用。
 * @param {string} text 照合対象
 * @param {string} platform 対象プラットフォーム（省略可）
 * @param {Array<object>} rules 読み込み済みルール
 * @returns {Array<{id: string, category: string, description: string, matchedPattern: string}>} 検出結果
 */
export function matchRiskRules(text, platform, rules) {
  // 照合対象だけを正規化し、登録patternと返却値・順序は維持する。
  const normalized = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s/gu, "");
  const violations = [];
  for (const rule of rules) {
    if (
      rule.platforms !== "all" &&
      platform &&
      !(Array.isArray(rule.platforms) && rule.platforms.includes(platform))
    ) continue;
    // 明示された賞金成績文だけを除外。他の箇所の稼ぐ等は警告する。
    const target = rule.id === "gambling-incitement"
      ? normalized.replace(/賞金を稼(?:ぐ|いだ)選手/gu, "賞金の選手")
      : normalized;
    const matchedPattern = rule.patterns.find((p) => target.includes(p));
    if (matchedPattern) {
      violations.push({
        id: rule.id,
        category: rule.category,
        description: rule.description,
        matchedPattern,
      });
    }
  }
  return violations;
}
