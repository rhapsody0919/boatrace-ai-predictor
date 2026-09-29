import { test, expect } from "./fixtures.js";

/**
 * 「今どの艇を見ているか」がレース詳細のタブをまたいで保たれることの固定（BOA-492）。
 *
 * 以前は基本情報・枠別情報・今節が別々のstateを持っていたため、基本情報で4号艇を
 * 開いてから枠別へ移ると1号艇に戻り、選び直しが要った。RaceTabsは非アクティブな
 * タブをアンマウントするので、枠別→今節→枠別と往復しただけでも消えていた。
 *
 * 初回表示は3タブとも従来どおりであることも一緒に確かめる（基本情報は誰も展開
 * しない、枠別・今節は1号艇）。共有値は「まだどの艇も選んでいない」を表すnullを
 * 持ち、基本情報で閉じるとnullに戻って他タブは1号艇へフォールバックする。
 *
 * 390pxで書いているのは、タブの往復がいちばん起きるのがスマホだから。
 * タブはラベルで引く（並び順はBOA-454で変わる）。
 */

// 今節タブに日別成績が入っている過去のレース
const RACE_PATH = "/race/2026-09-27-02-11";

const tab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

// 基本情報タブのバー（押すと選手が展開する）。艇番はバー内のチップに出る
const basicBar = (page, boat) =>
  page.locator(".rbit-bar-row").filter({
    has: page.locator(".rbit-boat-chip", { hasText: new RegExp(`^${boat}$`) }),
  });

const wakuChip = (page, boat) =>
  page.locator(".rwit-boat-chip").filter({
    has: page.locator(".rwit-boat-chip-num", {
      hasText: new RegExp(`^${boat}$`),
    }),
  });

const meetChip = (page, boat) =>
  page.locator(".rmt-select-chip", { hasText: new RegExp(`^${boat}`) });

test.use({ viewport: { width: 390, height: 844 } });

test("艇の選択が基本情報・枠別情報・今節タブで共有される", async ({ page }) => {
  // 本番Supabaseを複数段で引くため、DBが遅い日は既定の60秒に収まらない
  test.slow();

  await page.goto(RACE_PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".race-tabs-btn").first()).toBeVisible({
    timeout: 60000,
  });

  await test.step("初回表示は3タブとも従来どおり", async () => {
    await tab(page, "基本情報").click();
    await expect(basicBar(page, 1)).toBeVisible({ timeout: 30000 });
    // 誰も展開していない
    for (let boat = 1; boat <= 6; boat += 1) {
      await expect(basicBar(page, boat)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }

    await tab(page, "枠別情報").click();
    await expect(wakuChip(page, 1)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });

    await tab(page, "今節").click();
    await expect(meetChip(page, 1)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
  });

  await test.step("枠別で選んだ艇が今節・基本情報へ引き継がれる", async () => {
    await tab(page, "枠別情報").click();
    await wakuChip(page, 4).click();
    await expect(wakuChip(page, 4)).toHaveAttribute("aria-pressed", "true");

    await tab(page, "今節").click();
    await expect(meetChip(page, 4)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
    await expect(meetChip(page, 1)).toHaveAttribute("aria-pressed", "false");

    await tab(page, "基本情報").click();
    await expect(basicBar(page, 4)).toHaveAttribute("aria-expanded", "true", {
      timeout: 30000,
    });
    await expect(basicBar(page, 1)).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("今節で選び直すと枠別にも伝わる", async () => {
    await tab(page, "今節").click();
    await meetChip(page, 2).click();
    await expect(meetChip(page, 2)).toHaveAttribute("aria-pressed", "true");

    await tab(page, "枠別情報").click();
    await expect(wakuChip(page, 2)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
  });

  await test.step("タブを往復しても選択が消えない", async () => {
    await tab(page, "今節").click();
    await tab(page, "枠別情報").click();
    // 非アクティブタブはアンマウントされるが、共有stateは上に居るので残る
    await expect(wakuChip(page, 2)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
  });

  await test.step("基本情報で閉じると他タブは1号艇に戻る", async () => {
    await tab(page, "基本情報").click();
    await expect(basicBar(page, 2)).toHaveAttribute("aria-expanded", "true", {
      timeout: 30000,
    });
    await basicBar(page, 2).click();
    await expect(basicBar(page, 2)).toHaveAttribute("aria-expanded", "false");

    await tab(page, "枠別情報").click();
    await expect(wakuChip(page, 1)).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
  });
});
