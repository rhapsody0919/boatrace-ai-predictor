import { test, expect } from "./fixtures.js";

// 決まり手の棒は枠ごとに100%へそろえた「その枠の1着の中の内訳」。説明が「まくりの割合が高い枠番 = 外枠が決まりやすい」と
// 読ませると、どの会場でも4〜6号艇が当てはまり、外枠の1着の多さと取り違える（2026-11-23、#3258 の #1）
test("決まり手の説明は、棒を枠の1着の中の内訳として読ませる", async ({ page }) => {
  await page.goto("/winning-technique?tab=technique");
  const info = page.locator(".info-section");
  await expect(info).toContainText("その枠が1着になったレースの中の内訳");
  await expect(info).not.toContainText("外枠が決まりやすい");
  await expect(info).not.toContainText("イン逃げが決まりやすい");
});
