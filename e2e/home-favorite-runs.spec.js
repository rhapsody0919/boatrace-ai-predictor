import { test, expect, e2eTodayJST } from "./fixtures.js";
import {
  RACER,
  VENUE,
  expectVenueCards,
  isHistoryRequest,
  raceIdOf,
  routePredictions,
  setFavorites,
} from "./favorite-runs-fixture.js";

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

// 出走の締切（既定 23:0n、締切後の題は 08:00）を実時計と比べるため、時計を今日の JST 12:00 に固定する。
// live の実時計だと 23 時台に「締切後」へ倒れ、締切前の題が落ちる（BOA-1447）
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${e2eTodayJST()}T12:00:00+09:00`));
});

test("☆0件なら予測を読まず、区画は代わりの表示になり、会場カード24件が出る（#2225 の再発防止）", async ({
  page,
}) => {
  const calls = await routePredictions(page);
  await page.goto("/");
  await expectVenueCards(page);
  const section = page.getByTestId("favorite-runs");
  await expect(section).toHaveAttribute("data-fav-state", "no_favorites");
  await expect(section.locator(".favorite-runs__row")).toHaveCount(0);
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
  await expect(rows.first()).toContainText("峰 竜太");
  await expect(rows.first().locator(".favorite-runs__grade")).toHaveText("SG");
  await expect(rows.first().locator(".favorite-runs__name")).toHaveText("峰 竜太");
  await expect(rows.first().locator(".favorite-runs__name")).toHaveAttribute("translate", "no");

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
  // 成績の一言の主語は選手の姓（translate="no" の要素）
  await section.scrollIntoViewIfNeeded();
  const enStat = section.locator(".favorite-runs__row").first().locator(".favorite-runs__stat");
  await expect(enStat).toContainText(/^峰 in Boat 1: Starts \d+/, { timeout: 30000 });
  await expect(enStat.locator('[translate="no"]')).toHaveText("峰");
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

test("各行に、選手ページの枠番別成績と同じ号艇の出走数・2連率と、今節の着順を出す（GS04-7）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  await section.scrollIntoViewIfNeeded();
  // 締切前の1件目は 2R の1号艇
  const first = section.locator(".favorite-runs__row").first();
  await expect(first.locator(".favorite-runs__stat")).toContainText("峰の1号艇 出走数", {
    timeout: 30000,
  });
  const text = await first.locator(".favorite-runs__stat").innerText();
  const [, n, rate] = text.match(/出走数(\d+)(?:・2連率 ([\d.]+)%)?/);
  // 今節: 見出しと、着順の札か「初日（成績なし）」
  const meet = first.locator(".favorite-runs__meet");
  await expect(meet).toContainText("今節");
  expect(
    (await meet.locator(".favorite-runs__finish").count()) > 0 ||
      (await meet.innerText()).includes("初日（成績なし）"),
  ).toBe(true);

  // 選手ページの「枠番別成績（当サイト集計・2025年12月以降・全会場計）」の1号艇と同じ値
  await page.goto(`/racer/${RACER}`);
  const table = page
    .locator(".racer-technique-profile")
    .filter({ hasText: "枠番別成績（当サイト集計" })
    .locator("tbody tr")
    .first();
  await expect(table.locator("td").nth(0)).toHaveText("1", { timeout: 30000 });
  await expect(table.locator("td").nth(1)).toHaveText(n, { timeout: 30000 });
  if (rate) await expect(table.locator("td").nth(4)).toHaveText(`${rate}%`);
});

test("出走履歴の取得に失敗したら、その行に「成績を読めなかった」を出し、区画とほかの欄は出たまま", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.route(/\/rest\/v1\/race_entries/, (route) =>
    isHistoryRequest(route.request().url()) ? route.abort() : route.fallback(),
  );
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  await section.scrollIntoViewIfNeeded();
  const first = section.locator(".favorite-runs__row").first();
  await expect(first.locator(".favorite-runs__stat")).toHaveText("成績を読めなかった", {
    timeout: 30000,
  });
  await expect(section.locator(".favorite-runs__row:visible")).toHaveCount(4);
  await expect(first.getByRole("link", { name: "選手ページ" })).toBeVisible();
  await expectVenueCards(page);
});

test("出走履歴は区画が画面に入ってから、行にいる選手の数だけ読む", async ({ page }) => {
  // 縦を短くして、区画が最初は画面の外にあるようにする
  await page.setViewportSize({ width: 375, height: 200 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  const history = [];
  page.on("request", (request) => {
    if (isHistoryRequest(request.url())) history.push(request.url());
  });
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  await expect(section).toBeAttached({ timeout: 30000 });
  const inView = await section.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight);
  test.skip(inView, "区画が最初から画面に入っている（ヘッダーが短い）");
  await page.waitForTimeout(1500);
  expect(history).toEqual([]);
  await section.scrollIntoViewIfNeeded();
  await expect.poll(() => history.length, { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(1000);
  expect(history.length).toBeLessThanOrEqual(1);
});

test("今節の走が無くても、節の2日目以降なら「初日」と言い切らない", async ({ page }) => {
  await setFavorites(page, [RACER]);
  await routePredictions(page, { seriesDay: 3 });
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  await section.scrollIntoViewIfNeeded();
  const first = section.locator(".favorite-runs__row").first();
  await expect(first.locator(".favorite-runs__stat")).toContainText("出走数", {
    timeout: 30000,
  });
  await expect(first.locator(".favorite-runs__meet")).not.toContainText("初日");
});

test("768px: 全件を出し、1件を2〜3段にまとめる（375px の縦積みのままにしない）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await setFavorites(page, [RACER]);
  await routePredictions(page);
  await page.goto("/");
  const section = page.getByTestId("favorite-runs");
  const rows = section.locator(".favorite-runs__row:visible");
  await expect(rows).toHaveCount(5);
  const first = rows.first();
  // 締切・場とR・選手が同じ段に並ぶ（縦の範囲が重なる）
  const overlap = await first.evaluate((el) => {
    const boxes = [".favorite-runs__time", ".favorite-runs__race", ".favorite-runs__who"].map(
      (s) => el.querySelector(s).getBoundingClientRect(),
    );
    return Math.max(...boxes.map((b) => b.top)) < Math.min(...boxes.map((b) => b.bottom));
  });
  expect(overlap).toBe(true);
  const height = await first.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThan(170);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
