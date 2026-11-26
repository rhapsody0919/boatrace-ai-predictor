/**
 * 選手ページの「逃がし率（進入コース別）」（オーナー 2026-11-25。題は 2026-11-26 に「逃がし率」の短い形に）。
 * 絞り込みの枠の中に置き、絞り込み（会場・枠番・グレード・レース種別・進入コース）が効く履歴（vc.vcHistory）から数える。
 * 選手ごとの値は信頼性が低く予測にも効かないので、k/n と率の記録だけを出し、強調・並べ替えはしない。
 * 事実の記録なので「結果を保証しない」の断りは付けない（オーナー 2026-11-25）。
 */
import { nigashiByCourse } from "../../pure/nigashiStats.js";
import { useNigashiBaseline } from "../../hooks/useNigashiBaseline";

// 行の見た目。ページの地に乗るので意味トークンだけを使う（CSS のファイルを増やさないため部品の中に置く）
const ROW_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--spacing-3)",
  padding: "var(--spacing-2) var(--spacing-1)",
  borderBottom: "var(--border-width-1) solid var(--border-hairline)",
};
const SUB_STYLE = { color: "var(--text-secondary)" };

const slash = (date) => (date ? date.replaceAll("-", "/") : date);

function BaselineNote({ baseline }) {
  if (baseline === undefined || baseline?.empty) return null;
  if (baseline === null)
    return (
      <p className="racer-stat-note" role="alert">
        全国の値を読み込めませんでした。
      </p>
    );
  return (
    <p className="racer-stat-note">
      全国では、{slash(baseline.from)}〜{slash(baseline.to)}
      のどのコースの走でも{baseline.pct}%で1コースの艇が逃げています。
    </p>
  );
}

export default function RacerNigashiCourses({ history }) {
  const baseline = useNigashiBaseline();
  const { rows, from, to } = nigashiByCourse(history);
  if (rows.length === 0) return null;
  return (
    <div data-testid="racer-nigashi" style={{ margin: "var(--spacing-4) 0" }}>
      <h3>逃がし率（進入コース別）</h3>
      <p className="racer-stat-note">
        2〜6コースに入った走のうち、1コースの艇に逃げで1着を取られた走の割合。主に2コースで見る値です（当社データ{" "}
        {slash(from)}〜{slash(to)}。上の絞り込み条件が効きます）
      </p>
      <dl style={{ margin: 0 }}>
        {rows.map((r) => (
          <div key={r.course} style={ROW_STYLE}>
            <dt style={SUB_STYLE}>{r.course}コース</dt>
            <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
              {r.n}走中{r.count}走<small style={SUB_STYLE}>（{r.pct}%）</small>
            </dd>
          </div>
        ))}
      </dl>
      <BaselineNote baseline={baseline} />
      <p className="racer-stat-note">
        ※この走数では、率は偶然で大きく動きます。コースごとの違いを選手の特徴とは読めません。
      </p>
    </div>
  );
}
