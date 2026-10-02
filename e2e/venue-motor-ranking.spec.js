import { test, expect } from "./fixtures.js";

/**
 * 分析ツール「モーターランキング」タブ（BOA-428 子3）。
 *
 * 児島（16）を使う。会場公式サイトのモーター成績があり、前検データも毎節そろう会場。
 * 値は日によって変わるので、具体的な数字ではなく「並び・順位の付け方・件数の一致」を確かめる。
 */
const KOJIMA = "/winning-technique?tab=motorranking&venue_code=16";
const TODA = "/winning-technique?tab=motorranking&venue_code=2";

/** 表の行を読む（順位・機番・2連率・優出・優勝・前検・使用者・最良の印） */
const readRows = (page) =>
  page.locator(".vmr-table").evaluate((t) =>
    [...t.querySelectorAll("tbody tr")].map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) =>
        td.textContent.trim(),
      );
      const num = (s) => (s === "-" ? null : Number(s));
      return {
        rank: num(cells[0]),
        no: Number(cells[1]),
        noLinked: tr.querySelector("td.vmr-no a") !== null,
        rate: num(cells[2]),
        final: cells[3],
        win: num(cells[4]),
        pretest: num(cells[5]),
        user: cells[6],
        best:
          tr.querySelector(".rate-bar-label")?.classList.contains("is-best") ??
          false,
      };
    }),
  );

/** 競技順位（1, 2, 2, 4）。値の無い行は null */
const competitionRanks = (values, better) =>
  values.map((v) =>
    v === null
      ? null
      : 1 + values.filter((o) => o !== null && better(o, v)).length,
  );

async function openRanking(page, url = KOJIMA) {
  await page.goto(url);
  await expect(page.locator(".vmr-table tbody tr").first()).toBeVisible({
    timeout: 30000,
  });
}

