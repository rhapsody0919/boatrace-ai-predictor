/**
 * CollapsibleSection - 会場ページで、次のレースの直上に差し込んだ会場カードを見出しと要約1行に折りたたむ（BOA-546）。
 *
 * 会場カードは縦に長く（375pxで約900px）、そのまま差し込むと次のレースが1画面目に入らない。見出しの行
 * （見出し＋中身を想像できる要約1行）を1タップで開閉できるようにする。
 * - 初期は閉じる。開閉はこのタブの中で、カードの種類（storageKey）ごとに覚える（sessionStorage）。
 *   リロードで読んでいた位置に戻すとき、開閉が変わって高さがずれないようにするため
 * - collapsible=false なら折りたたまず、中身をそのまま出す（最上部に置くとき・レース詳細）
 */
import { useState } from "react";
import "./CollapsibleSection.css";

const readOpen = (storageKey) => {
  try {
    return window.sessionStorage.getItem(`venueCardOpen:${storageKey}`) === "1";
  } catch {
    return false;
  }
};

export default function CollapsibleSection({
  collapsible,
  storageKey,
  summary,
  children,
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey));
  if (!collapsible) return children;
  return (
    <details
      className="collapsible-section"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          window.sessionStorage.setItem(
            `venueCardOpen:${storageKey}`,
            next ? "1" : "0",
          );
        } catch {
          // 保存できない環境では、このページを開いている間だけ覚える
        }
      }}
    >
      <summary className="collapsible-section__summary">{summary}</summary>
      <div className="collapsible-section__body">{children}</div>
    </details>
  );
}
