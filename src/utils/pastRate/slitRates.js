/**
 * スリット7形の全国の出現率（%、小数1桁）。BOA-635 の形の一覧に添える（spec FR-1）。
 * 出典: docs/design/past-rate-check/analysis/slit-pattern-rates.md の全期間の値（T0-2）
 */
export const SLIT_RATE_SOURCE = { from: "2019-04", to: "2026-09", races: 398587 };

export const SLIT_RATES = {
  1: { flat: 14.2, wall: 15.1, d2: 8.9, d3: 6.3, kado: 14.9, d1: 12.1, dash: 15.2 },
  2: { flat: 14.2, wall: 15.1, d2: 3.6, d3: 2.9, kado: 8.0, d1: 5.4, dash: 6.7 },
};
