import { useState } from "react";
import { EMPTY_RANGE } from "./RacerSearchBoxLogic";

// 絞り込み 6 種の state と、変更のたびハイライト位置を先頭に戻す setter 群
export default function useRacerSearchFilters(setActiveIndex) {
  const [branchFilter, setBranchFilter] = useState("");
  const [heightRange, setHeightRange] = useState(EMPTY_RANGE);
  const [weightRange, setWeightRange] = useState(EMPTY_RANGE);
  const [gradeFilter, setGradeFilter] = useState([]);
  const [periodFilter, setPeriodFilter] = useState([]);
  const [hometownFilter, setHometownFilter] = useState([]);

  const resetFilters = () => {
    setBranchFilter("");
    setHeightRange(EMPTY_RANGE);
    setWeightRange(EMPTY_RANGE);
    setGradeFilter([]);
    setPeriodFilter([]);
    setHometownFilter([]);
  };

  const filters = {
    branch: branchFilter,
    heightRange,
    weightRange,
    grade: gradeFilter,
    period: periodFilter,
    hometown: hometownFilter,
  };

  const withActiveIndexReset = (setter) => (value) => {
    setter(value);
    setActiveIndex(0);
  };

  return {
    filters,
    resetFilters,
    withActiveIndexReset,
    setBranchFilterAndReset: withActiveIndexReset(setBranchFilter),
    setHeightRangeAndReset: withActiveIndexReset(setHeightRange),
    setWeightRangeAndReset: withActiveIndexReset(setWeightRange),
    setGradeFilterAndReset: withActiveIndexReset(setGradeFilter),
    setPeriodFilterAndReset: withActiveIndexReset(setPeriodFilter),
    setHometownFilterAndReset: withActiveIndexReset(setHometownFilter),
  };
}
