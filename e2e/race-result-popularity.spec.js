import { test, expect } from "./fixtures.js";

/**
 * 結果タブの払戻で、単勝・複勝の人気を締切時オッズ（race_odds_final）から出す（BOA-534）。
 *
 * 公式の払戻（race_payouts）は3連単〜拡連複にだけ人気が付き、単勝・複勝は popularity が NULL。
 * 単勝はオッズの小さい順、複勝は下限の小さい順（同じ下限なら上限）、同じオッズは同じ順位。
 * 値は児島 2026-09-29 12R の本番データ（race_payouts・race_odds_final、2026-09-30 に確認）。
 */

const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `テスト選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));

const raceIdOf = ({ date, venueCode, raceNumber }) =>
  `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;

function edgeData(races) {
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: races.map((race) => ({
      raceId: raceIdOf(race),
      venueCode: race.venueCode,
      venue: race.venue,
      raceNumber: race.raceNumber,
      startTime: "13:00",
      entries,
      predictions: {
        unified: {
          topPick: 1,
          top3: [1, 2, 3],
          confidence: 50,
          volatilityPercentile: 0.85,
          volatilityPercentileIsFallback: false,
          turnPrediction: {
            patterns: (race.turnCourses ?? [1, 3, 4]).map((course, i) => ({
              technique: "逃げ",
              winnerCourse: course,
              probability: 0.5 - i * 0.1,
            })),
          },
        },
      },
      exhibitionData: [],
      result: race.result,
    })),
  };
}

const st = (boat, startTiming, finishMark, finishRank) => ({
  boat_number: boat,
  start_timing: startTiming,
  is_flying: finishMark === "F",
  is_late_start: finishMark === "L",
  finish_mark: finishMark,
  finish_rank: finishRank,
});

const pay = (betType, seq, combination, payout, payoutStatus, popularity) => ({
  betType,
  seq,
  combination,
  payout,
  payoutStatus,
  popularity,
});
const KOJIMA = {
  date: "2026-09-29",
  venueCode: 16,
  venue: "児島",
  raceNumber: 12,
  result: {
    rank1: 1,
    rank2: 3,
    rank3: 5,
    payoutRows: [
      pay("2fuku", 1, "1-3", 380, "paid", 2),
      pay("2tan", 1, "1-3", 480, "paid", 2),
      pay("3fuku", 1, "1-3-5", 740, "paid", 2),
      pay("3tan", 1, "1-3-5", 1530, "paid", 4),
      pay("place", 1, "1", 100, "paid", null),
      pay("place", 2, "3", 200, "paid", null),
      pay("wide", 1, "1-3", 170, "paid", 2),
      pay("wide", 2, "1-5", 200, "paid", 3),
      pay("wide", 3, "3-5", 540, "paid", 7),
      pay("win", 1, "1", 100, "paid", null),
    ],
  },
};

// race_odds_final の行（児島 9/29 12R の本番値）
const FINAL_ROW = {
  captured_at: "2026-09-29T07:55:45.311+00:00",
  win_all: { 1: 1, 2: 9.4, 3: 14.6, 4: 11.6, 5: 13.8, 6: 12.3 },
  place_all: {
    1: { low: 1, high: 1 },
    2: { low: 2.3, high: 12.8 },
    3: { low: 2, high: 10.9 },
    4: { low: 2.2, high: 12.4 },
    5: { low: 1.9, high: 10.3 },
    6: { low: 2.7, high: 15.4 },
  },
  trifecta_all: null,
  trio_all: null,
  exacta_all: null,
  quinella_all: null,
  wide_all: null,
};

async function openResult(page, race, finalRow) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData([race]) }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route("**/rest/v1/race_odds_final**", (route) =>
    finalRow
      ? route.fulfill({ status: 200, json: finalRow })
      : route.fulfill({
          status: 406,
          json: { code: "PGRST116", message: "no rows" },
        }),
  );
  await page.goto(`/race/${raceIdOf(race)}`);
  const root = page.locator(".race-result");
  await expect(root.locator(".rr-payout-table")).toBeVisible({
    timeout: 20000,
  });
  return root;
}

const popOf = (root, type, combo) =>
  root
    .locator(".rr-payout-row")
    .filter({ has: root.page().locator(".rr-payout-type", { hasText: type }) })
    .filter({ hasText: combo })
    .locator(".rr-pop");

test.describe("単勝・複勝の人気を締切時オッズから出す（BOA-534）", () => {
  test("締切時オッズあり: 単勝・複勝に人気を出し、他の券種は公式の人気のまま。算出の注記を出す", async ({
    page,
  }) => {
    const root = await openResult(page, KOJIMA, FINAL_ROW);
    await expect(popOf(root, "単勝", "1")).toHaveText("1人気");
    // 複勝は下限の小さい順: 1号艇 1.0 → 1人気、3号艇 2.0（5号艇 1.9 の次）→ 3人気
    await expect(popOf(root, "複勝", "1").first()).toHaveText("1人気");
    await expect(
      root.locator(".rr-payout-row").filter({ hasText: "¥200" }).first(),
    ).toContainText("3人気");
    // 公式の人気（3連単4人気）はそのまま
    await expect(
      root.locator(".rr-payout-row").filter({ hasText: "¥1,530" }),
    ).toContainText("4人気");
    await expect(page.getByTestId("payout-popularity-note")).toContainText(
      "締切時オッズ",
    );
  });

  test("締切時オッズなし: 単勝・複勝の人気は空欄、注記も出さない", async ({
    page,
  }) => {
    const root = await openResult(page, KOJIMA, null);
    await expect(
      root.locator(".rr-payout-row").filter({ hasText: "¥1,530" }),
    ).toContainText("4人気");
    await expect(popOf(root, "単勝", "1")).toHaveText("");
    await expect(page.getByTestId("payout-popularity-note")).toHaveCount(0);
  });

  test("同じオッズは同じ順位（複勝の下限・上限が同じ艇が並ぶ）", async ({
    page,
  }) => {
    const tied = {
      ...FINAL_ROW,
      place_all: {
        ...FINAL_ROW.place_all,
        5: { low: 2, high: 10.9 }, // 3号艇と同じ
      },
    };
    const root = await openResult(page, KOJIMA, tied);
    // 1号艇 1.0 が1人気、3号艇と5号艇（2.0-10.9）が同じ2人気
    await expect(
      root.locator(".rr-payout-row").filter({ hasText: "¥200" }).first(),
    ).toContainText("2人気");
  });

  test("不成立の券種には人気を出さない（単勝・複勝が不成立）", async ({
    page,
  }) => {
    const race = {
      ...KOJIMA,
      result: {
        ...KOJIMA.result,
        raceStatus: "partial_refund",
        refundBoats: [6],
        payoutRows: KOJIMA.result.payoutRows.map((row) =>
          row.betType === "win" || row.betType === "place"
            ? { ...row, combination: null, payout: null, payoutStatus: "no_race" }
            : row,
        ),
      },
    };
    const root = await openResult(page, race, FINAL_ROW);
    const winRow = root
      .locator(".rr-payout-row")
      .filter({ has: page.locator(".rr-payout-type", { hasText: "単勝" }) });
    await expect(winRow).toContainText("不成立（返還）");
    await expect(winRow.locator(".rr-pop")).toHaveText("");
    await expect(page.getByTestId("payout-popularity-note")).toHaveCount(0);
  });
});
