import { test, expect } from "./fixtures.js";

/**
 * Cookie の同意の帯は document.body の直下（#root の外）に出す（BOA-1695）。
 * #root の最初の子になると、JS を回さない取得や読み上げで本文より先に帯の文が来る。
 * 見た目は変えない: position・bottom・z-index は CookieConsent.css の値（直す前と同じ）。
 */
test.describe("未回答（cookieConsent: null）", () => {
  test.use({ cookieConsent: null });

  const VIEWPORTS = [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ];
  const PATHS = ["/", "/venue/12", "/en/"];

  for (const viewport of VIEWPORTS) {
    for (const path of PATHS) {
      test(`${viewport.width}px ${path}: 帯は #root の外で、見た目は変わらない`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.goto(path);
        const banner = page.locator(".cookie-consent");
        await expect(banner).toBeVisible({ timeout: 25000 });
        // 帯は下からせり上がる（0.3秒）。途中で測らない
        await page.evaluate(() =>
          Promise.all(
            (
              document.querySelector(".cookie-consent")?.getAnimations() ?? []
            ).map((a) => a.finished),
          ),
        );

        const dom = await page.evaluate(() => {
          const root = document.getElementById("root");
          const el = document.querySelector(".cookie-consent");
          const cs = getComputedStyle(el);
          return {
            firstChildIsBanner: root.firstElementChild === el,
            insideRoot: root.contains(el),
            parentIsBody: el.parentElement === document.body,
            rootHead: root.innerText.slice(0, 120),
            bottomGap: Math.abs(
              window.innerHeight - el.getBoundingClientRect().bottom,
            ),
            position: cs.position,
            bottom: cs.bottom,
            zIndex: cs.zIndex,
          };
        });
        expect(dom.firstChildIsBanner).toBe(false);
        expect(dom.insideRoot).toBe(false);
        expect(dom.parentIsBody).toBe(true);
        expect(dom.rootHead).not.toContain("Cookie");
        expect(dom.bottomGap).toBeLessThanOrEqual(1);
        // 直す前の値（CookieConsent.css の position: fixed・bottom: 0・z-index: 9999）
        expect(dom.position).toBe("fixed");
        expect(dom.bottom).toBe("0px");
        expect(dom.zIndex).toBe("9999");
      });
    }
  }

  for (const [label, key, stored] of [
    ["同意する", ".cookie-consent__accept", "accepted"],
    ["拒否する", ".cookie-consent__reject", "rejected"],
  ]) {
    test(`「${label}」で帯が消え、再読み込みで出ない`, async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".cookie-consent")).toBeVisible({
        timeout: 25000,
      });
      await page.locator(key).click();
      await expect(page.locator(".cookie-consent")).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("boatai:cookie-consent"),
        ),
      ).toBe(stored);
      await page.reload();
      await expect(page.locator(".cookie-consent")).toHaveCount(0);
    });
  }
});
