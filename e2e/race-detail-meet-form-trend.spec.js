import { test, expect } from "./fixtures.js";

/**
 * 直前情報タブ「今節の足の推移と着順」（BOA-885）の固定。
 *
 * - ?tab=beforeInfo&boat=N で開くと N 号艇を強調する（思考アシスト・龍神ソナーからの導線の行き先）
 * - チップを押すと強調と URL の ?boat= が変わる（タブをまたいだ艇の共有、BOA-492・493）
 * - 下の行は選んだ艇の走で、着順・枠・進入が並ぶ。展示タイムのタブだけ会場平均の破線
 * - 全貌動画の撮影用に、線・チップ・行に data-boat がある
 *
 * 2026-10-14 福岡12R（準優勝戦）は6艇とも今節7〜9走あり、結果が確定している過去のレース。
 */
const RACE_PATH = "/race/2026-10-14-22-12?tab=beforeInfo&boat=3";

test.use({ viewport: { width: 390, height: 844 } });

test("今節の足のグラフが ?boat= の艇を強調し、選び直すと URL も変わる", async ({
  page,
}) => {
  test.slow();
  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  const card = page.getByTestId("meet-form-trend");
  await expect(card.locator("svg")).toBeVisible({ timeout: 60000 });

  await expect(card.locator("button[data-boat][aria-pressed=true]")).toHaveText(
    "3",
  );
  await expect(card.locator("g.mft-series.is-active")).toHaveAttribute(
    "data-boat",
    "3",
  );
  await expect(card.locator("g.mft-series")).toHaveCount(6);
  // 3号艇の今節は7走（10/10 4R の2着から、10/14 3R の1着まで）
  await expect(
    card.locator("g.mft-row[data-row=finish] text.mft-cell"),
  ).toHaveCount(7);
  await expect(
    card.locator("g.mft-row[data-row=finish] text.mft-cell").last(),
  ).toHaveText("1");
  await expect(card.locator("g.mft-row[data-row=frame]")).toHaveAttribute(
    "data-boat",
    "3",
  );
  await expect(card.locator("[data-venue-avg]")).not.toHaveCount(0);

  await card.locator("button[data-boat='5']").click();
  await expect(card.locator("g.mft-series.is-active")).toHaveAttribute(
    "data-boat",
    "5",
  );
  await expect(page).toHaveURL(/[?&]boat=5/);

  // まわり足のタブには日ごとの会場平均が無いので破線を出さない
  await card.getByRole("tab", { name: "まわり足" }).click();
  await expect(card.locator("[data-venue-avg]")).toHaveCount(0);

  // 導線（思考アシスト・龍神ソナー）は #meet-form-trend 付きで開き、カードまで下げる
  await page.goto(
    "/race/2026-10-14-22-12?tab=beforeInfo&boat=4#meet-form-trend",
    {
      waitUntil: "domcontentloaded",
    },
  );
  await expect(card.locator("g.mft-series.is-active")).toHaveAttribute(
    "data-boat",
    "4",
    { timeout: 60000 },
  );
  await expect(card).toBeInViewport();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
