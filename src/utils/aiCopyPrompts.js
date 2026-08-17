/**
 * race-ai-copy機能の分析依頼プロンプト種別定義
 */

export const AI_COPY_PROMPT_TYPES = {
  WIN: "win",
  TRIFECTA: "trifecta",
  TRIO: "trio",
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
};

export function getAiCopyPromptOptions(t) {
  return Object.entries(PROMPT_KEY_MAP).map(([type, { labelKey }]) => ({
    type,
    label: t(labelKey),
  }));
}

export function getAiCopyPromptText(t, promptType) {
  const entry =
    PROMPT_KEY_MAP[promptType] ?? PROMPT_KEY_MAP[AI_COPY_PROMPT_TYPES.WIN];
  return t(entry.promptKey);
}
