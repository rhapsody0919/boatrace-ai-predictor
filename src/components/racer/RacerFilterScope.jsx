import "./RacerFilterScope.css";

/**
 * 絞り込み（会場・枠番・グレード・レース種別）が効く節を入れる枠（UI/UX 改善 #6、
 * docs/design/racer-wt-uiux-2026-11/mock/approved.md）。上の公式成績・モーター・全体の成績には
 * 効かないことを枠の線で見せる。id はページ内の目次（RacerPageToc）の飛び先
 */
export default function FilterScopeFrame({ children }) {
  return (
    <section
      id="racer-filtered"
      className="racer-filter-scope"
      aria-label="絞り込みが効く成績"
    >
      <p className="racer-filter-scope__title">この枠の中は絞り込みが効きます</p>
      {children}
    </section>
  );
}
