// モータ情報タブの推移の並べ方（オーナー 2026-11-25 の案 A。選手の推移 trend-chart-layout.spec.js と同じ形）。
// 1200px 以上は左に図・右に6基の一覧（艇番・号機・最新の値）。それ未満は図を枠いっぱいにし、下に号機つきの札。
// 号機は全部の幅で6基とも見える。世代と走は偽の応答（e2e/motorGenerationMock.js）
import { test, expect } from "../fixtures.js";
import { mockGeneration, raceId } from "../motorGenerationMock.js";

test("モータ情報の推移は 1200px 以上で左に図・右に号機の一覧、それ未満は図の下に号機つきの札", async ({ page }) => {
  await mockGeneration(page);
  await page.goto(`/race/${raceId}?tab=motor`);
  const head = page.locator(".motor-condition-container .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("6基の今の値", { timeout: 30000 });
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  const svg = page.locator(".mtc-chart");
  await expect(svg).toBeVisible({ timeout: 30000 });
  const m = await page.evaluate(() => {
    const box = document.querySelector(".mtc-chart").getBoundingClientRect();
    const list = document.querySelector(".mtc-boats").getBoundingClientRect();
    const visible = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).length;
    return {
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      listLeft: list.left,
      listTop: list.top,
      motorNos: visible(".mtc-motor-no"),
      values: visible(".mtc-boats .trc-boat-value"),
      tab: document.querySelector(".motor-condition-container").getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(m.overflow, "横スクロール").toBe(0);
  expect(m.motorNos, "号機は6基とも見える").toBe(6);
  if (m.tab >= 1100) {
    expect(m.listLeft, "一覧は図の右").toBeGreaterThan(m.right);
    expect(m.values, "一覧に最新の値").toBe(6);
    expect(m.width, "図は列の左の大半").toBeGreaterThan(m.tab * 0.55);
  } else {
    expect(m.listTop, "札は図の下").toBeGreaterThanOrEqual(m.bottom - 1);
    expect(m.values, "狭い幅は値を出さない").toBe(0);
  }
});
