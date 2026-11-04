import { test, expect, e2eTodayJST } from "./fixtures.js";

/**
 * トップの区画「お気に入り選手の出走」（GS04-6、BOA-1272）の固定。
 *
 * 区画は予測の応答（Edge API /api/predictions/{date}?light=true、失敗時は RPC
 * get_predictions_by_date_light）から☆の選手を拾う。開催日程に左右されないよう、その応答を
 * テストの中で組み立てて返す。トップの会場カード（get_today_races）は録画のまま。
 *
 * #2225 は get_today_races の形（entries・racerId が無い）を読んで、☆0件でも
 * `race.entries is not iterable` でトップ全体を落とした。☆0件・取得失敗でも会場カード24件が
 * 出ることを、ここで固定する。
 */

// 開発機の負荷が高いと、最初に開くトップの変換・読み込みが既定の60秒を超えることがある
test.describe.configure({ timeout: 180_000 });

const PREDICTIONS =
  /\/api\/predictions\/|\/rest\/v1\/rpc\/get_predictions_by_date/;
const FAVORITES_KEY = "boatai-user:favorites:v1";
const VENUE = 12; // 住之江
const RACER = 4320;

const raceIdOf = (venue, race) =>
  `${e2eTodayJST()}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`;

/** 住之江 1R〜6R。2R〜6R の1号艇が☆の選手。startTime は既定で録画時刻（JST 10時台）より後 */
function predictionsBody({ startTime = (n) => `23:0${n}` } = {}) {
  const races = [1, 2, 3, 4, 5, 6].map((n) => ({
    raceId: raceIdOf(VENUE, n),
    venueCode: VENUE,
    venue: "住之江",
    raceNumber: n,
    startTime: startTime(n),
    raceGrade: "SG",
    cancellationStatus: null,
    entries: [1, 2, 3, 4, 5, 6].map((number) => ({
      number,
      racerId: number === 1 && n >= 2 ? RACER : 9000 + number,
      name: number === 1 && n >= 2 ? "峰竜太" : `選手${number}`,
      grade: "A1",
    })),
    predictions: {},
  }));
  // 別の会場の、☆の選手がいないレース（拾わないこと）
  races.push({
    raceId: raceIdOf(1, 1),
    venueCode: 1,
    venue: "桐生",
    raceNumber: 1,
    startTime: "22:00",
    raceGrade: "ippan",
    cancellationStatus: null,
    entries: [{ number: 1, racerId: 9100, name: "別の選手", grade: "B1" }],
    predictions: {},
  });
  return { date: e2eTodayJST(), races };
}

/** 予測の応答を差し替える。要求の数を返す（☆0件で読まないことを確かめる） */
async function routePredictions(page, { abort = false, ...options } = {}) {
  const calls = [];
  await page.route(PREDICTIONS, async (route) => {
    calls.push(route.request().url());
    if (abort) return route.abort();
    return route.fulfill({ json: predictionsBody(options) });
  });
  return calls;
}

async function setFavorites(page, racers) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [FAVORITES_KEY, JSON.stringify({ racers, venues: [] })],
  );
}

async function expectVenueCards(page) {
  await expect(
    page.locator(".venue-grid-card--open, .venue-grid-card--closed"),
  ).toHaveCount(24, { timeout: 30000 });
  await expect(page.locator(".data-fetch-error")).toHaveCount(0);
}

