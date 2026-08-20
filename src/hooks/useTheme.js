// ライト/ダークテーマの現在値・切替を扱うフック（ADR 0016）
// 実際に現在値の表示・切替UIが必要なコンポーネント（ThemeToggle等）のみが使用する。
// 他のコンポーネントはCSS変数（design-tokens.css）の自動反映に任せ、このフックを購読する必要はない。

import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribe } from "../utils/theme";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme);
  return [theme, setTheme];
}
