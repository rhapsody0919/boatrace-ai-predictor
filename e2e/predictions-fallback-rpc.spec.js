import { test, expect } from "./fixtures.js";

/**
 * Edge API（/api/predictions）が失敗したときのフォールバックが、Edge API と同じ RPC・同じ整形で
 * レースを出す（BOA-355）。
 *
 * 以前のフォールバックは、RPCとは別実装のネストクエリ（/rest/v1/races）で、項目が片方にだけ
 * 入る乖離が繰り返された（BOA-304 の気象・BOA-254 の中止状態・BOA-114 の買い目オッズ）。
 * ここでは Edge API を 500 にし、RPC（/rest/v1/rpc/get_predictions_by_date*）だけがデータを返す状態で、
 * 出走表と、RPC由来の項目（cancellationStatus）が画面に出ることを確かめる。
 * テーブルの直接クエリ（他の /rest/v1/**）は空を返すため、旧フォールバックではレースが出ない。
 */

const DATE = "2026-09-22";
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `フォールバック選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));
const race = (n, cancellationStatus) => ({
  raceId: `${DATE}-09-${String(n).padStart(2, "0")}`,
  venueCode: 9,
  venue: "津",
  raceNumber: n,
  startTime: "23:50",
  cancellationStatus,
  entries,
  predictions: { unified: { topPick: 1, top3: [1, 2, 3], confidence: 50 } },
  exhibitionData: [],
  result: null,
});
const rpcData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [race(1, "confirmed"), race(2, null)],
};

test.describe("Edge API 失敗時のフォールバック（BOA-355）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("boatai-language", "ja"),
    );
    await page.route("**/api/predictions/**", (route) =>
      route.fulfill({ status: 500, json: { success: false } }),
    );
    // 後から登録した route が先に評価される: RPC だけデータを返し、他のテーブルは空
    await page.route("**/rest/v1/**", (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
    await page.route("**/rest/v1/rpc/get_predictions_by_date*", (route) =>
      route.fulfill({ status: 200, json: rpcData }),
    );
  });

  test("Edge API が 500 でも、RPC の出力から出走表を出す", async ({ page }) => {
    await page.goto(`/race/${DATE}-09-02`);
    await expect(page.getByText("フォールバック選手1").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("RPC 由来の項目（中止状態）も、Edge API の経路と同じく反映される", async ({
    page,
  }) => {
    await page.goto(`/race/${DATE}-09-01`);
    await expect(
      page.getByText("このレースは中止となりました").first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
