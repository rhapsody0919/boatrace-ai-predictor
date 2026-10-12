import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./Breadcrumb.css";
import { isValidCrumbs, toBreadcrumbListLd } from "../utils/breadcrumbLd";

/**
 * 画面のパンくずと同じ並びで BreadcrumbList の構造化データを出す（集客レーン、2026-10-02）。
 * 検索結果の URL 表示がパンくずになる。このコンポーネントを使うページ（会場・レース詳細・過去の予想・
 * /today 等）は、ページ側に BreadcrumbList を持っていない（About・Blog 等は自前で出しており、
 * このコンポーネントは使っていない）ので、二重にならない。
 * JSON-LD はボット向け HTML（ADR 0089）と同じ関数（utils/breadcrumbLd.js）で組む
 */

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
