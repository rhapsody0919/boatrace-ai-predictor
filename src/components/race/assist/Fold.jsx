import { useState } from "react";

/** 畳んだ説明（押すと開く）。defaultOpen は開いた状態で出すとき（軸の要約の入口から深掘りへ渡すとき） */
export default function Fold({ title, children, defaultOpen = false, ref }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ta-fold" ref={ref}>
      <button
        type="button"
        className="ta-scope-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title} ›
      </button>
      {open && children}
    </div>
  );
}
