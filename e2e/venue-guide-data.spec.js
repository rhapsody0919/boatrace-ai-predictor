import { test, expect } from "@playwright/test";
import { VENUE_GUIDES_ZH_TW } from "../src/data/venueGuidesZhTw.js";
import { VENUE_GUIDES_EN } from "../src/data/venueGuidesEn.js";

// 日本国内のおおよその緯度経度範囲（沖縄〜北海道、離島含む）
const JAPAN_LAT_RANGE = [20, 46];
const JAPAN_LNG_RANGE = [122, 154];

// 会場からあまりに離れた座標はtypo/誤情報の可能性が高いため上限を設ける
const MAX_ATTRACTION_DISTANCE_KM = 100;

function isInJapan(lat, lng) {
  return (
    lat >= JAPAN_LAT_RANGE[0] &&
    lat <= JAPAN_LAT_RANGE[1] &&
    lng >= JAPAN_LNG_RANGE[0] &&
    lng <= JAPAN_LNG_RANGE[1]
  );
}

// Haversine formula（km）
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 「質向上パターン」（2026-08-10確立、memory feedback_venue_guide_quality_upgrade 参照）を
// 完全に適用済みの会場だけを対象にする。nearbyAttractionsだけでなくcashless/videoUrl/lat/lngも
// 全て揃っている会場のみを検証対象とすることで、未着手の会場（en版の大半など）を誤って
// 巻き込まないようにする。
function isQualityUpgraded(venue) {
  return Boolean(
    venue.nearbyAttractions &&
    venue.cashless &&
    venue.videoUrl &&
    venue.lat != null &&
    venue.lng != null,
  );
}

function registerVenueGuideQualityTests(guides, label) {
  test.describe(`会場ガイドデータの品質チェック（${label}）`, () => {
    for (const venue of guides) {
      if (!isQualityUpgraded(venue)) continue;

      test(`${venue.slug}: 会場写真(image)が必須フィールドを満たす`, () => {
        expect(venue.image, `${venue.slug}にimageが無い`).toBeTruthy();
        expect(venue.image.src, `${venue.slug}.image.src`).toBeTruthy();
        expect(venue.image.alt, `${venue.slug}.image.alt`).toBeTruthy();
        expect(venue.image.credit, `${venue.slug}.image.credit`).toBeTruthy();
        expect(venue.image.creditUrl, `${venue.slug}.image.creditUrl`).toMatch(
          /^https:\/\//,
        );
      });

      test(`${venue.slug}: 会場座標(lat/lng)が日本国内の範囲内`, () => {
        expect(
          isInJapan(venue.lat, venue.lng),
          `${venue.slug}: (${venue.lat}, ${venue.lng})が日本国内の範囲外`,
        ).toBe(true);
      });

      test(`${venue.slug}: mapQueryが設定されている`, () => {
        expect(venue.mapQuery, `${venue.slug}.mapQuery`).toBeTruthy();
      });

      test(`${venue.slug}: videoUrlがYouTubeの有効な形式`, () => {
        expect(venue.videoUrl, `${venue.slug}.videoUrl`).toMatch(
          /^https:\/\/www\.youtube\.com\//,
        );
      });

      test(`${venue.slug}: cashless情報が必須フィールドを満たす`, () => {
        expect(venue.cashless.note, `${venue.slug}.cashless.note`).toBeTruthy();
        expect(venue.cashless.url, `${venue.slug}.cashless.url`).toMatch(
          /^https:\/\//,
        );
      });

      test(`${venue.slug}: scheduleが設定されている`, () => {
        expect(
          venue.schedule?.typicalRaceDays,
          `${venue.slug}.schedule.typicalRaceDays`,
        ).toBeTruthy();
      });

      test(`${venue.slug}: 周辺観光地は5〜10件`, () => {
        const count = venue.nearbyAttractions.length;
        expect(
          count,
          `${venue.slug}のnearbyAttractions件数`,
        ).toBeGreaterThanOrEqual(5);
        expect(
          count,
          `${venue.slug}のnearbyAttractions件数`,
        ).toBeLessThanOrEqual(10);
      });

      test(`${venue.slug}: 各観光地がname/descriptionを持つ`, () => {
        venue.nearbyAttractions.forEach((a, i) => {
          expect(
            a.name,
            `${venue.slug}.nearbyAttractions[${i}].name`,
          ).toBeTruthy();
          expect(
            a.description,
            `${venue.slug}.nearbyAttractions[${i}].description`,
          ).toBeTruthy();
        });
      });

      test(`${venue.slug}: 少なくとも半数以上の観光地に座標がある`, () => {
        const withCoords = venue.nearbyAttractions.filter(
          (a) => a.lat != null && a.lng != null,
        ).length;
        expect(
          withCoords,
          `${venue.slug}: 座標付き観光地 ${withCoords}/${venue.nearbyAttractions.length}`,
        ).toBeGreaterThanOrEqual(Math.ceil(venue.nearbyAttractions.length / 2));
      });

      test(`${venue.slug}: 観光地の座標は日本国内かつ会場から${MAX_ATTRACTION_DISTANCE_KM}km以内`, () => {
        venue.nearbyAttractions.forEach((a, i) => {
          if (a.lat == null || a.lng == null) return;
          expect(
            isInJapan(a.lat, a.lng),
            `${venue.slug}.nearbyAttractions[${i}](${a.name}): (${a.lat}, ${a.lng})が日本国内の範囲外`,
          ).toBe(true);
          const dist = distanceKm(venue.lat, venue.lng, a.lat, a.lng);
          expect(
            dist,
            `${venue.slug}.nearbyAttractions[${i}](${a.name}): 会場から${dist.toFixed(1)}km離れている`,
          ).toBeLessThanOrEqual(MAX_ATTRACTION_DISTANCE_KM);
        });
      });
    }
  });
}

registerVenueGuideQualityTests(VENUE_GUIDES_ZH_TW, "zh-TW");
registerVenueGuideQualityTests(VENUE_GUIDES_EN, "en");
