import { splitSentences } from "../../../utils/analogyFormat";

/**
 * 説明・注記・脚注を「短い見出し＋箇条書き」で出す（2026-10-06 ユーザー決定。中身の文言はそのまま、1文ずつ1行）
 * @param {{title?: string, texts: (string|null|false|undefined)[], className?: string}} props
 *   texts は文言（複数の文を含んでよい）。空のものは飛ばす
 */
export default function NoteList({ title, texts, className = "" }) {
  const items = texts.filter(Boolean).flatMap(splitSentences);
  if (items.length === 0) return null;
  return (
    <div className={`af-notes ${className}`.trim()}>
      {title && <p className="af-notes-h">{title}</p>}
      <ul className="af-foot af-foot-list">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
