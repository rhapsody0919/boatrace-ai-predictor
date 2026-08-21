// 龍神レーダーのライト/ダークテーマ設定（ADR 0016）
// LANGUAGE_STORAGE_KEY（src/config/languages.js）と同じ置き場所の思想

export const THEME_STORAGE_KEY = "ryujin-radar-theme";

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};

// BOA-206でApp.css/RaceDetail.css/About.css/AccuracyDashboard.css等の未トークン化領域を
// 解消し、ThemeToggleを再有効化した（2026-08-21）。
export const THEME_SWITCHING_ENABLED = true;
