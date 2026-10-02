import "./RacerFilterFields.css";

/**
 * min/max範囲指定の汎用フィルタ入力。身長・体重の両方で使う共通コンポーネント
 * （docs/design/racer-search-and-list/screens.md参照）。
 *
 * 見出しの <label> は下限欄にしか結び付かないため、両方の欄に aria-label で
 * 「身長の下限（cm）」のような名前を付ける。以前は上限欄に名前が無く、
 * スクリーンリーダーで区別できなかった（BOA-470）
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
          aria-label={`${label}の下限（${unit}）`}
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
          aria-label={`${label}の上限（${unit}）`}
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
