import "./RacerFilterFields.css";

const GRADES = ["A1", "A2", "B1", "B2"];

/**
 * 級別（A1/A2/B1/B2）の複数選択チップフィルタ
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function GradeFilterChips({ value, onChange }) {
  const toggle = (grade) => {
    if (value.includes(grade)) {
      onChange(value.filter((g) => g !== grade));
    } else {
      onChange([...value, grade]);
    }
  };

  return (
    <div className="racer-filter-field">
      <label>級別</label>
      <div className="racer-filter-chip-group">
        {GRADES.map((grade) => (
          <button
            key={grade}
            type="button"
            className={`racer-filter-chip ${value.includes(grade) ? "is-selected" : ""}`}
            aria-pressed={value.includes(grade)}
            onClick={() => toggle(grade)}
          >
            {grade}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GradeFilterChips;
