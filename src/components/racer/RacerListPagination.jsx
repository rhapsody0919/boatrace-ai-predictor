import { Fragment } from "react";
import "./RacerListPagination.css";

// 現在ページの前後1件・先頭・末尾を表示し、間は省略記号にする
// （例: 1 … 4 5 6 … 33）
function buildPageList(currentPage, totalPages) {
  const pages = new Set([
    1,
    totalPages,
    currentPage - 1,
    currentPage,
    currentPage + 1,
  ]);
  return Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
}

/**
 * ページ番号方式のページネーション（docs/design/racer-search-and-list/spec.md FR2）
 */
function RacerListPagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = buildPageList(currentPage, totalPages);

  return (
    <nav className="racer-pagination" aria-label="ページ送り">
      <button
        type="button"
        className="racer-pagination-btn"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="前のページ"
      >
        ‹
      </button>
      {pages.map((page, i) => {
        const prevPage = pages[i - 1];
        const showEllipsis = prevPage != null && page - prevPage > 1;
        return (
          <Fragment key={page}>
            {showEllipsis && (
              <span className="racer-pagination-ellipsis">…</span>
            )}
            <button
              type="button"
              className={`racer-pagination-btn ${
                page === currentPage ? "is-current" : ""
              }`}
              onClick={() => onPageChange(page)}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </button>
          </Fragment>
        );
      })}
      <button
        type="button"
        className="racer-pagination-btn"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="次のページ"
      >
        ›
      </button>
    </nav>
  );
}

export default RacerListPagination;
