// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

// 過去に発生した割合を見る（BOA-635 T5-1）。スリットの7形の一覧と強さの段が、375〜1920px で横にはみ出さない。
// layer は固定データで返す（録画の時刻より後の、v16 公開後の確定済みレース。予想・結果は素通し）
test.describe("レイアウト: 過去に発生した割合を見る（BOA-635）", () => {
  const RACE_ID = "2026-10-16-01-12";
  const row = (i) => ({
    race_id: `2026-10-${String((i % 9) + 1).padStart(2, "0")}-01-${String((i % 12) + 1).padStart(2, "0")}`,
    race_date: `2026-10-${String((i % 9) + 1).padStart(2, "0")}`,
    rank1: (i % 6) + 1,
    rank2: ((i + 2) % 6) + 1,
    rank3: ((i + 4) % 6) + 1,
    winning_technique: "逃げ",
    course_by_boat: [1, 2, 3, 4, 5, 6],
    st_by_course: [0.15, 0.16, 0.14, 0.12, 0.15, 0.17],
    payout_3tan: 1500 + i * 10,
  });
  const LAYER = {
    status: "ok",
    run_id: "layout",
    race_id: RACE_ID,
    conditions: {
      b1_class: "A1",
      gap_band: 2,
      top_boat: 1,
      round: null,
      grade_g1plus: false,
    },
    n_total: 3000,
    n_returned: 40,
    pool_from: "2019-04-01",
    pool_cutoff: "2026-10-15",
    rows: Array.from({ length: 40 }, (_, i) => row(i)),
  };

  test("AI予想タブのスリットの入力と結果が横にはみ出さない", async ({
    page,
  }) => {
    await page.route("**/api/analogy/layer/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LAYER),
      }),
    );
    await page.goto(`/race/${RACE_ID}?tab=aiPrediction`, {
      waitUntil: "domcontentloaded",
    });
    const checker = page.getByTestId("past-rate-checker");
    await expect(checker).toBeVisible({ timeout: 30000 });
    await checker.getByRole("tab", { name: "スリット" }).click();
    await checker.getByRole("button", { name: /^カド一撃/ }).click();
    await checker
      .getByRole("button", { name: "過去に発生した割合を見る" })
      .click();
    await expect(checker.locator(".prc-result")).toBeVisible();
    const m = await checker.evaluate((el) => {
      const de = document.documentElement;
      const r = el.getBoundingClientRect();
      // SVG の中（描画範囲で切られる）と、横にスクロールする列（型のタブ）の中は数えない
      const scrolls = (x) => {
        for (let p = x.parentElement; p && p !== el; p = p.parentElement)
          if (["auto", "scroll"].includes(getComputedStyle(p).overflowX))
            return true;
        return false;
      };
      const wide = [...el.querySelectorAll("*")].filter(
        (x) =>
          !x.closest("svg") &&
          !scrolls(x) &&
          x.getBoundingClientRect().right > r.right + 1,
      ).length;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        right: r.right,
        vw: de.clientWidth,
        wide,
      };
    });
    expect(m.overflow, "ページの横スクロール").toBeLessThanOrEqual(1);
    expect(m.right, "部品の右端").toBeLessThanOrEqual(m.vw + 1);
    expect(m.wide, "部品の枠からはみ出す要素の数").toBe(0);
  });
});
