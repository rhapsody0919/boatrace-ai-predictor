import { Link } from "react-router-dom";
import { venues, formatVenueCode } from "./ContentHubLogic";

// 会場攻略セクション
export function VenueSection() {
  return (
    <section className="hub-section venue-section">
      <div className="section-header">
        <span className="section-icon">🏟️</span>
        <h2>会場別攻略ガイド</h2>
      </div>
      <p className="section-desc">
        全国24会場それぞれの特徴と狙い目を解説。水面特性、イン勝率、おすすめの賭け方を紹介。
      </p>
      <div className="guide-venue-grid">
        {venues.map((venue) => (
          <Link
            key={venue.code}
            to={`/blog/venue-${venue.id}`}
            className="guide-venue-card"
          >
            <span className="guide-venue-code">
              {formatVenueCode(venue.code)}
            </span>
            <span className="guide-venue-name">{venue.name}</span>
          </Link>
        ))}
      </div>
      <div className="venue-overview-link">
        <Link to="/blog/stadium-strategy-guide" className="overview-btn">
          24場の特徴と狙い目を一覧で見る →
        </Link>
      </div>
    </section>
  );
}
