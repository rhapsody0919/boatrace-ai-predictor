// 検索入力のキー操作（Esc で閉じる・↑↓でハイライト移動・Enter で選手ページへ）
export default function handleSearchKeyDown(
  e,
  { results, activeIndex, setActiveIndex, closeSearch, goToRacer },
) {
  if (e.key === "Escape") {
    closeSearch();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (results.length > 0) {
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (results.length > 0) {
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
  } else if (e.key === "Enter") {
    if (results[activeIndex]) {
      goToRacer(results[activeIndex].racer_id);
    }
  }
}
