import { test, expect } from "../fixtures.js";
import { contribution } from "../analogy-contribution-fixture.js";
import { ANALOGY_V16_RACE, routeAnalogyV16 } from "../analogy-v16-fixture.js";
import {
  OVERFLOW_TOLERANCE_PX,
  gotoAndSettle,
  inspectGrids,
  expectNoWastedGrids,
} from "./helpers.js";

/**
 * 龍神ソナーのタブ（BOA-271 v16、screens「デザイントークンと CSS」。2026-10-08 に AI予想タブから独立したタブへ）。上の PAGES はレース詳細を
 * 既定タブのまま測るため、節は検査の対象外。facts・similar・scenario の API を例のレースの固定の応答に差し替え
 * （e2e/analogy-v16-fixture.js）、AIの見立ての寄与度 API も固定値にして、3タブそれぞれで折りたたみを開いた状態の
 * 横スクロールとグリッドを見る（全33項目の表・③の表は 375px で列を詰めて折り返す約束）
 */
test.describe("レイアウト: 龍神ソナーのタブ（3つの内部タブ）", () => {
  const openSection = async (page) => {
    await routeAnalogyV16(page);
    await page.route("**/api/analogy/contribution*", (route) => {
      const u = new URL(route.request().url());
      return route.fulfill({
        json: contribution({
          venue: 0,
          grade: "all",
          round: "all",
          target: Number(u.searchParams.get("target")),
        }),
      });
    });
    await gotoAndSettle(page, `/race/${ANALOGY_V16_RACE}`);
    await page.click('[role="tab"]:has-text("龍神ソナー")');
    const section = page.getByRole("region", {
      name: /龍神ソナー/,
    });
    await expect(section).toBeVisible({ timeout: 30000 });
    return section;
  };
  const openAllDetails = (section) =>
    section.locator("details").evaluateAll((ds) => {
      ds.forEach((d) => {
        d.open = true;
      });
    });
  const expectFits = async (page) => {
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    expectNoWastedGrids(await inspectGrids(page));
  };

  test("差がつく材料: 七角形の項目の表・2艇を太くした状態と折りたたみを開いても横スクロールが出ない", async ({
    page,
  }) => {
    const section = await openSection(page);
    await expect(
      section.getByTestId("analogy-fact-card").first(),
    ).toBeVisible();
    await section.getByRole("button", { name: /全国勝率の6艇の表/ }).click();
    await expect(section.getByTestId("analogy-radar-table")).toBeVisible();
    await section.getByRole("button", { name: /4号艇（/ }).click(); // 2艇を太く
    await openAllDetails(section);
    await expectFits(page);
  });

  test("類似レース: 全33項目の表と1件ずつの比較を開いても横スクロールが出ない", async ({
    page,
  }) => {
    const section = await openSection(page);
    await section.getByRole("tab", { name: "類似レース" }).click();
    await expect(section.getByRole("slider")).toBeVisible();
    await openAllDetails(section);
    await section
      .getByRole("button", { name: /同じ\d+・近い\d+・違う\d+/ })
      .first()
      .click();
    await expectFits(page);
  });

  test("展開シナリオ: 形を選んで③の表を出しても横スクロールが出ない", async ({
    page,
  }) => {
    const section = await openSection(page);
    await section.getByRole("tab", { name: "展開シナリオ" }).click();
    await section.getByRole("button", { name: /^カド受け凹み/ }).click();
    // ③の区分の表は「区分で見る」に畳んである（承認モック mock-scenario-v1）。開いた状態で測る
    await openAllDetails(section);
    await expect(section.getByRole("table").last()).toBeVisible();
    await expectFits(page);
    // ②を開き直した状態（手がかりの箱・格子）も測る
    await section.getByRole("button", { name: /変える/ }).click();
    await openAllDetails(section);
    await expectFits(page);
  });

  test("PC（1024px 以上）では列の左端がタブの列にそろい、図と押して変わる結果が横に並ぶ。狭い画面では縦並びのまま（BOA-813）", async ({
    page,
  }) => {
    const section = await openSection(page);
    const wide = page.viewportSize().width >= 1024;
    // 図（左）と結果（右）の位置。PC では右の列の左端が図の右端より右、狭い画面では結果が図の下
    const sideBySide = (fig, side) =>
      Promise.all([fig.boundingBox(), side.boundingBox()]).then(
        ([a, b]) => b.x >= a.x + a.width - 1 && b.y < a.y + a.height,
      );
    const tabsLeft = await page
      .locator('[role="tab"]:has-text("龍神ソナー")')
      .evaluate((el) => el.parentElement.getBoundingClientRect().left);
    // 節（.af-v16）そのものの左端
    const colLeft = await section.evaluate(
      (el) => el.getBoundingClientRect().left,
    );
    if (wide) expect(Math.abs(colLeft - tabsLeft)).toBeLessThanOrEqual(24);

    // 差がつく材料: 七角形｜艇の行
    await expect(
      section.getByTestId("analogy-fact-card").first(),
    ).toBeVisible();
    expect(
      await sideBySide(
        section.locator(".af-hep .af-dark"),
        section.locator(".af-hep-legend"),
      ),
    ).toBe(wide);
    // 類似レース: ソナー｜点の近くの類似レース
    await section.getByRole("tab", { name: "類似レース" }).click();
    expect(
      await sideBySide(
        section.locator(".af-sonar"),
        section.locator(".af-sonar-picks"),
      ),
    ).toBe(wide);
    // 着順の流れ｜よく出た3連単
    expect(
      await sideBySide(
        section.locator(".af-flow").first(),
        section.locator(".af-bar:has(.af-tri)").first(),
      ),
    ).toBe(wide);
    // 展開シナリオ: ③攻める艇｜1号艇、④1着｜3着以内
    await section.getByRole("tab", { name: "展開シナリオ" }).click();
    await section.locator("#af-pat-kado").click();
    const boxes = section.getByTestId("analogy-attack-box");
    expect(await sideBySide(boxes.first(), boxes.last())).toBe(wide);
    const blks = section
      .locator("#af-scn-s4 .af-pair")
      .first()
      .locator(".af-scn-blk");
    expect(await sideBySide(blks.first(), blks.last())).toBe(wide);
    await expectFits(page);
  });
});
