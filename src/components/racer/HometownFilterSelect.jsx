import "./RacerFilterFields.css";

/**
 * 出身地（都道府県）の複数選択フィルタ。
 * 日本地図から選ぶUIはBOA-261で別途検討、今回はドロップダウンのみ
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function HometownFilterSelect({ value, onChange, options }) {
  const handleChange = (e) => {
    const selected = Array.from(e.target.selectedOptions).map(
      (opt) => opt.value,
    );
    onChange(selected);
  };

  return (
    <div className="racer-filter-field">
      <label htmlFor="racer-filter-hometown">出身地</label>
      <select
        id="racer-filter-hometown"
        className="racer-filter-select"
        multiple
        value={value}
        onChange={handleChange}
      >
        {options.map((hometown) => (
          <option key={hometown} value={hometown}>
            {hometown}
          </option>
        ))}
      </select>
    </div>
  );
}

export default HometownFilterSelect;
