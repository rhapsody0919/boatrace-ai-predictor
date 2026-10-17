import { test, expect } from "./fixtures.js";

/**
 * イン崩れ注意度の一覧の札とホームの今日のイン崩れ注意度（BOA-822 tasks 21・22、機能フラグの裏。?caution=1 で出す）。
 * 承認モック docs/design/in-collapse-caution/mock/2-lists-375.png。DB に依存しないよう、今日のレース（get_today_races と
 * Edge API）と Supabase REST を差し替える（today-highlights-result.spec.js と同じ形）。
 *
 *   - ホーム: 見出し「今日のイン崩れ注意度」、崩れやすい順・堅めの順の2列、値は割合と段の札。中くらいはどちらにも入れない。
 *     旧の「/ 100」の物差しは出さない
 *   - 会場のレース一覧: 札は「崩れやすい 65%」「中くらい 43%」「堅め 26%」。展開予測の的中/外れの札は出さない
 *   - 中止確定のレースは札・左の色線を出さない（ホームの上位からも外す）
 *   - フラグの外は今のまま（旧指数の「/ 100」）
 */

test.describe.configure({ timeout: 180_000 });

const VENUE_CODE = 2; // 戸田
const DATE = "2026-09-29";
const raceIdOf = (raceNo) =>
  `${DATE}-${String(VENUE_CODE).padStart(2, "0")}-${String(raceNo).padStart(2, "0")}`;

const ic = (pct, level) => ({
  pct,
  n: 30000,
  nonWin: 15000,
  level,
  gapCents: -100,
  band: -2,
  round: "other",
  boat1WinRate: 5,
  topOtherBoat: 2,
  topOtherWinRate: 6,
  basePct: 45,
  absentBoats: [],
  lowSample: false,
  through: "2026-09-28",
  def: "gapband-r-v1",
});

const RACES = [
  { raceNo: 1, inCaution: ic(65, "high"), percentile: 0.2 },
  { raceNo: 2, inCaution: ic(82, "high"), percentile: 0.5 },
  { raceNo: 3, inCaution: ic(43, "mid"), percentile: 0.95 },
  { raceNo: 4, inCaution: ic(26, "low"), percentile: 0.9 },
  { raceNo: 5, inCaution: null, percentile: 0.1 },
  // 中止確定。朝の生成で値は入っているが、札・色線は出さない（PR #1602 レビュー）
  { raceNo: 6, inCaution: ic(75, "high"), percentile: 0.5, cancelled: true },
];
const cancellationOf = (r) => (r.cancelled ? "confirmed" : null);

function todayResponse() {
  return {
    success: true,
    scrapedAt: new Date().toISOString(),
    data: [
      {
        place_cd: VENUE_CODE,
        place_name: "戸田",
        races: RACES.map((r) => ({
          raceNo: r.raceNo,
          startTime: `1${r.raceNo}:00`,
          date: DATE,
          placeCd: VENUE_CODE,
          raceGrade: null,
          cancellationStatus: cancellationOf(r),
          seriesDay: null,
          isFinalDay: null,
          raceTitle: null,
          raceStage: null,
          result: null,
          inCaution: r.inCaution,
          volatility: {
            percentile: r.percentile,
            isFallback: false,
            level: "standard",
          },
          turnPrediction: null,
          racers: [],
        })),
      },
    ],
  };
}

