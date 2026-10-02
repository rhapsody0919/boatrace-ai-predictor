import { test, expect } from "./fixtures.js";

/**
 * パンくずの構造化データ（BreadcrumbList、集客レーン 2026-10-02）の固定。
 *
 * Breadcrumb コンポーネントを使うページは、画面のパンくずと同じ並び・名前で BreadcrumbList を出す。
 * item は絶対URL。1ページに BreadcrumbList は1つだけ（ページ側の自前の JSON-LD と二重にしない）。
 */

// 開発機の負荷が高いと、最初に開くページの変換・読み込みが既定の60秒を超えることがある
test.describe.configure({ timeout: 180_000 });

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

// Breadcrumb コンポーネントを使う全ページで、JSON-LD の name・item が画面のパンくずと一致し、
// undefined が混ざらないこと。/races は以前 {label, path} で渡していて、画面のパンくずが空、
// JSON-LD の item が "https://www.boat-ai.jp/undefined" になっていた（集客レーン、2026-10-02）
for (const path of [
  "/races",
  "/today",
  "/races/2026-09-21",
  "/races/2026-09-21/2",
]) {
  test(`${path}: 画面のパンくずと BreadcrumbList が一致し、undefined が無い`, async ({
    page,
  }) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const crumbs = page.locator(".breadcrumb-list .breadcrumb-item");
    await expect(crumbs.first()).toBeVisible({ timeout: 30000 });
    const names = (await crumbs.allTextContents()).map((s) =>
      s.replace("›", "").trim(),
    );
    expect(names.every((n) => n.length > 0)).toBe(true);

    const lists = await breadcrumbLists(page);
    expect(lists).toHaveLength(1);
    const items = lists[0].itemListElement;
    expect(items.map((i) => i.name)).toEqual(names);
    for (const i of items) {
      expect(i.item).toMatch(/^https:\/\/www\.boat-ai\.jp\//);
      expect(i.item).not.toContain("undefined");
    }
  });
}
