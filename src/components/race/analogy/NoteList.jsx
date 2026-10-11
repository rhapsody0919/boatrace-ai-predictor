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

/**
 * 内部タブの一番下の折りたたみ（「割合の出し方・注意」など）。締切前には読まないが消すと信用の度合いが
 * 分からなくなる説明を、詳細度を変えずにまとめる（承認モック sonar-tab v3）
 * @param {{title: string, children: import("react").ReactNode}} props
 */
export function NotesFold({ title, children }) {
  return (
    <details
      className="af-details af-notes-fold"
      data-testid="analogy-notes-fold"
    >
      <summary>{title}</summary>
      <div className="af-notes-fold-body">{children}</div>
    </details>
  );
}
