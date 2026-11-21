import { test, expect } from "./fixtures.js";
import { VENUE_SUMMARY_STATS as S } from "../src/data/venueSummaryStats.js";

/**
 * 会場ページ（本日）の「<会場>のコース別成績と特徴（直近1年）」の節（BOA-1687 GS02 V1）。
 *
 * - 出走表の後に開いた状態で出す（クリック無しで進入コース1〜6の6行が見える）
 * - 前の畳んだカード（次の発走の直上）は外し、最初のレースカードを押し下げない
 * - 要約2行の直下に節へのページ内リンクを1つ置く
 *
 * レースの並びは Edge API を差し替えて固定する（venue-next-race.spec.js と同じ形。1R 10:30 〜 12R 16:00、
 * 30分おき、時計は 2026-09-28 14:00 JST。14:00 なら 1〜6R に結果、次の発走は 9R）。
 */

const DATE = "2026-09-28";
const AT = "14:00";
const startOf = (n) => {
  const m = 10 * 60 + 30 + (n - 1) * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const edgeData = (venue) => ({
  generatedAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({
    raceId: `${DATE}-${String(venue).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
    venueCode: venue,
    raceNumber: n,
    startTime: startOf(n),
    entries: [1, 2, 3, 4, 5, 6].map((i) => ({
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
    })),
    predictions: {},
    exhibitionData: [],
    result:
      minutesOf(startOf(n)) <= minutesOf(AT) - 40
        ? { rank1: 1, rank2: 2, rank3: 3 }
        : null,
  })),
});

async function open(page, venue) {
  await page.clock.setFixedTime(new Date(`${DATE}T${AT}:00+09:00`));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(venue) }),
  );
  await page.goto(`/venue/${venue}`);
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
  await expect(page.getByTestId("venue-course-section")).toBeAttached({
    timeout: 20000,
  });
}

// 変更前の master（1f118bc）で測った最初のレースカードの文書上の top（/venue/2・/venue/4 とも同じ）。許容 +1px
const MASTER_FIRST_CARD_TOP = { 375: 451.8, 1280: 288.5 };
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    for (const venue of [12, 1]) {
      test(`/venue/${venue}: クリック無しで6行の表・期間・母数を出し、出走表の後に置く`, async ({
        page,
      }) => {
        await open(page, venue);
        const section = page.getByTestId("venue-course-section");
        const rows = section.locator('[data-testid^="venue-course-row-"]');
        await expect(rows).toHaveCount(6);
        for (let i = 0; i < 6; i++) {
          await expect(rows.nth(i)).toBeVisible();
          await expect(rows.nth(i)).toContainText(/\d+\.\d%/);
        }
        // 表の列見出しに「進入コース」（枠番と取り違えない）
        await expect(
          section.getByTestId("venue-course-table").locator("thead"),
        ).toContainText("進入コース");
        // 節の中に期間の日付と母数
        const v = S.venues[venue];
        const to = S.to.replaceAll("-", "/");
        const period = section.getByTestId("venue-course-period");
        await expect(period).toContainText(S.from.replaceAll("-", "/"));
        await expect(period).toContainText(to);
        await expect(period).toContainText(
          `${v.courseRaces.toLocaleString("en-US")}レース`,
        );
        // 要約2行と表の期間の文字列が一致する（同じ指標を違う期間で並べない）
        await expect(page.getByTestId("venue-summary-lines")).toContainText(
          `${to}まで`,
        );
        // 最初のレースカードが節より DOM の上
        const order = await page.evaluate(() => {
          const card = document.querySelector(".race-card");
          const sec = document.querySelector(
            '[data-testid="venue-course-section"]',
          );
          return Boolean(
            card.compareDocumentPosition(sec) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          );
        });
        expect(order).toBe(true);
        // 横あふれ無し
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        // ページの上部に節へのページ内リンクが1つ
        await expect(
          page.locator(`a[href="#venue-course-section"]`),
        ).toHaveCount(1);
      });
    }

    for (const venue of [2, 4]) {
      test(`/venue/${venue}: 畳んだカードが無く、最初のレースカードを押し下げない`, async ({
        page,
      }) => {
        await open(page, venue);
        // (1) 畳んだカード（会場の特徴の details）が無い
        await expect(
          page.locator(".venue-characteristics-card.is-collapsible"),
        ).toHaveCount(0);
        await expect(
          page.locator(
            ".venue-characteristics-card details.collapsible-section",
          ),
        ).toHaveCount(0);
        await expect(
          page.getByTestId("venue-characteristics-teaser"),
        ).toHaveCount(0);
        // 次の発走（9R）の直前の差し込みに、details は「この日の水面傾向」だけ
        const holder = page.getByTestId("venue-next-race-cards");
        await expect(holder).toHaveCount(1);
        const folds = holder.locator("details.collapsible-section");
        const n = await folds.count();
        for (let i = 0; i < n; i++) {
          await expect(
            folds.nth(i).getByTestId("venue-day-summary-teaser"),
          ).toHaveCount(1);
        }
        const nextIsNineR = await holder.evaluate(
          (el) =>
            el.nextElementSibling?.classList.contains("race-card") &&
            /9R/.test(el.nextElementSibling.textContent),
        );
        expect(nextIsNineR).toBe(true);

        // (2) 最初のレースカードの文書上の top が master より下がらない
        await page.evaluate(() => document.fonts.ready);
        const top = await page
          .locator(".race-card")
          .first()
          .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        expect(top).toBeLessThanOrEqual(
          MASTER_FIRST_CARD_TOP[viewport.width] + 1,
        );

        // (3) 要約2行の直下に節へのページ内リンク。押すと節がヘッダーの直下〜画面内に入る
        const link = page.locator(
          '[data-testid="venue-summary-lines"] + * a[href^="#"]',
        );
        await expect(link).toHaveCount(1);
        const id = (await link.getAttribute("href")).slice(1);
        const section = page.locator(`[id="${id}"]`);
        await expect(section).toHaveCount(1);
        await expect(section).toHaveAttribute(
          "data-testid",
          "venue-course-section",
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        if (viewport.width === 375) {
          const before = await section.evaluate(
            (el) => el.getBoundingClientRect().top,
          );
          expect(before).toBeGreaterThan(viewport.height);
        }
        await link.click();
        const headerBottom = await page
          .locator(".app-header")
          .evaluate((el) => el.getBoundingClientRect().bottom);
        await expect
          .poll(() => section.evaluate((el) => el.getBoundingClientRect().top))
          .toBeLessThan(viewport.height);
        const after = await section.evaluate(
          (el) => el.getBoundingClientRect().top,
        );
        expect(after).toBeGreaterThanOrEqual(headerBottom - 1);
      });
    }
  });
}
