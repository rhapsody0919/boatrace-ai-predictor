import { test, expect, e2eTodayJST } from "./fixtures.js";
import { buildRacerTodayRuns, finishLabelOf, splitTodayRaceId, todayRunsMeetLabel } from "../src/pure/racerTodayRuns.js";
import { courseCell, meetFinishes, pickContextRun, venueCell } from "../src/pure/racerTodayContext.js";

/**
 * 選手ページの「今日の出走」（BOA-1691 R2）の固定。取得はスタブ（録画の当日の走は日で変わる）。
 * - 当日2走: /race/ への a が2つ、節は racer-summary より DOM の上、節の下端が viewport の内
 * - 発走済みは「n着」（締切の時刻を出さない）、発走前は「HH:MM締切」。前日の走は出ない
 * - 当日0走・取得の失敗: 節を DOM に置かない。失敗でもページの他の節が出て noindex にならない
 * 3941（A1・index）、2878（B1）。純関数の単体試験も CI が回すこの spec に置く。録画の時刻は試験の中で読む（`--list` は録画無し）
 */

const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const runIds = (d = e2eTodayJST()) => ({ DONE: `${d}-12-03`, NEXT: `${d}-12-09`, OLD: `${dayBefore(d)}-12-11` });
const TODAY_QUERY = /\/rest\/v1\/race_entries\?.*race_id=like\./;

// 当日の走の取得（race_id=like.<今日>）と、その race_id を含む問い合わせだけを差し替える（9R は結果の行が無い）
async function stubTodayRuns(page, entries, { fail = false } = {}) {
  const { DONE, NEXT } = runIds();
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

const robotsOf = (page) => page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "");

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    test("当日2走: 行が2つで /race へ、着順と締切、前日の走は出ない、要約より上で最初の画面の内", async ({ page }) => {
      const { DONE, NEXT, OLD } = runIds();
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
    await stubTodayRuns(page, [{ race_id: runIds().OLD, boat_number: 1 }]);
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
  // pure は src/config を読めないので、場名の表は呼び手（racerQueries6.js は VENUE_NAMES）が渡す
  const venueNames = { 12: "住之江" };

  test("race_id から場と R を取り出す", () => {
    expect(splitTodayRaceId("2026-11-22-12-03", venueNames)).toMatchObject({ date: "2026-11-22", venueName: "住之江", raceNo: 3 });
    expect(splitTodayRaceId("2026-11-22-05-01", venueNames)).toMatchObject({ venueName: "会場5", raceNo: 1 });
    expect(splitTodayRaceId("bad", venueNames)).toBeNull();
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
      venueNames,
    });
    expect(runs.map((r) => r.raceId)).toEqual([b, a]);
    expect(runs[0]).toMatchObject({ finish: "1着", deadline: null, boatNumber: 2 });
    expect(runs[1]).toMatchObject({ finish: null, deadline: "16:42" });
    expect(todayRunsMeetLabel(runs)).toBe("住之江 4日目");
    expect(todayRunsMeetLabel([{ venueName: "住之江", seriesDay: null }])).toBeNull();
  });
});

// 会場別成績の節と同じ履歴の読み（getRacerRaceHistory: race_entries → races・race_results・exhibition_data・
// race_conditions・race_start_timings）を差し替える。今日の走の読み（race_id=like.）は stubTodayRuns が答える。
// runs: [{ id: "YYYY-MM-DD-VV-RR", boat: 4, order: [着順の艇番6つ] }]
async function stubRaceHistory(page, runs) {
  const ids = new Set(runs.map((r) => r.id));
  const hit = (url) => [...ids].some((id) => url.includes(id));
  await page.route("**/rest/v1/race_entries?*", (route) => {
    const url = route.request().url();
    if (url.includes("select=race_id%2Cboat_number") && !url.includes("like.")) {
      return route.fulfill({ json: runs.map((r) => ({ race_id: r.id, boat_number: r.boat })) });
    }
    return route.fallback();
  });
  const tables = {
    races: (r) => ({ race_id: r.id, venue_code: Number(r.id.slice(11, 13)), race_grade: "一般" }),
    race_results: (r) => ({
      race_id: r.id, ...Object.fromEntries(r.order.map((b, i) => [`rank${i + 1}`, b])),
      winning_technique: "逃げ", payout_win: 200, payout_place_1: 110, payout_place_2: 150, race_status: null,
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((b) => [`actual_course_${b}`, b])),
    }),
    exhibition_data: (r) => ({ race_id: r.id, boat_number: r.boat, exhibition_time: 6.8 }),
    race_conditions: (r) => ({ race_id: r.id, race_stage: null, race_title: "一般", weather: "晴", wind_speed: 1, wave_height: 1 }),
    race_start_timings: (r) => ({ race_id: r.id, boat_number: r.boat, start_timing: 0.15, is_flying: false, finish_mark: null, entry_course: r.boat }),
  };
  for (const [table, row] of Object.entries(tables)) {
    await page.route(`**/rest/v1/${table}?*`, (route) =>
      hit(route.request().url()) ? route.fulfill({ json: runs.map(row) }) : route.fallback(),
    );
  }
}

