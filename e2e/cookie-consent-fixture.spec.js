import { test, expect } from "./fixtures.js";

/**
 * 共通 fixture が全テストを回答済み（バナー無し）で始めることの固定（BOA-502）。
 *
 * バナーは画面下部に position:fixed で出て、下の方の要素へのクリックを奪う。
 * smoke の「今節」タブのテストが、表の3行目をクリックしようとして
 * 「cookie-consent … intercepts pointer events」のまま60秒を使い切って落ちた。
 * 同じ行を画面の下端に置き、その中心で一番手前にある要素を見る
 * （Playwright のクリックが「遮られている」と判定するのと同じ当たり判定）。
 *
 * バナー自体（文言・同意・拒否）の検証は cookie-consent-i18n.spec.js にある。
 */
// 768px 以下ではレース詳細の下部ナビ（.race-bottom-nav、高さ80px）が画面下端を
// 常に覆うため、バナーの有無と関係なく行に当たらない。ナビが消える幅で測る
test.use({ viewport: { width: 1280, height: 720 } });

const RACE_PATH = "/race/2026-09-24-01-03";

// 今節タブの6艇の表の3行目を画面の下端に置き、その中心で一番手前の要素を調べる
async function hitAtRowNearBottom(page) {
  await page.goto(RACE_PATH);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  const row = page.locator(".rmt-compare tbody tr").nth(2);
  await expect(row).toBeVisible({ timeout: 25000 });
  // バナーは下からせり上がる（0.3秒）。途中で測らない
  await page.evaluate(() =>
    Promise.all(
      (document.querySelector(".cookie-consent")?.getAnimations() ?? []).map(
        (a) => a.finished,
      ),
    ),
  );
  return row.evaluate((el) => {
    const before = el.getBoundingClientRect();
    window.scrollBy(0, before.bottom - (window.innerHeight - 8));
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(r.left + r.width / 2, y);
    return {
      // 行の中心が画面の下から40px以内にある（バナーの帯の中。バナーは上下の余白だけで32px）
      nearBottom: window.innerHeight - y <= 40,
      inRow: el.contains(top),
      inBanner: Boolean(top?.closest(".cookie-consent")),
    };
  });
}

test("既定ではバナーが出ず、画面下端の行をクリックできる", async ({ page }) => {
  const hit = await hitAtRowNearBottom(page);
  await expect(page.locator(".cookie-consent")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("boatai:cookie-consent")),
  ).toBe("rejected");
  expect(hit).toEqual({ nearBottom: true, inRow: true, inBanner: false });
});

test.describe("未回答（cookieConsent: null）", () => {
  test.use({ cookieConsent: null });

  test("バナーが画面下端の行を覆う（fixture が無いと起きること）", async ({
    page,
  }) => {
    const hit = await hitAtRowNearBottom(page);
    await expect(page.locator(".cookie-consent")).toBeVisible();
    expect(hit).toEqual({ nearBottom: true, inRow: false, inBanner: true });
  });
});

// fixture の初期化スクリプトはページを開くたびに走る。テスト中に入った回答を
// 既定値で上書きすると、同意後の挙動を見るテストが遷移のたびに巻き戻る
test("テスト中に入った回答は、別のページへ移っても既定値で上書きしない", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("boatai:cookie-consent", "accepted"),
  );
  await page.goto("/racers");
  expect(
    await page.evaluate(() => localStorage.getItem("boatai:cookie-consent")),
  ).toBe("accepted");
});
