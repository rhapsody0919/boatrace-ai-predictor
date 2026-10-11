import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 一度も使われていない新モーター（2連率0・使用回数0）を、データ出走表で「0.0%」と出さない（BOA-702）。
 *
 * 新モーターに切り替えた直後、未使用のモーターは公式の累計実績が無く、出走表の2連率が 0.00 になる。「0.0%」だと
 * 「2着以内0回」と読まれる。使用回数が0と分かるときは「—」＋注記、1以上なら本物の0%なので「0.0%」のまま。
 *
 * 過去レース（モータ情報の一覧は公式値）で、出走表の応答の1号艇・2号艇の2連率を0にし、会場公式のモーター成績の
 * 出走数を、1号艇のモーターは0回、2号艇のモーターは5回にする。
 */

const RACE = "/race/2026-09-21-05-12";

test("未使用の新モーターは「—」と注記、使用済みで2着以内0回のモーターは 0.0% のまま", async ({
  page,
}) => {
  const motors = {};
  await page.route("**/rest/v1/race_entries*", async (route) => {
    const url = route.request().url();
    // モータ情報の一覧（getRaceMotorBreakdown）の取得だけを加工する
    if (!url.includes("motor_3rate") || !url.includes("motor_number")) {
      await route.fallback();
      return;
    }
    const response = await fetchRecorded(route);
    const rows = await response.json();
    for (const row of rows) {
      if (row.boat_number === 1 || row.boat_number === 2) {
        row.motor_2rate = 0;
        motors[row.boat_number] = row.motor_number;
      }
    }
    await route.fulfill({ response, json: rows });
  });
  await page.route("**/rest/v1/venue_motor_stats*", async (route) => {
    const url = new URL(route.request().url());
    const motor = Number(
      (url.searchParams.get("motor_number") ?? "").replace("eq.", ""),
    );
    const response = await fetchRecorded(route);
    const text = await response.text();
    if (!text) {
      await route.fulfill({ response });
      return;
    }
    const body = JSON.parse(text);
    const patch = (row) =>
      motor === motors[1]
        ? { ...row, race_count: 0 }
        : motor === motors[2]
          ? { ...row, race_count: 5 }
          : row;
    await route.fulfill({
      response,
      json: Array.isArray(body) ? body.map(patch) : body && patch(body),
    });
  });

  await page.goto(RACE);
  // データ出走表は基本情報タブにある（終了したレースでも出る）
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  const table = page.locator(".drt-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });
  const motorRow = table.locator("tbody tr").filter({
    // 見出しは「モーター2連率（過去90日）」（BOA-802 の3）
    has: page.locator(".drt-label-full", { hasText: /^モーター2連率（過去90日）$/ }),
  });
  await expect(motorRow).toBeVisible({ timeout: 30000 });
  // 注記
  await expect(motorRow.locator(".drt-label-note")).toHaveText(
    "新モーター・実績なし",
    { timeout: 30000 },
  );
  // 1号艇（未使用）は「—」、2号艇（5走で2着以内0回）は 0.0%
  // 最初のセルは行のラベル。艇のセルは1号艇から順に続く
  const cells = motorRow.locator("td");
  await expect(cells.nth(1)).toHaveText("—");
  await expect(cells.nth(2)).toContainText("0.0");
});
