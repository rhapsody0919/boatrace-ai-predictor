import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 期別成績の全期の取得（c1_entries を含む問い合わせ）の応答の出走を全期0にする。
 * 「全期出走なし」の選手を本番のデータに頼ると、その選手が新しい期に出走した時点で E2E Live が落ちる
 * （3391 は 2027年前期に出走し、2026-11-24 から赤）。応答を書き換えて、データが変わっても同じ場面にする
 */
async function zeroAllStarts(page) {
  await page.route("**/rest/v1/racer_period_stats*", async (route) => {
    if (!route.request().url().includes("c1_entries")) return route.fallback();
    const response = await fetchRecorded(route);
    const body = await response.json();
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: body.map((r) => ({ ...r, starts: 0 })),
    });
  });
}

/**
 * 選手ページの公式の成績（期別成績の推移・進入コース別成績）（GS00、2026-10-28）の固定。
 * 値の作り方は scripts/maintenance/verify-racer-official-period-stats.js が固定の入力で検証する。
 * ここでは画面に出ること、言ってはいけない言葉が無いこと、取得の失敗がエラー表示になることを見る。
 * 3941 池田浩二（A1、2019年後期から全期に出走）
 */

test("期別成績と進入コース別成績（公式）を出し、期の呼び名・注記を公式どおりにする", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  const section = page.locator(".racer-official-stats");
  await expect(section.locator("h2")).toHaveText(
    "池田浩二の公式成績（期別・進入コース別）",
  );
  await expect(section).toContainText("期別成績（公式・");
  await expect(section).toContainText("年後期");
  await expect(section).toContainText("この期で決まった級");
  await expect(section).toContainText("進入コース別成績（公式・");
  // 進入コース別の表は6コース
  const courseTable = section.locator(".racer-official-table").last();
  await expect(courseTable.locator("tbody tr")).toHaveCount(6);
  // 推移に「調子」「通算」「年別」と言わない（data-scientist の言える範囲）
  for (const word of ["調子", "好調", "不調", "通算", "年別", "得意コース"]) {
    await expect(section).not.toContainText(word);
  }
});

test("勝率の折れ線は開いた時点で全期の点が出て、最後の点が最新の期の目盛りに重なる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/racer/3941");
  const chart = page.locator(".racer-official-chart");
  // 期ごとの段（P-12、オーナー 2026-11-27「期ごとの段に1つ」）。期の札が出た直後に1回だけ測る
  await chart.locator(".rps-period").last().waitFor({ state: "attached" });
  // 描く動きは無い。段（横）の数は出走のある期の数、最新の期の段は図の右端の帯まで届く
  const measure = () =>
    chart.evaluate((el) => {
      const center = (n) => {
        const r = n.getBoundingClientRect();
        return r.x + r.width / 2;
      };
      const step = el.querySelector(".rps-step");
      // 段は出走のある期だけ（出走0の期は段を描かない）。位置はその期の帯の中心
      const dots = [...el.querySelectorAll(".rps-hit[data-starts]")].map(
        center,
      );
      const bands = [...el.querySelectorAll(".rps-hit")];
      const lastBand = bands.at(-1).getBoundingClientRect();
      const stepBox = step.getBoundingClientRect();
      const lastTickValue = [...el.querySelectorAll(".rps-period")].at(-1);
      return {
        dots,
        lastTickX: lastTickValue ? center(lastTickValue) : null,
        // 札は短い形（「27前」）。元の期の名前は data-label
        lastTickText: lastTickValue?.dataset.label ?? "",
        lineShownRatio:
          (stepBox.right - lastBand.left) / (lastBand.right - lastBand.left),
      };
    });
  const first = await measure();
  // 点は出走のある期だけ（「出走なし」の行には点を置かない）
  const periodRows = page.locator(
    ".racer-official-stats .racer-official-block:first-of-type .racer-official-table tbody tr",
  );
  const withStarts = await periodRows
    .filter({ hasNot: page.locator(".racer-official-empty") })
    .count();
  expect(first.dots.length).toBe(withStarts);
  expect(first.lineShownRatio).toBeGreaterThan(0.99);
  // 最新の期（表の先頭の行）の目盛りが右端にあり、最後の点と同じ位置
  const latestLabel = (
    await page
      .locator(".racer-official-table")
      .first()
      .locator("tbody tr th")
      .first()
      .innerText()
  ).split("\n")[0];
  expect(first.lastTickText).toBe(latestLabel);
  expect(Math.abs(first.dots.at(-1) - first.lastTickX)).toBeLessThan(2);
});

