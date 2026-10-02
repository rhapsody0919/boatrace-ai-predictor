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
    // 見出しは会場別カード（#1105）と同じ「対象件数」。1レースが複数ルールに当たると重複して数えるため
    await expect(summary.locator(".summary-detail")).toHaveText(
      "対象件数: 30 / 的中数: 7 (23%)",
    );

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

  // BOA-574: 会場別タブの4枚のカードは、以前は会場を選ぶたびに predictions を並び順なし・1000件打ち切りで
  // 取り直していた（race_id LIKE '%-16-%' が日付にも当たり、実データの約33%しか集計していなかった）。
  // いまは読み込み時の by_rule を会場のルールで合計して出す。会場を切り替えても再取得しない
  test("会場別タブのカードは by_rule の会場別合計を出し、切り替えても predictions を取り直さない", async ({
    page,
  }) => {
    await page.route(
      PERFORMANCE_API,
      fulfillJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 2160, hits: 290, payout: 272220 },
          by_rule: [
            // 児島（K16-*）: 合計 1,380件・的中264・払戻194,610 → 19%・141%
            { rule_id: "K16-W001", samples: 973, hits: 115, payout: 70610 },
            { rule_id: "K16-W002", samples: 118, hits: 26, payout: 9220 },
            { rule_id: "K16-P002", samples: 188, hits: 80, payout: 29120 },
            { rule_id: "K16-P003", samples: 101, hits: 43, payout: 85660 },
            // 芦屋（AS21-EX001 のみ）: 780件・的中26・払戻77,610 → 3%・100%（99.5…% を Math.round）
            { rule_id: "AS21-EX001", samples: 780, hits: 26, payout: 77610 },
          ],
          by_week: [],
        },
      }),
    );
    await page.goto("/admin/rules");
    await expect(page.locator(".overall-summary-card")).toBeVisible();

    // ここから先の predictions 要求を数える（本日タブの初回読み込みぶんは含めない）
    let predictionRequests = 0;
    page.on("request", (req) => {
      if (PREDICTIONS.test(req.url())) predictionRequests += 1;
    });

    await page.getByRole("button", { name: "会場別" }).click();
    const select = page.locator(".venue-selector select");
    const stats = page.locator(".venue-summary .stat-item");
    // カードは 対象件数・的中数・的中率・回収率 の順。値は位置で取り、見出しは別に確かめる
    const CARD_INDEX = { 対象件数: 0, 的中数: 1, 的中率: 2, 回収率: 3 };
    const statValue = (label) =>
      stats.nth(CARD_INDEX[label]).locator(".stat-value");

    await select.selectOption("16");
    await expect(page.locator(".venue-summary h3")).toHaveText(
      "児島 の運用成績",
    );
    await expect(statValue("対象件数")).toHaveText("1380");
    await expect(statValue("的中数")).toHaveText("264");
    await expect(statValue("的中率")).toHaveText("19%");
    await expect(statValue("回収率")).toHaveText("141%");
    // 下のルール一覧の表（同じ by_rule）の会場の合計と一致する
    const sampleCells = page.locator(".rules-table tbody tr td:nth-child(4)");
    const samplesInTable = (await sampleCells.allInnerTexts()).reduce(
      (sum, text) => sum + Number(text),
      0,
    );
    expect(samplesInTable).toBe(1380);
    // 見出しは「レース数」ではなく「対象件数」（1レースが複数ルールに当たると重複して数えるため）
    await expect(stats.nth(0).locator(".stat-label")).toHaveText("対象件数");

    await select.selectOption("21");
    await expect(statValue("対象件数")).toHaveText("780");
    await expect(statValue("的中数")).toHaveText("26");
    await expect(statValue("的中率")).toHaveText("3%");
    await expect(statValue("回収率")).toHaveText("100%");

    // by_rule に行が無い会場（津）は 0 を出して落ちない
    await select.selectOption("09");
    await expect(statValue("対象件数")).toHaveText("0");
    await expect(statValue("回収率")).toHaveText("0%");

    expect(predictionRequests).toBe(0);
  });

  // BOA-675: TodayTab の useMemo が早期 return の後にあった（rules-of-hooks 違反）。
  // hooks を早期 return の前に移したので、本日タブの「あり／なし」の両方の表示と、
  // タブを行き来しても例外が出ず表示が保たれることを固定する
  test("本日タブは適用レースの有無どちらでも描画でき、タブを行き来しても例外が出ない", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    // 後から登録した route が先に評価される。三国 1R・1着予想3 の予想を1件返す。
    // confidence 50 は confMin 75 の M10-P002・M10-T003 に当たらず、M10-W002（単勝）だけに当たる
    await page.route(
      PREDICTIONS,
      fulfillJson([
        {
          race_id: "2026-01-20-10-01",
          model_id: "standard",
          confidence: 50,
          top_pick: 3,
          top_2nd: 1,
          top_3rd: 2,
          predicted_at: "2026-01-20T00:00:00Z",
        },
      ]),
    );
    // 結果（3-1-2 で的中、単勝 450円）と締切時刻
    await page.route(
      /\/rest\/v1\/race_results\?/,
      fulfillJson([
        {
          race_id: "2026-01-20-10-01",
          rank1: 3,
          rank2: 1,
          rank3: 2,
          payout_win: 450,
          payout_place_1: 200,
          payout_place_2: 150,
          payout_trifecta: 1000,
          payout_trio: 3000,
        },
      ]),
    );
    await page.route(
      /\/rest\/v1\/races\?/,
      fulfillJson([{ race_id: "2026-01-20-10-01", start_time: "10:45" }]),
    );
    await page.route(
      PERFORMANCE_API,
      fulfillJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 1, hits: 1, payout: 450 },
          by_rule: [{ rule_id: "M10-W002", samples: 1, hits: 1, payout: 450 }],
          by_week: [],
        },
      }),
    );
    await page.goto("/admin/rules");
    await expect(page.locator(".overall-summary-card")).toBeVisible();

    const tab = (name) => page.getByRole("button", { name, exact: true });
    for (let i = 0; i < 2; i += 1) {
      await tab("本日").click();
      const stats = page.locator(".today-summary .stat-item .stat-value");
      await expect(stats).toHaveText(["1", "1", "1", "100円", "450円", "450%"]);
      await expect(page.locator(".venue-group-header")).toHaveText(["三国"]);
      await tab("会場別").click();
      await expect(page.locator(".venue-selector select")).toBeVisible();
      await tab("概要").click();
      await expect(page.locator(".rules-table")).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
  });

  test("本日タブは適用レースが無ければ空の表示を出し、例外を出さない", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.route(
      PERFORMANCE_API,
      fulfillJson({
        startDate: "2026-01-16",
        data: { total: { samples: 0, hits: 0, payout: 0 }, by_rule: [], by_week: [] },
      }),
    );
    await page.goto("/admin/rules");
    await page.getByRole("button", { name: "本日", exact: true }).click();
    await expect(page.locator(".today-tab .empty-state")).toHaveText(
      "本日適用されたルールはありません。",
    );
    await page.getByRole("button", { name: "概要", exact: true }).click();
    await page.getByRole("button", { name: "本日", exact: true }).click();
    await expect(page.locator(".today-tab .empty-state")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("API が失敗したら「データなし」にせずエラーを出す", async ({ page }) => {
    await page.route(
      PERFORMANCE_API,
      fulfillJson({ error: "get_admin_rule_performance 呼び出しエラー" }, 500),
    );
    await page.goto("/admin/rules");
    await expect(page.locator(".admin-rules-error-state")).toContainText(
      "get_admin_rule_performance 呼び出しエラー",
    );
  });
});
