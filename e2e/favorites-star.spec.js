import { test, expect } from "./fixtures.js";

const key = "boatai-user:favorites:v1";
const star = (page) => page.locator(".favorite-star-button");
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

async function prepare(page, value = { racers: [], venues: [] }, failWrite = false) {
  await page.addInitScript(({ key, value, failWrite }) => {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    localStorage.setItem("boatai:cookie-consent", "rejected");
    window.favoriteEvents = [];
    window.gtag = (...args) => window.favoriteEvents.push(args);
    if (failWrite) {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === key) throw new Error("test write failure");
        return setItem.call(this, k, v);
      };
    }
  }, { key, value, failWrite });
}

async function fits(page) {
  const box = await star(page).boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function event(page, name, params) {
  await expect.poll(() => page.evaluate((name) => window.favoriteEvents.filter((e) => e[1] === name), name))
    .toEqual([["event", name, params]]);
}

test.use({ viewport: { width: 375, height: 812 } });

test("選手の見出しで追加・解除・保存・計測", async ({ page }) => {
  await prepare(page);
  await page.goto("/racer/3941");
  await expect(star(page)).toHaveText("☆お気に入りに追加");
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(star(page)).toHaveAccessibleName(/.+をお気に入りに追加/);
  await fits(page);
  await star(page).click();
  await expect(star(page)).toHaveText("★お気に入りに登録中");
  await expect(star(page)).toHaveAttribute("aria-pressed", "true");
  expect((await stored(page)).racers).toEqual([3941]);
  await expect(page.getByRole("status")).toContainText("お気に入りに追加した");
  await fits(page);
  await event(page, "favorite_add", { fav_type: "racer", fav_entry: "racer_header", fav_count: 1 });
  await star(page).click();
  expect((await stored(page)).racers).toEqual([]);
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status")).toContainText("お気に入りから外した");
  await event(page, "favorite_remove", { fav_type: "racer", fav_entry: "racer_header", fav_count: 0 });
});

for (const path of ["/venue/2", "/races/2026-10-01/2", "/en/venue/2"]) {
  test(`会場の見出し ${path}`, async ({ page }) => {
    await prepare(page);
    await page.goto(path);
    await expect(star(page)).toHaveAttribute("aria-pressed", "false");
    if (path.startsWith("/en/")) await expect(star(page)).not.toHaveText(/[ぁ-んァ-ヶ一-龯]/);
    await fits(page);
    await star(page).click();
    expect((await stored(page)).venues).toEqual([2]);
    await expect(star(page)).toHaveAttribute("aria-pressed", "true");
    await fits(page);
    await event(page, "favorite_add", { fav_type: "venue", fav_entry: "venue_header", fav_count: 1 });
  });
}

test("30人の上限を保存・計測・6秒の知らせで確認", async ({ page }) => {
  const racers = Array.from({ length: 30 }, (_, i) => 4000 + i);
  await prepare(page, { racers, venues: [] });
  await page.goto("/racer/3941");
  await star(page).click();
  expect((await stored(page)).racers).toEqual(racers);
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status")).toContainText("30人まで");
  await fits(page);
  await event(page, "favorite_limit", { fav_type: "racer", fav_entry: "racer_header" });
  expect(await page.evaluate(() => window.favoriteEvents.some((e) => e[1] === "favorite_add"))).toBe(false);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toBeHidden({ timeout: 8000 });
});

test("壊れた保存でも初期表示と追加ができる", async ({ page }) => {
  await prepare(page, "{bad");
  await page.goto("/racer/3941");
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await star(page).click();
  expect((await stored(page)).racers).toEqual([3941]);
});

test("書込み失敗は登録せず知らせる", async ({ page }) => {
  await prepare(page, undefined, true);
  await page.goto("/racer/3941");
  await star(page).click();
  await expect(star(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status")).toContainText("保存できない");
  expect(await page.evaluate(() => window.favoriteEvents.some((e) => e[1]?.startsWith("favorite_")))).toBe(false);
});

for (const width of [375, 1440]) {
  test(`暗いテーマでも見出しと操作が収まる ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page);
    await page.goto("/venue/2");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect(star(page)).toBeVisible();
    await fits(page);
    await star(page).click();
    await expect(star(page)).toHaveAttribute("aria-pressed", "true");
    await fits(page);
  });
}
