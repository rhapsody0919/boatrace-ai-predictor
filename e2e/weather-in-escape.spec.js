import { test, expect } from "./fixtures.js";

/**
 * 分析ツール「風とイン逃げ率」タブ（BOA-211）。
 * 集計はリポジトリの静的な JSON（public/data/weather-in-escape.json）なので、値は固定。
 * 数値は data/analysis/weather-in-escape.json と docs/design/weather-in-escape/results.md と同じ。
 */

test("全会場のまとめ・会場別・ランキングを出す（BOA-211）", async ({
  page,
}) => {
  await page.goto("/winning-technique?tab=weather&venue_code=1", {
    waitUntil: "domcontentloaded",
  });
  const tab = page.getByTestId("weather-in-escape");
  await tab.waitFor({ timeout: 30000 });

  // 一言は判定した値（追い風・強 −3.9pt、24会場中23）から作る
  await expect(tab.locator(".wie-headline")).toContainText("24会場中23");
  await expect(tab.locator(".wie-headline")).toContainText("−3.9pt");

  // 決まり手: 向かい風・強はまくり、追い風・強は差しが増える
  await expect(page.getByTestId("wie-technique-head_strong")).toContainText(
    "まくり 17.3%",
  );
  await expect(page.getByTestId("wie-technique-tail_strong")).toContainText(
    "差し 17.0%",
  );

  // venue_code で会場を選んだ状態で開く。桐生の向かい風・強は130件で値を出さない、
  // 向かい風（635件）は参考値
  await expect(tab.locator("#wie-venue")).toHaveValue("1");
  const venueRows = page.getByTestId("wie-venue-rows").locator(".wie-row");
  await expect(venueRows.nth(0)).toContainText("件数が少ないため表示しません");
  await expect(venueRows.nth(0)).toContainText("130件");
  await expect(venueRows.nth(1)).toContainText("参考値");
  await expect(venueRows.nth(1)).toContainText("−12.4pt");

  // ランキング: 既定は追い風・強。向かい風・強に切り替えると先頭が変わる
  const ranking = page.getByTestId("wie-ranking").locator("tbody tr");
  await expect(ranking.first()).toContainText("下関");
  await tab.getByRole("button", { name: "向かい風・強" }).click();
  await expect(ranking.first()).toContainText("蒲郡");
  // 1,000件未満の会場は表に出さない（桐生の向かい風・強は130件）
  await expect(ranking.filter({ hasText: "桐生" })).toHaveCount(0);
});

test("英語では訳語で出す（BOA-211）", async ({ page }) => {
  await page.goto("/en/winning-technique?tab=weather", {
    waitUntil: "domcontentloaded",
  });
  const tab = page.getByTestId("weather-in-escape");
  await tab.waitFor({ timeout: 30000 });
  await expect(tab.locator(".wie-headline")).toContainText("23 of 24");
  await expect(tab).not.toContainText("追い風");
  await expect(tab).not.toContainText("weatherInEscape.");
});

test("集計の取得に失敗したら、空ではなくエラーを出し、再読み込みで取り直す（BOA-211）", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/data/weather-in-escape.json", (route) =>
    failing ? route.fulfill({ status: 500, body: "error" }) : route.fallback(),
  );
  await page.goto("/winning-technique?tab=weather", {
    waitUntil: "domcontentloaded",
  });
  const error = page.locator(".inline-fetch-error");
  await expect(error).toBeVisible({ timeout: 30000 });
  failing = false;
  await error.getByRole("button").click();
  await expect(page.getByTestId("weather-in-escape")).toBeVisible({
    timeout: 30000,
  });
});

test("集計に無い venue_code でも、最初の会場で表示する（BOA-211）", async ({
  page,
}) => {
  await page.goto("/winning-technique?tab=weather&venue_code=99", {
    waitUntil: "domcontentloaded",
  });
  const tab = page.getByTestId("weather-in-escape");
  await tab.waitFor({ timeout: 30000 });
  await expect(tab.locator("#wie-venue")).toHaveValue("1");
  await expect(
    page.getByTestId("wie-venue-rows").locator(".wie-row"),
  ).toHaveCount(5);
});
