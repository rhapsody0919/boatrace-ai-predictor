/**
 * RacerStructuredData - 選手個別ページの構造化データ（schema.org/Person JSON-LD）
 * VenueStructuredData.jsxと同じ形式を踏襲。プロフィール未取得の選手では何も出力しない
 */
const SITE_URL = "https://www.boat-ai.jp";

export default function RacerStructuredData({ profile, racerId }) {
  if (!profile) return null;

  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name?.replace(/\s+/g, ""),
    ...(profile.birth_date ? { birthDate: profile.birth_date } : {}),
    ...(profile.hometown ? { homeLocation: profile.hometown } : {}),
    url: `${SITE_URL}/racer/${racerId}`,
  };

  return <script type="application/ld+json">{JSON.stringify(person)}</script>;
}
