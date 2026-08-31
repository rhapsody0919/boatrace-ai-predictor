/**
 * EnglishVenueGuide - 会場別英語ガイド（/en/venues, /en/venues/:slug）
 * インバウンド観光クエリ（アクセス・入場料・初心者向け）の受け皿 + AI予想への導線（BOA-133）
 * JSX構造は VenueGuide.jsx に共通化済み（BOA-134）。ここでは英語の文言のみを保持する
 */
import { Link } from "react-router-dom";
import { VenueGuideList, VenueGuideDetail } from "./VenueGuide";
import { VenueRegionHub } from "./VenueRegionHub";
import { VENUE_GUIDES_EN } from "../data/venueGuidesEn";

const copy = {
  listTitle: "Boat Race Venues in Japan: Visitor Guides | Ryujin Radar",
  listDescription:
    "English visitor guides to all 24 of Japan's Kyotei (boat race) venues: how to get there, entrance fees, night races, and betting tips for each one.",
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
    `Boat Race ${venue.name} (${venue.kanji}): Access & Visitor Guide | Ryujin Radar`,
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
  scheduleHeading: "📅 When it races",
  nearbyAttractionsHeading: "🗺️ Nearby attractions",
  officialSiteLabel: "Official site →",
  mapHeading: "Venue map",
  multiMapLabel: "🗺️ Nearby attractions map (incl. the venue)",
  googleMapLabel: "📍 Google Maps (venue location, opens for directions)",
  scheduleOfficialLabel: "See the full official schedule →",
  videoLabel: "📺 Watch race highlights on the official YouTube channel →",
  raceVideoHeading: "🎬 See what boat racing looks like",
  raceVideoNote:
    "Videos from the official BOATRACE YouTube channel, updated with the latest race highlights — a quick way to get a feel for it before you go.",
  languageBarrierHeading: "🌐 Can I bet if I don't speak Japanese?",
  languageBarrierBody: [
    "Yes. Anyone 20 or older can legally bet at a Japanese boat race venue, regardless of nationality. In-person betting uses a mark sheet — a lottery-style card where you fill in circles for the race number, bet type, boat numbers and amount — so it's mostly about selecting numbers rather than reading Japanese.",
    "Tickets start at just ¥100. Some venues have English signage or offer smartphone translation help, though staff-level English support isn't guaranteed everywhere, so it's worth checking the official English guide beforehand.",
    "One important limit: online betting is only available to residents with a Japanese bank account and address — visitors need to place bets in person at the venue. Also, credit cards and general e-wallets (PayPay, etc.) aren't accepted for betting — each venue issues its own prepaid card instead (see the payment details below).",
  ],
  languageBarrierLinkLabel: "See the official BOATRACE English guide →",
  cashlessHeading: "💳 How to pay here",
  cashlessLinkLabel: "See the official payment guide →",
  bettingTip: "💡 Betting tip",
  beforeYouBet: "⚖️ Before you bet",
  disclaimer: (
    <>
      Betting requires being physically in Japan and aged 20 or older. Ryujin
      Radar provides information and AI analysis only — see our{" "}
      <Link to="/en/guide">beginner&apos;s guide</Link> for the rules and bet
      types.
    </>
  ),
  seeTodaysPredictions: (venue) =>
    `See today's AI predictions${venue.facts.nightRace ? " — including night races" : ""}`,
  regionTitle: (region) =>
    `Boat Race Venues in ${region.label}: Visitor Guides | Ryujin Radar`,
  regionDescription: (region) =>
    `English visitor guides to Kyotei (boat race) venues in ${region.label}: how to get there, entrance fees, and betting tips.`,
  regionHeading: (region) => `🏟️ Boat Race Venues in ${region.label}`,
  regionLabel: (region) => region.label,
};

export function EnglishVenueGuides() {
  return <VenueGuideList lang="en" guides={VENUE_GUIDES_EN} copy={copy} />;
}

export default function EnglishVenueGuide() {
  return <VenueGuideDetail lang="en" guides={VENUE_GUIDES_EN} copy={copy} />;
}

export function EnglishVenueRegionHub() {
  return <VenueRegionHub lang="en" guides={VENUE_GUIDES_EN} copy={copy} />;
}
