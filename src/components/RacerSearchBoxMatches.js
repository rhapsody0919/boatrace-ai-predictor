import { useMemo } from "react";
import {
  normalize,
  buildFilterOptions,
  hasActiveFilter,
  selectMatches,
} from "./RacerSearchBoxLogic";

const MAX_RESULTS = 8;

// 絞り込みの選択肢・名前とフィルタの AND 一致・表示件数の切り詰め
export default function useRacerMatches(racers, query, filters) {
  const filterOptions = useMemo(() => buildFilterOptions(racers), [racers]);

  const activeFilter = hasActiveFilter(filters);

  const normalizedQuery = normalize(query);

  const allMatches = selectMatches(
    racers,
    normalizedQuery,
    filters,
    activeFilter,
  );
  const results = allMatches.slice(0, MAX_RESULTS);
  const hiddenCount = allMatches.length - results.length;

  return { filterOptions, activeFilter, results, hiddenCount };
}
