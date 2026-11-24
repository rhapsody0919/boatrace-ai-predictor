import { test, expect } from "./fixtures.js";

/**
 * /today のイン崩れ注意度（BOA-822 task 35、機能フラグの裏。?caution=1 で出す）。
 *   - 注目レース: 「50以上なら高い」の旧の指数の欄を、注意度の割合と段の札に替える
 *   - 逃げ等のカード: 開いたときのフッターの「イン崩れ指数 N%」を「イン崩れ注意度 段 N%」に替える
 *   - in_caution_* の無い行（156 の前の過去の行・注意度を出さなかったレース）は欄を出さない（旧の指数にも戻さない）
 *   - 計測: 欄が画面に入ったら日ごとに1回 caution_visible（race_id・段なし）、レースへ移ったら段つきの caution_click
 *   - フラグの外は今のまま（旧の指数）
 * DB に依存しないよう morning_digest_days・rows を差し替える（today-featured-racer-link.spec.js と同じ形）。
 */

test.describe.configure({ timeout: 120_000 });

const DATE = "2026-11-20";
const raceIdOf = (venue, raceNo) =>
  `${DATE}-${String(venue).padStart(2, "0")}-${String(raceNo).padStart(2, "0")}`;

const metricRow = (section, rank, venue, raceNo, extra) => ({
  digest_date: DATE,
  section,
  rank,
  race_id: raceIdOf(venue, raceNo),
  venue_code: venue,
  race_number: raceNo,
  start_time: "15:00:00",
  boat_number: 1,
  course: 1,
  racer_id: 4000 + rank,
  racer_name: `選手${section === "featured" ? "注" : rank}`,
  grade: "A1",
  metric_value: 80,
  metric_expected: 55,
  metric_skill_delta: 25,
  metric_venue_baseline: 55,
  metric_predicted: 80,
  sample_size: 40,
  is_small_sample: false,
  motor_2rate: 40,
  volatility_percentile: 20,
  detail: { from: "nige", baselineGrade: "ippan" },
  ...extra,
});

const caution = (pct, level, n) => ({
  in_caution_pct: pct,
  in_caution_n: n,
  in_caution_level: level,
});

const ROWS = [
  metricRow("featured", 1, 2, 4, caution(26, "low", 34842)),
  metricRow("nige", 1, 2, 4, caution(26, "low", 34842)),
  metricRow("nige", 2, 3, 5, caution(65, "high", 12000)),
  // 156 の前の行: in_caution_* の列が無い
  metricRow("nige", 3, 4, 6, {}),
];

async function openDigest(page, query) {
  await page.route("**/rest/v1/morning_digest_days*", (route) =>
    route.fulfill({
      json: {
        digest_date: DATE,
        generated_at: `${DATE}T00:00:00Z`,
        flying_data_complete: true,
        suppressed_venues: [],
      },
    }),
  );
  await page.route("**/rest/v1/morning_digest_rows*", (route) =>
    route.fulfill({ json: ROWS }),
  );
  await page.goto(`/today?date=${DATE}${query}`);
  const featured = page.getByRole("region", {
    name: "今日の注目レース",
    exact: true,
  });
  await expect(featured).toBeVisible({ timeout: 30000 });
  return featured;
}

async function openCard(page, rank) {
  const card = page.locator(".digest-card").filter({ hasText: `選手${rank}` });
  await card.locator(".digest-card__toggle").click();
  return card.locator(".digest-card__foot");
}

test("フラグの側: 注目レースは注意度の割合と段の札、旧の指数は出さない", async ({
  page,
}) => {
  const featured = await openDigest(page, "&caution=1");
  const stat = featured.locator(".featured-race__stat", {
    hasText: "イン崩れ注意度",
  });
  await expect(stat.locator(".featured-race__stat-value")).toHaveText("26%");
  await expect(stat.locator(".in-caution-badge--low")).toHaveText("堅め");
  await expect(stat).toContainText("全国の過去レース34842件");
  await expect(featured).not.toContainText("高い（荒れやすい）");
  await expect(featured).not.toContainText("低い（堅い）");
});

test("フラグの側: カードのフッターは注意度、列の無い過去の行は欄を出さない", async ({
  page,
}) => {
  await openDigest(page, "&caution=1");
  const high = await openCard(page, 2);
  await expect(high).toContainText("イン崩れ注意度");
  await expect(high.locator(".in-caution-badge--high")).toHaveText(
    "!崩れやすい 65%",
  );
  await expect(high).not.toContainText("イン崩れ指数");
  const legacy = await openCard(page, 3);
  await expect(legacy).toContainText("モーター2連率");
  await expect(legacy).not.toContainText("イン崩れ");
});

test("フラグの外: 今のまま旧の指数を出す", async ({ page }) => {
  const featured = await openDigest(page, "");
  await expect(featured).toContainText("イン崩れ指数");
  await expect(featured).toContainText("低い（堅い）");
  await expect(featured).not.toContainText("イン崩れ注意度");
  const foot = await openCard(page, 2);
  await expect(foot).toContainText("イン崩れ指数 20%");
});

test("計測: 欄が見えたら1回 caution_visible、レースへ移ったら段つきの caution_click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__events = [];
    window.gtag = (...args) => window.__events.push(args);
  });
  const named = (name) =>
    page.evaluate(
      (n) =>
        window.__events
          .filter((e) => e[0] === "event" && e[1] === n)
          .map((e) => e[2]),
      name,
    );
  const featured = await openDigest(page, "&caution=1");
  await featured.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await named("caution_visible")).length).toBe(1);
  expect((await named("caution_visible"))[0]).toEqual({
    caution_surface: "today",
  });
  // カードを開いて欄がもう1つ画面に入っても、日ごとに1回のまま
  const foot = await openCard(page, 2);
  await foot.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  expect(await named("caution_visible")).toHaveLength(1);

  await featured.getByRole("link", { name: "このレースの詳細を見る" }).click();
  await expect.poll(async () => (await named("caution_click")).length).toBe(1);
  expect((await named("caution_click"))[0]).toEqual({
    caution_surface: "today",
    race_id: raceIdOf(2, 4),
    caution_band: "low",
    caution_target: "race",
  });
});
