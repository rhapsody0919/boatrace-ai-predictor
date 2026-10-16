import { test, expect } from "./fixtures.js";

/**
 * 思考アシスト・龍神ソナーから直前情報タブ「今節の足の推移と着順」への導線（BOA-885、2026-10-16 オーナー承認）。
 *
 * - 思考アシストの機力レンズ: 深掘り中の艇（無ければ1号艇）で開く
 * - 艇ごとの深掘り: 深掘りしている艇で開き、カードまで下がる
 * - 龍神ソナーの展開シナリオ: 攻める艇が決まる形（カド一撃＝4号艇）だけリンクを出し、押すと同じページで
 *   直前情報タブに切り替わってその艇を強調する
 *
 * 2026-10-14 福岡12R（準優勝戦、結果確定済み）。
 */
const RACE = "2026-10-14-22-12";

test.use({ viewport: { width: 375, height: 812 } });

test("思考アシストの機力レンズと深掘りから、その艇の今節の足を開く", async ({
  page,
}) => {
  test.slow();
  await page.goto(`/race/${RACE}/assist`, { waitUntil: "domcontentloaded" });
  await page
    .locator(".ta-lens-tabs button", { hasText: "機力" })
    .first()
    .click({ timeout: 60000 });
  const power = page.locator(".ta-split-fig .ta-meetform-link");
  await expect(power).toHaveText("今節の足の推移を見る（直前情報タブ）→");
  await expect(power).toHaveAttribute(
    "href",
    `/race/${RACE}?tab=beforeInfo&boat=1#meet-form-trend`,
  );

  await page.locator(".ta-boat-btn").nth(3).click();
  await expect(power).toHaveAttribute("href", /boat=4#meet-form-trend$/);
  const deep = page.locator(".ta-deep .ta-meetform-link");
  await expect(deep).toHaveText("4号艇の今節の足の推移 →", { timeout: 60000 });
  await deep.click();

  const card = page.getByTestId("meet-form-trend");
  await expect(card.locator("g.mft-series.is-active")).toHaveAttribute(
    "data-boat",
    "4",
    { timeout: 60000 },
  );
  await expect(card).toBeInViewport();
});

test("龍神ソナーの展開シナリオから、攻める艇の今節の足へ切り替える", async ({
  page,
}) => {
  test.slow();
  await page.goto(`/race/${RACE}?tab=sonar&sonar=scenario`, {
    waitUntil: "domcontentloaded",
  });
  const link = page.locator(".af-meetform-link");
  await page
    .locator(".af-pat:not(.is-any)", { hasText: "横一線" })
    .first()
    .click({ timeout: 60000 });
  // 攻める艇が決まらない形ではリンクを出さない
  await expect(link).toHaveCount(0);

  await page.locator(".af-pat-change").click();
  await page
    .locator(".af-pat:not(.is-any)", { hasText: "カド一撃" })
    .first()
    .click();
  await expect(link).toHaveText("攻める4号艇の今節の足 →");
  await link.click();

  const card = page.getByTestId("meet-form-trend");
  await expect(card.locator("g.mft-series.is-active")).toHaveAttribute(
    "data-boat",
    "4",
    { timeout: 60000 },
  );
  await expect(page).toHaveURL(/tab=beforeInfo.*boat=4#meet-form-trend$/);
  await expect(card).toBeInViewport();
});
