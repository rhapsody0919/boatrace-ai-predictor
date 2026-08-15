/**
 * カラーユーティリティ
 * アプリケーション全体で使用する色関連の定数と関数
 */

/**
 * 回収率に基づく色を取得
 * @param {number} rate - 回収率 (1.0 = 100%)
 * @returns {string} カラーコード
 */
export const getRecoveryColor = (rate) => {
  if (rate >= 1.0) return "#10b981"; // green - 100%以上（利益）
  if (rate >= 0.9) return "#f59e0b"; // yellow - 90%以上（ほぼ収支均衡）
  return "#ef4444"; // red - 90%未満（損失）
};

/**
 * モデル別カラーテーマ
 */
export const MODEL_COLORS = {
  standard: {
    primary: "#0ea5e9",
    secondary: "#0284c7",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    shadow: "rgba(14, 165, 233, 0.3)",
    light: "#e0f2fe",
  },
  safeBet: {
    primary: "#4caf50",
    secondary: "#2e7d32",
    gradient: "linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)",
    shadow: "rgba(76, 175, 80, 0.3)",
    light: "#e8f5e9",
  },
  upsetFocus: {
    primary: "#ff9800",
    secondary: "#f57c00",
    gradient: "linear-gradient(135deg, #ff9800 0%, #f57c00 100%)",
    shadow: "rgba(255, 152, 0, 0.3)",
    light: "#fff3e0",
  },
};

/**
 * 艇番別カラー（公式カラー）
 */
export const BOAT_COLORS = {
  1: { bg: "#ffffff", text: "#000000", name: "白" },
  2: { bg: "#000000", text: "#ffffff", name: "黒" },
  3: { bg: "#e53935", text: "#ffffff", name: "赤" },
  4: { bg: "#1e88e5", text: "#ffffff", name: "青" },
  5: { bg: "#fdd835", text: "#000000", name: "黄" },
  6: { bg: "#43a047", text: "#ffffff", name: "緑" },
};

/**
 * 的中/外れバッジカラー
 */
export const HIT_COLORS = {
  hit: "#10b981", // green
  miss: "#ef4444", // red
};

/**
 * 共通カラー定数
 */
export const COLORS = {
  primary: "#0ea5e9",
  secondary: "#64748b",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  dark: "#1e293b",
  light: "#f8fafc",
  border: "#e2e8f0",
};