/** 会場のレース一覧が読む /api/predictions/{date}（get_predictions_by_date の形） */
function predictionsResponse() {
  const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
    number: i,
    name: `試験${i}`,
    grade: "B1",
    age: 30,
    winRate: 5,
    localWinRate: 5,
    motorNumber: i,
    motor2Rate: 35,
    boatNumber: i,
    boat2Rate: 35,
  }));
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: RACES.map((r) => ({
      raceId: raceIdOf(r.raceNo),
      venueCode: VENUE_CODE,
      venue: "戸田",
      raceNumber: r.raceNo,
      startTime: `1${r.raceNo}:00`,
      cancellationStatus: cancellationOf(r),
      entries,
      predictions: {
        unified: {
          topPick: 1,
          top3: [1, 2, 3],
          confidence: 50,
          volatilityPercentile: r.percentile,
          volatilityPercentileIsFallback: false,
        },
      },
      inCaution: r.inCaution,
      volatility: {
        percentile: r.percentile,
        isFallback: false,
        level:
          r.percentile >= 0.7
            ? "high"
            : r.percentile <= 0.3
              ? "low"
              : "standard",
      },
      exhibitionData: [],
      result: null,
    })),
  };
}

async function setup(page) {
  await page.clock.setFixedTime(new Date("2026-09-29T09:00:00+09:00"));
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/api/races/today**", (route) =>
    route.fulfill({ json: todayResponse() }),
  );
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: predictionsResponse() }),
  );
  await page.route("**/rest/v1/rpc/get_today_races*", (route) =>
    route.fulfill({ status: 200, json: todayResponse() }),
  );
}

test.describe("イン崩れ注意度の一覧の札とホーム（BOA-822、?caution=1）", () => {
  test("ホーム: 崩れやすい順と堅めの順を割合と札で出し、中くらい・値の無いレースは入れない", async ({
    page,
  }) => {
    await setup(page);
    await page.goto("/?caution=1");
    const section = page.locator(".volatility-highlights");
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section).toContainText("今日のイン崩れ注意度");
    // 勝率差が誰と誰の差かを書く（#1602 ファン評価1周目 指摘2）
    await expect(section).toContainText(
      "1号艇と、他の艇で一番高い全国勝率の差（勝率差）",
    );
    const columns = await section
      .locator(".volatility-highlights__column")
      .evaluateAll((cols) =>
        cols.map((col) =>
          [...col.querySelectorAll("a")].map((a) => a.getAttribute("href")),
        ),
      );
    expect(columns).toEqual([
      [`/race/${raceIdOf(2)}`, `/race/${raceIdOf(1)}`],
      [`/race/${raceIdOf(4)}`],
    ]);
    await expect(section).toContainText("82%");
    await expect(section).toContainText("崩れやすい");
    await expect(section).toContainText("堅め");
    await expect(section).not.toContainText("/ 100");
    const link = await section
      .locator(".volatility-highlights__race-link")
      .first()
      .boundingBox();
    expect(link.height).toBeGreaterThanOrEqual(44);
    // 「段ごとの実績を見る」も 44px 以上、定義の1行に期間（#1602 ファン評価2周目）
    const accuracy = await section
      .locator(".volatility-highlights__accuracy-link a")
      .boundingBox();
    expect(accuracy.height).toBeGreaterThanOrEqual(44);
    await expect(section).toContainText("全国の過去レース（2019年4月〜前日）");
    // 準優勝戦・優勝戦はラウンドで分けた値（#1602 ファン評価3周目、1周目 P3 の再発）
    await expect(section).toContainText(
      "準優勝戦・優勝戦は、それぞれ準優勝戦だけ・優勝戦だけ",
    );
  });

  test("会場のレース一覧: 札は段と割合（中くらいは枠線だけ）、値の無いレースは札を出さない", async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`/venue/${VENUE_CODE}?caution=1`);
    const cards = page.locator(".race-card");
    await expect(cards.first()).toBeVisible({ timeout: 30000 });
    const badges = await page
      .locator(".race-card .in-caution-badge")
      .allInnerTexts();
    expect(badges.map((b) => b.replace(/\s+/g, " ").trim())).toEqual([
      "▲ 崩れやすい 65%",
      "▲ 崩れやすい 82%",
      "中くらい 43%",
      "堅め 26%",
    ]);
    const mid = page.locator(".race-card .in-caution-badge--mid");
    expect(await mid.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe(
      "solid",
    );
    await expect(page.locator(".race-card", { hasText: "🌪️" })).toHaveCount(0);
    // 札の割合が何か（全国の勝率差の帯）を一覧の上に書く（#1602 ファン評価1周目 指摘1）
    await expect(
      page.locator(".venue-race-list__in-caution-note"),
    ).toContainText(
      "他の艇で一番高い全国勝率の差（勝率差）が同じくらいの全国の過去レース",
    );
  });

  test("中止確定のレースは札と左の色線を出さない（PR #1602 レビュー）", async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`/venue/${VENUE_CODE}?caution=1`);
    const cancelled = page.locator(".race-card", { hasText: "中止" });
    await expect(cancelled).toHaveCount(1, { timeout: 30000 });
    await expect(cancelled.locator(".in-caution-badge")).toHaveCount(0);
    expect(
      await cancelled.evaluate((e) => getComputedStyle(e).borderLeftWidth),
    ).not.toBe("4px");
  });

  test("フラグの外は今のまま（旧指数の「/ 100」）", async ({ page }) => {
    await setup(page);
    await page.goto("/?caution=0");
    const section = page.locator(".volatility-highlights");
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section).toContainText("/ 100");
    await expect(section).not.toContainText("今日のイン崩れ注意度");
    await expect(page.locator(".venue-race-list__in-caution-note")).toHaveCount(
      0,
    );
  });
});

