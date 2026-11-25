import { test, expect } from "./fixtures.js";
import { mockGeneration, raceId } from "./motorGenerationMock.js";

// モータ情報タブの「今の値｜推移」（オーナー 2026-11-25 承認のモック改訂2、号機を足した形）。
// 世代と走は偽の応答で決める（入れ替え 8/06、毎日12レース、6基とも毎レース走る）。点そのものは
// verify-motor-generation-trend（純関数）・取得は verify-motor-generation-runs・図は verify-motor-trend-chart が見る
async function openTrend(page) {
  await page.goto(`/race/${raceId}?tab=motor`);
  const head = page.locator(".motor-condition-container .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("6基の今の値", { timeout: 30000 });
  await expect(head.locator(".trc-tab", { hasText: "今の値" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  return head;
}

test("推移に切り替えると6基の線と号機が出て、一覧は隠れる。3連率にも切り替わる", async ({ page }) => {
  await mockGeneration(page);
  const head = await openTrend(page);
  await expect(head.locator(".trc-title")).toHaveText("2連率の推移（公式・節ごと）");
  await expect(page.locator(".motor-ranking-table")).toHaveCount(0);
  await expect(page.locator(".mtc-chart .trc-stroke")).toHaveCount(6);
  await expect(page.locator(".mtc-chart")).toContainText("8/06 入れ替え");
  await expect(page.locator(".mtc-motor-no")).toHaveCount(6);
  await expect(page.locator(".mtc-motor-no").first()).toContainText("号機");
  await expect(page.locator(".mtc-selected")).toContainText("使用開始 2026/8/6");

  await page.locator(".mtc-boat").nth(2).click();
  await expect(page.locator(".mtc-selected")).toContainText("3号艇");

  await page.locator(".mtc-chip", { hasText: "3連率" }).click();
  await expect(head.locator(".trc-title")).toHaveText("3連率の推移（公式・節ごと）");
  // 展示タイムは検証した値と画面の値が違うので、評価し直すまで出さない
  await expect(page.locator(".mtc-chip", { hasText: "展示タイム" })).toHaveCount(0);

  await head.locator(".trc-tab", { hasText: "今の値" }).click();
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
});

test("節の点に重ねると吹き出しが出て、節のページへ飛べる。クリックで留め、Esc で閉じる", async ({ page }) => {
  await mockGeneration(page);
  await openTrend(page);
  const hit = await page.locator(".mtc-chart .trc-hit").boundingBox();
  await page.mouse.move(hit.x + hit.width * 0.5, hit.y + hit.height / 2);
  const tip = page.locator(".mtc-wrap .trc-tip");
  await expect(tip).toBeVisible();
  await expect(tip.locator(".trc-tip-link")).toHaveText("節へ →");
  await expect(tip.locator(".trc-tip-link")).toHaveAttribute("href", /^\/venue\/16\/meet\/2026-\d\d-\d\d$/);
  await expect(tip).toContainText("一般戦");
  await expect(tip).toContainText("乗った選手 選手");
  await expect(tip).toContainText("節の初日の公式2連率");
  await page.mouse.click(hit.x + hit.width * 0.5, hit.y + hit.height / 2);
  await expect(tip.locator(".trc-tip-close")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});

test("入れ替えから日が浅く20走に届かなければ、線を描かず号機と走数を出す", async ({ page }) => {
  await mockGeneration(page, { start: "2026-09-28" });
  await openTrend(page);
  await expect(page.locator(".mtc-empty")).toContainText("9/28に入れ替えたばかり");
  await expect(page.locator(".mtc-chart")).toHaveCount(0);
  await expect(page.locator(".mtc-motor-no").nth(1)).toHaveText(/^\d+走$/);
  await page.locator(".mtc-to-now").click();
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
});

test("走の取得に失敗したら、推移は空でなく失敗と出す", async ({ page }) => {
  await mockGeneration(page, { fail: true });
  await openTrend(page);
  await expect(page.locator(".mtc-wrap [role='alert']")).toBeVisible();
  await expect(page.locator(".mtc-empty")).toHaveCount(0);
});
