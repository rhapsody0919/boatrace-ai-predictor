/**
 * race-ai-copy機能の分析依頼プロンプト種別定義
 */
import { getVolatilityLevel } from "./volatilityLevel";

export const AI_COPY_PROMPT_TYPES = {
  WIN: "win",
  TRIFECTA: "trifecta",
  TRIO: "trio",
  VOLATILITY_TRIFECTA: "volatilityTrifecta",
};

const PROMPT_KEY_MAP = {
  [AI_COPY_PROMPT_TYPES.WIN]: {
    promptKey: "aiCopy.promptWin",
    labelKey: "aiCopy.promptSelectorWin",
  },
  [AI_COPY_PROMPT_TYPES.TRIFECTA]: {
    promptKey: "aiCopy.promptTrifecta",
    labelKey: "aiCopy.promptSelectorTrifecta",
  },
  [AI_COPY_PROMPT_TYPES.TRIO]: {
    promptKey: "aiCopy.promptTrio",
    labelKey: "aiCopy.promptSelectorTrio",
  },
  [AI_COPY_PROMPT_TYPES.VOLATILITY_TRIFECTA]: {
    promptKey: "aiCopy.promptVolatilityTrifecta",
    labelKey: "aiCopy.promptSelectorVolatilityTrifecta",
  },
};

/**
 * @param {function} t - i18nの翻訳関数
 * @param {{volatilityPercentile?: number|null}} [options]
 * @returns {{type:string, label:string}[]}
 *
 * volatilityTrifecta（イン崩れ狙い）は、実際にイン崩れ注意度が高い
 * （getVolatilityLevel === 'high'、他のイン崩れ表示と同じ閾値）レースでしか
 * 前提が成立しないため、該当しないレースでは選択肢自体を出さない
 * （堅いレースで「1号艇が崩れる前提」のプロンプトを出すのは実態と矛盾するため）
 */
export function getAiCopyPromptOptions(t, { volatilityPercentile } = {}) {
  const isVolatile = getVolatilityLevel(volatilityPercentile) === "high";
  return Object.entries(PROMPT_KEY_MAP)
    .filter(
      ([type]) =>
        type !== AI_COPY_PROMPT_TYPES.VOLATILITY_TRIFECTA || isVolatile,
    )
    .map(([type, { labelKey }]) => ({
      type,
      label: t(labelKey),
    }));
}

export function getAiCopyPromptText(t, promptType) {
  const entry =
    PROMPT_KEY_MAP[promptType] ?? PROMPT_KEY_MAP[AI_COPY_PROMPT_TYPES.WIN];
  return t(entry.promptKey);
}
