import { test, expect } from "./fixtures.js";

// BOA-832: 思考アシストの入口を目立たせる（2026-10-11 ユーザー選択）。
//   A 上部の切り替え: レース詳細を見ているときの「思考アシスト」側を文字色・太字・「›」で目立たせる（地色は付けない）。
//     補足は「迷わず読める順に、データとセオリーを並べました」
//   タブ列のすぐ上の1行「材料を順に見るなら 思考アシスト ›」: タブの数を減らさない。押しても表示の選択は残さず、
//     履歴に積んで移る。結果が出たレースでも出す。ja だけ
const RACE = "/race/2026-10-09-20-09";

const fullyVisibleTabs = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector(".race-tabs-bar");
    const br = bar.getBoundingClientRect();
    return [...bar.querySelectorAll(".race-tabs-btn")].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= br.left - 1 && r.right <= br.right + 1;
    }).length;
  });

test.describe("思考アシストの入口（BOA-832）", () => {
  test("375px: タブ列のすぐ上に1行が出て、タブは4つ見えたまま。押すと思考アシストへ移り、戻るでレース詳細に戻る", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(RACE);
    const row = page.locator(".assist-entry-row");
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row).toHaveText(/材料を順に見るなら\s*思考アシスト\s*›/);
    // 1行はタブ列のすぐ上
    const [rowBox, tabsBox] = await Promise.all([
      row.boundingBox(),
      page.locator(".race-tabs").first().boundingBox(),
    ]);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(tabsBox.y + 1);
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
    expect(await fullyVisibleTabs(page)).toBeGreaterThanOrEqual(4);

    await row.click();
    await expect(page).toHaveURL(/\/race\/2026-10-09-20-09\/assist$/);
    const events = await page.evaluate(() =>
      window.__events
        .filter((e) => e[0] === "event" && e[1] === "assist_view_switch")
        .map((e) => e[2]),
    );
    expect(events).toEqual([
      {
        race_id: "2026-10-09-20-09",
        assist_view: "assist",
        assist_entry: "tab_row",
      },
    ]);
    // 表示の選択は残さない（次にレース詳細を開いても思考アシストへ飛ばない）
    expect(
      await page.evaluate(() => localStorage.getItem("boatai-user:race-view")),
    ).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL(/\/race\/2026-10-09-20-09$/);
  });

  test("375px: 上部の切り替えは思考アシスト側を文字色と「›」で目立たせ、選ばれている側は ✓ のまま", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(RACE);
    const group = page.getByRole("group", { name: "表示" });
    const assist = group.getByRole("button", { name: /思考アシスト/ });
    await expect(assist).toBeVisible({ timeout: 30000 });
    await expect(assist).toHaveClass(/is-entry/);
    await expect(assist).toHaveAttribute("aria-pressed", "false");
    await expect(assist.locator(".assist-view-switch__arrow")).toHaveText("›");
    // 地色は付けない（地色の付いた側が選択中に読まれる）
    const bg = await assist.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).toBe("rgba(0, 0, 0, 0)");
    const race = group.getByRole("button", { name: /出走表とタブ/ });
    await expect(race).toHaveAttribute("aria-pressed", "true");
    await expect(race).toContainText("✓");
    await expect(page.locator(".assist-view-switch__note")).toHaveText(
      "迷わず読める順に、データとセオリーを並べました",
    );
  });

  test("1440px: 1行の左端はタブの列にそろい、幅は720まで", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RACE);
    const row = page.locator(".assist-entry-row");
    await expect(row).toBeVisible({ timeout: 30000 });
    const box = await row.boundingBox();
    const bar = await page.locator(".race-tabs-bar").boundingBox();
    expect(Math.abs(box.x - bar.x)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThanOrEqual(720);
  });

  test("英語のページには出さない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/en${RACE}`);
    await expect(page.locator(".race-tabs").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".assist-entry-row")).toHaveCount(0);
  });
});
