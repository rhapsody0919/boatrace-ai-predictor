import "./RacerFilterFields.css";

/**
 * 登録期の複数選択フィルタ（DB値「99期」等をそのまま選択肢に使う）
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function RegistrationPeriodFilterSelect({ value, onChange, options }) {
  const handleChange = (e) => {
    const selected = Array.from(e.target.selectedOptions).map(
      (opt) => opt.value,
    );
    onChange(selected);
  };

  return (
    <div className="racer-filter-field">
      <label htmlFor="racer-filter-registration-period">登録期</label>
      <select
        id="racer-filter-registration-period"
        className="racer-filter-select"
        multiple
        value={value}
        onChange={handleChange}
      >
        {options.map((period) => (
          <option key={period} value={period}>
            {period}
          </option>
        ))}
      </select>
    </div>
  );
}

export default RegistrationPeriodFilterSelect;
