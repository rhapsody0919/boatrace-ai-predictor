// 選手ページの PC の並び、前半（src/pages/RacerProfile.css の「PC（1200px 以上）の並び、前半」）。
// 1200px 以上: 今日の出走｜成績の要約（高さをそろえる）、プロフィール｜前付けの傾向、進入コース別の棒｜表（行をそろえる）。
// 1199px 以下は今の縦並びのまま
import { test, expect } from "../fixtures.js";

const box = (page, selector) =>
  page.locator(selector).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left };
  });

async function openRacer(page) {
  await page.goto("/racer/4320", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".racer-summary")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".racer-official-bars li").first()).toBeVisible({ timeout: 30000 });
}

test.describe("レイアウト: 選手ページの PC の並び（前半）", () => {
  test("1200px 以上は2列で、左右の上端と行がそろい、横にはみ出さない", async ({ page }) => {
    test.skip(page.viewportSize().width < 1200, "1200px 以上だけの並び");
    await openRacer(page);

    // 今日の出走（録画の時刻に出走があるときだけ）と要約は横に並び、上端と下端がそろう
    const today = page.locator('[data-testid="racer-today-runs"]');
    if ((await today.count()) > 0) {
      const a = await box(page, '[data-testid="racer-today-runs"]');
      const b = await box(page, ".racer-summary");
      expect(b.left, "要約が今日の出走の右").toBeGreaterThan(a.left + 100);
      expect(Math.abs(a.top - b.top), "上端").toBeLessThan(2);
      expect(Math.abs(a.bottom - b.bottom), "下端").toBeLessThan(2);
    }

    // プロフィールと前付けの傾向は横に並ぶ
    const front = page.locator("#racer-front-taking");
    if ((await front.count()) > 0) {
      const p = await box(page, ".racer-profile-card");
      const f = await box(page, "#racer-front-taking");
      expect(f.left, "前付けの傾向がプロフィールの右").toBeGreaterThan(p.left + 100);
      expect(Math.abs(p.top - f.top), "上端").toBeLessThan(2);
    }

    // 進入コース別: 棒の各行と表の各行の上端がそろう
    const bars = await page
      .locator(".racer-official-bars > li")
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
    const rows = await page
      .locator(".racer-official-bars + .racer-official-table-wrap tbody tr")
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
    expect(bars.length, "棒の行の数").toBeGreaterThan(0);
    expect(rows.length, "表の行の数").toBe(bars.length);
    bars.forEach((top, i) => {
      expect(Math.abs(top - rows[i]), `${i + 1}行目の上端`).toBeLessThan(2);
    });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "横のはみ出し").toBeLessThanOrEqual(2);
  });

  test("1199px 以下は今の縦並び（プロフィールが要約の下、コース別の表が棒の下）", async ({ page }) => {
    test.skip(page.viewportSize().width >= 1200, "1199px 以下だけ");
    await openRacer(page);
    const summary = await box(page, ".racer-summary");
    const profile = await box(page, ".racer-profile-card");
    expect(profile.top, "プロフィールが要約の下").toBeGreaterThan(summary.bottom);
    const bar = await box(page, ".racer-official-bars");
    const table = await box(page, ".racer-official-bars + .racer-official-table-wrap");
    expect(table.top, "コース別の表が棒の下").toBeGreaterThan(bar.bottom - 1);
  });
});
