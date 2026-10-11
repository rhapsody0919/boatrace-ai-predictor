import { createContext } from "react";

/**
 * シートを開く関数（ThinkingAssistPage が渡す）。用語の「?」とセオリーカードの入口は画面のどこにでも出るので、
 * props で深く渡さずここから読む
 * @type {import("react").Context<{openTerm: (term: string) => void, openTheory: (id: string, boat?: number|null) => void} | null>}
 */
export const AssistSheetContext = createContext(null);
