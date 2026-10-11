import "./HorizontalScrollHint.css";

/**
 * 横スクロールする表の「›」（右へ送る）と「‹」（左へ戻す）。useHorizontalScrollHint と対で使う。
 *
 * 同じボタンの JSX がレース詳細の6か所に並び、「‹」がある表と無い表が混在していた。無い表では、
 * 右へ送ると艇番・選手名の列が消えたまま、ボタンでは左に戻れなかった（BOA-699。横スワイプが
 * 効かない環境では戻す手段が無い）。置く場所は、手がかりの箱（.hscroll-hint）の直下
 *
 * 装飾兼ショートカットなので、支援技術には出さない（表の中身はスクロールせずに辿れる）
 *
 * @param {{hasMore: boolean, hasLess: boolean, onMore: Function, onLess: Function}} props
 */
function HorizontalScrollButtons({ hasMore, hasLess, onMore, onLess }) {
  return (
    <>
      {hasLess && (
        <button
          type="button"
          className="hscroll-less"
          onClick={onLess}
          aria-hidden="true"
          tabIndex={-1}
        >
          ‹
        </button>
      )}
      {hasMore && (
        <button
          type="button"
          className="hscroll-more"
          onClick={onMore}
          aria-hidden="true"
          tabIndex={-1}
        >
          ›
        </button>
      )}
    </>
  );
}

export default HorizontalScrollButtons;
