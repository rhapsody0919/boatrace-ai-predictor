import { test, expect } from "./fixtures.js";

// /admin/rules の運用成績は /api/admin/rules/performance（RPC get_admin_rule_performance の
// 生の整数）を画面側で整形して出す（BOA-567）。整形（% の丸め・週の累積・ラベル・0件ルール）と
// 取得失敗時の表示を固定する。dev サーバーには Edge Function が無いため API はスタブにする。
const PERFORMANCE_API = /\/api\/admin\/rules\/performance/;
const PREDICTIONS = /\/rest\/v1\/predictions\?/;

const fulfillJson =
  (body, status = 200) =>
  (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

test.describe("管理画面 /admin/rules の運用成績", () => {
  test.beforeEach(async ({ page }) => {
    // 本日タブの予想は見ないので空で返す
    await page.route(PREDICTIONS, fulfillJson([]));
  });

  test("RPC の生の値を旧実装と同じ式で整形して表示する", async ({ page }) => {
    await page.route(
      PERFORMANCE_API,
      fulfillJson({
        startDate: "2026-01-16",
        data: {
          // 投資 3,000円・回収 3,245円 → 108.16…% → 108%。的中 7/30 → 23.3…% → 23%
          total: { samples: 30, hits: 7, payout: 3245 },
          by_rule: [
            { rule_id: "AS21-EX001", samples: 20, hits: 1, payout: 2500 },
            { rule_id: "E03-W001", samples: 10, hits: 6, payout: 745 },
          ],
          by_week: [
            { week_start: "2026-01-19", samples: 10, hits: 6, payout: 745 },
            { week_start: "2026-01-12", samples: 20, hits: 1, payout: 2500 },
          ],
        },
      }),
    );
    await page.goto("/admin/rules");

    await expect(page.locator(".operation-period")).toHaveText(
      "運用期間: 2026-01-16 〜 現在",
    );
    const summary = page.locator(".overall-summary-card");
    await expect(summary).toContainText("投資 3,000円");
    await expect(summary).toContainText("回収 3,245円");
    await expect(summary).toContainText("回収率 108%");
    await expect(summary).toContainText("レース数: 30 / 的中数: 7 (23%)");

    // 週は昇順に並べ替えて累積する: 1/12 は 2500/2000=125%、1/19 は 3245/3000=108%
    const bars = page.locator(".week-bar-container");
    await expect(bars).toHaveCount(2);
    await expect(bars.nth(0)).toContainText("125%");
    await expect(bars.nth(0)).toContainText("1/12");
    await expect(bars.nth(1)).toContainText("108%");
    await expect(bars.nth(1)).toContainText("1/19");

    // 0件のルールも34件すべて出す。既定は回収率の降順
    await expect(page.getByText("全ルール成績一覧 (34件)")).toBeVisible();
    const firstRow = page.locator(".rules-table tbody tr").first();
    await expect(firstRow.locator(".rule-id")).toHaveText("AS21-EX001");
    await expect(firstRow).toContainText("125%");
    const edogawa = page.locator(".rules-table tbody tr", {
      has: page.locator(".rule-id", { hasText: "E03-W001" }),
    });
    // 6/10 → 60%、745/1000 → 74.5% → 75%（Math.round）
    await expect(edogawa).toContainText("60%");
    await expect(edogawa).toContainText("75%");
  });

  test("API が失敗したら「データなし」にせずエラーを出す", async ({ page }) => {
    await page.route(
      PERFORMANCE_API,
      fulfillJson({ error: "get_admin_rule_performance 呼び出しエラー" }, 500),
    );
    await page.goto("/admin/rules");
    await expect(page.locator(".error-state")).toContainText(
      "get_admin_rule_performance 呼び出しエラー",
    );
  });
});
