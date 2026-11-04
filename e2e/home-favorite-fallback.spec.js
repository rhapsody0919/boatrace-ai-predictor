import { test, expect } from "./fixtures.js";
import { rewriteTodayRaces, venueCodeOf } from "./today-races-rewrite.js";
import {
  RACER,
  expectVenueCards,
  routePredictions,
  setFavorites,
} from "./favorite-runs-fixture.js";

/**
 * 区画「お気に入り選手の出走」の代わりの表示と☆の会場の行（GS04-8、BOA-1274、モックの案A）の固定。
 *
 * 代わりの表示はトップの本日のレース（get_today_races）から作る。録画の応答を rewriteTodayRaces で
 * 書き換えて、SG・G1 の有無と☆の会場の開催を決める。☆の選手の出走は予測の応答（テストで組み立てる）。
 */

// 開発機の負荷が高いと、最初に開くトップの変換・読み込みが既定の60秒を超えることがある
test.describe.configure({ timeout: 180_000 });

/** 開催の無い会場コード（録画の本日のレースに無いもの）を返す */
const closedCodeOf = (venues) => {
  const open = new Set(venues.map(venueCodeOf));
  return [...Array(24).keys()].map((i) => i + 1).find((c) => !open.has(c));
};

/**
 * 開催場のうち1つ目を SG、2つ目を G1、残りを一般にする（grades: false なら全部一般）。
 * 決まった会場コード等を返す
 */
async function prepareToday(page, { grades = true } = {}) {
  const info = {};
  await rewriteTodayRaces(page, (venues) => {
    const open = venues.filter((v) => (v.races ?? []).length > 0);
    for (const v of venues)
      for (const r of v.races ?? []) {
        r.raceGrade = "ippan";
        r.cancellationStatus = null;
      }
    if (grades) {
      for (const r of open[0].races) Object.assign(r, { raceGrade: "SG", seriesDay: 5 });
      for (const r of open[1].races) Object.assign(r, { raceGrade: "G1", seriesDay: 3 });
    }
    info.first = venueCodeOf(open[0]);
    info.second = venueCodeOf(open[1]);
    info.openCount = open.length;
    info.closed = closedCodeOf(venues);
  });
  return info;
}

test("☆0件・SG と G1 がある日: SG の行が G1 より上、会場ページへのリンク、☆の付け方", async ({
  page,
}) => {
  const info = await prepareToday(page);
  const calls = await routePredictions(page);
  await page.goto("/");
  await expectVenueCards(page);
  const section = page.getByTestId("favorite-runs");
  await expect(section).toHaveAttribute("data-fav-state", "no_favorites");
  await expect(section).toContainText(
    "お気に入りの選手がまだいない。今日のSG・G1の開催はこちら。",
  );
  const rows = section.locator(".favorite-runs__alt");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator(".favorite-runs__alt-label")).toHaveText(
    "SG",
  );
  await expect(rows.nth(1).locator(".favorite-runs__alt-label")).toHaveText(
    "G1",
  );
  await expect(
    rows.nth(0).getByRole("link", { name: "会場ページ" }),
  ).toHaveAttribute("href", `/venue/${info.first}`);
  await expect(
    rows.nth(1).getByRole("link", { name: "会場ページ" }),
  ).toHaveAttribute("href", `/venue/${info.second}`);
  await expect(rows.nth(0)).toContainText(/日目・12R \d{2}:\d{2} 締切/);
  await expect(section.locator(".favorite-runs__howto")).toContainText(
    "30人まで",
  );
  expect(calls).toEqual([]);

  // today_row_click（遷移は止めて、送った事象だけを見る）
  await page.evaluate(() => {
    window.__events = [];
    window.gtag = (...args) => window.__events.push(args);
    document
      .querySelector('[data-testid="favorite-runs"]')
      .addEventListener("click", (event) => event.preventDefault(), true);
  });
  await rows.nth(0).getByRole("link", { name: "会場ページ" }).click();
  expect(await page.evaluate(() => window.__events)).toContainEqual([
    "event",
    "today_row_click",
    {
      row_kind: "grade_venue",
      row_link: "venue_page",
      row_state: "none",
      fav_state: "no_favorites",
    },
  ]);
});

