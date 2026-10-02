import { test, expect } from "./fixtures.js";

/**
 * パンくずの構造化データ（BreadcrumbList、集客レーン 2026-10-02）の固定。
 *
 * Breadcrumb コンポーネントを使うページは、画面のパンくずと同じ並び・名前で BreadcrumbList を出す。
 * item は絶対URL。1ページに BreadcrumbList は1つだけ（ページ側の自前の JSON-LD と二重にしない）。
 */

async function breadcrumbLists(page) {
  return page.locator('script[type="application/ld+json"]').evaluateAll((els) =>
    els
      .map((e) => {
        try {
          return JSON.parse(e.textContent);
        } catch {
          return null;
        }
      })
      .filter((j) => j?.["@type"] === "BreadcrumbList"),
  );
}

test("レース詳細: 画面のパンくずと同じ並びで BreadcrumbList を1つ出す", async ({
  page,
}) => {
  await page.goto("/race/2026-09-21-02-05", { waitUntil: "domcontentloaded" });
  const crumbs = page.locator(".breadcrumb-list .breadcrumb-item");
  await expect(crumbs.last()).toContainText("5R");
  const names = (await crumbs.allTextContents()).map((s) =>
    s.replace("›", "").trim(),
  );

  const lists = await breadcrumbLists(page);
  expect(lists).toHaveLength(1);
  const items = lists[0].itemListElement;
  expect(items.map((i) => i.name)).toEqual(names);
  expect(items.map((i) => i.position)).toEqual(names.map((_, i) => i + 1));
  expect(items.at(-1).item).toBe(
    "https://www.boat-ai.jp/race/2026-09-21-02-05",
  );
  for (const i of items)
    expect(i.item).toMatch(/^https:\/\/www\.boat-ai\.jp\//);
});

test("会場ページ: BreadcrumbList が出る", async ({ page }) => {
  await page.goto("/venue/2", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".breadcrumb-list")).toBeVisible();
  const lists = await breadcrumbLists(page);
  expect(lists).toHaveLength(1);
  expect(lists[0].itemListElement.at(-1).item).toBe(
    "https://www.boat-ai.jp/venue/2",
  );
});
