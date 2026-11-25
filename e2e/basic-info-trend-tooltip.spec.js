// 推移の線の点の吹き出しとレースへの飛び先（オーナー 2026-11-25 承認、ファン4人の最終案。
// 棚卸しの追補 parts-inventory/timeseries-hover-links.md の「走」）。選手の走の記録は録画に無いので作った記録で返す
import { test, expect } from "./fixtures.js";

const RACE = "/race/2026-09-21-02-05";
const day = (n) =>
  new Date(Date.UTC(2026, 8, 20) - n * 86400000).toISOString().slice(0, 10);
const runsFor = (racerId) =>
  Array.from({ length: 60 }, (_, i) => {
    const boat = 1 + ((racerId + i) % 6);
    const others = [1, 2, 3, 4, 5, 6].filter((b) => b !== boat);
    // 選手ごとに上位の多さを変え、時期で少し動かす（線が重ならないように）
    const good = (racerId % 6) + (i > 30 ? 1 : 0);
    const finish = (racerId * 7 + i * 5) % 9 < good ? 1 + (i % 3) : 4 + (i % 3);
    const ranks = [1, 2, 3, 4, 5, 6].map((r) =>
      r === finish ? boat : others.shift(),
    );
    const v = `0${1 + (i % 9)}`;
    return {
      race_id: `${day(60 - i)}-${v}-${v}`,
      boat_number: boat,
      grade: "A1",
      f_count: 0,
      race_date: day(60 - i),
      venue_code: v,
      race_grade: "一般",
      ranks,
      race_status: null,
      actual_courses: [1, 2, 3, 4, 5, 6],
      winning_technique: "逃げ",
      payout_win: 150,
      race_stage: "予選",
      race_title: "一般戦",
      wave_height: 2,
      series_day: 1,
      is_final_day: false,
      st_rows: [[boat, 0.15, false, false, null, boat]],
      exhibition_rows: [[boat, 6.8]],
    };
  });

async function openTrend(page) {
  await page.route("**/rest/v1/rpc/get_racer_scoped_race_rows*", (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runsFor(Number(body.p_racer_id))),
    });
  });
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  const head = page.locator(".race-basic-info-tab .trc-head");
  await expect(head.locator(".trc-title")).toBeVisible({ timeout: 30000 });
  await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  const hit = page.locator(".race-basic-info-tab .trc-hit");
  await expect(hit).toBeVisible({ timeout: 30000 });
  await hit.scrollIntoViewIfNeeded();
  return hit;
}

test("点に重ねると吹き出し（日付・会場・R／コース・着順・ST／値）、クリックで留めて外と Esc で閉じる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hit = await openTrend(page);
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  const tip = page.locator(".race-basic-info-tab .trc-tip");
  await expect(tip).toBeVisible();
  await expect(tip.locator(".trc-tip-line")).toHaveCount(3);
  await expect(tip).toContainText("ST");
  await expect(tip).toContainText("直近30走の3連対率");
  // レースへの飛び先はその走のレース詳細
  await expect(tip.locator(".trc-tip-link")).toHaveAttribute(
    "href",
    /^\/race\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/,
  );
  // 重ねただけなら外へ出ると消える
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  // クリックで留め、マウスを動かしても残る。外を押すと閉じる
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(page.locator(".trc-tip.is-pinned")).toBeVisible();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await expect(page.locator(".trc-tip.is-pinned")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(tip).toHaveCount(0);
  // Esc でも閉じる
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(page.locator(".trc-tip.is-pinned")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});

test("留めた吹き出しの「レースへ」でその走のレース詳細へ飛ぶ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hit = await openTrend(page);
  const box = await hit.boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  const link = page.locator(".trc-tip.is-pinned .trc-tip-link");
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test.describe("スマホ", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("押すと図の下に帯で出て、帯を開いたまま艇の丸を押すとその艇が選ばれる", async ({
    page,
  }) => {
    const hit = await openTrend(page);
    const box = await hit.boundingBox();
    await hit.tap({ position: { x: box.width * 0.4, y: box.height / 2 } });
    const tip = page.locator(".race-basic-info-tab .trc-tip.is-pinned");
    await expect(tip).toBeVisible();
    const link = await tip.locator(".trc-tip-link").boundingBox();
    expect(link.height, "リンクの押せる高さ").toBeGreaterThanOrEqual(44);
    // 吹き出しの外を押す（押した瞬間に閉じて丸が動くと、押した艇が選ばれなかった。ファン評価 11/25）
    await page.locator(".race-basic-info-tab .trc-boat").nth(2).tap();
    await expect(
      page.locator(".race-basic-info-tab .trc-boat").nth(2),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".race-basic-info-tab .trc-tip")).toHaveCount(0);
  });
});
