import { test, expect } from "./fixtures.js";
import {
  ensureOpenVenues,
  rewriteTodayRaces,
  setJstNoon,
} from "./today-races-rewrite.js";

/**
 * トップの開催の無い会場のカードも /venue/N へのリンクにする（BOA-1694 PV09 T3）。
 * 見た目は div のときと変えない。過去の日付の一覧（/races/<日付>）の閉じたカードはリンクにしない。
 *
 * 本日のレースは開催中の会場を2場に固定し、閉じた会場が必ず在るようにする。
 * 見た目の値は、同じクラスの div（直す前の要素）を同じ親に足して比べる。
 */

test.describe.configure({ timeout: 180_000 });

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
];

async function openTop(page, path = "/") {
  await setJstNoon(page);
  await rewriteTodayRaces(page, (venues) => {
    const open = ensureOpenVenues(venues, 2);
    const keep = new Set(open.slice(0, 2));
    for (const v of venues) if (!keep.has(v)) v.races = [];
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".venue-grid-card--closed").first()).toBeVisible({
    timeout: 30000,
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("会場のカードの a 要素は24本で href は /venue/1〜24 に一意。閉じたカードの字は残る", async ({
      page,
    }) => {
      await openTop(page);
      const links = page.locator("a.venue-grid-card");
      await expect(links).toHaveCount(24);
      const hrefs = await links.evaluateAll((els) =>
        els.map((e) => e.getAttribute("href")),
      );
      expect(new Set(hrefs).size).toBe(24);
      expect([...hrefs].sort()).toEqual(
        Array.from({ length: 24 }, (_, i) => `/venue/${i + 1}`).sort(),
      );
      const closed = page.locator("a.venue-grid-card--closed");
      expect(await closed.count()).toBeGreaterThan(0);
      for (const text of await closed.allInnerTexts())
        expect(text).toMatch(/次開催|本日開催なし/);
    });

    test("閉じたカードの見た目は div のときと同じで、横にあふれない", async ({
      page,
    }) => {
      await openTop(page);
      const result = await page.evaluate(() => {
        const props = ["color", "textDecorationLine", "backgroundColor"];
        const pick = (el) => {
          const cs = getComputedStyle(el);
          return Object.fromEntries(props.map((p) => [p, cs[p]]));
        };
        const link = document.querySelector("a.venue-grid-card--closed");
        const ref = document.createElement("div");
        ref.className = link.className;
        link.parentElement.appendChild(ref);
        const out = { link: pick(link), ref: pick(ref) };
        ref.remove();
        const de = document.documentElement;
        out.overflow = de.scrollWidth - de.clientWidth;
        return out;
      });
      expect(result.link).toEqual(result.ref);
      expect(result.link.textDecorationLine).toBe("none");
      expect(result.overflow).toBeLessThanOrEqual(0);
    });

    test("閉じたカードを押すと /venue/N へ移り、コース別成績の節が出る", async ({
      page,
    }) => {
      await openTop(page);
      const card = page.locator("a.venue-grid-card--closed").first();
      const href = await card.getAttribute("href");
      await card.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByTestId("venue-course-section")).toBeVisible({
        timeout: 20000,
      });
    });
  });
}

test("/en/ でも閉じたカードの href は /en/venue/N", async ({ page }) => {
  await openTop(page, "/en/");
  const hrefs = await page
    .locator("a.venue-grid-card--closed")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of hrefs) expect(h).toMatch(/^\/en\/venue\/\d+$/);
});

test("過去の日付の一覧の閉じたカードは a 要素でない", async ({ page }) => {
  await page.goto("/races/2026-08-11");
  const closed = page.locator(".venue-grid-card--closed").first();
  await expect(closed).toBeVisible({ timeout: 10000 });
  await expect(page.locator("a.venue-grid-card--closed")).toHaveCount(0);
  expect(await closed.evaluate((e) => e.tagName)).toBe("DIV");
});
