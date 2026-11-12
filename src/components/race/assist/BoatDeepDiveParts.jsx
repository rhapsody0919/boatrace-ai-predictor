import { useState } from "react";
import { METRICS } from "../../../utils/assistModel";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { TermButton } from "./SheetButtons";

/** 用語の「?」つきの見出し（dt） */
export const Dt = ({ term, children }) => (
  <dt>
    {children ?? term}
    <TermButton term={term} />
  </dt>
);

/** 値のボタン（押すと6艇比較）。深掘りの1艇の値には金枠を付けない（FR-3a「付けない所」） */
export function Val({ metric, racer, onMetric }) {
  const def = METRICS[metric];
  const v = def.value(racer);
  const text = v == null ? C.noRecord : def.text(v, racer);
  return (
    <button
      type="button"
      className="ta-kv-btn ta-num"
      aria-label={C.compareAria(
        def.label,
        v == null ? C.noRecord : def.aria(v, racer),
      )}
      onClick={() => onMetric(metric, racer.boat)}
    >
      {text}
    </button>
  );
}

/** 成績から付けた札（D-41）。押すと付けた理由を1行で出す */
export function Feat({ chip, venue }) {
  const [open, setOpen] = useState(false);
  const label =
    chip.id === "locTop"
      ? C.feat.locTop(venue)
      : chip.id === "tech"
        ? C.feat.tech(chip.technique)
        : C.feat[chip.id];
  const why =
    chip.id === "tech"
      ? C.featWhy.tech(chip.wins, chip.technique, chip.count)
      : C.featWhy[chip.id];
  return (
    <span className="ta-feat-item">
      <button
        type="button"
        className="ta-tag ta-tag-hit"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && <span className="ta-note">{why}</span>}
    </span>
  );
}
