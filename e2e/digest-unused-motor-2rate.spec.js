import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 「本日のデータ一覧」（/today）のカードで、一度も使われていない新モーター（2連率0・会場公式の出走数0）を
 * 「モーター2連率 0.0%」と出さない（BOA-702 後半）。
 *
 * 行の応答（morning_digest_rows）の逃げの上位3行の2連率を0にし、会場公式の出走数（motor_race_count、
 * マイグレーション131）を 1行目は0、2行目は5、3行目は無し（列の追加前に生成した行）にする。
 * 1行目は「—（新モーター・実績なし）」、2行目は本物の0%なので「0.0%」、3行目は分からないので従来どおり「0.0%」。
 *
 * 日付は生成済みの過去日に固定する（today-seo-meta.spec.js と同じ）。
 */
const DIGEST_FIXED_DATE = "2026-09-22";

test("/today: 未使用の新モーターは「—（新モーター・実績なし）」、使用済み・不明は 0.0% のまま", async ({
  page,
}) => {
  const patched = [];
  await page.route("**/rest/v1/morning_digest_rows*", async (route) => {
    const response = await fetchRecorded(route);
    const rows = await response.json();
    const nige = rows
      .filter((r) => r.section === "nige")
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 3);
    nige.forEach((row, i) => {
      row.motor_2rate = 0;
      if (i === 0) row.motor_race_count = 0;
      else if (i === 1) row.motor_race_count = 5;
      else delete row.motor_race_count;
      patched.push(row);
    });
    await route.fulfill({ response, json: rows });
  });

  await page.goto(`/today?date=${DIGEST_FIXED_DATE}`);
  await expect(page.locator(".digest-card").first()).toBeVisible({
    timeout: 30000,
  });
  expect(patched).toHaveLength(3);

  // 逃げのカードは折りたたまれている。▼で開くとフッターにモーター2連率が出る
  const footerOf = async (row) => {
    const card = page
      .locator(".digest-card--collapsible")
      .filter({ hasText: `${row.race_number}R` })
      .filter({ hasText: row.racer_name })
      .first();
    await card.locator(".digest-card__toggle").click();
    return card.locator(".digest-card__foot");
  };

  await expect(await footerOf(patched[0])).toContainText(
    "モーター2連率 —（新モーター・実績なし）",
  );
  await expect(await footerOf(patched[1])).toContainText("モーター2連率 0.0%");
  await expect(await footerOf(patched[2])).toContainText("モーター2連率 0.0%");
});
