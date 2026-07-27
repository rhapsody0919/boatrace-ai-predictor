/**
 * 会場別ビジターガイド 全体検証スクリプト（BOA-148）
 *
 * 全24会場のtitle/description/canonical/構造化データ、一覧ページ、地域ハブページの
 * 会場数が正しいかをPlaywrightで一括チェックする。venue-guide-expansion完了時の
 * 最終検証、および今後会場データを変更した際の回帰チェックに使う。
 *
 * 前提: npm run dev でローカルサーバーが起動していること
 *
 * 使い方:
 *   node scripts/analysis/verify-venue-guides.mjs [--base=http://localhost:5180]
 */
import { chromium } from "playwright";
import { VENUE_GUIDES_EN } from "../../src/data/venueGuidesEn.js";
import { VENUE_REGIONS } from "../../src/data/venueRegions.js";

const BASE = (
  process.argv.find((a) => a.startsWith("--base=")) ||
  "--base=http://localhost:5173"
).split("=")[1];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const issues = [];

  for (const venue of VENUE_GUIDES_EN) {
    const url = `${BASE}/en/venues/${venue.slug}`;
    await page.goto(url, { waitUntil: "networkidle" });

    const title = await page.title();
    const description = await page
      .$eval('meta[name="description"]', (el) => el.content)
      .catch(() => null);
    const canonical = await page
      .$eval('link[rel="canonical"]', (el) => el.href)
      .catch(() => null);
    const jsonLd = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => els.map((e) => JSON.parse(e.textContent)),
    );
    const hasTouristAttraction = jsonLd.some(
      (d) => d["@type"] === "TouristAttraction",
    );
    const hasBreadcrumb = jsonLd.some((d) => d["@type"] === "BreadcrumbList");

    if (!title || !title.includes(venue.name)) {
      issues.push(`${venue.slug}: titleに会場名が含まれない ("${title}")`);
    }
    if (!description) {
      issues.push(`${venue.slug}: meta descriptionが見つからない`);
    }
    if (!canonical || !canonical.endsWith(`/venues/${venue.slug}`)) {
      issues.push(`${venue.slug}: canonicalが不正 ("${canonical}")`);
    }
    if (!hasTouristAttraction) {
      issues.push(`${venue.slug}: TouristAttraction構造化データが見つからない`);
    }
    if (!hasBreadcrumb) {
      issues.push(`${venue.slug}: BreadcrumbList構造化データが見つからない`);
    }
  }

  // 一覧ページ
  await page.goto(`${BASE}/en/venues`, { waitUntil: "networkidle" });
  const listCardCount = await page.locator(".evg-card").count();
  if (listCardCount !== VENUE_GUIDES_EN.length) {
    issues.push(
      `一覧ページのカード数が${listCardCount}件（期待値${VENUE_GUIDES_EN.length}件）`,
    );
  }

  // 地域ハブページ（会場0件の地域は/venuesへリダイレクトされる想定）
  for (const region of VENUE_REGIONS) {
    const expectedCount = VENUE_GUIDES_EN.filter(
      (v) => v.regionGroup === region.slug,
    ).length;
    await page.goto(`${BASE}/en/venues/region/${region.slug}`, {
      waitUntil: "networkidle",
    });

    if (expectedCount === 0) {
      if (!page.url().endsWith("/en/venues")) {
        issues.push(
          `${region.slug}地域ハブ: 会場0件のはずが/venuesへリダイレクトされていない`,
        );
      }
      continue;
    }

    const cardCount = await page.locator(".evg-card").count();
    if (cardCount !== expectedCount) {
      issues.push(
        `${region.slug}地域ハブ: カード数が${cardCount}件（期待値${expectedCount}件）`,
      );
    }
  }

  await browser.close();

  if (issues.length > 0) {
    console.error(`❌ ${issues.length}件の問題が見つかりました:`);
    issues.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }

  console.log(
    `✅ 全${VENUE_GUIDES_EN.length}会場 + ${VENUE_REGIONS.length}地域ハブページの検証に成功しました`,
  );
}

main();
