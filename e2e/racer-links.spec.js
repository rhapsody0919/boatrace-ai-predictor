import { test, expect } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
  thinkingAssistScenario,
} from "./thinking-assist-fixture.js";

/**
 * 選手名から選手ページ（/racer/{登録番号}）へのリンク（BOA-879）。
 * 思考アシスト: 艇の行は深掘りを開くボタンのまま、深掘りの見出しのフルネームをリンクにする（案B、2026-10-15 オーナー決定）
 * 龍神ソナーの平均STの表・基本情報・今節: 押すと開く・選ぶ操作は変えず、表の最終行・開いた詳細・選んだ艇の詳細に
 * リンクを置く（ファン4人の議論、docs/design/racer-links/fan-panel.md）
 * 例のレースは 2026-10-06 徳山10R（1号艇 三馬崇史 = 5243、3号艇 西岡顕心 = 5224）
 */

test.describe("BOA-879: 思考アシストの選手名リンク", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
    await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
    await expect(page.getByRole("tablist", { name: "見方" })).toBeVisible({
      timeout: 20000,
    });
  });

  test("艇の行は深掘りを開くボタンのまま（リンクにしない）", async ({ page }) => {
    const row = page.getByRole("button", { name: /^3号艇 西岡$/ });
    await expect(row).toBeVisible();
    await expect(row.locator("a")).toHaveCount(0);
    await row.click();
    await expect(page.getByRole("region", { name: /3号艇/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/race/${THINKING_ASSIST_RACE}/assist`));
  });

  test("深掘りの見出しのフルネームが選手ページへのリンクになり、押すと移る", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^3号艇 西岡$/ }).click();
    const deep = page.getByRole("region", { name: /3号艇/ });
    const link = deep.getByRole("heading").getByRole("link", { name: /西岡/ });
    await expect(link).toHaveAttribute("href", "/racer/5224");
    await expect(link).toHaveAttribute("translate", "no");
    await link.click();
    await expect(page).toHaveURL(/\/racer\/5224$/);
  });
});

const RACE_IDS = ["5243", "5166", "5224", "5085", "5136", "5245"];

test.describe("BOA-879: レース詳細の選手名リンク", () => {
  test("龍神ソナーの平均STの表: 最終行の › は各艇の選手ページの「STの推移」へ", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    // ソナーの展開シナリオは範囲キーを問わず同じ固定の応答にする（表の中身はこのテストの対象外）
    await page.route("**/api/analogy/scenario/**", (route) =>
      route.fulfill({ json: thinkingAssistScenario("NC:2-2-2-0:1B1") }),
    );
    await page.goto(`/race/${THINKING_ASSIST_RACE}?tab=sonar&sonar=scenario`);
    const section = page.getByRole("region", { name: /龍神ソナー/ });
    await section.getByText("数字で見る（平均STの表）").click({
      timeout: 30000,
    });
    const row = section
      .locator(".af-hint-t tbody tr")
      .filter({
        has: page.getByRole("rowheader", { name: "選手ページのSTの推移" }),
      });
    const links = row.getByRole("link");
    await expect(links).toHaveCount(6);
    for (const [i, id] of RACE_IDS.entries()) {
      await expect(links.nth(i)).toHaveAttribute(
        "href",
        `/racer/${id}#st-trend`,
      );
      await expect(links.nth(i)).toHaveAccessibleName(
        `${i + 1}号艇の選手のSTの推移（選手ページ）`,
      );
    }
    await links.nth(2).click();
    await expect(page).toHaveURL(/\/racer\/5224#st-trend$/);
    // 成績が後から届いても「STの推移」が画面の上に来る
    const trend = page.locator("#st-trend");
    await expect(trend).toBeVisible({ timeout: 30000 });
    await expect
      .poll(() => trend.evaluate((e) => Math.round(e.getBoundingClientRect().top)))
      .toBeLessThan(200);
  });

  test("基本情報: 艇の行は押すと開くまま、開いた中の一番上に選手ページへのリンク", async ({
    page,
  }) => {
    await page.goto(`/race/${THINKING_ASSIST_RACE}?tab=basic`);
    const row = page.locator(".rbit-bar-row").nth(2);
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator("a")).toHaveCount(0);
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const link = page
      .locator(".rbit-expanded")
      .getByRole("link", { name: /^西岡顕心\s?の選手ページ ›$/ });
    await expect(link).toHaveAttribute("href", "/racer/5224");
    await link.click();
    await expect(page).toHaveURL(/\/racer\/5224$/);
  });

  test("今節: 艇の選択チップは選ぶまま、選んだ艇の詳細の一番上に選手ページへのリンク", async ({
    page,
  }) => {
    await page.goto(`/race/${THINKING_ASSIST_RACE}?tab=meet`);
    const chip = page.locator(".rmt-select-chip", { hasText: "西岡顕心" });
    await expect(chip).toBeVisible({ timeout: 30000 });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const link = page.getByTestId("racer-page-detail-link");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText("西岡顕心の選手ページ ›");
    await expect(link).toHaveAttribute("href", "/racer/5224");
  });
});
