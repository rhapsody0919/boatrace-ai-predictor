import { test, expect } from "./fixtures.js";

/**
 * 今節タブの「このレースは◯◯のため、得点率は動きません」に、公式の日本語の種別名
 * （準優勝戦等）がそのまま入っていた（BOA-713 のファン評価で指摘）。ko では「準優勝戦」の
 * 漢字が2位決定戦と読まれ、見出しのチップ「준결승전」とも食い違う。ja 以外は区分の訳にする。
 */

// 2026-10-02 児島11R（準優勝戦）
const RACE = "2026-10-02-16-11";

const meetTab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

async function openSettledNote(page, path, tabLabel) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await meetTab(page, tabLabel).click();
  // 選手を1人選ぶと、その選手の得点率の下に「動きません」の一文が出る
  const chip = page.locator(".rmt-select-chip").first();
  await chip.waitFor({ timeout: 60000 });
  await chip.click();
  const note = page.locator(".rmt-forecast-settled").first();
  await note.waitFor({ timeout: 60000 });
  return note;
}

test.use({ viewport: { width: 375, height: 812 } });

test("ko の今節タブで、準優勝戦を区分の訳（준결승전）で書き、漢字を出さない", async ({
  page,
}) => {
  test.slow();
  const note = await openSettledNote(page, `/ko/race/${RACE}`, "이번 시리즈");
  await expect(note).toContainText("준결승전");
  await expect(note).not.toContainText("準優勝戦");
});

test("ja の今節タブは従来どおり公式の種別名（準優勝戦）のまま", async ({
  page,
}) => {
  test.slow();
  const note = await openSettledNote(page, `/race/${RACE}`, "今節");
  await expect(note).toContainText("準優勝戦");
});

test("Ｗ準優戦（男女Ｗ優勝戦の節）も準優勝戦の区分で訳す", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const labels = await page.evaluate(async () => {
    const { raceStageLabel } =
      await import("/src/constants/raceStageConfig.js");
    const t = (key) => key;
    return ["Ｗ準優戦前半", "Ｗ準優戦後半", "準優勝戦", "準優進出戦"].map(
      (stage) => [
        raceStageLabel(stage, t, "ko"),
        raceStageLabel(stage, t, "ja"),
      ],
    );
  });
  expect(labels.map(([ko]) => ko.text)).toEqual([
    "raceStage.semifinal",
    "raceStage.semifinal",
    "raceStage.semifinal",
    "raceStage.semifinalQualifier",
  ]);
  // ja は公式の種別名のまま
  expect(labels[0][1]).toEqual({ text: "Ｗ準優戦前半", isOfficial: true });
});
