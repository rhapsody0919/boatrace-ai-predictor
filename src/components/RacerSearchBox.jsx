import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabaseDataService } from "../services/supabaseDataService";
import BranchFilterSelect from "./racer/BranchFilterSelect";
import RangeFilterInput from "./racer/RangeFilterInput";
import GradeFilterChips from "./racer/GradeFilterChips";
import RegistrationPeriodFilterSelect from "./racer/RegistrationPeriodFilterSelect";
import HometownFilterSelect from "./racer/HometownFilterSelect";
import "./RacerSearchBox.css";

const MAX_RESULTS = 8;
const CLOSE_ANIMATION_MS = 150;
const EMPTY_RANGE = { min: null, max: null };

// ひらがな→カタカナ変換＋空白除去＋小文字化して比較する。
// racer_profiles.name/name_kana は姓名間に不揃いな全角スペースを含むため、
// 検索クエリ・照合対象の双方から空白を除去してから部分一致させる
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "")
    .toLowerCase();
}

// 「99期」のような登録期文字列から数値部分を抽出する（新しい順ソート用）
function extractPeriodNumber(period) {
  const match = /^(\d+)/.exec(period ?? "");
  return match ? Number(match[1]) : 0;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

/**
 * ヘッダー用の選手名検索ボックス（ja専用）。
 * 全選手一覧（約1,627件、getAllRacersWithGrade）をトリガーのホバー/フォーカス時に
 * プリフェッチし、以降はクライアント側でフィルタする（打鍵ごとの通信は発生しない）。
 * 支部・身長・体重・級別・登録期・出身地のフィルタは名前入力とAND条件で絞り込む
 * （docs/design/racer-search-and-list/spec.md FR1）
 */
function RacerSearchBox() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [racers, setRacers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [branchFilter, setBranchFilter] = useState("");
  const [heightRange, setHeightRange] = useState(EMPTY_RANGE);
  const [weightRange, setWeightRange] = useState(EMPTY_RANGE);
  const [gradeFilter, setGradeFilter] = useState([]);
  const [periodFilter, setPeriodFilter] = useState([]);
  const [hometownFilter, setHometownFilter] = useState([]);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const fetchStartedRef = useRef(false);

  const closeSearch = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      setQuery("");
      setActiveIndex(0);
      setBranchFilter("");
      setHeightRange(EMPTY_RANGE);
      setWeightRange(EMPTY_RANGE);
      setGradeFilter([]);
      setPeriodFilter([]);
      setHometownFilter([]);
    }, CLOSE_ANIMATION_MS);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        closeSearch();
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);

  // トリガーのホバー/フォーカス時点で先読みを開始し、クリック後の待ち時間を減らす
  const prefetchRacers = () => {
    if (fetchStartedRef.current) return;
    fetchStartedRef.current = true;
    setLoading(true);
    supabaseDataService
      .getAllRacersWithGrade()
      .then((data) => setRacers(data))
      .catch((err) => {
        console.error("選手一覧取得エラー:", err.message);
        setRacers([]);
      })
      .finally(() => setLoading(false));
  };

  const openSearch = () => {
    setIsOpen(true);
    setIsClosing(false);
    prefetchRacers();
    // ドロップダウンのレンダー後にフォーカスする
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const goToRacer = (racerId) => {
    navigate(`/racer/${racerId}`);
    closeSearch();
  };

  const filterOptions = useMemo(() => {
    if (!racers) {
      return { branches: [], periods: [], hometowns: [] };
    }
    return {
      branches: uniqueSorted(racers.map((r) => r.branch)),
      periods: Array.from(
        new Set(racers.map((r) => r.registration_period).filter(Boolean)),
      ).sort((a, b) => extractPeriodNumber(b) - extractPeriodNumber(a)),
      hometowns: uniqueSorted(racers.map((r) => r.hometown)),
    };
  }, [racers]);

  const hasActiveFilter =
    branchFilter !== "" ||
    heightRange.min != null ||
    heightRange.max != null ||
    weightRange.min != null ||
    weightRange.max != null ||
    gradeFilter.length > 0 ||
    periodFilter.length > 0 ||
    hometownFilter.length > 0;

  const normalizedQuery = normalize(query);

  const matchesFilters = (r) => {
    if (normalizedQuery.length > 0) {
      const nameMatch =
        normalize(r.name).includes(normalizedQuery) ||
        normalize(r.name_kana).includes(normalizedQuery);
      if (!nameMatch) return false;
    }
    if (branchFilter && r.branch !== branchFilter) return false;
    if (
      heightRange.min != null &&
      (r.height_cm == null || r.height_cm < heightRange.min)
    )
      return false;
    if (
      heightRange.max != null &&
      (r.height_cm == null || r.height_cm > heightRange.max)
    )
      return false;
    if (
      weightRange.min != null &&
      (r.weight_kg == null || r.weight_kg < weightRange.min)
    )
      return false;
    if (
      weightRange.max != null &&
      (r.weight_kg == null || r.weight_kg > weightRange.max)
    )
      return false;
    if (gradeFilter.length > 0 && !gradeFilter.includes(r.grade)) return false;
    if (
      periodFilter.length > 0 &&
      !periodFilter.includes(r.registration_period)
    )
      return false;
    if (hometownFilter.length > 0 && !hometownFilter.includes(r.hometown))
      return false;
    return true;
  };

  const allMatches =
    (normalizedQuery.length > 0 || hasActiveFilter) && racers
      ? racers.filter(matchesFilters)
      : [];
  const results = allMatches.slice(0, MAX_RESULTS);
  const hiddenCount = allMatches.length - results.length;

  // 検索条件（名前・フィルタ）が変わるたびハイライト位置を先頭に戻す
  const withActiveIndexReset = (setter) => (value) => {
    setter(value);
    setActiveIndex(0);
  };

  const handleInputChange = withActiveIndexReset((value) => setQuery(value));
  const setBranchFilterAndReset = withActiveIndexReset(setBranchFilter);
  const setHeightRangeAndReset = withActiveIndexReset(setHeightRange);
  const setWeightRangeAndReset = withActiveIndexReset(setWeightRange);
  const setGradeFilterAndReset = withActiveIndexReset(setGradeFilter);
  const setPeriodFilterAndReset = withActiveIndexReset(setPeriodFilter);
  const setHometownFilterAndReset = withActiveIndexReset(setHometownFilter);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      closeSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
    } else if (e.key === "Enter") {
      if (results[activeIndex]) {
        goToRacer(results[activeIndex].racer_id);
      }
    }
  };

  return (
    <div className="racer-search" ref={rootRef}>
      <button
        type="button"
        className="racer-search-trigger"
        onClick={() => (isOpen ? closeSearch() : openSearch())}
        onMouseEnter={prefetchRacers}
        onFocus={prefetchRacers}
        onTouchStart={prefetchRacers}
        aria-label="選手名で検索"
        title="選手名で検索"
        aria-expanded={isOpen}
      >
        <span aria-hidden="true">🔍</span>
      </button>
      {isOpen && (
        <div
          className={`racer-search-panel ${isClosing ? "is-closing" : ""}`}
          role="dialog"
          aria-label="選手名検索"
        >
          <div className="racer-search-panel-header">
            <input
              ref={inputRef}
              type="text"
              className="racer-search-input"
              placeholder="選手名を入力（漢字・ひらがな可）"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              translate="no"
            />
            <button
              type="button"
              className="racer-search-close"
              onClick={closeSearch}
              aria-label="検索を閉じる"
            >
              ×
            </button>
          </div>

          <div className="racer-search-filter-block">
            <p className="racer-search-filter-title">絞り込み</p>
            <div className="racer-search-filter-grid">
              <BranchFilterSelect
                value={branchFilter}
                onChange={setBranchFilterAndReset}
                options={filterOptions.branches}
              />
              <GradeFilterChips
                value={gradeFilter}
                onChange={setGradeFilterAndReset}
              />
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
                value={periodFilter}
                onChange={setPeriodFilterAndReset}
                options={filterOptions.periods}
              />
              <HometownFilterSelect
                value={hometownFilter}
                onChange={setHometownFilterAndReset}
                options={filterOptions.hometowns}
              />
            </div>
          </div>

          {loading && <p className="racer-search-status">読み込み中...</p>}

          {!loading && !query && !hasActiveFilter && (
            <p className="racer-search-hint">
              選手名の一部を入力してください（漢字・ひらがな両方に対応）
            </p>
          )}

          {!loading && (query || hasActiveFilter) && results.length === 0 && (
            <p className="racer-search-status">
              見つかりません。漢字・ひらがなを入れ替えて試してください
            </p>
          )}

          {results.length > 0 && (
            <>
              <ul className="racer-search-results" translate="no">
                {results.map((r, i) => (
                  <li key={r.racer_id}>
                    <button
                      type="button"
                      className={`racer-search-result ${
                        i === activeIndex ? "is-active" : ""
                      }`}
                      onClick={() => goToRacer(r.racer_id)}
                      onMouseEnter={() => setActiveIndex(i)}
                    >
                      <span className="racer-search-result-name">
                        {r.name?.replace(/\s+/g, "")}
                      </span>
                      {r.branch && (
                        <span className="racer-search-result-branch">
                          {r.branch}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 && (
                <p className="racer-search-more">
                  他に{hiddenCount}件あります。もう少し詳しく入力してください
                </p>
              )}
            </>
          )}

          <Link
            to="/racers"
            className="racer-search-list-link"
            onClick={closeSearch}
          >
            フィルタで絞り込んで探す →
          </Link>
        </div>
      )}
    </div>
  );
}

export default RacerSearchBox;
