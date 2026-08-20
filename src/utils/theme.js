// テーマ状態の読み書き・永続化・購読（ADR 0016）
// React Contextは使わず、src/i18n.jsと同じ思想の軽量な自前実装にする。
// 未選択時（localStorage未設定）はnullを返し、design-tokens.cssの
// prefers-color-schemeフォールバックに委ねる（テーマはページ内容を
// 変えないため、言語判定と異なりOS設定追従で問題ない）。

import { THEME_STORAGE_KEY, THEMES } from "../config/theme";

const listeners = new Set();

function readStoredTheme() {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === THEMES.LIGHT || value === THEMES.DARK ? value : null;
}

function applyTheme(theme) {
  if (theme) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// モジュール読み込み時にも適用しておく（index.htmlのインラインスクリプトと合わせた二重防御）
if (typeof document !== "undefined") {
  applyTheme(readStoredTheme());
}

export function getTheme() {
  return readStoredTheme();
}

export function setTheme(theme) {
  if (theme === null) {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
  applyTheme(theme);
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
