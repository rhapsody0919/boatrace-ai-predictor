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

// 艇を押した直後（書き戻しが画面に反映される前）にタブを押しても、艇の選択が消えない。
// setSearchParams の関数形式が受け取る値は描画時点のもので、反映前に次の書き戻しが走ると
// 古い値を土台にして boat を消していた（CI で「?tab=meet&boat=2」が「?tab=meet」になった）。
// 同じタスクの中で2つのクリックを発火させて、反映前の書き戻しを確実に起こす
test("艇を押した直後にタブを押しても、艇の選択が URL から消えない", async ({
  page,
}) => {
  test.slow();
  await openRace(page, RACE_PATH);
  await tab(page, "基本情報").click();
  await expect(basicBar(page, 5)).toBeVisible({ timeout: 30000 });

  await page.evaluate(() => {
    const bar = [...document.querySelectorAll(".rbit-bar-row")].find(
      (el) => el.querySelector(".rbit-boat-chip")?.textContent.trim() === "5",
    );
    const meet = [...document.querySelectorAll(".race-tabs-btn")].find(
      (el) => el.textContent.trim() === "今節",
    );
    bar.click();
    meet.click();
  });
  await expect.poll(() => searchOf(page)).toBe("?tab=meet&boat=5");
  await expect(meetChip(page, 5)).toHaveAttribute("aria-pressed", "true", {
    timeout: 30000,
  });
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

// BOA-847: URL は初期値として読むだけ。操作しても first を書き戻さない。
const firstBoat = (page, boat) =>
  page.locator(".af-flow").getByRole("button", {
    name: new RegExp(`^1着 ${boat}号艇 [\\d,]+件$`),
  });

// 思考アシスト用の既存スタブは boats=1 を拒むため、ソナー用の応答に上書きする。
async function routeFirstScenario(page) {
  const {
    THINKING_ASSIST_RACE,
    routeThinkingAssistV16,
    thinkingAssistScenario,
    thinkingAssistScopeKeys,
  } = await import("./thinking-assist-fixture.js");
  await routeThinkingAssistV16(page);
  await page.route("**/api/analogy/scenario/**", (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    return route.fulfill({
      json: thinkingAssistScenario(scope ?? thinkingAssistScopeKeys().NC),
    });
  });
  return THINKING_ASSIST_RACE;
}

test("相手レンズの軸を選んだ URL で着順の流れを開く", async ({ page }) => {
  test.slow();
  const THINKING_ASSIST_RACE = await routeFirstScenario(page);
  await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
  await page
    .getByRole("tablist", { name: "見方" })
    .getByRole("tab", { name: "相手", exact: true })
    .click();
  await page.getByRole("radio", { name: "4号艇を軸" }).click();
  const link = page.locator(".ta-follow-sonar");
  await expect(link).toHaveAttribute(
    "href",
    `/race/${THINKING_ASSIST_RACE}?tab=sonar&sonar=scenario&first=4`,
  );
  await link.click();
  await expect(firstBoat(page, 4)).toHaveAttribute("aria-pressed", "true");
  const initial = searchOf(page);
  await firstBoat(page, 4).click();
  await expect(firstBoat(page, 4)).toHaveAttribute("aria-pressed", "false");
  expect(searchOf(page)).toBe(initial);
});

test("直接開いた first は1〜6だけを初期選択に使う", async ({ page }) => {
  test.slow();
  const THINKING_ASSIST_RACE = await routeFirstScenario(page);
  const path = `/race/${THINKING_ASSIST_RACE}?tab=sonar&sonar=scenario`;
  await openRace(page, `${path}&first=4`);
  await expect(firstBoat(page, 4)).toHaveAttribute("aria-pressed", "true");
  for (const raw of ["", "0", "7", "04", "4.0", "x"]) {
    await openRace(page, `${path}&first=${raw}`);
    await expect(firstBoat(page, 4)).toBeVisible();
    await expect(
      page.locator('.af-flow [role="button"][aria-pressed="true"]'),
    ).toHaveCount(0);
  }
});

test("first は艇番だけを受け取り、レースの page_view から除く", async () => {
  const { parseFirstParam, pageViewPath } =
    await import("../src/utils/raceUrlState.js");
  for (let b = 1; b <= 6; b += 1) expect(parseFirstParam(String(b))).toBe(b);
  for (const raw of [null, undefined, "", "0", "7", "04", "4.0", "x", " 4"])
    expect(parseFirstParam(raw)).toBeNull();
  expect(
    pageViewPath("/race/example", "?tab=sonar&sonar=scenario&first=4&x=1"),
  ).toBe("/race/example?x=1");
  expect(pageViewPath("/about", "?first=4")).toBe("/about?first=4");
});

// BOA-847 取り込み時に追加: 内部タブの往復と、別の軸からの入り直し
test("first は1回だけ使い、内部タブを往復しても選び直さない", async ({
  page,
}) => {
  test.slow();
  const THINKING_ASSIST_RACE = await routeFirstScenario(page);
  await openRace(
    page,
    `/race/${THINKING_ASSIST_RACE}?tab=sonar&sonar=scenario&first=4`,
  );
  await expect(firstBoat(page, 4)).toHaveAttribute("aria-pressed", "true");
  const inner = page.locator(".af-tabs");
  await inner.getByRole("tab", { name: "差がつく材料" }).click();
  await inner.getByRole("tab", { name: "展開シナリオ" }).click();
  await expect(firstBoat(page, 4)).toBeVisible();
  await expect(
    page.locator('.af-flow [role="button"][aria-pressed="true"]'),
  ).toHaveCount(0);
});

// 使い終えた印はモジュールの Set にあるので、再読み込み（page.goto）ではなく
// 画面内の移動（戻る）で入り直す。再読み込みすると印が消えて検査にならない
test("別の軸から入り直すと、その軸を1着に選ぶ", async ({ page }) => {
  test.slow();
  const THINKING_ASSIST_RACE = await routeFirstScenario(page);
  const pickAxisAndOpen = async (boat) => {
    await page
      .getByRole("tablist", { name: "見方" })
      .getByRole("tab", { name: "相手", exact: true })
      .click();
    await page.getByRole("radio", { name: `${boat}号艇を軸` }).click();
    await page.locator(".ta-follow-sonar").click();
    await expect(firstBoat(page, boat)).toHaveAttribute("aria-pressed", "true");
  };
  await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
  await pickAxisAndOpen(4);
  await page.goBack();
  await pickAxisAndOpen(2);
});
