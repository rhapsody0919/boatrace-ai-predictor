import "./RacerFilterFields.css";

/**
 * 支部の選択式フィルタ。FR1（ヘッダー検索）・FR2（一覧ページ）で共用する
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function BranchFilterSelect({ value, onChange, options }) {
  return (
    <div className="racer-filter-field">
      <label htmlFor="racer-filter-branch">支部</label>
      <select
        id="racer-filter-branch"
        className="racer-filter-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">すべて</option>
        {options.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </div>
  );
}

export default BranchFilterSelect;
