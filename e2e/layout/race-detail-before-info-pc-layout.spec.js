// 直前情報タブの PC の並び（src/components/race/RaceBeforeInfoTab.css の「PC の並び」）。
// 1200px 以上: 気象｜展示タイム、展示情報の表は全幅、今節の足の推移｜進入コース、選手コメントは2列。
// 展示タイムがまだ無いときは気象・展示タイムとも全幅。1199px 以下: 今の縦並びのまま
import { test, expect } from "../fixtures.js";

// 多摩川G1 12R（気象・展示タイム・展示情報・今節の足・進入コース・選手コメントが全てそろう）
const PATH = "/race/2026-09-21-05-12?tab=beforeInfo";

const boxOf = (page, selector) =>
  page.locator(selector).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, right: r.right, bottom: r.bottom };
  });

async function openBeforeInfo(page) {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".race-before-info-tab")).toBeVisible({
    timeout: 30000,
  });
  for (const sel of [
    ".rbi-weather-card",
    ".rbi-chart-card .rbi-chart-note",
    ".mft-card",
    ".ecd-card",
    ".rpr-card .rpr-comment",
  ]) {
    await expect(page.locator(sel).first(), sel).toBeVisible({
      timeout: 30000,
    });
  }
}

test.describe("レイアウト: 直前情報の PC の並び", () => {
  test("1200px 以上は2枚ずつ左右に並び、表は全幅、コメントは2列で、横にはみ出さない", async ({
    page,
  }) => {
    test.skip(
      page.viewportSize().width < 1200,
      "1200px 以上だけの並び（1199px 以下は下の試験）",
    );
    await openBeforeInfo(page);
    const tab = await boxOf(page, ".race-before-info-tab");

    for (const [l, r] of [
      [".rbi-weather-card", ".rbi-chart-card"],
      [".mft-card", ".ecd-card"],
    ]) {
      const left = await boxOf(page, l);
      const right = await boxOf(page, r);
      expect(Math.abs(left.y - right.y), `${l}｜${r} の上端`).toBeLessThan(2);
      expect(Math.abs(left.x - tab.x), `${l} の左端`).toBeLessThan(2);
      expect(Math.abs(right.right - tab.right), `${r} の右端`).toBeLessThan(2);
      expect(right.x, `${r} は ${l} の右`).toBeGreaterThan(left.right);
    }

    // 気象は棒グラフと同じ高さの縦の一覧（名前が左・値が右）
    const weather = await boxOf(page, ".rbi-weather-card");
    const chart = await boxOf(page, ".rbi-chart-card");
    expect(Math.abs(weather.bottom - chart.bottom), "気象と棒グラフの下端").toBeLessThan(2);
    const itemLefts = await page
      .locator(".rbi-weather-card .rbi-weather-item")
      .evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(itemLefts).size, "気象は1列").toBe(1);

    // 展示情報の表のカードは全幅
    const table = await boxOf(page, ".rbi-card:has(.drt-table-wrapper)");
    expect(Math.abs(table.w - tab.w), "展示情報の表の幅").toBeLessThan(2);

    // 選手コメントは2列（1・2／3・4…）
    const comments = await page
      .locator(".rpr-comment")
      .evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().left)));
    if (comments.length >= 2) {
      expect(new Set(comments).size, "コメントの列の数").toBe(2);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "横スクロール").toBe(0);
  });

  test("1200px 以上でも展示タイムがまだ無いときは、気象と展示タイムを全幅に戻す", async ({
    page,
  }) => {
    test.skip(page.viewportSize().width < 1200, "1200px 以上だけの並び");
    await openBeforeInfo(page);
    // 展示前の空の状態（.rbi-empty の1行）に差し替える。出す物は Chart.jsx の空の分岐と同じ形
    await page.locator(".rbi-chart-card").evaluate((c) => {
      c.innerHTML = '<h3 class="rbi-heading">展示タイム</h3><p class="rbi-empty">-</p>';
    });
    const tab = await boxOf(page, ".race-before-info-tab");
    for (const sel of [".rbi-weather-card", ".rbi-chart-card"]) {
      const b = await boxOf(page, sel);
      expect(Math.abs(b.w - tab.w), `${sel} は全幅`).toBeLessThan(2);
    }
  });

  test("1199px 以下は縦に積む", async ({ page }) => {
    test.skip(page.viewportSize().width >= 1200, "1199px 以下だけの並び");
    await openBeforeInfo(page);
    const weather = await boxOf(page, ".rbi-weather-card");
    const chart = await boxOf(page, ".rbi-chart-card");
    expect(chart.y, "展示タイムは気象の下").toBeGreaterThanOrEqual(weather.bottom - 1);
    const mft = await boxOf(page, ".mft-card");
    const ecd = await boxOf(page, ".ecd-card");
    expect(ecd.y, "進入コースは今節の足の下").toBeGreaterThanOrEqual(mft.bottom - 1);
  });
});
