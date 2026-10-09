import { useState } from "react";

/** 畳んだ説明（押すと開く） */
export default function Fold({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ta-fold">
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
