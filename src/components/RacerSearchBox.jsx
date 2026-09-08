import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabaseDataService } from "../services/supabaseDataService";
import "./RacerSearchBox.css";

const MAX_RESULTS = 8;
const CLOSE_ANIMATION_MS = 150;

// ひらがな→カタカナ変換＋空白除去＋小文字化して比較する。
// racer_profiles.name/name_kana は姓名間に不揃いな全角スペースを含むため、
// 検索クエリ・照合対象の双方から空白を除去してから部分一致させる
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/[ぁ-ゖ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60),
    )
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * ヘッダー用の選手名検索ボックス（ja専用）。
 * 全選手一覧（約1,600件、getAllRacersLite）をトリガーのホバー/フォーカス時に
 * プリフェッチし、以降はクライアント側でフィルタする（打鍵ごとの通信は発生しない）
 */
function RacerSearchBox() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [racers, setRacers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
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
      .getAllRacersLite()
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

  const normalizedQuery = normalize(query);
  const allMatches =
    normalizedQuery.length > 0 && racers
      ? racers.filter(
          (r) =>
            normalize(r.name).includes(normalizedQuery) ||
            normalize(r.name_kana).includes(normalizedQuery),
        )
      : [];
  const results = allMatches.slice(0, MAX_RESULTS);
  const hiddenCount = allMatches.length - results.length;

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setActiveIndex(0);
  };

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
              onChange={handleInputChange}
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

          {loading && <p className="racer-search-status">読み込み中...</p>}

          {!loading && !query && (
            <p className="racer-search-hint">
              選手名の一部を入力してください（漢字・ひらがな両方に対応）
            </p>
          )}

          {!loading && query && results.length === 0 && (
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
        </div>
      )}
    </div>
  );
}

export default RacerSearchBox;
