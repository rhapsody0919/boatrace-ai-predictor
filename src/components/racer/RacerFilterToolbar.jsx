import BranchFilterSelect from "./BranchFilterSelect";
import RangeFilterInput from "./RangeFilterInput";
import GradeFilterChips from "./GradeFilterChips";
import RegistrationPeriodFilterSelect from "./RegistrationPeriodFilterSelect";
import HometownFilterSelect from "./HometownFilterSelect";
import "./RacerFilterToolbar.css";

/**
 * /racers一覧ページ用のフィルタツールバー。共通フィルタコンポーネント5つを
 * 横並びレイアウトで束ねる（docs/design/racer-search-and-list/screens.md）
 */
function RacerFilterToolbar({
  filters,
  onFilterChange,
  filterOptions,
  matchCount,
  totalCount,
  onReset,
}) {
  return (
    <div className="racer-filter-toolbar">
      <div className="racer-filter-toolbar-grid">
        <BranchFilterSelect
          value={filters.branch}
          onChange={(v) => onFilterChange({ ...filters, branch: v })}
          options={filterOptions.branches}
        />
        <RangeFilterInput
          idPrefix="racers-page-height"
          label="身長"
          unit="cm"
          min={filters.heightRange.min}
          max={filters.heightRange.max}
          onChange={(v) => onFilterChange({ ...filters, heightRange: v })}
        />
        <RangeFilterInput
          idPrefix="racers-page-weight"
          label="体重"
          unit="kg"
          min={filters.weightRange.min}
          max={filters.weightRange.max}
          onChange={(v) => onFilterChange({ ...filters, weightRange: v })}
        />
        <GradeFilterChips
          value={filters.grade}
          onChange={(v) => onFilterChange({ ...filters, grade: v })}
        />
        <RegistrationPeriodFilterSelect
          value={filters.period}
          onChange={(v) => onFilterChange({ ...filters, period: v })}
          options={filterOptions.periods}
        />
        <HometownFilterSelect
          value={filters.hometown}
          onChange={(v) => onFilterChange({ ...filters, hometown: v })}
          options={filterOptions.hometowns}
        />
      </div>
      <div className="racer-filter-toolbar-foot">
        <span>
          {totalCount}人中 {matchCount}人が条件に一致
        </span>
        <button
          type="button"
          className="racer-filter-toolbar-reset"
          onClick={onReset}
        >
          条件をリセット
        </button>
      </div>
    </div>
  );
}

export default RacerFilterToolbar;
