import { test, expect } from "./fixtures.js";

/**
 * 選手ページのインデックス判定（集客レーン、2026-10-02、第1段階）の固定。
 *
 * - 現役の A1 選手（最新の出走が A1 で直近30日以内）は、ニュースが無くても index にする
 * - それ以外（B1 等）でニュースが無い選手は noindex のまま
 * - title は「{選手名}（競艇）選手の成績・勝率・決まり手 | 龍神レーダー」（メタ情報のみ。例外1の暫定措置）
 *
 * 判定そのものは scripts/maintenance/verify-racer-index-policy.js で固定の入力で検証する。
 * ここでは録画データの実選手で、ページの robots と title に反映されることを見る。
 * 録画は毎日撮り直されるが、次の2人の級は 12/31 まで変わらない（級は 1/1・7/1 に切り替わる）。
 *   3941 池田浩二（A1）、2878（B1）
 */

const robotsOf = (page) =>
  page.evaluate(
    () =>
      document.querySelector('meta[name="robots"]')?.getAttribute("content") ??
      "",
  );

test("現役の A1 選手（ニュース無し）は index にし、成績の語を入れた title を出す", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page).toHaveTitle(
    "池田浩二（競艇）選手の成績・勝率・決まり手 | 龍神レーダー",
  );
  await expect.poll(() => robotsOf(page)).not.toContain("noindex");
  // 画面の見出しには「競艇」を出さない
  await expect(page.locator(".racer-profile-header")).not.toContainText("競艇");
});

test("B1 選手（ニュース無し）は noindex のまま", async ({ page }) => {
  await page.goto("/racer/2878");
  await expect(page.locator(".racer-profile-header h1")).toBeVisible();
  await expect.poll(() => robotsOf(page)).toContain("noindex");
});
