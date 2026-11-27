// BOA-822 の公開（2026-11-27）で表示が無くなったので外した: /accuracy で展開予測の会場別的中率が表示される
// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

// 誤って中止が確定（cancellation_status='confirmed'）のまま残った、結果のあるレースに
// 中止バッジ・中止バナーを出さない（BOA-525）。2026-09-12 に32本がこの状態になり、
// 的中/外れバッジと中止バッジが同時に出た（BOA-512）。本番データはBOA-512/524で直った
// ため、DBに依存しないようEdge API・Supabase RESTを差し替えて再現する。
// 本当に中止されたレース（確定かつ結果なし）には中止表示が出続けることも併せて確かめる
test.describe("結果のあるレースを中止扱いしない（BOA-525）", () => {
  const DATE = "2026-09-12";
  const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
    number: i,
    name: `テスト選手${i}`,
    grade: "B1",
    age: 30,
    winRate: 5.0,
    localWinRate: 5.0,
    motorNumber: i,
    motor2Rate: 35,
    boatNumber: i,
    boat2Rate: 35,
  }));
  const unified = {
    topPick: 1,
    top3: [1, 2, 3],
    confidence: 50,
    turnPrediction: {
      patterns: [{ technique: "逃げ", winnerCourse: 1, probability: 0.6 }],
    },
  };
  const race = (n, { cancellationStatus, result }) => ({
    raceId: `${DATE}-05-${String(n).padStart(2, "0")}`,
    venueCode: 5,
    venue: "多摩川",
    raceNumber: n,
    startTime: `1${n}:00`,
    cancellationStatus,
    entries,
    predictions: { unified },
    exhibitionData: [],
    result,
  });
  const edgeData = {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: [
      // 1R: 誤った確定が残っているが、結果（1着あり）がある → 実施済み
      race(1, {
        cancellationStatus: "confirmed",
        result: { rank1: 1, rank2: 2, rank3: 3, payoutWin: 150 },
      }),
      // 2R: 本当に中止（確定・結果なし）
      race(2, { cancellationStatus: "confirmed", result: null }),
    ],
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ json: edgeData }),
    );
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
  });

  test("レース一覧: 結果のあるレースは中止バッジを出さず、展開予測の的中/外れも出さない（BOA-822）", async ({
    page,
  }) => {
    await page.goto(`/races/${DATE}/5`);
    const cards = page.locator(".race-card");
    await expect(cards).toHaveCount(2, { timeout: 20000 });

    const ran = cards.nth(0);
    // 展開予測の的中/外れのバッジは BOA-822 の公開（2026-11-27）で出なくなった
    await expect(ran).not.toContainText("展開的中");
    await expect(ran).not.toContainText("展開外れ");
    await expect(ran.locator(".race-card-header")).not.toContainText("中止");

    const cancelled = cards.nth(1);
    await expect(cancelled.locator(".race-card-header")).toContainText("中止");
  });

  test("レース詳細: 結果のあるレースに中止バナーを出さず、本当の中止には出す", async ({
    page,
  }) => {
    const BANNER = "このレースは中止となりました";
    await page.goto(`/race/${DATE}-05-01`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });
    // 結果タブ等の描画を待つ（中止バナーは同じパネル内に出る）
    await expect(page.getByText("テスト選手1").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(BANNER)).toHaveCount(0);

    await page.goto(`/race/${DATE}-05-02`);
    await expect(page.getByText(BANNER).first()).toBeVisible({
      timeout: 20000,
    });
  });
});

test.describe("的中レース一覧は /accuracy へ転送される（BOA-822）", () => {
  test("/hit-races は /accuracy へ転送され、展開予測の的中バッジも旧モデル切替UIも出ない", async ({
    page,
  }) => {
    await page.goto("/hit-races");
    await expect(page).toHaveURL(/\/accuracy$/);
    await expect(page.locator(".accuracy-dashboard")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".hit-badge")).toHaveCount(0);
    await expect(page.locator(".turn-hit-detail")).toHaveCount(0);
    await expect(page.locator(".model-selector")).toHaveCount(0);
  });
});

test.describe("過去の予想データ一覧のunified一本化（BOA-178）", () => {
  test("/races で日付カードが並び、展開予測的中率は出ず、旧モデル比較表も出ない（BOA-822）", async ({
    page,
  }) => {
    await page.goto("/races");
    await expect(page.locator(".date-card").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".date-card-turn-stat")).toHaveCount(0);
    await expect(page.locator(".mct-wrapper")).toHaveCount(0);
  });
});

test.describe("成績ページのunified一本化（BOA-175）", () => {
  test("/accuracy は注意度の段ごとの実績を出し、展開予測の的中率と旧モデル切替UIは出ない（BOA-822）", async ({
    page,
  }) => {
    await page.goto("/accuracy");
    await expect(page.locator(".ica-row").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".turn-accuracy-hero-rate")).toHaveCount(0);
    await expect(page.locator(".model-selector")).toHaveCount(0);
  });

  test("/accuracy から旧モデルの月別成績アーカイブへの導線がある", async ({
    page,
  }) => {
    await page.goto("/accuracy");
    const historyLink = page.locator('a.history-link:has-text("アーカイブ")');
    await expect(historyLink).toBeVisible({ timeout: 10000 });
    await historyLink.click();
    await expect(page).toHaveURL(/\/accuracy\/history$/);
  });
});

test.describe("複勝予想UI撤去の完全性（レース結果パネル）", () => {
  test("結果確定済みレースの「レース結果」パネルに複勝予想の検証が表示されない", async ({
    page,
  }) => {
    await page.goto("/races/2026-08-14");
    await page.locator(".venue-grid-card--open").first().click();
    const button = page.locator(".race-card .predict-btn").first();
    await expect(button).toBeVisible({ timeout: 10000 });
    await button.click();
    const resultPanel = page.locator(".race-result");
    await expect(resultPanel).toBeVisible({ timeout: 10000 });
    // BOA-238で払戻金セクション（単勝/複勝/3連複/3連単等）を追加したため、
    // 「複勝」という文字列自体は払戻金の券種ラベルとして正当に表示されるようになった。
    // ここで再発防止したいのは複勝予想の検証UI（「複勝◯位予想」「的中！」「不的中」）の方なので、
    // 判定もそちらに絞る
    await expect(resultPanel).not.toContainText("複勝予想");
    await expect(resultPanel).not.toContainText("的中！");
    await expect(resultPanel).not.toContainText("不的中");
  });
});
