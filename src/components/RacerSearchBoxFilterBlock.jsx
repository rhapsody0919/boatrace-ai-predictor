import BranchFilterSelect from "./racer/BranchFilterSelect";
import RangeFilterInput from "./racer/RangeFilterInput";
import GradeFilterChips from "./racer/GradeFilterChips";
import RegistrationPeriodFilterSelect from "./racer/RegistrationPeriodFilterSelect";
import HometownFilterSelect from "./racer/HometownFilterSelect";

export default function RacerSearchBoxFilterBlock({
  filters,
  filterOptions,
  setBranchFilterAndReset,
  setGradeFilterAndReset,
  setHeightRangeAndReset,
  setWeightRangeAndReset,
  setPeriodFilterAndReset,
  setHometownFilterAndReset,
}) {
  const { branch, heightRange, weightRange, grade, period, hometown } = filters;
  return (
    <div className="racer-search-filter-block">
      <p className="racer-search-filter-title">絞り込み</p>
      <div className="racer-search-filter-grid">
        <BranchFilterSelect
          value={branch}
          onChange={setBranchFilterAndReset}
          options={filterOptions.branches}
        />
        <GradeFilterChips value={grade} onChange={setGradeFilterAndReset} />
        <RangeFilterInput
          idPrefix="racer-search-height"
          label="身長"
          unit="cm"
          min={heightRange.min}
          max={heightRange.max}
          onChange={setHeightRangeAndReset}
        />
        <RangeFilterInput
          idPrefix="racer-search-weight"
          label="体重"
          unit="kg"
          min={weightRange.min}
          max={weightRange.max}
          onChange={setWeightRangeAndReset}
        />
        <RegistrationPeriodFilterSelect
          value={period}
          onChange={setPeriodFilterAndReset}
          options={filterOptions.periods}
        />
        <HometownFilterSelect
          value={hometown}
          onChange={setHometownFilterAndReset}
          options={filterOptions.hometowns}
        />
      </div>
    </div>
  );
}
