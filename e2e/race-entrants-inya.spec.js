import { test, expect } from "./fixtures.js";

// 出走6艇の欄の「イン屋」の札（BOA-1422）。札の判定は、DB 側で数えた前付けの件数
// （マイグレーション 203 の RPC get_racer_front_taking_counts、6選手で1回）から画面が出す。
// 頁を開いただけでは、選手の全走（走の RPC・6表の読み）を読まない（Supabase の Egress の主因だった、2026-11-19）
// 戸田5R（一般、確定済み。race-entrants-strip.spec.js と同じレース）
const RACE = "/race/2026-09-22-02-05";
const COUNTS = "**/rest/v1/rpc/get_racer_front_taking_counts*";

// 選手の全走の読み（走の RPC と、race_entries の f_count 付きの読み）を数える
function countScopedReads(page) {
  const seen = [];
  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());
    if (
      url.includes("/rest/v1/rpc/get_racer_scoped_race_rows") ||
      (url.includes("/rest/v1/race_entries?") &&
        url.includes("f_count") &&
        url.includes("racer_id=eq."))
    )
      seen.push(url);
  });
  return seen;
}

test("件数が下限（20走・30%）以上の選手だけに札が付き、頁を開いただけでは選手の全走を読まない", async ({
  page,
}) => {
  const calls = [];
  await page.route(COUNTS, (route) => {
    const args = route.request().postDataJSON();
    calls.push(args);
    const ids = args.p_racer_ids;
    return route.fulfill({
      json: [
        { racer_id: ids[1], runs: 19, taken: 19 }, // 走数が下限に足りない
        { racer_id: ids[2], runs: 20, taken: 6 }, // ちょうど下限（30%）
        { racer_id: ids[3], runs: 100, taken: 29 }, // 割合が下限に足りない
        { racer_id: ids[5], runs: 40, taken: 40 },
        // ids[0]・ids[4] は行なし（数える走が無い）
      ],
    });
  });
  const scopedReads = countScopedReads(page);
  await page.goto(RACE);
  const entrants = page.getByTestId("race-entrants");
  await expect(entrants.locator(".race-entrants__item")).toHaveCount(6, {
    timeout: 25000,
  });
  await expect(page.getByTestId("race-entrants-inya-3")).toBeVisible();
  await expect(page.getByTestId("race-entrants-inya-6")).toBeVisible();
  await expect(entrants.locator(".race-entrants__inya")).toHaveCount(2);

  // 6選手で1回。表示中のレースより前の走だけを数える
  expect(calls).toHaveLength(1);
  expect(calls[0].p_racer_ids).toHaveLength(6);
  expect(calls[0].p_before_race_id).toBe("2026-09-22-02-05");
  expect(calls[0].p_since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(scopedReads).toEqual([]);
});

test("件数の取得に失敗したら札なし（欄は崩さない）", async ({ page }) => {
  await page.route(COUNTS, (route) =>
    route.fulfill({ status: 500, json: { message: "stub failure" } }),
  );
  const scopedReads = countScopedReads(page);
  await page.goto(RACE);
  const entrants = page.getByTestId("race-entrants");
  await expect(entrants.locator(".race-entrants__item")).toHaveCount(6, {
    timeout: 25000,
  });
  await expect(entrants.locator(".race-entrants__name")).toHaveCount(6);
  await expect(entrants.locator(".race-entrants__inya")).toHaveCount(0);
  expect(scopedReads).toEqual([]);
});
