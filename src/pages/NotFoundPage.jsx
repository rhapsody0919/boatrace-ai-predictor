import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import { getAvailableLanguages } from "../config/languages";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import { useRobotsMeta } from "../hooks/useRobotsMeta";

const PAGE_STYLE = {
  maxWidth: "40rem",
  margin: "0 auto",
  padding: "1.5rem 1rem",
  color: "var(--text-primary)",
  overflowWrap: "anywhere",
};
const LIST_STYLE = { paddingLeft: "1.25rem", lineHeight: 2 };

/**
 * 不明なパス・範囲外の会場コードで出す「見つかりません」ページ。
 * HTTP 404 は返せない（SPA）ので、noindex で検索に載らないようにする。
 * @param {boolean} venueOutOfRange 範囲外の会場コード（/venue/99 等）のとき true
 */
export default function NotFoundPage({ venueOutOfRange = false }) {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  useRobotsMeta(true);

  // 会場ガイド（/venues）は ja に無い。ja の会場一覧はトップのグリッド
  const hasVenueGuide = getAvailableLanguages("/venues").some(
    (l) => l.code === i18n.resolvedLanguage,
  );
  const venuesPath = hasVenueGuide ? "/venues" : "/";

  return (
    <>
      <title>{t("notFound.title")}</title>
      <Header />
      <main style={PAGE_STYLE}>
        <h1>{t("notFound.title")}</h1>
        <p>{t("notFound.reason")}</p>
        {venueOutOfRange && <p>{t("notFound.venueRange")}</p>}
        <nav aria-label={t("notFound.linksLabel")}>
          <ul style={LIST_STYLE}>
            <li>
              <Link to={localize("/")}>{t("notFound.today")}</Link>
            </li>
            <li>
              <Link to={localize(venuesPath)}>{t("notFound.venues")}</Link>
            </li>
            <li>
              <Link to={localize("/blog")}>{t("notFound.blog")}</Link>
            </li>
          </ul>
        </nav>
      </main>
    </>
  );
}
