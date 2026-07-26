/**
 * VenueRegionHub - 地域別ビジターガイドのハブページ（/{lang}/venues/region/:regionSlug、BOA-138）
 * VenueGuideList/VenueCardと同じ lang/guides/copy パターンで組み立てる
 */
import { Link, useParams, Navigate } from "react-router-dom";
import Header from "../components/Header";
import { VenueCard } from "./VenueGuide";
import { VenueListStructuredData } from "../components/VenueStructuredData";
import { getVenueRegion } from "../data/venueRegions";
import "./EnglishGuide.css";
import "./EnglishVenueGuide.css";

const SITE_URL = "https://www.boat-ai.jp";

export function VenueRegionHub({ lang, guides, copy }) {
  const { regionSlug } = useParams();
  const base = `/${lang}`;
  const region = getVenueRegion(regionSlug);
  const regionGuides = region
    ? guides.filter((v) => v.regionGroup === region.slug)
    : [];

  if (!region || regionGuides.length === 0) {
    return <Navigate to={`${base}/venues`} replace />;
  }

  return (
    <div className="app">
      <title>{copy.regionTitle(region)}</title>
      <meta name="description" content={copy.regionDescription(region)} />
      <link
        rel="canonical"
        href={`${SITE_URL}${base}/venues/region/${region.slug}`}
      />
      <VenueListStructuredData
        lang={lang}
        guides={regionGuides}
        extraCrumb={{
          name: region.label,
          path: `${base}/venues/region/${region.slug}`,
        }}
      />

      <Header />

      <div className="eg-container">
        <nav className="evg-breadcrumb">
          <Link to={`${base}/venues`}>{copy.backToAll}</Link>
        </nav>

        <section className="eg-hero">
          <h1>{copy.regionHeading(region)}</h1>
        </section>

        <div className="evg-list">
          {regionGuides.map((v) => (
            <VenueCard
              key={v.slug}
              venue={v}
              to={`${base}/venues/${v.slug}`}
              nightRaceBadge={copy.nightRaceBadge}
            />
          ))}
        </div>

        <section className="eg-cta">
          <h2>{copy.ctaHeading}</h2>
          <Link to={`${base}/`} className="eg-cta-button">
            {copy.ctaButton}
          </Link>
        </section>
      </div>
    </div>
  );
}
