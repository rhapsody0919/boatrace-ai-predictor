import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TERM_HINTS } from "./termHints";
import "./TermHintButton.css";

export default function TermHintButton({ termKey }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  if (i18n.language !== "ja") return null;
  const explanation = TERM_HINTS[termKey];
  if (!explanation) return null;

  return (
    <span className="term-hint">
      <button
        type="button"
        className="term-hint__button"
        onClick={() => setOpen((v) => !v)}
        aria-label="用語の説明を見る"
        aria-expanded={open}
      >
        ?
      </button>
      {open && <span className="term-hint__popover">{explanation}</span>}
    </span>
  );
}
