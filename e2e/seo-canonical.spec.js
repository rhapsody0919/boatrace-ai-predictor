import { test, expect } from "./fixtures.js";

// SEO 点検 F1・F4（2026-10-11）。4言語で出すページの canonical が日本語の URL に固定され、
// hreflang・sitemap（各言語の URL を載せている）と食い違っていた。表示中の言語の URL にそろえる。
// 思考アシスト・選手一覧には description・canonical が無かった
// 会場ページは初回の読み込みが重く、60秒の既定では goto が間に合わないことがある（手元で3件）
test.describe.configure({ timeout: 120000 });

const SITE = "https://www.boat-ai.jp";
const RACE = "2026-10-09-20-09";

const canonicalOf = (page) =>
  page.locator('link[rel="canonical"]').first().getAttribute("href");

const LOCALIZED = [
  { path: "/venue/20", expected: "/venue/20" },
  { path: "/en/venue/20", expected: "/en/venue/20" },
  { path: "/ko/venue/20", expected: "/ko/venue/20" },
  { path: "/venue/16/meet/2026-09-28", expected: "/venue/16/meet/2026-09-28" },
  {
    path: "/zh-TW/venue/16/meet/2026-09-28",
    expected: "/zh-TW/venue/16/meet/2026-09-28",
  },
  { path: `/race/${RACE}`, expected: `/race/${RACE}` },
  { path: `/en/race/${RACE}`, expected: `/en/race/${RACE}` },
];

for (const { path, expected } of LOCALIZED) {
  test(`${path}: canonical は表示中の言語の URL で、hreflang の自分の行と一致する`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1, {
      timeout: 30000,
    });
    const canonical = await canonicalOf(page);
    expect(canonical).toBe(`${SITE}${expected}`);
    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(alternates).toContain(canonical);
  });
}

test("思考アシスト: description に日付・R番号があり、canonical は自分自身", async ({
  page,
}) => {
  await page.goto(`/race/${RACE}/assist`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1, {
    timeout: 30000,
  });
  expect(await canonicalOf(page)).toBe(`${SITE}/race/${RACE}/assist`);
  const description = await page
    .locator('meta[name="description"]')
    .first()
    .getAttribute("content");
  expect(description).toContain("2026年10月9日");
  expect(description).toContain("9R");
  expect(description).toContain("思考アシスト");
});

test("選手一覧: canonical は /racers", async ({ page }) => {
  await page.goto("/racers", { waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1, {
    timeout: 30000,
  });
  expect(await canonicalOf(page)).toBe(`${SITE}/racers`);
});