test("枠番別成績は当サイト集計と書き、進入コース別（公式）と分ける", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-performance-stats")).toContainText(
    "枠番別成績（当サイト集計・2025年12月以降・全会場計）",
  );
  await expect(page.locator(".racer-performance-stats")).not.toContainText(
    "前づけ）は現時点では区別できない",
  );
});

test("公式の期別成績の取得に失敗したらエラー表示を出す（「データなし」に化けさせない）", async ({
  page,
}) => {
  await page.route("**/rest/v1/racer_period_stats*", (route) => {
    // 期別成績の全期の取得（period_year で並べる問い合わせ）だけを落とす。平均ST の取得は通す
    if (route.request().url().includes("c1_entries")) return route.abort();
    return route.fallback();
  });
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".inline-fetch-error").first()).toBeVisible();
  await expect(page.locator(".racer-official-stats")).toHaveCount(0);
});

test("公式の期別成績のHTTP 500をデータなしにせず、失敗として表示する", async ({
  page,
}) => {
  let failedRequests = 0;
  await page.route("**/rest/v1/racer_period_stats*", (route) => {
    if (!route.request().url().includes("c1_entries")) return route.fallback();
    failedRequests += 1;
    return route.fulfill({
      status: 500,
      json: { message: "BOA-1292 period stats unavailable" },
    });
  });
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-profile-header h1")).toHaveText("池田浩二");
  await expect(page.locator(".inline-fetch-error").first()).toBeVisible();
  expect(failedRequests).toBeGreaterThan(0);
  await expect(page.locator(".racer-official-stats")).toHaveCount(0);
});

test("全期出走なしの選手は、空の折れ線を出さず「この N 期に出走はありません」と書く", async ({
  page,
}) => {
  await zeroAllStarts(page);
  await page.goto("/racer/3391");
  const section = page.locator(".racer-official-stats");
  await expect(section).toContainText(/この\d+期に出走はありません/);
  await expect(section.locator(".racer-official-chart")).toHaveCount(0);
});

test("375px: 成績表は1列目を固定し、進入コース別の表は幅に収まる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/racer/3941");
  const section = page.locator(".racer-official-stats");
  await section.locator(".racer-official-table").first().waitFor();
  const firstCellPosition = await section
    .locator(".racer-official-table tbody th")
    .first()
    .evaluate((el) => getComputedStyle(el).position);
  expect(firstCellPosition).toBe("sticky");
  const course = await section
    .locator(".racer-official-table-wrap")
    .last()
    .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(course.sw).toBeLessThanOrEqual(course.cw);
});

test("折れ線のツールチップに集計期間を出す（今の半期と取り違えない）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/racer/3941");
  // 最後の点は表の最新の期。期は半年ごとに増えるので、集計期間は注記の「この表の最新は…（集計 X）」から読む
  const note = await page
    .locator(".racer-official-stats .racer-official-note")
    .first()
    .innerText();
  const latestRange = note.match(
    /集計\s*(\d{4}\/\d{2}\/\d{2}〜\d{4}\/\d{2}\/\d{2})/,
  )?.[1];
  expect(latestRange).toBeTruthy();
  // 最新の期の帯（期ごとの段、P-12）に触れると、その期の集計期間
  const dot = page.locator(".racer-official-chart .rps-hit").last();
  await dot.hover();
  await expect(page.locator(".racer-official-chart .rps-tip")).toContainText(
    `集計 ${latestRange}`,
  );
});

test("375px: 折れ線の中央の点のツールチップが画面の右端で切れない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/racer/3941");
  // 期ごとの段（P-12）の期の帯に触れる。スマホは吹き出しを図の下に幅いっぱいで出す
  const dots = page.locator(".racer-official-chart .rps-hit");
  await dots.nth(7).hover();
  const tip = page.locator(".racer-official-chart .rps-tip");
  await expect(tip).toContainText("勝率");
  const right = await tip.evaluate((el) => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(375);
});

test("375px では期別の表に横に送れる目印を出し、1440px では出さない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/racer/3941");
  const hint = page.locator(".racer-official-scroll-hint").first();
  await expect(hint).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(hint).toBeHidden();
});

test("進入コース別は公式サイトのコース別のページと期間が違うと書き、全期出走なしの選手には後の走が載る時期を書く", async ({
  page,
}) => {
  await page.goto("/racer/3941");
  await expect(page.locator(".racer-official-stats")).toContainText(
    "公式サイトの選手のコース別成績のページとは集計の期間が違う",
  );
  await zeroAllStarts(page);
  await page.goto("/racer/3391");
  await expect(page.locator(".racer-official-stats")).toContainText(
    /より後の走は、その期が終わって公式の期別成績が公開されると載ります/,
  );
});
