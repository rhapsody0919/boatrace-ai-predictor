import { test, expect } from "@playwright/test";

/**
 * レース詳細のタブ構成の固定（BOA-454）。
 *
 * 390pxで完全に見えるタブは4つだけ（実測: 可視334px）。並びは「粒度」で揃える
 * ことに決めた ── 6艇を横断して見るタブを前に、選手1人を掘るタブを後ろに、
 * 買い目・結果を最後に。根拠は `PredictionPanel.jsx` のコメントに書いてある。
 *
 * レースの確定状態に依存しない形で書いている。「結果タブが出ているかどうか」は
 * DBの中身（バックフィルで後から結果が入ることがある）で変わるため、
 * 特定のレースが確定済みであることを前提にすると、いつか勝手に壊れる。
 * 代わりに**規則そのもの**を確かめる。
 *
 * - 結果タブ以外の7つは、どのレースでもこの順で並ぶ
 * - 結果タブが出ているなら、必ず末尾で、開いた時点で選ばれている
 * - 結果タブが出ていないなら、開いた時点で選ばれているのは基本情報
 */

// 結果タブを除いた固定の並び。前半4つが6艇横断、後半2つが1艇ドリルダウン、
// 最後に買い目
const TABS_BEFORE_RESULT = [
  "基本情報",
  "AI予想",
  "今節",
  "直前情報",
  "枠別情報",
  "モータ情報",
  "オッズ一覧",
];

// 結果が入っているレースと、入っていないレース。どちらも過去の固定レースで、
// どちらがどちらかはテストの中で判定する（上記のとおり前提にしない）
const RACES = ["/race/2026-09-27-02-11", "/race/2026-09-21-02-05"];

test.use({ viewport: { width: 390, height: 844 } });

for (const path of RACES) {
  test(`レース詳細のタブは決めた順で並び、結果タブは確定時だけ出る: ${path}`, async ({
    page,
  }) => {
    // 本番Supabaseを複数段で引くため、DBが遅い日は既定の60秒に収まらない
    test.slow();

    await page.goto(path, { waitUntil: "domcontentloaded" });
    const tabs = page.locator(".race-tabs-btn");
    await expect(tabs.first()).toBeVisible({ timeout: 60000 });

    const labels = await tabs.allInnerTexts();
    const hasResult = labels.includes("結果");

    await test.step("結果タブ以外は決めた順で並ぶ", async () => {
      expect(labels.filter((label) => label !== "結果")).toEqual(
        TABS_BEFORE_RESULT,
      );
    });

    await test.step("結果タブは末尾にだけ出て、出たときは既定で選ばれる", async () => {
      const active = await page.locator(".race-tabs-btn.is-active").innerText();
      if (hasResult) {
        expect(labels[labels.length - 1]).toBe("結果");
        // 確定済みレースを開いたら、最初に見えるのは結果
        expect(active).toBe("結果");
      } else {
        // 未確定レースでは空の結果タブを出さない。既定は基本情報
        expect(active).toBe("基本情報");
      }
    });

    await test.step("390pxで先頭4つが完全に見え、5つ目が半分見える", async () => {
      const measured = await page
        .locator(".race-tabs-bar")
        .evaluate((bar, expected) => {
          const btns = [...bar.querySelectorAll(".race-tabs-btn")];
          const byLabel = (label) =>
            btns.find((b) => b.textContent.trim() === label);
          const fourth = byLabel(expected[3]);
          const fifth = byLabel(expected[4]);
          return {
            client: bar.clientWidth,
            fourthRight: fourth.offsetLeft + fourth.offsetWidth,
            fifthLeft: fifth.offsetLeft,
          };
        }, TABS_BEFORE_RESULT);

      // 4つ目（直前情報）までが可視域に収まっている
      expect(measured.fourthRight).toBeLessThanOrEqual(measured.client);
      // 5つ目（枠別情報）が始まっているのも見えている。半分見えているタブ自体が
      // 「右に続く」の手がかりになる（フェードや「›」より強い）
      expect(measured.fifthLeft).toBeLessThan(measured.client);
    });
  });
}

test("タブを押すとGA4に race_tab_select が送られる（並び順の評価をデータでやるため）", async ({
  page,
}) => {
  test.slow();

  // gtag が読み込まれていない環境でも、trackEvent が呼ぶ窓口は window.gtag。
  // 差し替えて、押したときだけ送られることを見る
  await page.addInitScript(() => {
    window.__gaEvents = [];
    window.gtag = (...args) => {
      if (args[0] === "event") window.__gaEvents.push(args);
    };
  });

  await page.goto(RACES[0], { waitUntil: "domcontentloaded" });
  const tabs = page.locator(".race-tabs-btn");
  await expect(tabs.first()).toBeVisible({ timeout: 60000 });

  // 初回マウント・レース遷移では送らない（ユーザーが選んだものだけ数える）
  const beforeClick = await page.evaluate(() =>
    window.__gaEvents.filter((e) => e[1] === "race_tab_select"),
  );
  expect(beforeClick).toHaveLength(0);

  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__gaEvents.filter((e) => e[1] === "race_tab_select").length,
      ),
    )
    .toBe(1);

  const sent = await page.evaluate(
    () => window.__gaEvents.find((e) => e[1] === "race_tab_select")[2],
  );
  expect(sent.tab_id).toBe("meet");
  // GA4の予約語と衝突する `source` のようなキーを足していないこと
  expect(Object.keys(sent).sort()).toEqual([
    "from_tab_id",
    "tab_count",
    "tab_id",
  ]);
});
