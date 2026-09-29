import { test, expect } from "./fixtures.js";

/**
 * 会場ページ（本日）を開いたら、次の発走レースへスクロールし、会場カード2枚（この会場の特徴・この日の水面傾向）を
 * その直上に出す（BOA-546）。
 *
 * - 次の発走レース＝開いた時点で最初の発走前（UPCOMING）のレース。締切後・結果待ちのレースはカードの上に残る
 * - 1Rが発走前・全レース締切後・過去日付は、従来どおりカードは最上部でスクロールしない
 * - 開いた時点で固定（時刻が進んでもカードは動かない）
 * - ブラウザの戻るで来たときは自動スクロールしない
 *
 * レースの並びは Edge API を差し替えて固定する（1R 10:30 〜 12R 16:00、30分おき）。結果は、開く時刻の
 * 40分以上前に発走したレースにだけ入れる（14:00 なら 1〜6R。7R 13:30・8R 14:00 は結果待ち）。
 */

const DATE = "2026-09-28";
const VENUE = 5;
const startOf = (n) => {
  const m = 10 * 60 + 30 + (n - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const edgeData = (at) => ({
  generatedAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(VENUE).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: VENUE,
    venue: "多摩川",
    raceNumber: n,
    startTime: startOf(n),
    entries: [1, 2, 3, 4, 5, 6].map((i) => ({
      number: i,
      name: `テスト選手${i}`,
      grade: "B1",
      age: 30,
      winRate: 5.0,
      localWinRate: 5.0,
      motorNumber: i,
      motor2Rate: 35,
      boatNumber: i,
      boat2Rate: 35,
    })),
    predictions: {},
    exhibitionData: [],
    result:
      minutesOf(startOf(n)) <= minutesOf(at) - 40
        ? { rank1: 1, rank2: 2, rank3: 3 }
        : null,
  })),
});

const jst = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);

async function open(page, { at, path = `/venue/${VENUE}`, install = false }) {
  if (install) await page.clock.install({ time: jst(at) });
  else await page.clock.setFixedTime(jst(at));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(at) }),
  );
  await page.goto(path);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  await expect(page.locator(".venue-characteristics-card")).toBeVisible({
    timeout: 20000,
  });
}

// 会場カード（この会場の特徴）が、何枚目のレースカードの前にあるか（最上部なら -1）
const cardsPosition = (page) =>
  page.evaluate(() => {
    const cards = document.querySelector(".venue-characteristics-card");
    const grid = document.querySelector(".race-grid");
    if (!cards || !grid) return null;
    if (!grid.contains(cards)) return -1;
    const children = [...grid.children];
    const holder = children.find((c) => c.contains(cards));
    return children
      .slice(children.indexOf(holder) + 1)
      .find((c) => c.classList.contains("race-card"))
      ?.textContent.match(/(\d+)R/)?.[1];
  });

for (const width of [375, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("本日・レース中: 会場カードを次の発走レース（9R）の直前に全幅で出し、そこまでスクロールする", async ({
      page,
    }) => {
      await open(page, { at: "14:00" }); // 7R 13:30・8R 14:00 は締切後、9R 14:30 が次
      const holder = page.getByTestId("venue-next-race-cards");
      await expect(holder).toBeVisible();
      expect(await cardsPosition(page)).toBe("9");
      // 全幅（グリッドの幅いっぱい）
      const [hw, gw] = await Promise.all([
        holder.evaluate((e) => e.getBoundingClientRect().width),
        page.locator(".race-grid").evaluate((e) => e.getBoundingClientRect().width),
      ]);
      expect(Math.abs(hw - gw)).toBeLessThan(1);
      // スクロールして、会場カードがヘッダーのすぐ下（画面の上のほう）に来る
      await expect
        .poll(() => holder.evaluate((e) => e.getBoundingClientRect().top))
        .toBeLessThan(200);
      const headerBottom = await page
        .locator(".app-header")
        .evaluate((e) => e.getBoundingClientRect().bottom);
      expect(
        await holder.evaluate((e) => e.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(headerBottom - 1);
    });
  });
}

test.describe("カードを動かさない・スクロールしない場合", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("1R が発走前: 従来どおり最上部でスクロールしない", async ({ page }) => {
    await open(page, { at: "09:00" });
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("全レース締切後: 従来どおり最上部でスクロールしない", async ({
    page,
  }) => {
    await open(page, { at: "20:00" });
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("過去日付のページ: 従来どおり最上部でスクロールしない", async ({
    page,
  }) => {
    await open(page, { at: "14:00", path: `/races/${DATE}/${VENUE}` });
    // 過去日付ビューは本日扱いにしない（時計は同じ日だが URL で決まる）
    expect(await cardsPosition(page)).toBe(-1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("時刻が進んで次のレースが変わっても、カードは開いた時点の位置のまま", async ({
    page,
  }) => {
    await open(page, { at: "14:00", install: true });
    expect(await cardsPosition(page)).toBe("9");
    await page.clock.fastForward("01:00:00"); // 15:00（次は 11R）
    await page.waitForTimeout(500);
    expect(await cardsPosition(page)).toBe("9");
  });

  test("ブラウザの戻るで来たときは自動スクロールしない", async ({ page }) => {
    await open(page, { at: "14:00" });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    // いちばん上に戻してから、1Rのカードでレース詳細へ移り（アプリ内の遷移）、ブラウザの戻るで帰る
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .locator(".race-card")
      .first()
      .getByRole("button", { name: /詳細を見る/ })
      .click();
    await expect(page).toHaveURL(/\/race\//);
    await page.goBack();
    await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100);
  });
});
