import { test, expect } from "./fixtures.js";

/**
 * /accuracy と /winning-technique?tab=volatility のイン崩れ注意度の段ごとの実績（BOA-822 task 24、screens S-5、
 * 承認モック mock/3-accuracy-375.png。機能フラグの裏、?caution=1）。DB に依存しないよう accuracy_cache を差し替える。
 *   - 公開前: 「公開後」は押せず、公開前の検証を出す。段は崩れやすい→堅め、割合・件数・ぶれ幅、全レースの点線
 *   - 公開直後: 既定は公開後。30件未満の段は割合を出さず件数だけ、公開からの日数
 *   - /winning-technique のタブのラベルと中身もフラグで切り替わる。フラグの外は今のまま
 */

const PRE = {
  from: "2025-06-01",
  to: "2026-10-10",
  base: { n: 75295, nonWin: 34194 },
  byLevel: {
    low: { n: 21027, nonWin: 5716 },
    mid: { n: 32169, nonWin: 13962 },
    high: { n: 22071, nonWin: 14503 },
  },
  sparse: { n: 28, nonWin: 13 },
};
const POST = {
  from: "2026-10-20",
  through: "2026-10-22",
  base: { n: 400, nonWin: 180 },
  byLevel: {
    low: { n: 120, nonWin: 30 },
    mid: { n: 251, nonWin: 110 },
    high: { n: 29, nonWin: 20 },
  },
};
const accuracy = (postlaunch) => ({
  calculatedAt: "2026-10-17T17:40:00Z",
  def: "gapband-r-v1",
  prelaunch: PRE,
  postlaunch,
});

async function routeAccuracy(page, data) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/rest/v1/accuracy_cache*", (route) => {
    const url = route.request().url();
    return route.fulfill({
      status: 200,
      json: url.includes("in_caution_accuracy") ? [{ data }] : [],
    });
  });
}

const rowTexts = (page) =>
  page
    .locator(".ica-row")
    .evaluateAll((rows) =>
      rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    );

test.describe("イン崩れ注意度の段ごとの実績（BOA-822、?caution=1）", () => {
  test("公開前: 公開後は押せず、公開前の検証の3段を崩れやすい→堅めの順に出す", async ({
    page,
  }) => {
    await routeAccuracy(page, accuracy(null));
    await page.goto("/accuracy?caution=1");
    const chart = page.locator(".ica");
    await expect(chart.locator(".ica-row")).toHaveCount(3, { timeout: 20000 });
    await expect(chart.getByRole("button", { name: "公開後" })).toBeDisabled();
    await expect(
      chart.getByRole("button", {
        name: "公開前の検証（2025/6/1〜2026/10/10）",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(chart).toContainText("75,295レース");
    await expect(chart).toContainText("全レース 45.4%");
    const rows = await rowTexts(page);
    expect(rows[0]).toContain("崩れやすい（注意度55%以上）");
    expect(rows[0]).toContain("65.7%");
    expect(rows[0]).toContain(
      "22,071レース中 65.7%（全体の29%のレース）・ぶれ幅 65.1〜66.3%",
    );
    // 段に入らなかったレースの説明（2周目 P2）
    await expect(page.getByTestId("ica-sparse")).toContainText(
      "注意度を出さなかった28レース",
    );
    expect(rows[1]).toContain("中くらい（注意度35〜55%）");
    expect(rows[2]).toContain("堅め（注意度35%未満）");
    expect(rows[2]).toContain("27.2%");
    // 旧の展開予測の的中率は出さない
    await expect(page.locator(".turn-accuracy-hero")).toHaveCount(0);
    await expect(
      page.getByText("旧モデルの月別成績アーカイブを見る"),
    ).toBeVisible();
    // 段の%は注意度の範囲、注意度が出る場所を書く（#1606 ファン評価1周目 P2）
    await expect(chart).toContainText("レース詳細の「AI予想」タブ");
  });

  test("公開直後: 既定は公開後、30件未満の段は件数だけ。公開前の検証に切り替えられる", async ({
    page,
  }) => {
    await routeAccuracy(page, accuracy(POST));
    await page.goto("/accuracy?caution=1");
    const chart = page.locator(".ica");
    await expect(chart.locator(".ica-row")).toHaveCount(3, { timeout: 20000 });
    await expect(
      chart.getByRole("button", { name: "公開後（2026/10/20〜）" }),
    ).toHaveAttribute("aria-pressed", "true");
    const rows = await rowTexts(page);
    expect(rows[0]).toContain("29レース（少ないので割合は出さない）");
    expect(rows[0]).toContain("—");
    expect(rows[0]).not.toContain("ぶれ幅");
    expect(rows[1]).toContain("43.8%");
    await expect(chart).toContainText(
      "公開から3日。30レースに届いた段から割合を出します。",
    );
    await chart
      .getByRole("button", { name: "公開前の検証（2025/6/1〜2026/10/10）" })
      .click();
    expect((await rowTexts(page))[0]).toContain("65.7%");
  });

  test("/winning-technique の volatility タブ: ラベルと中身が段ごとの実績になり、フラグの外は今のまま", async ({
    page,
  }) => {
    await routeAccuracy(page, accuracy(null));
    await page.goto("/winning-technique?tab=volatility&caution=1");
    await expect(page.locator(".ica .ica-row")).toHaveCount(3, {
      timeout: 20000,
    });
    await expect(page.locator(".analysis-tab-btn.active")).toHaveText(
      "🌪️ イン崩れ注意度の実績",
    );
    await expect(page.getByText("イン崩れ指数の実績について")).toHaveCount(0);

    await page.goto("/winning-technique?tab=volatility&caution=0");
    await expect(page.locator(".analysis-tab-btn.active")).toContainText(
      "イン崩れ指数の実績",
      { timeout: 20000 },
    );
    await expect(page.locator(".ica")).toHaveCount(0);
  });
});

// BOA-822 task 27: 段ごとの実績が画面に入ったら、ページごとに1回 caution_visible（race_id・段なし）
test("計測: /accuracy の段ごとの実績が見えたら1回 caution_visible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__events = [];
    window.gtag = (...args) => window.__events.push(args);
  });
  await routeAccuracy(page, accuracy(null));
  await page.goto("/accuracy?caution=1");
  await expect(page.locator(".ica .ica-row")).toHaveCount(3, {
    timeout: 20000,
  });
  const visible = () =>
    page.evaluate(() =>
      window.__events
        .filter((e) => e[0] === "event" && e[1] === "caution_visible")
        .map((e) => e[2]),
    );
  await expect.poll(async () => (await visible()).length).toBe(1);
  expect((await visible())[0]).toEqual({ caution_surface: "accuracy" });
});
