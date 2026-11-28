import { test, expect } from "./fixtures.js";

// 選手の推移の線の下の段（節ごとのモーターの会場内順位と号機、レーン B の after B）。
// 段の取得（race_entries の2つの読み）は録画に無いので、ここで返す形を決める。区分と号機の描き方は
// verify-racer-motor-band、順位の計算は verify-racer-meet-motors が見る
const RACE = "/race/2026-09-21-02-05";
const isBandRead = (url) =>
  url.includes("/rest/v1/race_entries") &&
  (url.includes("select=race_id%2Cmotor_number%2Cmotor_2rate") || url.includes("select=race_id%2Cboat_number%2Cmotor_2rate"));

async function openTrend(page) {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const head = page.locator(".race-basic-info-tab .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("勝率の今の値", { timeout: 30000 });
  await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  return page.locator(".race-basic-info-tab .trc-wrap");
}

test("推移の線の下に、選んだ艇の節ごとの段と見出しと注記が出る", async ({ page }) => {
  await page.route((url) => isBandRead(url.href), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  const wrap = await openTrend(page);
  const band = wrap.locator(".rmb-svg");
  await expect(band).toBeVisible({ timeout: 30000 });
  await expect(band.locator(".rmb-seg").first()).toBeVisible({ timeout: 30000 });
  // 見出しは「2連率」（位置の「上・中・下」は出さない）。段の説明は下の「?」の中（plan.md §14、オーナー 2026-11-28）
  await expect(band.locator(".rmb-head")).toHaveText(["2連率", "号機"]);
  await wrap.locator(".rmb-note .term-hint__button").click();
  await expect(page.locator(".term-hint__popover")).toContainText("上から何%");
  await wrap.locator(".rmb-note .term-hint__button").click();
  // 節を押すと、下の行に期間・会場・号機（2連率の無い節は「まだ無い」）。もう一度押すと消える
  await band.locator(".rmb-hit").last().click();
  await expect(wrap.locator(".rmb-pick")).toContainText("2連率がまだ無い");
  await band.locator(".rmb-hit").last().click();
  await expect(wrap.locator(".rmb-pick")).toHaveCount(0);
});

test("段の取得に失敗したら、線は残して段の代わりに失敗と出す", async ({ page }) => {
  await page.route((url) => isBandRead(url.href), (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"e2e","code":"XX000"}' }),
  );
  const wrap = await openTrend(page);
  await expect(wrap).toContainText("節ごとのモーターを読み込めませんでした", { timeout: 30000 });
  await expect(wrap.locator(".trc-svg")).toBeVisible();
  await expect(wrap.locator(".rmb-svg")).toHaveCount(0);
});
