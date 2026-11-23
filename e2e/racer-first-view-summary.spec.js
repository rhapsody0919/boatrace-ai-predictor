import { test, expect, e2eTodayJST } from "./fixtures.js";
import { stubRacerScopedRuns, runDates } from "./racer-scoped-stub.js";

/**
 * 選手ページの最初の画面の要約（BOA-1688 R1）の固定。
 *
 * - 375×812 の最初の画面（viewport の内）に級・勝率・2連率の数字が出て、勝率の隣に期の名前がある
 * - 画面の勝率・2連率は公式の期別成績（racer_period_stats）の最新の期の値と一致する
 * - 優出・優勝は全期の和で、和の最初の期を明記する
 * - 前付けの1行は前付けの走が0の選手では DOM に無い
 * - description に期の名前と勝率が入り、選手ごとに文が違う。title は選手ごとに一意
 *
 * 期別の行はスタブにする（録画の値は期が替わると動く）。4320（A1）と 2878（B1）
 */

const period = (racerId, year, no, extra) => ({
  period_year: year,
  period_no: no,
  calc_from: no === 2 ? `${year - 1}-11-01` : `${year - 1}-05-01`,
  calc_to: no === 2 ? `${year}-04-30` : `${year - 1}-10-31`,
  grade: "A1",
  win_rate: 6.5,
  top2_rate: 40.1,
  starts: 120,
  first_count: 30,
  second_count: 18,
  finals: 1,
  wins: 0,
  avg_st: 0.15,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].flatMap((c) => [
      [`c${c}_entries`, 20],
      [`c${c}_p1`, 5],
      [`c${c}_p2`, 3],
      [`c${c}_p3`, 2],
      [`c${c}_avg_st`, 0.15],
      [`c${c}_f`, 0],
      [`c${c}_l0`, 0],
      [`c${c}_l1`, 0],
      [`c${c}_k0`, 0],
      [`c${c}_k1`, 0],
    ]),
  ),
  racer_id: racerId,
  ...extra,
});

const STUBS = {
  4320: [
    period(4320, 2026, 2, { win_rate: 7.38, top2_rate: 56.4, starts: 146, finals: 4, wins: 2, c4_f: 1 }),
    period(4320, 2026, 1, { finals: 3, wins: 1 }),
    period(4320, 2019, 2, { finals: 2, wins: 0 }),
  ],
  2878: [
    period(2878, 2026, 2, { grade: "B1", win_rate: 4.21, top2_rate: 18.7, starts: 98, finals: 0, wins: 0 }),
    period(2878, 2025, 2, { grade: "B1", finals: 1, wins: 0 }),
  ],
};

async function stubPeriods(page, racerId) {
  await page.route("**/rest/v1/racer_period_stats?*", (route) =>
    route.fulfill({ json: STUBS[racerId] }),
  );
}

// 前付けの走を作る（2〜6号艇で枠番より内のコースに入った走）。runs 走のうち taken 走が前付け
async function stubFrontTaking(page, { runs, taken }) {
  const dates = runDates(runs);
  await page.route("**/rest/v1/rpc/get_racer_scoped_race_rows*", (route) =>
    route.fulfill({
      json: dates.map((date, i) => ({
        race_id: `${date}-02-01`,
        boat_number: 3,
        grade: "A1",
        f_count: 0,
        race_date: date,
        venue_code: 2,
        race_grade: "一般",
        ranks: [1, 2, 3, 4, 5, 6],
        race_status: null,
        winning_technique: "逃げ",
        payout_win: 200,
        // 3号艇が1コースに入れば前付け、3コースなら枠なり
        actual_courses: i < taken ? [2, 3, 1, 4, 5, 6] : [1, 2, 3, 4, 5, 6],
      })),
    }),
  );
}

const descriptionOf = (page) =>
  page.evaluate(
    () => document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
  );

async function inViewport(page, locator) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  return Boolean(box) && box.y >= 0 && box.y + box.height <= vp.height;
}

test.use({ viewport: { width: 375, height: 812 } });

test("A1（4320）: 最初の画面に級・勝率・2連率と期の名前、値は公式の期別と一致、前付けの1行", async ({
  page,
}) => {
  await stubPeriods(page, 4320);
  await stubFrontTaking(page, { runs: 20, taken: 3 });
  await page.goto("/racer/4320");
  const block = page.getByTestId("racer-summary");
  await expect(page.getByTestId("racer-summary-win-rate")).toHaveText("7.38");
  await expect(page.getByTestId("racer-summary-top2-rate")).toHaveText("56.4%");
  await expect(page.getByTestId("racer-summary-grade")).toHaveText(/^[AB][12]$/);
  // 勝率の隣に期の名前（データから組んだ文字列）
  await expect(
    block.locator(".racer-summary__stat", { has: page.getByTestId("racer-summary-win-rate") }),
  ).toContainText("2026年後期");
  // F 数は最新の期のコース別 F の和
  await expect(page.getByTestId("racer-summary-f")).toHaveText("1");
  // 優出・優勝は全期の和で、最初の期を明記する
  await expect(page.getByTestId("racer-summary-finals")).toHaveText(
    "優出 9・優勝 3（2019年後期からの和）",
  );
  await expect(page.getByTestId("racer-summary-front")).toHaveText(
    "前付け 15%（20走中3走）",
  );
  // 数字の要素3つ（級・勝率・2連率）が viewport の内
  for (const id of ["racer-summary-grade", "racer-summary-win-rate", "racer-summary-top2-rate"]) {
    expect(await inViewport(page, page.getByTestId(id)), id).toBe(true);
  }
  // 枠番別の回収率は最初の画面に出さない
  await expect(block).not.toContainText("回収率");
  await expect(block).not.toContainText("競艇");
  // プロフィールは登録番号・支部・登録期だけ見せ、残りは畳む
  await expect(page.locator(".racer-profile-more")).not.toHaveAttribute("open", "");
  await expect(
    page.locator(".racer-profile-card > .racer-profile-facts-grid .racer-profile-fact strong"),
  ).toHaveText(["登録番号", "支部", "登録期"]);

  await expect.poll(() => descriptionOf(page)).toContain(
    "2026年後期の勝率 7.38・2連率 56.4%・優出 4・優勝 2。",
  );
  await expect(page).toHaveTitle(/勝率7\.38・決まり手/);
  const ld = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => JSON.parse(n.textContent)).find((d) => d["@type"] === "ProfilePage"),
    );
  expect(ld.dateModified).toBe("2026-04-30");
});

