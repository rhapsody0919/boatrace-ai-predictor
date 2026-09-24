/**
 * DigestCardGrid - カードの並びと「もっと見る」（BOA-402）
 *
 * 逃げは1日あたり平均32件・最大43件の候補が出る（実測。上位25件まで保存する）。
 * 全部を常に展開すると、次のセクションへ届くまでのスクロールが長くなるため、
 * 既定では上位 `previewCount` 件だけを出し、残りはボタンで開く。
 *
 * 文言は既存の `HitRaces`（「もっと見る (残り◯レース) ▼」「閉じる ▲」）に揃える
 * （`.claude/rules/component-reuse.md`「同じUIパターンは既存に合わせる」）。
 */
import { useState } from "react";
import "./DigestCardGrid.css";

function DigestCardGrid({ rows, previewCount = 6, children }) {
  const [showAll, setShowAll] = useState(false);
  const hasMore = rows.length > previewCount;
  const visible = showAll || !hasMore ? rows : rows.slice(0, previewCount);

  return (
    <>
      <div className="digest-grid">{visible.map(children)}</div>
      {hasMore && (
        <button
          type="button"
          className="digest-grid__more"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
        >
          {showAll
            ? "閉じる ▲"
            : `もっと見る (残り${rows.length - previewCount}件) ▼`}
        </button>
      )}
    </>
  );
}

export default DigestCardGrid;