test.describe("会場モーターランキング（BOA-428 子3）", () => {
  test("タブを押すと URL に tab=motorranking が載り、表が出る", async ({
    page,
  }) => {
    await page.goto("/winning-technique?venue_code=16");
    await page.click('.analysis-tab-btn:has-text("モーターランキング")');
    await expect(page).toHaveURL(/tab=motorranking/);
    // ほかのパラメータ（ディープリンクの会場）は残す
    await expect(page).toHaveURL(/venue_code=16/);
    await expect(page.locator(".vmr-table")).toBeVisible({ timeout: 30000 });
  });

  test("直近の節の前検データにあるモーターが、すべて一覧にある", async ({
    page,
  }) => {
    // 前検の1日分（racer_id・motor_number を選ぶクエリ）の応答を控える
    const pretest = page.waitForResponse(
      (res) =>
        res.url().includes("/rest/v1/motor_pretest_stats") &&
        res.url().includes("motor_number") &&
        res.ok(),
      { timeout: 30000 },
    );
    await page.goto(KOJIMA);
    const motors = (await (await pretest).json()).map((r) => r.motor_number);
    expect(motors.length).toBeGreaterThan(0);
    await expect(page.locator(".vmr-table tbody tr").first()).toBeVisible({
      timeout: 30000,
    });
    const listed = new Set((await readRows(page)).map((r) => r.no));
    expect(motors.filter((m) => !listed.has(m))).toEqual([]);
  });

  test("初期は2連率の降順で、同じ値は同じ順位、次の順位は飛ぶ", async ({
    page,
  }) => {
    await openRanking(page);
    await expect(
      page.getByText(
        /出典: 児島 公式サイトのモーター成績（取得日 \d{4}\/\d{1,2}\/\d{1,2}）/,
      ),
    ).toBeVisible();
    const rows = await readRows(page);
    expect(rows.length).toBeGreaterThan(40);
    const rates = rows.map((r) => r.rate);
    const present = rates.filter((v) => v !== null);
    expect(present).toEqual([...present].sort((a, b) => b - a));
    expect(rows.map((r) => r.rank)).toEqual(
      competitionRanks(rates, (a, b) => a > b),
    );
  });

  test("優勝で並べると降順・順位を付け直し、前検は速い順・値なしは末尾", async ({
    page,
  }) => {
    await openRanking(page);
    await page.getByRole("button", { name: /^優勝/ }).click();
    let rows = await readRows(page);
    const wins = rows.map((r) => r.win);
    expect(wins.filter((v) => v !== null)).toEqual(
      wins.filter((v) => v !== null).sort((a, b) => b - a),
    );
    expect(rows.map((r) => r.rank)).toEqual(
      competitionRanks(wins, (a, b) => a > b),
    );

    await page.getByRole("button", { name: /^前検/ }).click();
    rows = await readRows(page);
    const times = rows.map((r) => r.pretest);
    const firstNull = times.indexOf(null);
    if (firstNull >= 0) {
      expect(times.slice(firstNull).every((v) => v === null)).toBe(true);
    }
    expect(rows.map((r) => r.rank)).toEqual(
      competitionRanks(times, (a, b) => a < b),
    );
  });

  test("機番で並べると昇順で、順位は2連率の順位のまま", async ({ page }) => {
    await openRanking(page);
    const byRate = new Map((await readRows(page)).map((r) => [r.no, r.rank]));
    await page.getByRole("button", { name: /^機番/ }).click();
    const rows = await readRows(page);
    const nos = rows.map((r) => r.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
    for (const r of rows) expect(r.rank).toBe(byRate.get(r.no));
  });

  test("2連率1位（同率は全部）の値ラベルだけに印が付き、太字", async ({
    page,
  }) => {
    await openRanking(page);
    const rows = await readRows(page);
    const max = Math.max(...rows.map((r) => r.rate).filter((v) => v !== null));
    for (const r of rows) expect(r.best).toBe(r.rate === max);
    const weight = await page
      .locator(".vmr-table .rate-bar-label.is-best")
      .first()
      .evaluate((e) => Number(getComputedStyle(e).fontWeight));
    expect(weight).toBeGreaterThanOrEqual(700);
  });

  test("今節使われていないモーターは、使用者・前検が「-」で機番はリンクにしない", async ({
    page,
  }) => {
    await openRanking(page);
    const rows = await readRows(page);
    for (const r of rows.filter((x) => x.user === "-")) {
      expect(r.pretest).toBeNull();
      expect(r.noLinked).toBe(false);
    }
  });

  test("会場サイトの値の取得に失敗したら、表の代わりにエラー（前検データの一覧に差し替えない）", async ({
    page,
  }) => {
    await page.route(/\/rest\/v1\/venue_motor_stats/, (route) => route.abort());
    await page.goto(KOJIMA);
    await expect(
      page.getByRole("alert").filter({
        hasText: "モーター成績を取得できませんでした",
      }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".vmr-table")).toHaveCount(0);
    await expect(page.getByText("BOATRACE 公式の前検データ")).toHaveCount(0);
  });

  test("戸田（会場サイトにデータが無い）は前検データの出典で、優出・優勝は「-」", async ({
    page,
  }) => {
    await openRanking(page, TODA);
    await expect(
      page.getByText(
        "出典: BOATRACE 公式の前検データ（直近の節で使われたモーターのみ）",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^公式2連率/ }),
    ).toBeVisible();
    const rows = await readRows(page);
    for (const r of rows) {
      expect(r.final).toBe("-");
      expect(r.win).toBeNull();
      expect(r.user).not.toBe("-");
    }
  });

  test("375px でページに横スクロールが出ず、順位・機番・2連率が最初の画面に入る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openRanking(page);
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(sw).toBeLessThanOrEqual(cw + 1);
    const right = await page
      .locator(".vmr-table thead th")
      .nth(2)
      .evaluate((e) => e.getBoundingClientRect().right);
    expect(right).toBeLessThanOrEqual(375);
  });
});
