import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 前検タイムの取得失敗を「前検なし」としてキャッシュしない（BOA-686）。
 *
 * 以前は fetchPretestByRacer が例外を捕まえて空の前検を返していた。呼び出し元の
 * getRaceMotorBreakdown は withCache の中なので、過去レースでは失敗が「この節は前検なし」として
 * localStorage に7日残り、リロードしても「前検」列が出なかった。失敗時に画面は何も知らせず、
 * 前検の無い節（列ごと出さない）と見分けがつかなかった。
 *
 * ここでは motor_pretest_stats を途中まで500にし（タブを開く前にも先読みで同じ取得が走るため、
 * 「1回目だけ」ではなく、切り替えるまで失敗させ続ける）、
 * (1) モータ情報タブが取得失敗を出すこと（前検の無い表に化けないこと）
 * (2) リロード後は取り直した前検が出ること（失敗がキャッシュに残っていないこと）
 * を確かめる。
 */

const RACE = "/race/2026-09-21-05-12";

const openMotorTab = async (page) => {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
};

test("前検タイムの取得が失敗したら取得失敗を出し、リロード後は前検の列が出る（失敗をキャッシュしない）", async ({
  page,
}) => {
  let failing = true;
  let succeeded = 0;
  await page.route("**/rest/v1/motor_pretest_stats*", async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "stub failure (BOA-686)" }),
      });
      return;
    }
    // 失敗を止めた後: 表示中の節の選手ぶんの前検を返す。登番は実応答から拾う
    // （route.fetch() は録画を通らないため fetchRecorded を使う）
    const url = new URL(route.request().url());
    const response = await fetchRecorded(route);
    const rows = await response.json().catch(() => []);
    const racerIds = Array.isArray(rows) ? rows.map((r) => r.racer_id) : [];
    succeeded += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        racerIds.map((racerId, i) => ({
          racer_id: racerId,
          race_date:
            url.searchParams.get("race_date")?.slice(-10) ?? "2026-09-21",
          pretest_time: 6.6 + i * 0.01,
          pretest_rank: i + 1,
        })),
      ),
    });
  });

  await openMotorTab(page);
  const panel = page.locator(".error-state");
  await expect(panel.first()).toBeVisible({ timeout: 30000 });
  // 前検の列が無いだけの表（前検の無い節と同じ見た目）には化けない
  await expect(page.locator("td.motor-pretest-cell")).toHaveCount(0);

  // リロード: 失敗が「前検なし」としてキャッシュされていれば、取り直しは起きず列も出ない
  failing = false;
  await page.reload();
  await page.locator(".race-tabs-btn", { hasText: "モータ情報" }).click();
  const table = page.locator(".motor-ranking-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });
  await expect(table.locator("thead")).toContainText("前検");
  await expect(table.locator("td.motor-pretest-cell").first()).toHaveText(
    /\d\.\d{2}/,
  );
  expect(succeeded).toBeGreaterThanOrEqual(1);
});
