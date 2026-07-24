/**
 * EnglishVenueGuide - 会場別英語ガイド（/en/venues, /en/venues/:slug）
 * インバウンド観光クエリ（アクセス・入場料・初心者向け）の受け皿 + AI予想への導線（BOA-133）
 * JSX構造は VenueGuide.jsx に共通化済み（BOA-134）。ここでは英語の文言のみを保持する
 */
import { Link } from "react-router-dom";
import { VenueGuideList, VenueGuideDetail } from "./VenueGuide";
import { VENUE_GUIDES_EN } from "../data/venueGuidesEn";

const copy = {
  listTitle: "Boat Race Venues in Japan: Visitor Guides | BoatAI",
  listDescription:
    "English visitor guides to Japan's Kyotei (boat race) venues: how to get there, entrance fees, night races, and betting tips for Heiwajima, Suminoe, Edogawa, Tamagawa and Fukuoka.",
  heroTitle: "🏟️ Boat Race Venue Guides",
  heroLead: (
    <>
      Japan has 24 Kyotei venues, and most welcome visitors for a ¥100 entrance
      fee. These guides cover the venues easiest for travelers to reach — how to
      get there, what makes each one unique, and how to enjoy your first visit.
      New to the sport? Start with our{" "}
      <Link to="/en/guide">beginner&apos;s guide</Link>.
    </>
  ),
  nightRaceBadge: "🌙 Night races",
  ctaHeading: "Check today's AI predictions before you go",
  ctaButton: "🏁 View Free Predictions",
  backToAll: "← All venues",
  detailTitle: (venue) =>
    `Boat Race ${venue.name} (${venue.kanji}): Access & Visitor Guide | BoatAI`,
  detailDescription: (venue) =>
    `How to visit Boat Race ${venue.name} in ${venue.region}: access from the nearest station, entrance fee, water characteristics and betting tips. ${venue.tagline}.`,
  detailHeading: (venue) => (
    <>
      🚤 Boat Race {venue.name} <span className="eg-kanji">{venue.kanji}</span>
    </>
  ),
  whyVisit: "Why visit",
  gettingThere: "🚉 Getting there",
  entranceNote:
    "Entrance fee: ¥100 (most venues). Free shuttle buses run on race days only — check the official venue site for the day's schedule.",
  quickFacts: "⚡ Quick facts",
  factLabels: {
    water: "Water",
    character: "Race style",
    nightRace: "Night races",
    entrance: "Entrance",
  },
  nightRaceYes: "Yes 🌙",
  nightRaceNo: "No (daytime)",
  bettingTip: "💡 Betting tip",
  beforeYouBet: "⚖️ Before you bet",
  disclaimer: (
    <>
      Betting requires being physically in Japan and aged 20 or older. BoatAI
      provides information and AI analysis only — see our{" "}
      <Link to="/en/guide">beginner&apos;s guide</Link> for the rules and bet
      types.
    </>
  ),
  seeTodaysPredictions: (venue) =>
    `See today's AI predictions${venue.facts.nightRace ? " — including night races" : ""}`,
};

export function EnglishVenueGuides() {
  return <VenueGuideList lang="en" guides={VENUE_GUIDES_EN} copy={copy} />;
}

export default function EnglishVenueGuide() {
  return <VenueGuideDetail lang="en" guides={VENUE_GUIDES_EN} copy={copy} />;
}
