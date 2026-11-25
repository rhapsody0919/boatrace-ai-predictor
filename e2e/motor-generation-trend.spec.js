import { test, expect } from "./fixtures.js";

// モータ情報タブの「今の値｜推移」（オーナー 2026-11-25 承認のモック改訂2、号機を足した形）。
// 世代と走は偽の応答で決める（入れ替え 8/06、毎日12レース、6基とも毎レース走る）。点そのものは
// verify-motor-generation-trend（純関数）・取得は verify-motor-generation-runs・図は verify-motor-trend-chart が見る
const raceId = "2026-09-29-16-12";
const day = (n) => new Date(Date.UTC(2026, 7, 6) + n * 86400000).toISOString().slice(0, 10);

async function mockGeneration(page, { start = "2026-08-06", fail = false } = {}) {
  await page.route("**/rest/v1/venue_motor_start_dates*", (route) => route.fulfill({ json: [{ start_date: start }] }));
  await page.route("**/rest/v1/races*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    if (q.get("select") !== "race_id,race_date") return route.fallback();
    const races = [];
    for (let n = 0; day(n) <= raceId.slice(0, 10); n += 1)
      for (let no = 1; no <= 12; no += 1) races.push({ race_id: `${day(n)}-16-${String(no).padStart(2, "0")}`, race_date: day(n) });
    return route.fulfill({ json: races.filter((r) => r.race_date >= start && r.race_id < raceId) });
  });
  // 6基の走の取得（motor_number=in.）だけを偽にする。公式の率は節（7日）ごとに変わる
  await page.route((url) => url.pathname.endsWith("/race_entries") && url.search.includes("motor_number=in."), (route) => {
    if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"e2e","code":"XX000"}' });
    const q = new URL(route.request().url()).searchParams;
    const ids = q.get("race_id").slice(4, -1).split(",");
    const motors = q.get("motor_number").slice(4, -1).split(",").map(Number);
    return route.fulfill({
      json: ids.flatMap((id) => {
        const week = Math.floor((Date.parse(id.slice(0, 10)) - Date.parse(start)) / (7 * 86400000));
        return motors.map((m, i) => ({ race_id: id, boat_number: i + 1, motor_number: m, motor_2rate: week === 0 ? 0 : 25 + i * 3 + (week % 3), motor_3rate: week === 0 ? 0 : 45 + i * 3 }));
      }),
    });
  });
}

async function openTrend(page) {
  await page.goto(`/race/${raceId}?tab=motor`);
  const head = page.locator(".motor-condition-container .trc-head");
  await expect(head.locator(".trc-title")).toHaveText("6基の今の値", { timeout: 30000 });
  await expect(head.locator(".trc-tab", { hasText: "今の値" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
  await head.locator(".trc-tab", { hasText: "推移" }).click();
  return head;
}

test("推移に切り替えると6基の線と号機が出て、一覧は隠れる。3連率にも切り替わる", async ({ page }) => {
  await mockGeneration(page);
  const head = await openTrend(page);
  await expect(head.locator(".trc-title")).toHaveText("2連率の推移（公式・節ごと）");
  await expect(page.locator(".motor-ranking-table")).toHaveCount(0);
  await expect(page.locator(".mtc-chart .trc-stroke")).toHaveCount(6);
  await expect(page.locator(".mtc-chart")).toContainText("8/06 入れ替え");
  await expect(page.locator(".mtc-motor-no")).toHaveCount(6);
  await expect(page.locator(".mtc-motor-no").first()).toContainText("号機");
  await expect(page.locator(".mtc-selected")).toContainText("使用開始 2026/8/6");

  await page.locator(".mtc-boat").nth(2).click();
  await expect(page.locator(".mtc-selected")).toContainText("3号艇");

  await page.locator(".mtc-chip", { hasText: "3連率" }).click();
  await expect(head.locator(".trc-title")).toHaveText("3連率の推移（公式・節ごと）");
  // 展示タイムは検証した値と画面の値が違うので、評価し直すまで出さない
  await expect(page.locator(".mtc-chip", { hasText: "展示タイム" })).toHaveCount(0);

  await head.locator(".trc-tab", { hasText: "今の値" }).click();
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
});

test("入れ替えから日が浅く20走に届かなければ、線を描かず号機と走数を出す", async ({ page }) => {
  await mockGeneration(page, { start: "2026-09-28" });
  await openTrend(page);
  await expect(page.locator(".mtc-empty")).toContainText("9/28に入れ替えたばかり");
  await expect(page.locator(".mtc-chart")).toHaveCount(0);
  await expect(page.locator(".mtc-motor-no").nth(1)).toHaveText(/^\d+走$/);
  await page.locator(".mtc-to-now").click();
  await expect(page.locator(".motor-ranking-table")).toBeVisible();
});

test("走の取得に失敗したら、推移は空でなく失敗と出す", async ({ page }) => {
  await mockGeneration(page, { fail: true });
  await openTrend(page);
  await expect(page.locator(".mtc-wrap [role='alert']")).toBeVisible();
  await expect(page.locator(".mtc-empty")).toHaveCount(0);
});
