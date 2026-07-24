/**
 * VenueGuide - 会場別ビジターガイドの共通コンポーネント（BOA-134）
 * 一覧・詳細のJSX構造を言語非依存にし、lang/guides/copyで言語別ページを組み立てる
 */
import { Link, useParams, Navigate } from "react-router-dom";
import Header from "../components/Header";
import "./EnglishGuide.css";
import "./EnglishVenueGuide.css";

const SITE_URL = "https://www.boat-ai.jp";

// 会場一覧ページ（/{lang}/venues）
export function VenueGuideList({ lang, guides, copy }) {
  const base = `/${lang}`;

  return (
    <div className="app">
      <title>{copy.listTitle}</title>
      <meta name="description" content={copy.listDescription} />
      <link rel="canonical" href={`${SITE_URL}${base}/venues`} />

      <Header />

      <div className="eg-container">
        <section className="eg-hero">
          <h1>{copy.heroTitle}</h1>
          <p className="eg-hero-lead">{copy.heroLead}</p>
        </section>

        <div className="evg-list">
          {guides.map((v) => (
            <Link
              key={v.slug}
              to={`${base}/venues/${v.slug}`}
              className="evg-card"
            >
              <div className="evg-card-head">
                <h2>
                  {v.name} <span className="eg-kanji">{v.kanji}</span>
                </h2>
                <span className="evg-region">{v.region}</span>
              </div>
              <p className="evg-tagline">{v.tagline}</p>
              <div className="evg-badges">
                {v.facts.nightRace && (
                  <span className="evg-badge evg-badge--night">
                    {copy.nightRaceBadge}
                  </span>
                )}
                <span className="evg-badge">{v.facts.water}</span>
              </div>
            </Link>
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

// 会場詳細ページ（/{lang}/venues/:slug）
export function VenueGuideDetail({ lang, guides, copy }) {
  const { slug } = useParams();
  const base = `/${lang}`;
  const venue = guides.find((v) => v.slug === slug) ?? null;

  if (!venue) {
    return <Navigate to={`${base}/venues`} replace />;
  }

  return (
    <div className="app">
      <title>{copy.detailTitle(venue)}</title>
      <meta name="description" content={copy.detailDescription(venue)} />
      <link rel="canonical" href={`${SITE_URL}${base}/venues/${venue.slug}`} />

      <Header />

      <div className="eg-container">
        <nav className="evg-breadcrumb">
          <Link to={`${base}/venues`}>{copy.backToAll}</Link>
        </nav>

        <section className="eg-hero">
          <h1>{copy.detailHeading(venue)}</h1>
          <p className="evg-tagline evg-tagline--hero">{venue.tagline}</p>
        </section>

        <section className="eg-section">
          <h2>{copy.whyVisit}</h2>
          {venue.intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>

        <section className="eg-section">
          <h2>{copy.gettingThere}</h2>
          <ul className="eg-list">
            {venue.access.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="eg-note">{copy.entranceNote}</p>
        </section>

        <section className="eg-section">
          <h2>{copy.quickFacts}</h2>
          <div className="eg-facts-grid">
            <div className="eg-fact">
              <strong>{copy.factLabels.water}</strong>
              <span>{venue.facts.water}</span>
            </div>
            <div className="eg-fact">
              <strong>{copy.factLabels.character}</strong>
              <span>{venue.facts.character}</span>
            </div>
            <div className="eg-fact">
              <strong>{copy.factLabels.nightRace}</strong>
              <span>
                {venue.facts.nightRace ? copy.nightRaceYes : copy.nightRaceNo}
              </span>
            </div>
            <div className="eg-fact">
              <strong>{copy.factLabels.entrance}</strong>
              <span>¥100</span>
            </div>
          </div>
        </section>

        <section className="eg-section eg-highlight">
          <h2>{copy.bettingTip}</h2>
          <p>{venue.tip}</p>
        </section>

        <section className="eg-section eg-disclaimer">
          <h2>{copy.beforeYouBet}</h2>
          <p>{copy.disclaimer}</p>
        </section>

        <section className="eg-cta">
          <h2>{copy.seeTodaysPredictions(venue)}</h2>
          <Link to={`${base}/`} className="eg-cta-button">
            {copy.ctaButton}
          </Link>
        </section>
      </div>
    </div>
  );
}
