import { test, expect } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "./thinking-assist-fixture.js";

/**
 * 思考アシストのヘッダーの「もっと詳しく見る（龍神ソナー）」は、龍神ソナーのタブ（?tab=sonar）へ移る。
 * BOA-271 でソナーが別のタブに分かれた後も ?tab=aiPrediction のままで、AI予想タブに移っていた（2026-10-17 オーナー指摘）
 */
test("思考アシストの「龍神ソナー」のリンクを押すと、ソナーのタブが選ばれる", async ({
  page,
}) => {
  await routeThinkingAssistV16(page);
  await page.goto(`/race/${THINKING_ASSIST_RACE}/assist`);
  const link = page.getByRole("link", { name: /龍神ソナー/ }).first();
  await expect(link).toBeVisible({ timeout: 30000 });
  await expect(link).toHaveAttribute(
    "href",
    `/race/${THINKING_ASSIST_RACE}?tab=sonar`,
  );
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/race/${THINKING_ASSIST_RACE}\\?tab=sonar$`),
  );
  await expect(
    page.getByRole("tab", { name: "龍神ソナー", exact: true }),
  ).toHaveAttribute("aria-selected", "true", { timeout: 30000 });
  await expect(
    page.getByRole("tab", { name: "AI予想", exact: true }),
  ).toHaveAttribute("aria-selected", "false");
});
