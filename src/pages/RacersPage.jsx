import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import {
  RacerTable,
  RacerCompactRow,
  RacerListPagination,
  RacerFilterToolbar,
} from "../components/racer";
import { supabaseDataService } from "../services/supabaseDataService";
import "./RacersPage.css";

const PAGE_SIZE = 50;
const EMPTY_RANGE = { min: null, max: null };
const DEFAULT_SORT_KEY = "winRate";
const DEFAULT_SORT_DIR = "desc";

// 「99期」のような登録期文字列から数値部分を抽出する（新しい順ソート用）
function extractPeriodNumber(period) {
  const match = /^(\d+)/.exec(period ?? "");
  return match ? Number(match[1]) : 0;
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

function parseListParam(searchParams, key) {
  const raw = searchParams.get(key);
  return raw ? raw.split(",").filter(Boolean) : [];
}

function parseNumberParam(searchParams, key) {
  const raw = searchParams.get(key);
  return raw !== null && raw !== "" ? Number(raw) : null;
}

/**
 * 選手一覧ページ（/racers）。支部・身長・体重・級別・登録期・出身地で
 * 絞り込み、支部・身長・体重・級別・登録期・出身地・勝率・年齢でソートする。
 * フィルタ・ソート・ページはURLクエリパラメータと同期する（FR2・FR4）。
 * ja専用（TRANSLATED_PATHS未登録）のためt()を使わず直接日本語文字列で実装する
 * （既存RacerProfile.jsxと同じ方針）
 */
export default function RacersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [racers, setRacers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedRacerId, setExpandedRacerId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabaseDataService
      .getAllRacersWithGrade()
      .then((data) => {
        if (cancelled) return;
        setRacers(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("選手一覧取得エラー:", err.message);
        setRacers([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filters = useMemo(
    () => ({
      branch: searchParams.get("branch") ?? "",
      heightRange: {
        min: parseNumberParam(searchParams, "heightMin"),
        max: parseNumberParam(searchParams, "heightMax"),
      },
      weightRange: {
        min: parseNumberParam(searchParams, "weightMin"),
        max: parseNumberParam(searchParams, "weightMax"),
      },
      grade: parseListParam(searchParams, "grade"),
      period: parseListParam(searchParams, "period"),
      hometown: parseListParam(searchParams, "hometown"),
    }),
    [searchParams],
  );

  const sortKey = searchParams.get("sort") || DEFAULT_SORT_KEY;
  const sortDir = searchParams.get("dir") || DEFAULT_SORT_DIR;
  const currentPage = Number(searchParams.get("page") || "1");

  const updateSearchParams = (updates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        next.delete(key);
      } else if (Array.isArray(value)) {
        next.set(key, value.join(","));
      } else {
        next.set(key, String(value));
      }
    }
    setSearchParams(next);
  };

  const handleFilterChange = (newFilters) => {
    updateSearchParams({
      branch: newFilters.branch,
      heightMin: newFilters.heightRange.min,
      heightMax: newFilters.heightRange.max,
      weightMin: newFilters.weightRange.min,
      weightMax: newFilters.weightRange.max,
      grade: newFilters.grade,
      period: newFilters.period,
      hometown: newFilters.hometown,
      page: null,
    });
  };

  const handleReset = () => {
    setSearchParams(new URLSearchParams());
  };

  const handleSortChange = (key) => {
    if (key === sortKey) {
      updateSearchParams({ dir: sortDir === "asc" ? "desc" : "asc", page: null });
    } else {
      updateSearchParams({ sort: key, dir: "desc", page: null });
    }
  };

  const handlePageChange = (page) => {
    updateSearchParams({ page });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const racersWithAge = useMemo(() => {
    if (!racers) return [];
    return racers.map((r) => ({ ...r, age: calcAge(r.birth_date) }));
  }, [racers]);

  const filterOptions = useMemo(
    () => ({
      branches: uniqueSorted(racersWithAge.map((r) => r.branch)),
      periods: Array.from(
        new Set(racersWithAge.map((r) => r.registration_period).filter(Boolean)),
      ).sort((a, b) => extractPeriodNumber(b) - extractPeriodNumber(a)),
      hometowns: uniqueSorted(racersWithAge.map((r) => r.hometown)),
    }),
    [racersWithAge],
  );

  const matchesFilters = (r) => {
    if (filters.branch && r.branch !== filters.branch) return false;
    const { heightRange, weightRange } = filters;
    if (heightRange.min != null && (r.height_cm == null || r.height_cm < heightRange.min))
      return false;
    if (heightRange.max != null && (r.height_cm == null || r.height_cm > heightRange.max))
      return false;
    if (weightRange.min != null && (r.weight_kg == null || r.weight_kg < weightRange.min))
      return false;
    if (weightRange.max != null && (r.weight_kg == null || r.weight_kg > weightRange.max))
      return false;
    if (filters.grade.length > 0 && !filters.grade.includes(r.grade)) return false;
    if (filters.period.length > 0 && !filters.period.includes(r.registration_period))
      return false;
    if (filters.hometown.length > 0 && !filters.hometown.includes(r.hometown))
      return false;
    return true;
  };

  const filtered = useMemo(
    () => racersWithAge.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [racersWithAge, filters],
  );

  const sorted = useMemo(() => {
    const withCompareValue = (r) => {
      if (sortKey === "registration_period") return extractPeriodNumber(r[sortKey]);
      return r[sortKey];
    };
    return [...filtered].sort((a, b) => {
      const va = withCompareValue(a);
      const vb = withCompareValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") {
        return sortDir === "asc" ? va.localeCompare(vb, "ja") : vb.localeCompare(va, "ja");
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });
     
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pageItems = sorted.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const toggleExpand = (racerId) => {
    setExpandedRacerId((current) => (current === racerId ? null : racerId));
  };

  return (
    <>
      <title>選手一覧 | 龍神レーダー</title>
      <meta
        name="description"
        content="支部・身長・体重・級別・登録期・出身地で絞り込み、勝率などでソートできる選手一覧。"
      />

      <Header />

      <div className="racers-page">
        <h1 className="racers-page-title">選手一覧</h1>

        <RacerFilterToolbar
          filters={filters}
          onFilterChange={handleFilterChange}
          filterOptions={filterOptions}
          matchCount={sorted.length}
          totalCount={racersWithAge.length}
          onReset={handleReset}
        />

        {loading && <p className="racers-page-status">読み込み中...</p>}

        {!loading && sorted.length === 0 && (
          <p className="racers-page-status">
            条件に一致する選手が見つかりません
          </p>
        )}

        {!loading && sorted.length > 0 && (
          <>
            <div className="racers-page-table-view">
              <RacerTable
                racers={pageItems}
                sortKey={sortKey}
                sortDir={sortDir}
                onSortChange={handleSortChange}
              />
            </div>
            <div className="racers-page-mobile-view">
              {pageItems.map((racer) => (
                <RacerCompactRow
                  key={racer.racer_id}
                  racer={racer}
                  isExpanded={expandedRacerId === racer.racer_id}
                  onToggleExpand={toggleExpand}
                />
              ))}
            </div>

            <RacerListPagination
              currentPage={safePage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </>
  );
}