test("B1（2878）: 前付けの走が0なら1行を DOM に置かない。description と title は A1 の選手と違う", async ({
  page,
}) => {
  await stubPeriods(page, 2878);
  // 走は全部1号艇（前付けの母数に入らない）
  await stubRacerScopedRuns(page, [{ date: "2026-01-05", venue: 2, rr: 1, course: 1, rank1: 1, technique: "逃げ" }]);
  await page.goto("/racer/2878");
  await expect(page.getByTestId("racer-summary-win-rate")).toHaveText("4.21");
  await expect(page.getByTestId("racer-summary-top2-rate")).toHaveText("18.7%");
  await expect(page.getByTestId("racer-summary-finals")).toHaveText(
    "優出 1・優勝 0（2025年後期からの和）",
  );
  // 前付けの取得が終わってから（「前付けの傾向」の節の文が出てから）無いことを見る
  await expect(page.getByTestId("racer-front-taking")).toContainText("0走");
  await expect(page.getByTestId("racer-summary-front")).toHaveCount(0);
  for (const id of ["racer-summary-grade", "racer-summary-win-rate", "racer-summary-top2-rate"]) {
    expect(await inViewport(page, page.getByTestId(id)), id).toBe(true);
  }
  await expect.poll(() => descriptionOf(page)).toContain("2026年後期の勝率 4.21・2連率 18.7%・優出 0・優勝 0。");
  await expect(page).toHaveTitle(/勝率4\.21・決まり手/);
});

// 冒頭の1行目は最新の出走表の値（#3258 の #2）。出走表の勝率は「今期の累積」でなく直近6か月なので「今期」と書かず、
// 出走表の日付を付ける。F は期の中の本数なので、出走が今日と同じ期の中のときだけ出す
async function stubLatestEntry(page, row) {
  await page.route("**/rest/v1/race_entries?*", (route) => {
    const url = route.request().url();
    if (url.includes("global_2rate") && url.includes("f_count") && url.includes("limit=1")) {
      return route.fulfill({ json: row });
    }
    return route.fallback();
  });
}

test("冒頭の1行目は最新の出走表の値に日付を付け、前の期の公式成績を2行目に並べる", async ({ page }) => {
  const today = e2eTodayJST();
  await stubPeriods(page, 4320);
  await stubLatestEntry(page, { race_id: `${today}-02-01`, win_rate: 8.12, global_2rate: 61.5, f_count: 1 });
  await page.goto("/racer/4320");
  const latest = page.getByTestId("racer-summary-latest");
  await expect(latest).toHaveText(`${today.replaceAll("-", "/")} の出走表 勝率 8.12・2連率 61.5%・F1`);
  await expect(latest).not.toContainText("今期");
  // 2行目は前の期の公式成績のまま（値・期の名前は上の試験と同じ）
  await expect(page.getByTestId("racer-summary-win-rate")).toHaveText("7.38");
  await expect(page.getByTestId("racer-summary")).toContainText("前の期の公式成績（2026年後期・146走）");
  for (const id of ["racer-summary-latest", "racer-summary-win-rate"]) {
    expect(await inViewport(page, page.getByTestId(id)), id).toBe(true);
  }
});

test("期をまたいだ出走表の F は出さない（0とも書かない）", async ({ page }) => {
  await stubPeriods(page, 2878);
  // 2026-10-01 は 5/1〜10/31 の期。録画の今日（11月以降）とは別の期
  await stubLatestEntry(page, { race_id: "2026-10-01-02-01", win_rate: 4.5, global_2rate: 20.25, f_count: 2 });
  await page.goto("/racer/2878");
  const latest = page.getByTestId("racer-summary-latest");
  await expect(latest).toHaveText("2026/10/01 の出走表 勝率 4.50・2連率 20.3%");
  await expect(latest).not.toContainText("F");
});

test("出走表の1行が出ないとき（勝率 0.00 の新人など）、注記は「上の出走表」を指さない", async ({ page }) => {
  await stubPeriods(page, 2878);
  await stubLatestEntry(page, { race_id: `${e2eTodayJST()}-02-01`, win_rate: 0, global_2rate: 0, f_count: 0 });
  await page.goto("/racer/2878");
  await expect(page.getByTestId("racer-summary")).toContainText("前の期の公式成績（2026年後期・98走）");
  await expect(page.getByTestId("racer-summary-latest")).toHaveCount(0);
  await expect(page.getByTestId("racer-summary")).not.toContainText("上の出走表");
});
