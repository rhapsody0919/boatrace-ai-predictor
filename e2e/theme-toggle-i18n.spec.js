import { test, expect } from "./fixtures.js";

/**
 * ThemeToggle の aria-label・title が表示言語に追随することの固定（BOA-620）。
 *
 * Header 内で全ページに出るのに、日本語の直書きだったため /en/ 等でも
 * 「ダークテーマに切り替え」と読み上げ・ツールチップが出ていた。
 * ja の文言は修正前のまま変えない。
 */
const HIRAGANA_KATAKANA = /[぀-ヿ]/;

const CASES = [
  {
    path: "/",
    toDark: "ダークテーマに切り替え",
    toLight: "ライトテーマに切り替え",
  },
  {
    path: "/en/",
    toDark: "Switch to dark theme",
    toLight: "Switch to light theme",
  },
  { path: "/zh-TW/", toDark: "切換為深色主題", toLight: "切換為淺色主題" },
  { path: "/ko/", toDark: "다크 테마로 전환", toLight: "라이트 테마로 전환" },
];

for (const c of CASES) {
  test(`ThemeToggle: ${c.path} で aria-label・title が表示言語になる`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(c.path);
    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
    await page.reload();

    await page.click(".menu-btn");
    const toggle = page.locator(".theme-toggle");
    await expect(toggle).toBeVisible();

    // ライト表示中はダークへの切り替えを案内する
    await expect(toggle).toHaveAttribute("aria-label", c.toDark);
    await expect(toggle).toHaveAttribute("title", c.toDark);

    await toggle.click();
    // 切り替えでメニューが閉じるので開き直す
    await page.click(".menu-btn");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", c.toLight);
    await expect(toggle).toHaveAttribute("title", c.toLight);

    if (c.path !== "/") {
      for (const attr of ["aria-label", "title"]) {
        expect(await toggle.getAttribute(attr)).not.toMatch(HIRAGANA_KATAKANA);
      }
    }

    await page.evaluate(() => localStorage.removeItem("ryujin-radar-theme"));
  });
}
