import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import {
  RacerTable,
  RacerCompactRow,
  RacerListPagination,
  RacerFilterToolbar,
  extractPeriodNumber,
  calcAge,
  uniqueSorted,
  matchesRacerFilters,
} from "../components/racer";
import { supabaseDataService } from "../services/supabaseDataService";
import "./RacersPage.css";

const PAGE_SIZE = 50;
const EMPTY_RANGE = { min: null, max: null };
const DEFAULT_SORT_KEY = "winRate";
const DEFAULT_SORT_DIR = "desc";

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
  // ?page=abc等の不正な値はNaNになりうるため、有効な正の整数以外は1にフォールバックする
  const rawPage = Number(searchParams.get("page"));
  const currentPage = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const updateSearchParams = (updates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
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
      updateSearchParams({
        dir: sortDir === "asc" ? "desc" : "asc",
        page: null,
      });
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
        new Set(
          racersWithAge.map((r) => r.registration_period).filter(Boolean),
        ),
      ).sort((a, b) => extractPeriodNumber(b) - extractPeriodNumber(a)),
      hometowns: uniqueSorted(racersWithAge.map((r) => r.hometown)),
    }),
    [racersWithAge],
  );

  const filtered = useMemo(
    () => racersWithAge.filter((r) => matchesRacerFilters(r, filters)),
    [racersWithAge, filters],
  );

  const sorted = useMemo(() => {
    const withCompareValue = (r) => {
      if (sortKey === "registration_period")
        return extractPeriodNumber(r[sortKey]);
      return r[sortKey];
    };
    return [...filtered].sort((a, b) => {
      const va = withCompareValue(a);
      const vb = withCompareValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") {
        return sortDir === "asc"
          ? va.localeCompare(vb, "ja")
          : vb.localeCompare(va, "ja");
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
