// 龍神レーダーのライト/ダークテーマ設定（ADR 0016）
// LANGUAGE_STORAGE_KEY（src/config/languages.js）と同じ置き場所の思想

export const THEME_STORAGE_KEY = "ryujin-radar-theme";

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};

// ダークテーマは基盤（トークン・状態管理・ThemeToggle）は実装済みだが、
// App.css配下の広範な未トークン化領域（ブログプレビュー・レース一覧カード等）で
// 白背景が浮いて見える不具合が残っているため一般公開を見送っている（BOA-206）。
// BOA-206解消後にtrueへ変更してThemeToggleを表示する。
export const THEME_SWITCHING_ENABLED = false;