// 今日の出走の直下の1段（#3258 の #3）: 今日の枠のコース成績（公式3期）・その場の当地・今節の着順。30走未満は件数で
test.describe("今日の出走の手がかりの1段", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("次の走（4号艇・住之江）の4コースの公式成績・住之江の当地・今節の着順を並べる", async ({ page }) => {
    const today = e2eTodayJST();
    const { DONE, NEXT } = runIds(today);
    await stubTodayRuns(page, [{ race_id: DONE, boat_number: 2 }, { race_id: NEXT, boat_number: 4 }]);
    // 公式の期別: 4コースは20走で1着2回（30走未満なので件数）
    const courseCols = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].flatMap((c) => [
        [`c${c}_entries`, c === 4 ? 20 : 40], [`c${c}_p1`, c === 4 ? 2 : 8], [`c${c}_p2`, 3], [`c${c}_p3`, 3],
        [`c${c}_avg_st`, 0.16], [`c${c}_f`, 0], [`c${c}_l0`, 0], [`c${c}_l1`, 0], [`c${c}_k0`, 0], [`c${c}_k1`, 0],
      ]),
    );
    await page.route("**/rest/v1/racer_period_stats?*", (route) =>
      route.fulfill({ json: [{ racer_id: 3941, period_year: 2026, period_no: 2, calc_from: "2025-11-01", calc_to: "2026-04-30",
        grade: "A1", win_rate: 6.5, top2_rate: 40, starts: 220, first_count: 40, second_count: 20, finals: 0, wins: 0, avg_st: 0.16, ...courseCols }] }),
    );
    // 住之江（12）の走: 前々日は2着・前日は1着（今節）、30日前は別の節（2着。当地の数には入る）。戸田（2）の走は当地に入れない
    const daysAgo = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    // 4号艇で出た走。order は着順の艇番
    await stubRaceHistory(page, [
      { id: `${daysAgo(30)}-12-05`, boat: 4, order: [1, 4, 2, 3, 5, 6] },
      { id: `${daysAgo(10)}-02-03`, boat: 4, order: [4, 1, 2, 3, 5, 6] },
      { id: `${daysAgo(2)}-12-04`, boat: 4, order: [3, 4, 1, 2, 5, 6] },
      { id: `${daysAgo(1)}-12-06`, boat: 4, order: [4, 1, 2, 3, 5, 6] },
    ]);
    await page.goto("/racer/3941");
    const ctx = page.getByTestId("racer-today-context");
    await expect(page.getByTestId("racer-today-course")).toHaveText("4コース（公式1期）20走中1着2回");
    await expect(page.getByTestId("racer-today-venue")).toHaveText("住之江の当地（直近2年）3走中1着1回2着以内3回");
    await expect(page.getByTestId("racer-today-meet")).toHaveText("今節の着順2 1");
    // 1段は今日の出走の節の中にあり、最初の画面の内
    await expect(page.getByTestId("racer-today-runs").getByTestId("racer-today-context")).toHaveCount(1);
    const box = await ctx.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(812);
  });

  test("純関数: 30走以上は率、30走未満は件数、節は2日を超える間で切る", () => {
    expect(courseCell({ course: 1, entries: 25, wins: 1, reliability: "reference", winRate: 4, top2Rate: 8 }))
      .toEqual({ title: "1コース（公式3期）", main: "25走中1着1回", sub: null });
    expect(courseCell({ course: 1, entries: 40, wins: 12, reliability: "firm", winRate: 30, top2Rate: 52.55 }))
      .toEqual({ title: "1コース（公式3期）", main: "1着 30.0%", sub: "2連対率 52.5%・40走" });
    expect(courseCell({ course: 6, entries: 5, wins: 0, reliability: "none", winRate: null, top2Rate: null })).toBeNull();
    expect(venueCell({ n: 0, win: 0, top2: 0 }, "戸田")).toEqual({ title: "戸田の当地（直近2年）", main: "出走なし", sub: null });
    // 浮動小数で 57.49999… にならず、整数で切り捨てる
    expect(venueCell({ n: 40, win: 23, top2: 30 }, "戸田").main).toBe("1着 57.5%");
    expect(venueCell({ n: 40, win: 4, top2: 10 }, "戸田").main).toBe("1着 10.0%");
    const runs = [
      { date: "2026-11-22", finishRank: 6, finishMark: null },
      { date: "2026-11-20", finishRank: null, finishMark: "F" },
      { date: "2026-11-01", finishRank: 1, finishMark: null },
    ];
    expect(meetFinishes(runs, "2026-11-23")).toEqual(["F", "6"]);
    expect(meetFinishes([], "2026-11-23")).toBeNull();
    expect(pickContextRun([{ finish: "2着" }, { finish: null, raceNo: 9 }])).toEqual({ finish: null, raceNo: 9 });
  });
});
