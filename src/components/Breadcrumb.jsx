import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./Breadcrumb.css";

const SITE_ORIGIN = "https://www.boat-ai.jp";

/**
 * 画面のパンくずと同じ並びで BreadcrumbList の構造化データを出す（集客レーン、2026-10-02）。
 * 検索結果の URL 表示がパンくずになる。このコンポーネントを使うページ（会場・レース詳細・過去の予想・
 * /today 等）は、ページ側に BreadcrumbList を持っていない（About・Blog 等は自前で出しており、
 * このコンポーネントは使っていない）ので、二重にならない。
 */
// 名前か URL が欠けた項目があるときは JSON-LD を出さない。壊れた BreadcrumbList（item が ".../undefined"）は
// Search Console でエラーになる。呼び出し側の渡し方の誤り（{label, path} 等）は e2e で検知する
function isValidCrumbs(items) {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(
      (item) =>
        typeof item?.name === "string" &&
        item.name !== "" &&
        typeof item?.url === "string" &&
        item.url !== "",
    )
  );
}

function toBreadcrumbListLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.url, SITE_ORIGIN).href,
    })),
  };
}

export default function Breadcrumb({ items }) {
  const { t } = useTranslation();
  return (
    <nav className="breadcrumb" aria-label={t("breadcrumbLabel")}>
      {isValidCrumbs(items) && (
        <script type="application/ld+json">
          {JSON.stringify(toBreadcrumbListLd(items))}
        </script>
      )}
      <ol className="breadcrumb-list">
        {items.map((item, index) => (
          <li key={index} className="breadcrumb-item">
            {index < items.length - 1 ? (
              <>
                <Link to={item.url}>{item.name}</Link>
                <span className="breadcrumb-separator">›</span>
              </>
            ) : (
              <span className="breadcrumb-current">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
