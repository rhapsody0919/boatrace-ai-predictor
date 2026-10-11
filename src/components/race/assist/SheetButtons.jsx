import { useContext } from "react";
import { AssistSheetContext } from "./assistSheetContext";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const useSheets = () => {
  const ctx = useContext(AssistSheetContext);
  if (!ctx)
    throw new Error("思考アシスト: AssistSheetContext の外で使われました");
  return ctx;
};

/** 用語の「?」（D-8・D-15）。名前は「{用語}とは」。見た目は小さい丸、押せる範囲は 44px（N-6） */
export function TermButton({ term }) {
  const { openTerm } = useSheets();
  return (
    <button
      type="button"
      className="ta-tq"
      aria-label={C.termAria(term)}
      onClick={() => openTerm(term)}
    >
      ?
    </button>
  );
}

/**
 * セオリーカードの入口（「傾向 ›」・図の印・札）。名前は「{セオリーの名前}の過去レースの傾向」。
 * children が無ければ「傾向 ›」と書く
 */
export function TheoryButton({
  id,
  name,
  boat = null,
  className = "",
  children,
}) {
  const { openTheory } = useSheets();
  return (
    <button
      type="button"
      className={`ta-th${className ? ` ${className}` : ""}`}
      aria-label={C.theoryAria(name)}
      onClick={() => openTheory(id, boat)}
    >
      {children ?? C.trend}
    </button>
  );
}
