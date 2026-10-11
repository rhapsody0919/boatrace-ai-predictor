import { test, expect } from "./fixtures.js";

// SEO 施策 B1（2026-10-11 ユーザー承認のモック）。トップの AI 説明に、龍神ソナー・思考アシストで
// 答えられる問いと操作順を足し、2段落目から廃止の方向の「展開予測」「イン崩れ指数」の説明を外した
test.describe.configure({ timeout: 120000 });

const intro = (page) => page.locator(".home-ai-intro");

test("ja: ソナーと思考アシストのカード、3段の操作、会場一覧へのリンクがある", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const section = intro(page);
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.locator(".home-ai-intro__tool")).toHaveCount(2);
  await expect(section).toContainText("龍神ソナー");
  await expect(section).toContainText("思考アシスト");
  await expect(section.locator(".home-ai-intro__steps li")).toHaveCount(3);
  // 2段目は会場カードの実際のボタン名を使う
  await expect(
    section.locator(".home-ai-intro__steps li").nth(1),
  ).toContainText("「詳細を見る」");
  // 2段落目に廃止の方向の機能名を出さない
  const method = section.locator("p").nth(1);
  await expect(method).not.toContainText("展開予測");
  await expect(method).not.toContainText("イン崩れ指数");
  // 「開催中の会場から選ぶ」で会場一覧へ飛ぶ
  const link = section.locator(".home-ai-intro__venues-link");
  await expect(link).toHaveAttribute("href", "#today-venues");
  await expect(page.locator("#today-venues")).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/#today-venues$/);
});

test("en: 思考アシスト（ja だけの切り替え）は出さず、ソナーだけの操作にする", async ({
  page,
}) => {
  await page.goto("/en/", { waitUntil: "domcontentloaded" });
  const section = intro(page);
  await expect(section).toBeVisible({ timeout: 30000 });
  await expect(section.locator(".home-ai-intro__tool")).toHaveCount(1);
  await expect(section).toContainText("Ryujin Sonar");
  await expect(section).not.toContainText("Thinking Assist");
  await expect(section.locator(".home-ai-intro__steps li").nth(2)).toHaveText(
    'Open the "Ryujin Sonar" tab',
  );
});

test("375px: カードが縦に並び、横にはみ出さず、リンクの高さは44px以上", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const section = intro(page);
  await expect(section).toBeVisible({ timeout: 30000 });
  const tools = section.locator(".home-ai-intro__tool");
  const a = await tools.nth(0).boundingBox();
  const b = await tools.nth(1).boundingBox();
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const link = await section
    .locator(".home-ai-intro__venues-link")
    .boundingBox();
  expect(link.height).toBeGreaterThanOrEqual(44);
});
