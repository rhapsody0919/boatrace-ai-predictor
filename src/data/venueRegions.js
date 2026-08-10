/**
 * 会場の地域区分マスタ（BOA-135）
 * 各会場データの `regionGroup` フィールドと対応するキーを持つ。地域ハブページ（/en/venues/region/:regionSlug）で使用
 * scripts/generate-sitemap.js から node 直実行でも import されるため、Vite 専用構文を使わず純粋な JS データに保つこと
 */

export const VENUE_REGIONS = [
  {
    slug: "kanto",
    label: "Kanto (Tokyo Area)",
    labelZhTw: "關東（東京地區）",
    labelKo: "간토（도쿄 지역）",
  },
  {
    slug: "chubu-tokai",
    label: "Chubu / Tokai",
    labelZhTw: "中部・東海地區",
    labelKo: "주부・도카이",
  },
  {
    slug: "kinki",
    label: "Kinki (Osaka Area)",
    labelZhTw: "近畿（大阪地區）",
    labelKo: "긴키（오사카 지역）",
  },
  {
    slug: "shikoku",
    label: "Shikoku",
    labelZhTw: "四國地區",
    labelKo: "시코쿠",
  },
  {
    slug: "chugoku",
    label: "Chugoku",
    labelZhTw: "中國地區",
    labelKo: "주고쿠",
  },
  { slug: "kyushu", label: "Kyushu", labelZhTw: "九州地區", labelKo: "규슈" },
];

export function getVenueRegion(slug) {
  return VENUE_REGIONS.find((r) => r.slug === slug) || null;
}
