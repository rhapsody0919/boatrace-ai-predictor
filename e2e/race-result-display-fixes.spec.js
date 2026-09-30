import { test, expect } from "./fixtures.js";

/**
 * 結果タブ・一覧カードの既存の表示崩れ（BOA-559）。
 * 1. フライング艇のスタート矢印が、ラインの手前（遅いスタート）に描かれていた
 * 2. 375px で、全角スペースで詰めた選手名（「丹下　　　将」）が姓だけに切れ、級別も見えない
 * 3. 一覧カードの出走表で、768px 以上だと6号艇の列が切れる（表の最小幅がカードより広い）
 */

const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  // 公式の元データと同じく、姓と名の間を全角スペースで詰めた名前（BOA-559）
  name:
    i === 1 ? "丹下　　　将" : i === 2 ? "土屋　実沙希" : `テスト選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));

function edgeData({ date, venueCode, venue, raceNumber, result }) {
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: [
      {
        raceId: `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`,
        venueCode,
        venue,
        raceNumber,
        startTime: "13:00",
        entries,
        predictions: {
          unified: {
            topPick: 1,
            top3: [1, 2, 3],
            confidence: 50,
            turnPrediction: {
              patterns: [
                { technique: "逃げ", winnerCourse: 1, probability: 0.6 },
              ],
            },
          },
        },
        exhibitionData: [],
        result,
      },
    ],
  };
}

// race_start_timings の行（本番の値そのまま。2026-09-29 に execute_sql で確認）
const st = (boat, startTiming, finishMark, finishRank) => ({
  boat_number: boat,
  start_timing: startTiming,
  is_flying: finishMark === "F",
  is_late_start: false,
  finish_mark: finishMark,
  finish_rank: finishRank,
});

async function openResult(page, { race, startTimings }) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(race) }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route("**/rest/v1/race_start_timings**", (route) =>
    route.fulfill({ status: 200, json: startTimings }),
  );
  const raceId = edgeData(race).races[0].raceId;
  await page.goto(`/race/${raceId}`);
  const table = page.locator(".race-result .rr-table");
  await expect(table).toBeVisible({ timeout: 20000 });
  return table;
}


// 浜名湖 2026-09-14 6R（不成立。1・2・3・5・6号艇がF、4号艇は0.02）
const HAMANAKO = {
  date: "2026-09-14",
  venueCode: 6,
  venue: "浜名湖",
  raceNumber: 6,
  result: { rank1: 4, rank2: 1, rank3: 2 },
};
const HAMANAKO_ST = [
  st(1, 0.11, "F", null),
  st(2, 0.09, "F", null),
  st(3, 0.03, "F", null),
  st(4, 0.02, "_", null),
  st(5, 0.03, "F", null),
  st(6, 0.01, "F", null),
];

test("フライング艇の矢印はスタートラインより先に、遅れていない艇はラインの手前に描く", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const table = await openResult(page, {
    race: HAMANAKO,
    startTimings: HAMANAKO_ST,
  });
  await expect(table.locator(".rr-row")).toHaveCount(6);
  const dots = await table.locator(".rr-row").evaluateAll((rows) =>
    rows.map((row) => {
      const boat = row.querySelector(".rr-boat-chip")?.textContent.trim();
      const dot = row.querySelector(".rr-st-dot");
      return { boat, left: parseFloat(dot?.style.left ?? "NaN") };
    }),
  );
  const LINE = 84;
  for (const d of dots) {
    if (d.boat === "4") expect(d.left, d.boat).toBeLessThan(LINE);
    else expect(d.left, d.boat).toBeGreaterThan(LINE);
  }
  // F0.11（1号艇）は F0.01（6号艇）より先
  const left = (b) => dots.find((d) => d.boat === b).left;
  expect(left("1")).toBeGreaterThan(left("6"));
});

test("375px: 全角スペースで詰めた選手名は空白を1つにまとめ、名前と級別が切れずに見える", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const table = await openResult(page, {
    race: HAMANAKO,
    startTimings: HAMANAKO_ST,
  });
  const row1 = table
    .locator(".rr-row")
    .filter({ has: page.locator(".rr-boat-chip", { hasText: /^1$/ }) });
  const name = row1.locator(".rr-name-text");
  await expect(name).toHaveText("丹下 将B1");
  // 5文字の名前（「土屋 実沙希」）も級別まで切れない（級別は名前の下の行。ファン評価1周目）
  const names = table.locator(".rr-name-text");
  const clipped = await names.evaluateAll((els) =>
    els
      .filter((e) => e.scrollWidth > e.clientWidth)
      .map((e) => e.textContent),
  );
  expect(clipped).toEqual([]);
  await expect(table).toContainText("土屋 実沙希");
});

test("STが0.15より遅い艇も、遅いほどラインから離れて描く（0.16と0.27が重ならない）", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const table = await openResult(page, {
    race: {
      date: "2026-09-29",
      venueCode: 16,
      venue: "児島",
      raceNumber: 12,
      result: { rank1: 1, rank2: 2, rank3: 3, rank4: 4, rank5: 5, rank6: 6 },
    },
    startTimings: [
      st(1, 0.18, "1", 1),
      st(2, 0.16, "2", 2),
      st(3, 0.12, "3", 3),
      st(4, 0.12, "4", 4),
      st(5, 0.2, "5", 5),
      st(6, 0.27, "6", 6),
    ],
  });
  await expect(table.locator(".rr-row")).toHaveCount(6);
  const left = await table.locator(".rr-row").evaluateAll((rows) =>
    Object.fromEntries(
      rows.map((row) => [
        row.querySelector(".rr-boat-chip")?.textContent.trim(),
        parseFloat(row.querySelector(".rr-st-dot")?.style.left ?? "NaN"),
      ]),
    ),
  );
  // 遅いほど左（ラインから離れる）: 0.12 > 0.16 > 0.18 > 0.20 > 0.27
  expect(left["3"]).toBeGreaterThan(left["2"]);
  expect(left["2"]).toBeGreaterThan(left["1"]);
  expect(left["1"]).toBeGreaterThan(left["5"]);
  expect(left["5"]).toBeGreaterThan(left["6"]);
});

for (const width of [768, 1024, 1440]) {
  test(`${width}px: 一覧カードの出走表は6号艇の列まで切れずに収まる`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/races/2026-09-14/6");
    await expect(page.locator(".rcdt-table").first()).toBeVisible({
      timeout: 30000,
    });
    const overflow = await page.$$eval(".rcdt-table-wrapper", (ws) =>
      ws.filter((w) => w.scrollWidth > w.clientWidth + 1).length,
    );
    expect(overflow).toBe(0);
  });
}
