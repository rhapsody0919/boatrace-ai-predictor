import { test, expect } from "./fixtures.js";

/**
 * 会場公式のモーター成績（venue_motor_stats）の取得失敗を、表の該当列だけ「取得失敗」で示し、
 * キャッシュしない（BOA-740）。
 *
 * 以前は getVenueMotorStats が失敗を null（その会場・モーターの行なし）にしていた。そのため、
 * モータ情報タブの1着率・優出数・優勝数は、会場公式が出していない会場と同じく列ごと畳まれ、失敗が見えなかった。
 * さらに、呼び出し元の getRaceMotorBreakdown（withCache の中）が、その結果を過去レースでは7日間保存していた。
 *
 * ここでは venue_motor_stats を途中まで500にし（先読みでも同じ取得が走るため、切り替えるまで失敗させ続ける）、
 * (1) 表は出たまま、1着率・優出数・優勝数の列に「取得失敗」と注記が出ること（他の列は出る）
 * (2) 失敗をやめてリロードした後は「取得失敗」が消えること（失敗がキャッシュに残っていないこと）
 * を確かめる。
 */

const RACE = "/race/2026-09-21-05-12";

test("会場公式のモーター成績の取得が失敗したら、その列だけ「取得失敗」を出し、リロード後は値に戻る（失敗をキャッシュしない）", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/rest/v1/venue_motor_stats*", async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure (BOA-740)" }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
  const table = page.locator(".motor-ranking-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });

  // 表全体はエラーにならず、他の列（公式2連率）は出る
  await expect(table.locator("thead")).toContainText("公式2連率");
  // 会場公式由来の列は畳まれず、6艇とも「取得失敗」
  await expect(table.locator("thead")).toContainText("優出数");
  await expect(table.locator("thead")).toContainText("優勝数");
  await expect(table.locator("thead")).toContainText("1着率");
  // 1行に3列（1着率・優出数・優勝数）× 6艇
  await expect(table.locator(".motor-stat-failed")).toHaveCount(18);
  await expect(
    page.locator(".motor-venue-stats-failed-note").first(),
  ).toBeVisible();
  // 取得失敗の行に「集計前」は付けない（出走数が無いだけで、集計前とは断定できない）
  await expect(table).not.toContainText("集計前");

  // リロード: 失敗がキャッシュされていれば、「取得失敗」が残る
  failing = false;
  await page.reload();
  await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
  await expect(table).toBeVisible({ timeout: 30000 });
  await expect(table.locator(".motor-stat-failed")).toHaveCount(0);
  await expect(page.locator(".motor-venue-stats-failed-note")).toHaveCount(0);
});
