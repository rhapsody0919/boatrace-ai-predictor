import { Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  const [searchParams] = useSearchParams();
  const pageUrl = (page) => {
    const next = new URLSearchParams(searchParams);
    if (page === 1) next.delete("page");
    else next.set("page", String(page));
    const query = next.toString();
    return `/racers${query ? `?${query}` : ""}`;
  };
  const Previous = currentPage <= 1 ? "span" : Link;
  const Next = currentPage >= totalPages ? "span" : Link;
  if (totalPages <= 1) return null;

  const pages = buildPageList(currentPage, totalPages);

  return (
    <nav className="racer-pagination" aria-label="ページ送り">
      <Previous
        to={currentPage > 1 ? pageUrl(currentPage - 1) : undefined}
        className="racer-pagination-btn"
        onClick={currentPage > 1 ? onPageChange : undefined}
        aria-disabled={currentPage <= 1 ? true : undefined}
        aria-label="前のページ"
      >
        ‹
      </Previous>
      {pages.map((page, i) => {
        const prevPage = pages[i - 1];
        const showEllipsis = prevPage != null && page - prevPage > 1;
        return (
          <Fragment key={page}>
            {showEllipsis && (
              <span className="racer-pagination-ellipsis">…</span>
            )}
            <Link
              to={pageUrl(page)}
              className={`racer-pagination-btn ${
                page === currentPage ? "is-current" : ""
              }`}
              onClick={onPageChange}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </Link>
          </Fragment>
        );
      })}
      <Next
        to={currentPage < totalPages ? pageUrl(currentPage + 1) : undefined}
        className="racer-pagination-btn"
        onClick={currentPage < totalPages ? onPageChange : undefined}
        aria-disabled={currentPage >= totalPages ? true : undefined}
        aria-label="次のページ"
      >
        ›
      </Next>
    </nav>
  );
}

export default RacerListPagination;