test("☆0件なら区画を出さず、予測も読まず、会場カード24件が出る（#2225 の再発防止）", async ({
  page,
}) => {
  const calls = await routePredictions(page);
  await page.goto("/");
  await expectVenueCards(page);
  await expect(page.getByTestId("favorite-runs")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("☆があって予測の取得に失敗しても、区画を出さず会場カード24件が出る", async ({
  page,
}) => {
  await setFavorites(page, [RACER]);
  const calls = await routePredictions(page, { abort: true });
  await page.goto("/");
  await expectVenueCards(page);
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  await expect(page.getByTestId("favorite-runs")).toHaveCount(0);
});

test("375px: 締切の順に4件出し、あと1件を開く。入口・事象・置き場所", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.goto("/");
  await expectVenueCards(page);

  const section = page.getByTestId("favorite-runs");
  await expect(
    section.getByRole("heading", { name: "お気に入り選手の出走" }),
  ).toBeVisible();
  await expect(section).toContainText(
    "お気に入りの選手1人のうち1人が今日出走・5レース",
  );
  const rows = section.locator(".favorite-runs__row:visible");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("23:02");
  await expect(rows.first()).toContainText("住之江 2R");
  await expect(rows.first()).toContainText("峰竜太");
  await expect(rows.first().locator(".favorite-runs__grade")).toHaveText("SG");
  await expect(rows.first().locator('[translate="no"]')).toHaveText("峰竜太");

  const more = section.getByRole("button", { name: "あと1件を見る" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText("住之江 6R");

  const first = rows.first();
  await expect(first.getByRole("link", { name: "選手ページ" })).toHaveAttribute(
    "href",
    `/racer/${RACER}`,
  );
  await expect(first.getByRole("link", { name: "龍神ソナー" })).toHaveAttribute(
    "href",
    `/race/${raceIdOf(VENUE, 2)}?tab=sonar`,
  );
  await expect(
    first.getByRole("link", { name: "思考アシスト" }),
  ).toHaveAttribute("href", `/race/${raceIdOf(VENUE, 2)}/assist`);

  // 出さないもの（spec 5）
  await expect(section).not.toContainText(/印|買い目|番目/);

  // 置き場所: 会場の一覧（と SG開催中の帯があればその）上
  const sectionBottom = await section.evaluate(
    (el) => el.getBoundingClientRect().bottom + window.scrollY,
  );
  for (const selector of [".sg-now-banner", ".venue-grid-card"]) {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) continue;
    const top = await target.evaluate(
      (el) => el.getBoundingClientRect().top + window.scrollY,
    );
    expect(sectionBottom).toBeLessThanOrEqual(top);
  }

  // today_row_click（遷移は止めて、送った事象だけを見る）
  await page.evaluate(() => {
    window.__events = [];
    window.gtag = (...args) => window.__events.push(args);
    document
      .querySelector('[data-testid="favorite-runs"]')
      .addEventListener("click", (event) => event.preventDefault(), true);
  });
  await first.getByRole("link", { name: "選手ページ" }).click();
  expect(await page.evaluate(() => window.__events)).toContainEqual([
    "event",
    "today_row_click",
    {
      row_kind: "run",
      row_link: "racer_page",
      row_state: "upcoming",
      fav_state: "runs",
    },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("1440px: 5件を全部、1件1行で出し、横にはみ出さない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  const rows = section.locator(".favorite-runs__row:visible");
  await expect(rows).toHaveCount(5);
  await expect(
    section.getByRole("button", { name: /あと\d+件を見る/ }),
  ).toBeHidden();
  // 1件1行: 締切・場・選手・入口が同じ高さに並ぶ
  for (const row of await rows.all()) {
    const tops = await row.evaluate((el) =>
      [
        ".favorite-runs__time",
        ".favorite-runs__race",
        ".favorite-runs__who",
        ".favorite-runs__links",
      ].map((s) =>
        Math.round(el.querySelector(s).getBoundingClientRect().top / 20),
      ),
    );
    expect(new Set(tops).size, `1行に並ぶ: ${tops}`).toBeLessThanOrEqual(2);
    const height = await row.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(height).toBeLessThan(72);
  }
  const box = await section.boundingBox();
  expect(box.width).toBeLessThanOrEqual(1200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("締切を過ぎた出走は「締切を過ぎたN件」に畳み、ボタンで開閉する", async ({
  page,
}) => {
  await setFavorites(page, [RACER]);
  await routePredictions(page, { startTime: () => "08:00" });
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  const button = section.getByRole("button", { name: "締切を過ぎた5件" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(5);
  await button.click();
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(0);
});

test("/en/: 区画に日本語が無く（選手名を除く）、JST を添え、思考アシストの入口が無い", async ({
  page,
}) => {
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.goto("/en/");
  const section = page.getByTestId("favorite-runs");
  await expect(
    section.getByRole("heading", { name: "Favorite racers' races" }),
  ).toBeVisible();
  await expect(section.locator(".favorite-runs__row").first()).toContainText(
    "23:02 JST",
  );
  expect(
    await section.evaluate((el) => {
      const copy = el.cloneNode(true);
      copy
        .querySelectorAll('[translate="no"]')
        .forEach((node) => node.remove());
      return copy.textContent.match(/[぀-ヿ㐀-鿿]/gu);
    }),
  ).toBeNull();
  await expect(section.locator('a[href$="/assist"]')).toHaveCount(0);
  await expect(section.locator('a[href*="tab=sonar"]').first()).toHaveAttribute(
    "href",
    `/en/race/${raceIdOf(VENUE, 2)}?tab=sonar`,
  );
});
