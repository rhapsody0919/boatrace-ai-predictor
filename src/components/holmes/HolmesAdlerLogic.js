export const THEME = "#9333ea";

/**
 * HolmesAdler の純な計算: 無補正 Harville 比の 3連単 logloss 改善率（%）。
 */
export function calcLoglossImprovePct(info) {
  return info.eval?.trifecta_logloss_plain && info.eval?.trifecta_logloss_fitted
    ? ((info.eval.trifecta_logloss_plain - info.eval.trifecta_logloss_fitted) /
        info.eval.trifecta_logloss_plain) *
        100
    : null;
}
