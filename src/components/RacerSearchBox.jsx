import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabaseDataService } from "../services/supabaseDataService";
import "./RacerSearchBox.css";

const MAX_RESULTS = 8;

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

/**
 * ヘッダー用の選手名検索ボックス（ja専用）。
 * 全選手一覧（約1,600件、getAllRacersLite）を初回展開時に一度だけ取得し、
 * 以降はクライアント側でフィルタする（打鍵ごとの通信は発生しない）
 */
function RacerSearchBox() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [racers, setRacers] = useState(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);

  const openSearch = () => {
    setIsOpen(true);
    if (racers === null && !loading) {
      setLoading(true);
      supabaseDataService
        .getAllRacersLite()
        .then((data) => setRacers(data))
        .catch((err) => {
          console.error("選手一覧取得エラー:", err.message);
          setRacers([]);
        })
        .finally(() => setLoading(false));
    }
    // ドロップダウンのレンダー後にフォーカスする
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeSearch = () => {
    setIsOpen(false);
    setQuery("");
  };

  const goToRacer = (racerId) => {
    navigate(`/racer/${racerId}`);
    closeSearch();
  };

  const normalizedQuery = normalize(query);
  const results =
    normalizedQuery.length > 0 && racers
      ? racers
          .filter(
            (r) =>
              normalize(r.name).includes(normalizedQuery) ||
              normalize(r.name_kana).includes(normalizedQuery),
          )
          .slice(0, MAX_RESULTS)
      : [];

  return (
    <div className="racer-search" ref={rootRef}>
      <button
        type="button"
        className="racer-search-trigger"
        onClick={() => (isOpen ? closeSearch() : openSearch())}
        aria-label="選手名で検索"
        aria-expanded={isOpen}
      >
        <span aria-hidden="true">🔍</span>
      </button>
      {isOpen && (
        <div className="racer-search-panel" role="dialog">
          <input
            ref={inputRef}
            type="text"
            className="racer-search-input"
            placeholder="選手名で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter" && results.length > 0) {
                goToRacer(results[0].racer_id);
              }
            }}
            translate="no"
          />
          {loading && <p className="racer-search-status">読み込み中...</p>}
          {!loading && query && results.length === 0 && (
            <p className="racer-search-status">選手が見つかりません</p>
          )}
          {results.length > 0 && (
            <ul className="racer-search-results" translate="no">
              {results.map((r) => (
                <li key={r.racer_id}>
                  <button
                    type="button"
                    className="racer-search-result"
                    onClick={() => goToRacer(r.racer_id)}
                  >
                    {r.name?.replace(/\s+/g, "")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default RacerSearchBox;
