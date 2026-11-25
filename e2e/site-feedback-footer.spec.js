import { test, expect } from "./fixtures.js";
import { RACE_PATH, panel } from "./site-feedback-helpers.js";

/**
 * ご意見ボックスのフッターの入口（src/components/Footer.jsx の「ご意見・ご要望を送る」）。
 * 右下のボタンと同じパネルを開く。ボタン・パネルの動きは site-feedback.spec.js・site-feedback-placement.spec.js。
 */
const entry = (page) => page.getByTestId("site-feedback-footer");

test.describe("パソコンの幅（1280px）", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("フッターの入口からも同じパネルが開き、閉じるとフッターの入口へフォーカスが戻る", async ({
    page,
  }) => {
    await page.goto("/contact");
    await expect(entry(page)).toHaveText("ご意見・ご要望を送る");
    await entry(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(entry(page)).toBeFocused();
  });

  // 出さない画面。先にその画面に固有の物が見えるのを待つ（白い画面のまま「無い」で通さない）
  test(`${RACE_PATH}/assist ではフッターの入口も出さない`, async ({ page }) => {
    await page.goto(`${RACE_PATH}/assist`);
    await expect(page.locator(".ta-header-row").first()).toBeVisible({
      timeout: 25000,
    });
    await expect(entry(page)).toHaveCount(0);
  });
});

test.describe("Cookie の確認が出ている間（未回答）", () => {
  test.use({ cookieConsent: null, viewport: { width: 1280, height: 800 } });

  test("確認が出ている間はフッターの入口も出さない（開いたパネルの「送る」が帯に隠れる）", async ({
    page,
  }) => {
    await page.goto("/contact");
    await expect(page.locator(".cookie-consent")).toBeVisible({
      timeout: 25000,
    });
    await expect(entry(page)).toBeHidden();
    await page.locator(".cookie-consent__reject").click();
    await expect(entry(page)).toBeVisible();
  });
});
