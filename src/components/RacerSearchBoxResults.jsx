export default function RacerSearchBoxResults({
  results,
  hiddenCount,
  activeIndex,
  onSelect,
  onHover,
}) {
  return (
    <>
      <ul className="racer-search-results" translate="no">
        {results.map((r, i) => (
          <li key={r.racer_id}>
            <button
              type="button"
              className={`racer-search-result ${
                i === activeIndex ? "is-active" : ""
              }`}
              onClick={() => onSelect(r.racer_id)}
              onMouseEnter={() => onHover(i)}
            >
              <span className="racer-search-result-name">
                {r.name?.replace(/\s+/g, "")}
              </span>
              {r.branch && (
                <span className="racer-search-result-branch">{r.branch}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="racer-search-more">
          他に{hiddenCount}件あります。もう少し詳しく入力してください
        </p>
      )}
    </>
  );
}
