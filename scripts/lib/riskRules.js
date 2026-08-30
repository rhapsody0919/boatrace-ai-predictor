/**
 * SNSマーケティングハブ Phase 2用 risk-rules.json 決定的照合ユーティリティ
 *
 * sns-video-studio/remotion/risk-rules.jsonのpatternsはすべて単純な文字列パターンのため、
 * LLM推論を挟まず部分一致で判定する（ADR 0028、docs/adr/0028-sns-hub-insight-risk-check-method.md）。
 * insightのproposed→active昇格判定（scripts/maintenance/promote-strategy-insights.js）から利用する。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RISK_RULES_PATH = path.join(
  __dirname,
  "../../sns-video-studio/remotion/risk-rules.json",
);

let cachedRules = null;

function loadRiskRules() {
  if (cachedRules) return cachedRules;
  let raw;
  try {
    raw = fs.readFileSync(RISK_RULES_PATH, "utf-8");
  } catch (err) {
    throw new Error(
      `risk-rules.jsonの読み込みに失敗しました(${RISK_RULES_PATH}): ${err.message}`,
    );
  }
  try {
    cachedRules = JSON.parse(raw).rules;
  } catch (err) {
    throw new Error(`risk-rules.jsonのパースに失敗しました: ${err.message}`);
  }
  return cachedRules;
}

function ruleAppliesToPlatform(rule, platform) {
  if (rule.platforms === "all") return true;
  // platform未指定（insightがscope=null=全プラットフォーム対象）の場合は、
  // どのプラットフォームで使われるか分からないため保守的に全ルールを適用する
  if (!platform) return true;
  return Array.isArray(rule.platforms) && rule.platforms.includes(platform);
}

/**
 * テキストがrisk-rules.jsonのいずれかのパターンに抵触するか判定する。
 * @param {string} text - 照合対象のテキスト（insight_text等）
 * @param {string} [platform] - 'x' | 'tiktok' | 'youtube' 等。省略時は全ルールを保守的に適用
 * @returns {Array<{id: string, category: string, description: string, matchedPattern: string}>} 抵触したルール一覧（空配列=抵触なし）
 */
export function checkRiskRules(text, platform) {
  const rules = loadRiskRules();
  const violations = [];
  for (const rule of rules) {
    if (!ruleAppliesToPlatform(rule, platform)) continue;
    const matchedPattern = rule.patterns.find((p) => text.includes(p));
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
