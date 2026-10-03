import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 節ページ（/venue/:venueCode/meet/:startDate、BOA-682）の固定。
 *
 * 児島 2026-09-28〜10-03 の G1（予選終了後）。値は公式の得点率一覧（racer_series_points）と
 * 一致することを 2026-10-02 に確認した（docs/design/meet-page/spec.md FR-1.2・1.3・1.5）。
 * 日程・段階・基準のレースの判定は scripts/maintenance/verify-meet-page-model.js。
 */

test.describe.configure({ timeout: 180_000 });

const KOJIMA = "/venue/16/meet/2026-09-28";

// 録画の時計（e2e/recording.json の recordedAt）は日々撮り直されて動く。節の段階は「今日」で
// 決まるので、節が終わった後の日付に固定する。節ページが読むクエリ（節の窓・race_series）は
// 録画に無いので本番へ素通しになり、時計を動かしても中身は実データのまま
async function afterTheMeet(page) {
  await page.clock.setFixedTime(new Date("2026-10-05T12:00:00+09:00"));
}

test("予選終了後の節は、46人の順位・18位の下の準優の線・順位外6人・準優3レースを出す", async ({
  page,
}) => {
  await afterTheMeet(page);
  await page.goto(KOJIMA, { waitUntil: "domcontentloaded" });
  const rows = page.locator(".meet-ranking__table tbody tr.meet-ranking__row");
  await expect(rows.first()).toBeVisible({ timeout: 60000 });

  await expect(page.locator(".meet-page__header h1")).toHaveText("児島キングカップ開設74周年記念競走");
  await expect(page.locator(".meet-ranking__border")).toHaveText(
    "準優の枠 18位 5.50（確定）",
  );
  await expect(rows).toHaveCount(52);
  await expect(page.locator("tr.meet-ranking__row.is-excluded")).toHaveCount(6);
  await expect(rows.first()).toContainText("藤原");
  await expect(rows.first()).toContainText("8.67");

  // 準優の線は18位と19位の間に1本だけ
  const line = page.locator("tr.meet-ranking__line");
  await expect(line).toHaveCount(1);
  const before = line.locator("xpath=preceding-sibling::tr[1]");
  await expect(before.locator(".meet-ranking__c-rank")).toHaveText("18");

  // 優勝戦の番組が出た後も数がずれないよう、準優勝戦のカードだけを数える
  const races = page.locator(".meet-qualifiers__race", { hasText: "準優勝戦" });
  await expect(races).toHaveCount(3);
  await expect(races.locator(".meet-qualifiers__boat")).toHaveCount(18);
  await expect(races.first()).toHaveAttribute("href", "/race/2026-10-02-16-10");

  await expect(page).toHaveTitle(
    "児島競艇 児島キングカップ開設74周年記念競走 得点率ランキング・準優ボーダー | 龍神レーダー",
  );
  // 画面内には「競艇」を出さない（title・meta は code-style 例外1）
  await expect(page.locator("main, .meet-page")).not.toContainText("競艇");
});

test("節の途中の日を初日として開くと「見つからない」を出し、索引させない", async ({
  page,
}) => {
  await afterTheMeet(page);
  await page.goto("/venue/16/meet/2026-09-30", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".meet-page__message")).toContainText(
    "この節は見つかりませんでした",
    { timeout: 60000 },
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("初日の最初のレースの結果が出る前は、空の表ではなく案内を出す", async ({
  page,
}) => {
  // 結果が1つも無い初日の朝を、結果の応答を空にして再現する（セルフレビューの指摘）
  await page.clock.setFixedTime(new Date("2026-09-28T09:00:00+09:00"));
  await page.route(/\/rest\/v1\/race_results/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto(KOJIMA, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".meet-page__no-rate")).toHaveText(
    "得点率は初日のレース後から出ます",
    { timeout: 60000 },
  );
  await expect(page.locator(".meet-ranking__table")).toHaveCount(0);
});

test("日付の形でない URL は、パンくず・title に壊れた日付（0/0・NaN）を出さない", async ({
  page,
}) => {
  await page.goto("/venue/16/meet/abc", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".meet-page__message")).toContainText(
    "この節は見つかりませんでした",
    { timeout: 60000 },
  );
  // 修正前は "abc" から「0/0開幕の節」を作っていた
  await expect(page.locator(".breadcrumb")).not.toContainText(/開幕の節|NaN/);
  await expect(page).not.toHaveTitle(/開幕の節|NaN/);
});

test("初日の途中（まだ1走もしていない選手がいる間）は、準優の目安を伏せて理由を出す", async ({
  page,
}) => {
  // 初日の 1R・2R だけ結果がある状態を、結果の応答を絞って再現する（今節タブと同じ条件、BOA-690）
  await page.clock.setFixedTime(new Date("2026-09-28T11:30:00+09:00"));
  await page.route(/\/rest\/v1\/race_results/, async (route) => {
    const response = await fetchRecorded(route);
    const body = await response.json().catch(() => null);
    const kept = Array.isArray(body)
      ? body.filter((r) => r.race_id <= "2026-09-28-16-02")
      : body;
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: kept,
    });
  });
  await page.goto(KOJIMA, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".meet-ranking__table tbody tr").first()).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator(".meet-page__note").first()).toContainText(
    "準優の目安は全員が1走してから出します",
  );
  await expect(page.locator(".meet-ranking__border")).toHaveCount(0);
  await expect(page.locator("tr.meet-ranking__line")).toHaveCount(0);
});
