import { test, expect } from "./fixtures.js";

/**
 * レース詳細のタブ・艇の選択を URL（?tab=・?boat=）に載せることの固定（BOA-493）。
 *
 * - 選ぶたびに history.replace で書き戻す。そのリンクを開くと同じタブ・艇で開く
 * - push ではなく replace なので、戻るボタンは選択を巻き戻さず前のページへ戻る
 * - 既定のタブ・艇未選択ではクエリを付けない
 * - GA4 の page_view は、タブ・艇を選んでも増えない（PageViewTracker が除いて数える）
 * - 不正な値は無視して既定で開く（tab は既定に戻した時点で URL から消える。boat は
 *   無視されるだけで残るが、どのタブでも艇未選択として扱う）
 */

// 確定済みの過去のレース（既定タブは「結果」）
const RACE_PATH = "/race/2026-09-27-02-11";

const tab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

const basicBar = (page, boat) =>
  page.locator(".rbit-bar-row").filter({
    has: page.locator(".rbit-boat-chip", { hasText: new RegExp(`^${boat}$`) }),
  });

const meetChip = (page, boat) =>
  page.locator(".rmt-select-chip", { hasText: new RegExp(`^${boat}`) });

const searchOf = (page) => new URL(page.url()).search;

async function openRace(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".race-tabs-btn").first()).toBeVisible({
    timeout: 60000,
  });
}

test.use({ viewport: { width: 390, height: 844 } });

test("選んだタブ・艇が URL に載り、そのリンクを開くと同じタブ・艇で開く", async ({
  page,
}) => {
  test.slow();
  await openRace(page, RACE_PATH);

  // 既定（確定済みなので結果タブ・艇未選択）ではクエリを付けない
  await expect(tab(page, "結果")).toHaveAttribute("aria-selected", "true");
  expect(searchOf(page)).toBe("");

  await tab(page, "基本情報").click();
  await expect.poll(() => searchOf(page)).toBe("?tab=basic");

  await basicBar(page, 4).click();
  await expect(basicBar(page, 4)).toHaveAttribute("aria-expanded", "true", {
    timeout: 30000,
  });
  await expect.poll(() => searchOf(page)).toBe("?tab=basic&boat=4");

  // そのリンクを新しく開くと、同じタブ・同じ艇で開く
  const shared = page.url();
  await openRace(page, shared);
  await expect(tab(page, "基本情報")).toHaveAttribute("aria-selected", "true");
  await expect(basicBar(page, 4)).toHaveAttribute("aria-expanded", "true", {
    timeout: 30000,
  });

  // 艇の選択はタブをまたいで保たれ、URL も艇を持ったままタブだけ変わる
  await tab(page, "今節").click();
  await expect(meetChip(page, 4)).toHaveAttribute("aria-pressed", "true", {
    timeout: 30000,
  });
  await expect.poll(() => searchOf(page)).toBe("?tab=meet&boat=4");

  // 基本情報で閉じると艇の選択が消える。既定のタブ（結果）に戻すと tab も消える
  await tab(page, "基本情報").click();
  await basicBar(page, 4).click();
  await expect.poll(() => searchOf(page)).toBe("?tab=basic");
  await tab(page, "結果").click();
  await expect.poll(() => searchOf(page)).toBe("");
});

test("戻るボタンはタブ・艇の選択を巻き戻さず、前のページへ戻る", async ({
  page,
}) => {
  test.slow();
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await openRace(page, RACE_PATH);

  await tab(page, "基本情報").click();
  await basicBar(page, 2).click();
  await tab(page, "今節").click();
  await expect.poll(() => searchOf(page)).toBe("?tab=meet&boat=2");

  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
});

test("不正な ?tab=・?boat= は無視して既定で開く（不正な tab は URL から消える）", async ({
  page,
}) => {
  test.slow();
  await openRace(page, `${RACE_PATH}?tab=nosuchtab&boat=9`);
  await expect(tab(page, "結果")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => searchOf(page)).toBe("?boat=9");

  // 艇番が範囲外なので、基本情報では誰も展開しない
  await tab(page, "基本情報").click();
  for (let boat = 1; boat <= 6; boat += 1) {
    await expect(basicBar(page, boat)).toHaveAttribute(
      "aria-expanded",
      "false",
      { timeout: 30000 },
    );
  }
});

test("タブ・艇を選んでも GA4 の page_view は増えない（クエリを除いて数える）", async ({
  page,
}) => {
  test.slow();
  // gtag を記録用に差し替える（後から読み込まれる GA のスクリプトに上書きさせない）
  await page.addInitScript(() => {
    window.__pageViews = [];
    Object.defineProperty(window, "gtag", {
      configurable: false,
      writable: false,
      value: (command, name, params) => {
        if (command === "event" && name === "page_view") {
          window.__pageViews.push(params.page_location);
        }
      },
    });
  });
  await openRace(page, `${RACE_PATH}?tab=meet`);
  // 最初の1件（落ち着くまで500ms待ってから送る）
  await expect
    .poll(() => page.evaluate(() => window.__pageViews.length))
    .toBe(1);

  await tab(page, "基本情報").click();
  await basicBar(page, 3).click();
  await tab(page, "枠別情報").click();
  await expect.poll(() => searchOf(page)).toBe("?tab=waku&boat=3");
  await page.waitForTimeout(1500);

  const views = await page.evaluate(() => window.__pageViews);
  expect(views).toHaveLength(1);
  // 数える URL にもタブ・艇は含めない（同じレースは1つの page_location にまとまる）
  expect(views[0]).toMatch(/\/race\/2026-09-27-02-11$/);
});
