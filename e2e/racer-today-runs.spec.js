import { test, expect, e2eTodayJST } from "./fixtures.js";
import { buildRacerTodayRuns, finishLabelOf, splitTodayRaceId, todayRunsMeetLabel } from "../src/pure/racerTodayRuns.js";

/**
 * 選手ページの「今日の出走」（BOA-1691 R2）の固定。取得はスタブ（録画の当日の走は日で変わる）。
 * - 当日2走: /race/ への a が2つ、節は racer-summary より DOM の上、節の下端が viewport の内
 * - 発走済みは「n着」（締切の時刻を出さない）、発走前は「HH:MM締切」。前日の走は出ない
 * - 当日0走・取得の失敗: 節を DOM に置かない。失敗でもページの他の節が出て noindex にならない
 * 3941（A1・index）、2878（B1）。純関数の単体試験も CI が回すこの spec に置く
 */

const TODAY = e2eTodayJST();
const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const [DONE, NEXT, OLD] = [`${TODAY}-12-03`, `${TODAY}-12-09`, `${YESTERDAY}-12-11`];
const TODAY_QUERY = /\/rest\/v1\/race_entries\?.*race_id=like\./;

// 当日の走の取得（race_id=like.<今日>）と、その race_id を含む問い合わせだけを差し替える（9R は結果の行が無い）
async function stubTodayRuns(page, entries, { fail = false } = {}) {
  await page.route(TODAY_QUERY, (route) =>
    fail ? route.fulfill({ status: 500, json: { message: "stub" } }) : route.fulfill({ json: entries }),
  );
  const rows = {
    races: [{ race_id: DONE, start_time: "11:05:00" }, { race_id: NEXT, start_time: "16:42:00" }],
    race_results: [{ race_id: DONE, rank1: 1, rank2: 2, rank3: 3, rank4: 4, race_status: "normal", refund_boats: [] }],
    race_conditions: [{ race_id: DONE, series_day: 3 }, { race_id: NEXT, series_day: 3 }],
  };
  for (const [table, json] of Object.entries(rows)) {
    await page.route(`**/rest/v1/${table}?*`, (route) =>
      route.request().url().includes(DONE) ? route.fulfill({ json }) : route.fallback(),
    );
  }
}

const robotsOf = (page) =>
  page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "");

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("当日2走: 行が2つで /race へ、着順と締切、前日の走は出ない、要約より上で最初の画面の内", async ({ page }) => {
      // 並びの確かめのため、後の走・前日の走を先に返す
      await stubTodayRuns(page, [
        { race_id: NEXT, boat_number: 4 }, { race_id: OLD, boat_number: 1 }, { race_id: DONE, boat_number: 2 },
      ]);
      await page.goto("/racer/3941");
      const section = page.getByTestId("racer-today-runs");
      await expect(section.locator('a[href^="/race/"]')).toHaveCount(2);
      await expect(section.locator("h2")).toHaveText("今日の出走（2走）");
      await expect(section).toContainText("住之江 3日目");
      const rows = section.getByTestId("racer-today-run");
      await expect(rows.nth(0)).toHaveAttribute("href", `/race/${DONE}`);
      await expect(rows.nth(1)).toHaveAttribute("href", `/race/${NEXT}`);
      // 艇番・場と R・札だけ（発走済みの行に締切の時刻が無い）
      await expect(rows).toHaveText(["2住之江 3R2着", "4住之江 9R16:42締切"]);

      await expect(page.getByTestId("racer-summary")).toBeVisible();
      const layout = await page.evaluate(() => {
        const a = document.querySelector('[data-testid="racer-today-runs"]');
        const b = document.querySelector('[data-testid="racer-summary"]');
        const { scrollWidth, clientWidth } = document.documentElement;
        const above = Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { above, bottom: a.getBoundingClientRect().bottom, overflow: scrollWidth - clientWidth };
      });
      expect(layout).toMatchObject({ above: true, overflow: 0 });
      expect(layout.bottom).toBeLessThanOrEqual(viewport.height);
    });
  });
}

test.describe("節を置かない", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // 取得が終わってから無いことを見る（取得中も節は無いので、待たないと何も確かめない）
  async function openAfterTodayQuery(page, racerId) {
    const answered = page.waitForResponse(TODAY_QUERY);
    await page.goto(`/racer/${racerId}`);
    await answered;
    await expect(page.getByTestId("racer-summary")).toBeVisible();
  }

  test("当日0走（前日の走だけ）の選手では節が DOM に無い", async ({ page }) => {
    await stubTodayRuns(page, [{ race_id: OLD, boat_number: 1 }]);
    await openAfterTodayQuery(page, 2878);
    await expect(page.getByTestId("racer-today-runs")).toHaveCount(0);
  });

  test("取得の失敗: 節を出さず、ページの他の節は出て noindex にならない", async ({ page }) => {
    await stubTodayRuns(page, [], { fail: true });
    await openAfterTodayQuery(page, 3941);
    await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
    await expect(page.getByTestId("racer-today-runs")).toHaveCount(0);
    await expect.poll(() => robotsOf(page)).not.toContain("noindex");
  });
});

test.describe("純関数 racerTodayRuns", () => {
  test("race_id から場と R を取り出す", () => {
    expect(splitTodayRaceId("2026-11-22-12-03")).toMatchObject({ date: "2026-11-22", venueName: "住之江", raceNo: 3 });
    expect(splitTodayRaceId("bad")).toBeNull();
  });

  test("着順: rank に艇番があれば n着、不成立・返還・どの rank にも無い時", () => {
    const r = { rank1: 3, rank2: 1, rank3: 2, rank4: 6, rank5: 5, rank6: null, race_status: "normal", refund_boats: [] };
    expect([1, 6, 4].map((boat) => finishLabelOf(r, boat))).toEqual(["2着", "4着", "結果"]);
    expect(finishLabelOf({ ...r, race_status: "partial_refund", refund_boats: [4] }, 4)).toBe("返還");
    expect(finishLabelOf({ ...r, race_status: "no_race" }, 1)).toBe("不成立");
    expect(finishLabelOf(undefined, 1)).toBeNull();
  });

  test("今日の走だけを race_id の昇順、締切は HH:MM、日目の札", () => {
    const [a, b, old] = ["2026-11-22-12-09", "2026-11-22-12-03", "2026-11-21-12-11"];
    const runs = buildRacerTodayRuns({
      today: "2026-11-22",
      entries: [{ race_id: a, boat_number: 4 }, { race_id: old, boat_number: 1 }, { race_id: b, boat_number: 2 }],
      races: [{ race_id: a, start_time: "16:42:00" }],
      results: [{ race_id: b, rank1: 2 }],
      conditions: [{ race_id: a, series_day: 4 }],
    });
    expect(runs.map((r) => r.raceId)).toEqual([b, a]);
    expect(runs[0]).toMatchObject({ finish: "1着", deadline: null, boatNumber: 2 });
    expect(runs[1]).toMatchObject({ finish: null, deadline: "16:42" });
    expect(todayRunsMeetLabel(runs)).toBe("住之江 4日目");
    expect(todayRunsMeetLabel([{ venueName: "住之江", seriesDay: null }])).toBeNull();
  });
});
