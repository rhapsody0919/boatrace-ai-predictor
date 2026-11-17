import { Link } from "react-router-dom";
import RacerSearchBoxFilterBlock from "./RacerSearchBoxFilterBlock";
import RacerSearchBoxResults from "./RacerSearchBoxResults";

export default function RacerSearchBoxPanel({
  isClosing,
  inputRef,
  query,
  onQueryChange,
  onKeyDown,
  onClose,
  loading,
  activeFilter,
  filters,
  filterOptions,
  filterSetters,
  results,
  hiddenCount,
  activeIndex,
  onSelect,
  onHover,
}) {
  return (
    <div
      className={`racer-search-panel ${isClosing ? "is-closing" : ""}`}
      role="dialog"
      aria-label="選手名検索"
    >
      <div className="racer-search-panel-header">
        <input
          ref={inputRef}
          type="text"
          className="racer-search-input"
          placeholder="選手名を入力（漢字・ひらがな可）"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          translate="no"
        />
        <button
          type="button"
          className="racer-search-close"
          onClick={onClose}
          aria-label="検索を閉じる"
        >
          ×
        </button>
      </div>

      <RacerSearchBoxFilterBlock
        filters={filters}
        filterOptions={filterOptions}
        {...filterSetters}
      />

      {loading && <p className="racer-search-status">読み込み中...</p>}

      {!loading && !query && !activeFilter && (
        <p className="racer-search-hint">
          選手名の一部を入力してください（漢字・ひらがな両方に対応）
        </p>
      )}

      {!loading && (query || activeFilter) && results.length === 0 && (
        <p className="racer-search-status">
          見つかりません。漢字・ひらがなを入れ替えて試してください
        </p>
      )}

      {results.length > 0 && (
        <RacerSearchBoxResults
          results={results}
          hiddenCount={hiddenCount}
          activeIndex={activeIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
      )}

      <Link to="/racers" className="racer-search-list-link" onClick={onClose}>
        フィルタで絞り込んで探す →
      </Link>
    </div>
  );
}
