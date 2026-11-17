// i18n-allow-file: Header.jsx が ja のときだけ描画する（選手データ・検索が ja のみのため）
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import useCloseOnOutsideClick from "./RacerSearchBoxOutsideClick";
import handleSearchKeyDown from "./RacerSearchBoxKeys";
import useRacerPrefetch from "./RacerSearchBoxPrefetch";
import useRacerSearchFilters from "./RacerSearchBoxFilters";
import RacerSearchBoxPanel from "./RacerSearchBoxPanel";
import useRacerMatches from "./RacerSearchBoxMatches";
import "./RacerSearchBox.css";

const CLOSE_ANIMATION_MS = 150;

/**
 * ヘッダー用の選手名検索ボックス（ja専用）。
 * 全選手一覧（約1,627件、getAllRacersWithGrade）をトリガーのホバー/フォーカス時に
 * プリフェッチし、以降はクライアント側でフィルタする（打鍵ごとの通信は発生しない）。
 * 支部・身長・体重・級別・登録期・出身地のフィルタは名前入力とAND条件で絞り込む
 * （docs/design/racer-search-and-list/spec.md FR1）
 */
function RacerSearchBox() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState("");
  const { racers, loading, prefetchRacers } = useRacerPrefetch();
  const [activeIndex, setActiveIndex] = useState(0);
  const { filters, resetFilters, withActiveIndexReset, ...filterSetters } =
    useRacerSearchFilters(setActiveIndex);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const closeSearch = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      setQuery("");
      setActiveIndex(0);
      resetFilters();
    }, CLOSE_ANIMATION_MS);
  };

  useCloseOnOutsideClick(isOpen, rootRef, closeSearch);

  const openSearch = () => {
    setIsOpen(true);
    setIsClosing(false);
    prefetchRacers();
    // ドロップダウンのレンダー後にフォーカスする
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const goToRacer = (racerId) => {
    navigate(`/racer/${racerId}`);
    closeSearch();
  };

  const { filterOptions, activeFilter, results, hiddenCount } = useRacerMatches(
    racers,
    query,
    filters,
  );

  // 検索条件（名前・フィルタ）が変わるたびハイライト位置を先頭に戻す
  const handleInputChange = withActiveIndexReset((value) => setQuery(value));

  const handleKeyDown = (e) =>
    handleSearchKeyDown(e, {
      results,
      activeIndex,
      setActiveIndex,
      closeSearch,
      goToRacer,
    });

  return (
    <div className="racer-search" ref={rootRef}>
      <button
        type="button"
        className="racer-search-trigger"
        onClick={() => (isOpen ? closeSearch() : openSearch())}
        onMouseEnter={prefetchRacers}
        onFocus={prefetchRacers}
        onTouchStart={prefetchRacers}
        aria-label="選手名で検索"
        title="選手名で検索"
        aria-expanded={isOpen}
      >
        <span aria-hidden="true">🔍</span>
      </button>
      {isOpen && (
        <RacerSearchBoxPanel
          isClosing={isClosing}
          inputRef={inputRef}
          query={query}
          onQueryChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onClose={closeSearch}
          loading={loading}
          activeFilter={activeFilter}
          filters={filters}
          filterOptions={filterOptions}
          filterSetters={filterSetters}
          results={results}
          hiddenCount={hiddenCount}
          activeIndex={activeIndex}
          onSelect={goToRacer}
          onHover={setActiveIndex}
        />
      )}
    </div>
  );
}

export default RacerSearchBox;
