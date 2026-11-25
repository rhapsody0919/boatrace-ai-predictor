// 枠別情報タブ「1コースの艇に逃げで1着を取られた走（2号艇の選手本人）」（逃し率、オーナー 2026-11-25）
import { test, expect } from "./fixtures.js";
import { stubRacerScopedRuns, runDates } from "./racer-scoped-stub.js";

const RACE = "/race/2026-09-27-02-11";

// 進入2コースで走った走（逃げられた・逃げられていない）と、ほかのコースの走（数えない）
function runs({ nigashi = 0, other2 = 0, otherCourse = 0 }) {
  const kinds = [
    // 自分は2コース、勝ったのは1コースの艇（艇番2）で決まり手は逃げ
    ...Array(nigashi).fill({ course: 2, rank1: 2, technique: "逃げ" }),
    ...Array(other2).fill({ course: 2, rank1: 1, technique: "差し" }),
    ...Array(otherCourse).fill({ course: 3, rank1: 2, technique: "逃げ" }),
  ];
  const dates = runDates(kinds.length);
  return kinds.map((k, i) => ({ ...k, date: dates[i], venue: 5 }));
}

// 全国の基準（会場ごとの行）。2会場を走数で重み付けて 52% になる
const BASELINE_ROWS = [
  { venue_code: 1, runs: 1000, nigashi_rate: 50.0, window_start: "2025-12-03", window_end: "2026-09-26" },
  { venue_code: 2, runs: 1000, nigashi_rate: 54.0, window_start: "2025-12-02", window_end: "2026-09-26" },
];

async function open(page, { baselineFails = false } = {}) {
  await page.route("**/rest/v1/venue_course_technique_baseline?*", (route) =>
    baselineFails
      ? route.fulfill({ status: 500, json: { message: "boom" } })
      : route.fulfill({ json: BASELINE_ROWS }),
  );
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: /^枠別情報$/ }).click();
  return page.getByTestId("nigashi-card");
}

test("2号艇の進入2コースの走のうち、逃げで1着を取られた走を k/n と率で出し、全国の基準を1行添える 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  // 2コース 17走（逃げられた 9）。3コースの逃げは数えない。率は30走未満でも出す
  await stubRacerScopedRuns(page, runs({ nigashi: 9, other2: 8, otherCourse: 5 }));
  const card = await open(page);
  await expect(card).toContainText("1コースの艇に逃げで1着を取られた走（2号艇の選手本人）");
  await expect(card.getByTestId("nigashi-value")).toHaveText("17走中9走（53%）");
  await expect(card).toContainText("全国では、2025/12/02〜2026/09/26の2コースの走の52%で1コースの艇が逃げています。");
  await expect(card).toContainText("選手の特徴を表す率ではありません");
  // 事実の記録なので「結果を保証しない」の断りは付けない（オーナー 2026-11-25）
  await expect(card).not.toContainText("保証");
  // 右の列（決まり手のカードと同じ列）の上に置く。PC の下の段は3列のまま、スマホでは逃げのカードの直後に来る
  await expect(page.locator(".race-split__side > [data-testid=nigashi-card]")).toHaveCount(1);
  await expect(card.locator("xpath=following-sibling::*[1]")).toHaveClass(/rwit-card/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});

test("全国の基準の取得に失敗したら、選手の値は出したまま失敗を1行で出す（0% や空にしない）", async ({
  page,
}) => {
  await stubRacerScopedRuns(page, runs({ nigashi: 3, other2: 2 }));
  const card = await open(page, { baselineFails: true });
  await expect(card.getByTestId("nigashi-value")).toHaveText("5走中3走（60%）");
  await expect(card).toContainText("全国の値を読み込めませんでした。");
  await expect(card).not.toContainText("全国では");
});

test("進入2コースの走が無いときは、期間つきで「走った走はありません」と出す", async ({
  page,
}) => {
  await stubRacerScopedRuns(page, runs({ otherCourse: 4 }));
  const card = await open(page);
  await expect(card).toContainText("進入2コースで走った走はありません");
  await expect(card.getByTestId("nigashi-value")).toHaveCount(0);
});
