import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 展開予測の説明を「1着」にそろえる（BOA-710）。
 *
 * モデルの確率は「その艇がその決まり手で1着になる確率」（scripts/lib/turnPrediction.js の
 * コース1着率×1着の決まり手率）で、的中の判定も1着の艇で行う。ところが「?」の用語説明・
 * 使い方ガイド・成績ページは「1マークでどの艇が先頭になりそうか」と書いていて、同じ画面の
 * 説明文（「1着になりそうな艇の候補」）と食い違っていた。
 */

const RACE = "/race/2026-09-29-16-12";

/** 確定済みのレースを、レース前の表示（展開予測カードと「?」が出る）にする */
async function showAsPreRace(page) {
  await page.route("**/api/predictions/**", async (route) => {
    const response = await fetchRecorded(route);
    const body = await response.json().catch(() => null);
    if (!body) return route.fulfill({ response });
    const clear = (v) => {
      if (Array.isArray(v)) v.forEach(clear);
      else if (v && typeof v === "object") {
        for (const k of Object.keys(v)) {
          if (k === "result") v[k] = null;
          else clear(v[k]);
        }
      }
    };
    clear(body);
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: body,
    });
  });
}

for (const [lang, want, notWant] of [
  ["ja", "1着になりそう", "先頭"],
  ["en", "likely to win", "lead at the first mark"],
]) {
  test(`展開予測の「?」の説明は「1着」で書く（${lang}、BOA-710）`, async ({
    page,
  }) => {
    test.slow();
    await showAsPreRace(page);
    await page.goto(`${lang === "ja" ? "" : "/en"}${RACE}?tab=aiPrediction`);
    const card = page
      .locator(".prediction-card")
      .filter({ has: page.locator(".turn-pattern-list") });
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.locator(".term-hint__button").first().click();
    const hint = page.locator(".term-hint__popover");
    await expect(hint).toContainText(want);
    await expect(hint).not.toContainText(notWant);
  });
}

test("使い方ガイドと成績ページの展開予測の説明は「1着」で書く（BOA-710）", async ({
  page,
}) => {
  await page.goto("/how-to-use");
  // ガイドはステップごとに切り替える。展開予測はステップ5
  await page.locator(".step-nav-btn", { hasText: "Step 5" }).click();
  const guide = page
    .locator("li", { hasText: "確率付きの上位パターン" })
    .first();
  await expect(guide).toContainText("1着になりそうか");
  await expect(guide).not.toContainText("先頭");
  await expect(page.getByText("「1コース 逃げ 39%」")).toBeVisible();

  await page.goto("/accuracy");
  const info = page.locator(".accuracy-info").first();
  await expect(info).toContainText("どの艇が1着になるかを予想する機能", {
    timeout: 30000,
  });
  await expect(info).not.toContainText("先頭");
});

test("的中レースの展開予測のカードは「的中した候補」と書き、共有文に「先頭」を書かない（BOA-710）", async ({
  page,
}) => {
  // 共有ボタンが開く URL を記録する（実際には開かない）
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });
  await page.goto("/hit-races");
  const label = page.locator(".turn-hit-course-label").first();
  await expect(label).toBeVisible({ timeout: 30000 });
  // 上位候補のどれかが当たれば的中なので、本命に推したように読める「1着予想」とは書かない
  await expect(label).toHaveText("的中した候補");
  // 決まり手は実際の結果と違うことがあるので、この欄には書かず、AI の予想として書く。
  // 値は1着の艇番で、進入コースが違うときだけ添える（BOA-708）
  await expect(page.locator(".turn-hit-course-value").first()).toHaveText(
    /^\d号艇(（\dコース）)?$/,
  );
  await expect(page.locator(".turn-hit-probability").first()).toHaveText(
    /^予想: (逃げ|差し|まくり|まくり差し|抜き|恵まれ) \d+%$/,
  );

  const card = page.locator(".race-card").filter({ has: label }).first();
  await card.locator(".social-share-button").first().click();
  await expect
    .poll(() => page.evaluate(() => window.__opened.length))
    .toBeGreaterThan(0);
  const text = decodeURIComponent(
    await page.evaluate(() => window.__opened.join(" ")),
  );
  // 予想確率はその決まり手で1着になる確率なので、決まり手も添える（ファン評価2周目）
  // 予想確率はその決まり手で1着になる確率なので決まり手も添える（ファン評価2周目）。ただし実際の
  // 決まり手と違うことがあるので、結果としてではなく AI の予想として書く（3周目）
  expect(text).toMatch(
    /\d号艇が(\dコースから)?1着（AIの予想: (逃げ|差し|まくり|まくり差し|抜き|恵まれ) \d+%）/,
  );
  expect(text).not.toContain("先頭");
});
