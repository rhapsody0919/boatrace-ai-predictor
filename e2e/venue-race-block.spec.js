import { test, expect } from "./fixtures.js";

/**
 * 会場ページのレースの塊（公式スマホの形、docs/design/venue-race-card-redesign/approved.md）。
 * Edge API を差し替えて固定する（venue-next-race.spec.js と同じ並び。14:00 で 1〜6R は結果あり、9R が次）。
 */

const DATE = "2026-09-28";
const VENUE = 5;
const idOf = (n) => `${DATE}-05-${String(n).padStart(2, "0")}`;
const startOf = (n) => {
  const m = 10 * 60 + 30 + (n - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const entry = (i) => ({ number: i, name: `選手${i}`, grade: "B1" });
const result = { rank1: 4, rank2: 2, rank3: 1, payoutTrio: 8450 };
result.winningTechnique = "まくり";

const edgeData = () => ({
  generatedAt: `${DATE}T00:00:00Z`,
  updatedAt: `${DATE}T00:00:00Z`,
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: idOf(n),
    venueCode: VENUE,
    raceNumber: n,
    startTime: startOf(n),
    raceGrade: "G3",
    raceStage: n >= 10 ? "準優勝戦" : "一般戦",
    entries: [1, 2, 3, 4, 5, 6].map(entry),
    predictions: {},
    exhibitionData: [],
    result: n <= 6 ? result : null,
  })),
});

async function open(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.clock.setFixedTime(new Date(`${DATE}T14:00:00+09:00`));
  await page.route("**/api/predictions/**", (r) =>
    r.fulfill({ json: edgeData() }),
  );
  await page.goto(`/venue/${VENUE}`);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  return page.locator(".race-grid > .race-card");
}

for (const width of [375, 768, 1024, 1440]) {
  test(`${width}px: 帯・結果1行・リンク。会場名とグレードの札は出さず、横にはみ出さない`, async ({
    page,
  }) => {
    const cards = await open(page, width);
    const done = cards.nth(0);
    const bar = done.locator(".race-card-header");
    await expect(bar).toContainText("1R");
    await expect(bar).toContainText("一般戦");
    await expect(bar).toContainText("締切予定時刻 10:30");
    await expect(bar).not.toContainText("多摩川");
    await expect(bar).not.toContainText("G3");
    await expect(done.getByTestId("venue-race-result")).toHaveText(
      "結果4-2-1まくり¥8,450",
    );
    const links = done.locator(".venue-race-block__links a");
    await expect(links).toHaveText(["詳細を見る", "AI予想", "結果"]);
    await expect(links.nth(0)).toHaveAttribute("href", `/race/${idOf(1)}`);
    await expect(links.nth(1)).toHaveAttribute(
      "href",
      `/race/${idOf(1)}?tab=aiPrediction`,
    );
    await expect(links.nth(2)).toHaveAttribute(
      "href",
      `/race/${idOf(1)}?tab=result`,
    );
    const next = cards.nth(9);
    await expect(next.getByTestId("venue-race-result")).toHaveCount(0);
    await expect(next.locator(".race-card-header")).toContainText("準優勝戦");
    await expect(next.locator(".venue-race-block__links a").nth(2)).toHaveText(
      "直前情報",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("375px: 「↑ レース一覧」でページの上へ戻る", async ({ page }) => {
  const cards = await open(page, 375);
  await page.waitForTimeout(5500); // 着いたときの自動スクロールの合わせ直し（5秒）が終わるのを待つ
  await cards.nth(10).locator(".venue-race-block__back").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
