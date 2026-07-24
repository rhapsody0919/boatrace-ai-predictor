/**
 * VenueStructuredData - 会場ガイドの構造化データ（schema.org JSON-LD）共通コンポーネント（BOA-137）
 * TouristAttraction採用の経緯は docs/adr/0001-venue-guide-schema-org-type.md を参照
 * 一覧（list）・詳細（detail）ページの両方から呼ばれる想定（地域ハブページも一覧と同じ構造で利用予定、BOA-138）
 */
const SITE_URL = "https://www.boat-ai.jp";

function toTouristAttraction(venue, url) {
  return {
    "@type": "TouristAttraction",
    name: `${venue.name} (${venue.kanji})`,
    description: venue.tagline,
    url,
    ...(venue.image ? { image: `${SITE_URL}${venue.image.src}` } : {}),
  };
}

// 一覧ページ用: ItemList + パンくずリスト（Home > Venues）
export function VenueListStructuredData({ lang, guides }) {
  const base = `/${lang}`;
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: guides.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: toTouristAttraction(v, `${SITE_URL}${base}/venues/${v.slug}`),
    })),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}${base}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Venues",
        item: `${SITE_URL}${base}/venues`,
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json">{JSON.stringify(itemList)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumb)}</script>
    </>
  );
}

// 詳細ページ用: TouristAttraction + パンくずリスト（Home > Venues > 会場名）
export function VenueDetailStructuredData({ lang, venue }) {
  const base = `/${lang}`;
  const url = `${SITE_URL}${base}/venues/${venue.slug}`;
  const attraction = {
    "@context": "https://schema.org",
    ...toTouristAttraction(venue, url),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}${base}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Venues",
        item: `${SITE_URL}${base}/venues`,
      },
      { "@type": "ListItem", position: 3, name: venue.name, item: url },
    ],
  };

  return (
    <>
      <script type="application/ld+json">{JSON.stringify(attraction)}</script>
      <script type="application/ld+json">{JSON.stringify(breadcrumb)}</script>
    </>
  );
}
