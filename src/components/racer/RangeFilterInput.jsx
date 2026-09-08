import "./RacerFilterFields.css";

/**
 * min/max範囲指定の汎用フィルタ入力。身長・体重の両方で使う共通コンポーネント
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function RangeFilterInput({ label, unit, min, max, onChange, idPrefix }) {
  return (
    <div className="racer-filter-field">
      <label htmlFor={`${idPrefix}-min`}>
        {label} ({unit})
      </label>
      <div className="racer-filter-range">
        <input
          id={`${idPrefix}-min`}
          type="number"
          value={min ?? ""}
          placeholder="下限"
          onChange={(e) =>
            onChange({
              min: e.target.value === "" ? null : Number(e.target.value),
              max,
            })
          }
        />
        <span className="unit">〜</span>
        <input
          id={`${idPrefix}-max`}
          type="number"
          value={max ?? ""}
          placeholder="上限"
          onChange={(e) =>
            onChange({
              min,
              max: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        />
      </div>
    </div>
  );
}

export default RangeFilterInput;