test("☆0件・SG と G1 が無い日: 「今日の開催は N場」で会場の一覧へ", async ({
  page,
}) => {
  const info = await prepareToday(page, { grades: false });
  await page.goto("/");
  await expectVenueCards(page);
  const section = page.getByTestId("favorite-runs");
  await expect(section.locator(".favorite-runs__message")).toHaveText(
    "お気に入りの選手がまだいない。",
  );
  const count = section.getByRole("link", {
    name: `今日の開催は${info.openCount}場。会場の一覧へ`,
  });
  await expect(count).toHaveAttribute("href", "#today-venues");
  // 押すと会場の一覧（区画の下）へ送る。#today-venues の見出し（区画の上）に戻らない
  await count.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(document.querySelector(".venue-grid").getBoundingClientRect().top),
      ),
    )
    .toBeLessThan(150);
  await expect(section.locator(".favorite-runs__alt")).toHaveCount(0);
  await expect(section.locator(".favorite-runs__howto")).toBeVisible();
});

test("☆の選手はいるが今日の出走なし: ☆の会場の開催（開催中・終了／開催なし）と SG・G1", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const info = await prepareToday(page);
  await routePredictions(page, { withRacer: false });
  // 先にトップを1回開いて会場コードを確定させてから、☆を入れて開き直す
  await page.goto("/");
  await expectVenueCards(page);
  await setFavorites(page, [RACER], [info.first, info.closed]);
  await page.reload();
  await expectVenueCards(page);

  const section = page.getByTestId("favorite-runs");
  await expect(section).toHaveAttribute("data-fav-state", "no_runs");
  await expect(section.locator(".favorite-runs__message")).toHaveText(
    "お気に入りの選手1人は、今日は出走なし。",
  );
  const rows = section.locator(".favorite-runs__alt");
  // ☆の会場2つ → SG → G1
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator(".favorite-runs__alt-label")).toHaveText(
    "お気に入り",
  );
  await expect(rows.nth(0)).toContainText(
    /開催中・次は \d+R \d{2}:\d{2} 締切|本日のレースは終了/,
  );
  await expect(rows.nth(1)).toContainText("今日は開催なし");
  await expect(
    rows.nth(1).getByRole("link", { name: "会場ページ" }),
  ).toHaveAttribute("href", `/venue/${info.closed}`);
  await expect(rows.nth(2).locator(".favorite-runs__alt-label")).toHaveText(
    "SG",
  );
  await expect(section.locator(".favorite-runs__howto")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("☆の選手が出走する日: 出走の行の下に「お気に入りの会場」", async ({
  page,
}) => {
  const info = await prepareToday(page);
  await routePredictions(page);
  await page.goto("/");
  await expectVenueCards(page);
  await setFavorites(page, [RACER], [info.first]);
  await page.reload();

  const section = page.getByTestId("favorite-runs");
  await expect(section).toHaveAttribute("data-fav-state", "runs");
  const venues = section.getByTestId("favorite-venues");
  await expect(venues).toContainText("お気に入りの会場");
  await expect(venues.getByRole("link")).toHaveAttribute(
    "href",
    `/venue/${info.first}`,
  );
  const rowBottom = await section
    .locator(".favorite-runs__row")
    .last()
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const venuesTop = await venues.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(venuesTop).toBeGreaterThanOrEqual(rowBottom);
});

test("/en/: 代わりの表示に日本語が無い", async ({ page }) => {
  await prepareToday(page);
  await page.goto("/en/");
  await expectVenueCards(page);
  const section = page.getByTestId("favorite-runs");
  await expect(section).toContainText("You have no favorite racers yet.");
  expect(
    await section.evaluate((el) => el.textContent.match(/[぀-ヿ㐀-鿿]/gu)),
  ).toBeNull();
  await expect(section.locator('a[href^="/en/venue/"]').first()).toBeVisible();
});
