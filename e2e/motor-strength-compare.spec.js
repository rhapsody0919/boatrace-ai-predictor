import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * モーター表の公式2連率の棒と会場内順位（BOA-428 子1）。
 *
 * 過去のレース（児島 2026-09-30 7R）を使う。過去レースは2連率の列そのものが出走表時点の公式値で、
 * 会場内順位はレース日以前で最新のスナップショット。値が日によって変わらないので固定できる
 * （設計レビューで 69/22/68/15/62/44号機 = 20タイ/17タイ/26タイ/46/9/7位、60機中を再現済み）。
 */
const KOJIMA_7R =
  "/winning-technique?tab=motor&venue_code=16&race_id=2026-09-30-16-07";

const readTable = (page) =>
  page.locator(".motor-ranking-table").evaluate((t) => ({
    heads: [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim()),
    rows: [...t.querySelectorAll("tbody tr")].map((tr) => {
      const fill = tr.querySelector(".rate-bar-fill");
      const track = tr.querySelector(".rate-bar-track");
      const label = tr.querySelector(".rate-bar-label");
      return {
        value: parseFloat(label?.textContent),
        ratio: fill
          ? fill.getBoundingClientRect().width /
            track.getBoundingClientRect().width
          : null,
        best: label?.classList.contains("ind-best") ?? false,
        rank: tr.querySelector(".motor-venue-rank")?.textContent ?? null,
      };
    }),
  }));

test.describe("モーター表の棒と会場内順位（BOA-428）", () => {
  test("棒の長さの比が公式2連率の比と一致し、会場内順位が出る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_7R);
    await expect(page.locator(".motor-venue-rank").first()).toBeVisible({
      timeout: 30000,
    });
    const { heads, rows } = await readTable(page);
    // 棒（公式2連率）と会場内順位を機番のすぐ右に置く
    // E2E は時計を録画時刻に固定するので、このレースが当日扱い（見出しは「公式2連率（節時点）」）にも
    // 過去扱い（「2連率 (%)」、列そのものが公式値）にもなりうる
    expect(heads[2]).toBe("機番");
    expect(heads[3]).toMatch(/^(公式2連率（節時点）|2連率 \(%\))$/);
    expect(heads[4]).toBe("会場内順位");
    expect(rows).toHaveLength(6);
    const max = Math.max(...rows.map((r) => r.value));
    for (const r of rows) {
      expect(r.ratio).toBeCloseTo(r.value / max, 2);
    }
    expect(rows.map((r) => r.rank)).toEqual([
      "20位タイ/60",
      "17位タイ/60",
      "26位タイ/60",
      "46位/60",
      "9位/60",
      "7位/60",
    ]);
    // 最良（40.0、6号艇）の値ラベルだけに印
    expect(rows.map((r) => r.best)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    // 取得日は当日扱いなら最新、過去扱いならレース日以前で最新（児島は 9/23 から中身が同じ）
    await expect(page.locator(".motor-venue-rank-note")).toContainText(
      /取得日 \d{4}\/\d{1,2}\/\d{1,2}）/,
    );
    // 行全体の金の強調（期間の2連率の最大）は外した。最良は値ラベルだけで示す
    await expect(page.locator(".motor-ranking-row.best-motor")).toHaveCount(0);
  });

  test("375px で枠・選手・機番・棒・会場内順位が横スクロールなしで見える", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(KOJIMA_7R);
    await expect(page.locator(".motor-venue-rank").first()).toBeVisible({
      timeout: 30000,
    });
    const box = await page.locator(".motor-ranking-table").evaluate((t) => ({
      wrapRight: t.parentElement.getBoundingClientRect().right,
      rankRight: Math.max(
        ...[...t.querySelectorAll(".motor-venue-rank")].map(
          (c) => c.getBoundingClientRect().right,
        ),
      ),
      docW: document.documentElement.scrollWidth,
    }));
    expect(box.docW).toBe(375);
    expect(box.rankRight).toBeLessThanOrEqual(box.wrapRight);
  });

  test("会場サイトの値が取れないときは、列を残して「取得できませんでした」", async ({
    page,
  }) => {
    await page.route("**/rest/v1/venue_motor_stats*", (route) => route.abort());
    await page.goto(KOJIMA_7R);
    await expect(page.locator(".motor-venue-rank").first()).toHaveText(
      "取得できませんでした",
      { timeout: 30000 },
    );
    await expect(page.locator(".motor-venue-rank")).toHaveCount(6);
    await expect(page.locator(".motor-venue-rank-note")).toHaveCount(0);
  });

  test("浜名湖（会場サイトの値を出さない会場）では会場内順位の列を出さない", async ({
    page,
  }) => {
    await page.goto(
      "/winning-technique?tab=motor&venue_code=6&race_id=2026-09-30-06-07",
    );
    await expect(page.locator(".motor-ranking-table tbody tr")).toHaveCount(6, {
      timeout: 30000,
    });
    await expect(page.locator(".rate-bar")).toHaveCount(6);
    await expect(page.locator(".motor-venue-rank")).toHaveCount(0);
    await expect(
      page.locator(".motor-ranking-table thead th", {
        hasText: "会場内順位",
      }),
    ).toHaveCount(0);
  });
  test("1桁で同じに見える最大の値は、どちらにも最良の印が付く", async ({
    page,
  }) => {
    // 38.33 と 38.28 はどちらも「38.3」と出る。生の値で判定すると片方だけに印が付いていた
    await page.route("**/rest/v1/race_entries*", async (route) => {
      const response = await fetchRecorded(route);
      const body = await response.json().catch(() => null);
      if (
        !Array.isArray(body) ||
        !route.request().url().includes("2026-09-30-16-07")
      ) {
        return route.fulfill({ response });
      }
      const rates = { 1: 30, 2: 31, 3: 32, 4: 33, 5: 38.33, 6: 38.28 };
      for (const row of body) {
        if (row.boat_number in rates) row.motor_2rate = rates[row.boat_number];
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto(KOJIMA_7R);
    await expect(page.locator(".rate-bar-label").first()).toBeVisible({
      timeout: 30000,
    });
    const { rows } = await readTable(page);
    expect(rows.map((r) => r.best)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  test("出走数0（集計前）のモーターは会場内順位に入れない", async ({
    page,
  }) => {
    // 唐津では、まだ走っていないモーターの 2連率 0 が「40位タイ」と出ていた
    await page.route("**/rest/v1/venue_motor_stats*", async (route) => {
      const response = await fetchRecorded(route);
      const body = await response.json().catch(() => null);
      if (!Array.isArray(body) || body.length < 10) {
        return route.fulfill({ response });
      }
      for (const row of body) {
        if (row.motor_number === 44) row.race_count = 0;
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto(KOJIMA_7R);
    await expect(page.locator(".motor-venue-rank").first()).toBeVisible({
      timeout: 30000,
    });
    const { rows } = await readTable(page);
    // 6号艇（44号機）だけ「-」、母数は 60 → 59
    expect(rows[5].rank).toBe("-");
    expect(rows[4].rank).toMatch(/\/59$/);
    // 行を押して開くドリルダウンの会場内順位も、同じ母数（59機中）にそろう
    await page.locator(".motor-ranking-table tbody tr").nth(4).click();
    await expect(page.getByText(/位(タイ)?／59機中/).first()).toBeVisible({
      timeout: 30000,
    });
  });
});
