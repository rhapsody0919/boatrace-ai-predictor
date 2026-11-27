// 使い方ガイドのタブの数と並びが、レース詳細の実際のタブ（龍神ソナーを含む）とそろっていることを守る
import { test, expect } from "./fixtures.js";

// 正本は PredictionPanelTabs.jsx（龍神ソナーは基本情報とイン崩れの間。ANALOGY_FINDER_PUBLIC=true で公開済み）。
// タブの名前は IN_CAUTION_PUBLIC=true の公開後の物（AI予想→イン崩れ、#3622）
const TABS = [
  "基本情報",
  "龍神ソナー",
  "イン崩れ",
  "今節",
  "直前情報",
  "枠別情報",
  "モータ情報",
  "オッズ一覧",
  "結果",
];

test("使い方ガイドのステップ4は、発走前8つ・確定で9つのタブを実際の並びで載せる", async ({
  page,
}) => {
  await page.goto("/how-to-use");
  // ガイドはステップごとに切り替える。タブの説明はステップ4
  await page.locator(".step-nav-btn", { hasText: "Step 4" }).click();
  const detail = page.locator(".step-detail", { hasText: "タブの内容" });
  const items = detail.locator("ul > li");
  await expect(items).toHaveCount(TABS.length);
  for (const [index, tab] of TABS.entries()) {
    await expect(items.nth(index).locator("strong").first()).toHaveText(tab);
  }
  const intro = page.locator("p", { hasText: "データ出走表の上にタブが並んでいます" });
  await expect(intro).toContainText("発走前は8つ");
  await expect(intro).toContainText("加わって9つになります");
  await expect(page.getByText("前半の5つは")).toBeVisible();
});
