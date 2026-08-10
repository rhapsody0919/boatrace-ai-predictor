import { test, expect } from "@playwright/test";
import { VENUE_GUIDES_ZH_TW } from "../src/data/venueGuidesZhTw.js";

// 会場ガイドの観光情報が「質向上パターン」に沿っているかを機械的に検証する。
// nearbyAttractionsを追加した会場（=質向上済み）は必ず5〜10件を満たすこと。
// 未着手の会場（フィールド自体が無い）は対象外。
test.describe("会場ガイドデータの品質チェック（zh-TW）", () => {
  for (const venue of VENUE_GUIDES_ZH_TW) {
    if (!venue.nearbyAttractions) continue;

    test(`${venue.slug}: 周辺観光地は5〜10件`, () => {
      const count = venue.nearbyAttractions.length;
      expect(
        count,
        `${venue.slug}のnearbyAttractions件数`,
      ).toBeGreaterThanOrEqual(5);
      expect(count, `${venue.slug}のnearbyAttractions件数`).toBeLessThanOrEqual(
        10,
      );
    });

    test(`${venue.slug}: 会場座標(lat/lng)がある場合、少なくとも半数以上の観光地にも座標がある`, () => {
      if (venue.lat == null || venue.lng == null) return;
      const withCoords = venue.nearbyAttractions.filter(
        (a) => a.lat != null && a.lng != null,
      ).length;
      expect(
        withCoords,
        `${venue.slug}: 座標付き観光地 ${withCoords}/${venue.nearbyAttractions.length}`,
      ).toBeGreaterThanOrEqual(Math.ceil(venue.nearbyAttractions.length / 2));
    });
  }
});
