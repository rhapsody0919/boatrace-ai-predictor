/**
 * 会場の地域区分マスタ（BOA-135）
 * 各会場データの `regionGroup` フィールドと対応するキーを持つ。地域ハブページ（/en/venues/region/:regionSlug）で使用
 * scripts/generate-sitemap.js から node 直実行でも import されるため、Vite 専用構文を使わず純粋な JS データに保つこと
 */

export const VENUE_REGIONS = [
  { slug: "kanto", label: "Kanto (Tokyo Area)" },
  { slug: "chubu-tokai", label: "Chubu / Tokai" },
  { slug: "kinki", label: "Kinki (Osaka Area)" },
  { slug: "shikoku", label: "Shikoku" },
  { slug: "chugoku", label: "Chugoku" },
  { slug: "kyushu", label: "Kyushu" },
];

export function getVenueRegion(slug) {
  return VENUE_REGIONS.find((r) => r.slug === slug) || null;
}
