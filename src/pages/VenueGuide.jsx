/**
 * VenueGuide - 会場別ビジターガイドの共通コンポーネント（BOA-134）
 * 一覧・詳細のJSX構造を言語非依存にし、lang/guides/copyで言語別ページを組み立てる
 */
import { Link, useParams, Navigate } from "react-router-dom";
import Header from "../components/Header";
import {
  VenueListStructuredData,
  VenueDetailStructuredData,
} from "../components/VenueStructuredData";
import VenueMap from "../components/VenueMap";
import { VENUE_IMAGE_DIMENSIONS } from "../data/venueImageDimensions";
import "./EnglishGuide.css";
import "./EnglishVenueGuide.css";

const SITE_URL = "https://www.boat-ai.jp";

// 会場カード（一覧・地域ハブページ共通、BOA-136）
export function VenueCard({ venue, to, nightRaceBadge }) {
  return (
    <Link to={to} className="evg-card">
      <div className="evg-card-head">
        <h2>
          {venue.name} <span className="eg-kanji">{venue.kanji}</span>
        </h2>
        <span className="evg-region">{venue.region}</span>
      </div>
      <p className="evg-tagline">{venue.tagline}</p>
      <div className="evg-badges">
        {venue.facts.nightRace && (
          <span className="evg-badge evg-badge--night">{nightRaceBadge}</span>
        )}
        <span className="evg-badge">{venue.facts.water}</span>
      </div>
    </Link>
  );
}

// 会場一覧ページ（/{lang}/venues）
export function VenueGuideList({ lang, guides, copy }) {
  const base = `/${lang}`;

  return (
    <div className="app">
      <title>{copy.listTitle}</title>
      <meta name="description" content={copy.listDescription} />
      <link rel="canonical" href={`${SITE_URL}${base}/venues`} />
      <VenueListStructuredData lang={lang} guides={guides} />

      <Header />

      <div className="eg-container">
        <section className="eg-hero">
          <h1>{copy.heroTitle}</h1>
          <p className="eg-hero-lead">{copy.heroLead}</p>
        </section>

        <div className="evg-list">
          {guides.map((v) => (
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
      <VenueDetailStructuredData lang={lang} venue={venue} />

      <Header />

      <div className="eg-container">
        <nav className="evg-breadcrumb">
          <Link to={`${base}/venues`}>{copy.backToAll}</Link>
        </nav>

        <section className="eg-hero">
          <h1>{copy.detailHeading(venue)}</h1>
          <p className="evg-tagline evg-tagline--hero">{venue.tagline}</p>
        </section>

        {venue.image && (
          <figure className="evg-photo">
            <img
              src={venue.image.src}
              alt={venue.image.alt}
              loading="lazy"
              width={VENUE_IMAGE_DIMENSIONS[venue.image.src]?.width}
              height={VENUE_IMAGE_DIMENSIONS[venue.image.src]?.height}
            />
            <figcaption>
              <a
                href={venue.image.creditUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {venue.image.credit}
              </a>
            </figcaption>
          </figure>
        )}

        <section className="eg-section">
          <h2>{copy.whyVisit}</h2>
          {venue.intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>

        <section className="eg-section">
          <h2>{copy.raceVideoHeading}</h2>
          <div className="evg-map">
            <iframe
              title={copy.raceVideoHeading}
              src="https://www.youtube.com/embed/videoseries?list=UU4zGMicoES8FZwkhiXXZThg"
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="eg-note">{copy.raceVideoNote}</p>
        </section>

        <section className="eg-section">
          <h2>{copy.gettingThere}</h2>
          <ul className="eg-list">
            {venue.access.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="eg-note">{copy.entranceNote}</p>
          {venue.lat && venue.lng && (
            <>
              <p className="evg-map-label">{copy.multiMapLabel}</p>
              <VenueMap
                venue={venue}
                venueLabel={venue.name}
                attractions={venue.nearbyAttractions}
              />
            </>
          )}
          {venue.mapQuery && (
            <>
              <p className="evg-map-label">{copy.googleMapLabel}</p>
              <div className="evg-map">
                <iframe
                  title={copy.mapHeading}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(venue.mapQuery)}&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </>
          )}
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
          {venue.videoUrl && (
            <a
              className="evg-video-link"
              href={venue.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.videoLabel}
            </a>
          )}
        </section>

        {venue.schedule?.typicalRaceDays && (
          <section className="eg-section">
            <h2>{copy.scheduleHeading}</h2>
            <p>{venue.schedule.typicalRaceDays}</p>
            {venue.schedule.seasonalNotes && (
              <p className="eg-note">{venue.schedule.seasonalNotes}</p>
            )}
            <a
              href={`https://www.boatrace.jp/owpc/pc/site/place/stadium/br${String(venue.code).padStart(2, "0")}/`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.scheduleOfficialLabel}
            </a>
          </section>
        )}

        {venue.nearbyAttractions?.length > 0 && (
          <section className="eg-section">
            <h2>{copy.nearbyAttractionsHeading}</h2>
            <ul className="eg-list">
              {venue.nearbyAttractions.map((a, i) => (
                <li key={i}>
                  <strong>{a.name}</strong> — {a.description}
                  {a.url && (
                    <>
                      {" "}
                      <a href={a.url} target="_blank" rel="noopener noreferrer">
                        {copy.officialSiteLabel}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="eg-section">
          <h2>{copy.languageBarrierHeading}</h2>
          {copy.languageBarrierBody.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <a
            href="https://www.boatrace.jp/extent/common/en/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.languageBarrierLinkLabel}
          </a>
          {venue.cashless && (
            <>
              <h3 className="eg-subheading">{copy.cashlessHeading}</h3>
              <p>{venue.cashless.note}</p>
              <a
                href={venue.cashless.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.cashlessLinkLabel}
              </a>
            </>
          )}
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