// BOA-822 task 27: 計測（measurement.md）。欄・一覧の定義が画面に入ったらページごとに1回 caution_visible（race_id・段なし）、
// レースへ移ったら押したレースの race_id・段つきの caution_click
test.describe("イン崩れ注意度の計測（ホーム・会場の一覧、BOA-822 task 27）", () => {
  const named = (page, name) =>
    page.evaluate(
      (n) =>
        window.__events
          .filter((e) => e[0] === "event" && e[1] === n)
          .map((e) => e[2]),
      name,
    );
  const stubGtag = (page) =>
    page.addInitScript(() => {
      window.__events = [];
      window.gtag = (...args) => window.__events.push(args);
    });

  test("ホーム: 欄が見えたら1回、行を押したらそのレースの段つき", async ({
    page,
  }) => {
    await stubGtag(page);
    await setup(page);
    await page.goto("/?caution=1");
    const section = page.locator(".volatility-highlights--in-caution");
    await expect(section).toBeVisible({ timeout: 30000 });
    await section.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await named(page, "caution_visible")).length)
      .toBe(1);
    expect((await named(page, "caution_visible"))[0]).toEqual({
      caution_surface: "home_highlight",
    });
    await section.locator(".volatility-highlights__race-link").first().click();
    await expect
      .poll(async () => (await named(page, "caution_click")).length)
      .toBe(1);
    expect((await named(page, "caution_click"))[0]).toEqual({
      caution_surface: "home_highlight",
      race_id: raceIdOf(2),
      caution_band: "high",
      caution_target: "race",
    });
  });

  test("会場の一覧: 定義の1行が見えたら1回、札のあるカードからレースへ移ったら段つき", async ({
    page,
  }) => {
    await stubGtag(page);
    await setup(page);
    await page.goto(`/venue/${VENUE_CODE}?caution=1`);
    await expect(page.locator(".venue-race-list__in-caution-note")).toBeVisible(
      { timeout: 30000 },
    );
    await expect
      .poll(async () => (await named(page, "caution_visible")).length)
      .toBe(1);
    expect((await named(page, "caution_visible"))[0]).toEqual({
      caution_surface: "race_list",
    });
    await page
      .locator(".race-card", { hasText: "堅め 26%" })
      .locator(".predict-btn")
      .click();
    await expect
      .poll(async () => (await named(page, "caution_click")).length)
      .toBe(1);
    expect((await named(page, "caution_click"))[0]).toEqual({
      caution_surface: "race_list",
      race_id: raceIdOf(4),
      caution_band: "low",
      caution_target: "race",
    });
  });
});
