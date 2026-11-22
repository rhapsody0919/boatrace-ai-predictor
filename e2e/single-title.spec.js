import { test, expect } from "./fixtures.js";

// 描画後の head の title が svg の外でちょうど1つになることを固定する（BOA-1693）。
// 遷移の途中でも0にならず、GA の page_view の時点の document.title が空でない。
test.use({ viewport: { width: 375, height: 812 }, cookieConsent: "accepted" });

const PAGES = [
  "/",
  "/venue/12",
  "/race/202601011201",
  "/racer/4444",
  "/blog",
  "/privacy",
];

const titleCount = (page) =>
  page.evaluate(
    () =>
      Array.from(document.querySelectorAll("title")).filter(
        (el) => !el.closest("svg"),
      ).length,
  );

const titleTexts = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("title"))
      .filter((el) => !el.closest("svg"))
      .map((el) => el.textContent),
  );

test.describe("head の title は1つ", () => {
  for (const path of PAGES) {
    test(`${path} を直接開くと title が1つで document.title と一致する`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect.poll(() => titleCount(page)).toBe(1);
      const [text] = await titleTexts(page);
      expect(text).not.toBe("");
      expect(await page.title()).toBe(text);
    });
  }

  test("画面内のリンクで移る間も0にならず、page_view の document.title が空でない", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__titleCounts = [];
      window.__pageViewTitles = [];
      window.gtag = (...args) => {
        if (args[0] === "event" && args[1] === "page_view") {
          window.__pageViewTitles.push(document.title);
        }
      };
      const count = () =>
        Array.from(document.querySelectorAll("title")).filter(
          (el) => !el.closest("svg"),
        ).length;
      const start = () => {
        new MutationObserver(() => window.__titleCounts.push(count())).observe(
          document.documentElement,
          { childList: true, subtree: true, characterData: true },
        );
      };
      if (document.documentElement) start();
      else document.addEventListener("DOMContentLoaded", start);
    });

    const go = async (href) => {
      await page.locator(`a[href="${href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect.poll(() => titleCount(page)).toBe(1);
    };

    await page.goto("/");
    await expect.poll(() => titleCount(page)).toBe(1);
    await page.goto("/venue/12");
    await expect.poll(() => titleCount(page)).toBe(1);
    await page.goto("/");
    await go("/blog");
    await page.goto("/");
    await go("/privacy").catch(() => {});

    const counts = await page.evaluate(() => window.__titleCounts);
    // 遷移の途中の記録に、描画の始まる前の head（title 0）は含めない
    const afterFirstTitle = counts.slice(counts.findIndex((n) => n > 0));
    expect(afterFirstTitle).not.toContain(0);

    await expect
      .poll(() => page.evaluate(() => window.__pageViewTitles.length))
      .toBeGreaterThan(0);
    const titles = await page.evaluate(() => window.__pageViewTitles);
    for (const t of titles) expect(t).not.toBe("");
  });
});
