import { test, expect } from "./fixtures.js";
import { rewriteTodayRaces, venueCodeOf } from "./today-races-rewrite.js";

/**
 * トップの会場カードの「N日目」の札（BOA-1199、モック A案 docs/design/top-venue-series-day/APPROVED.md）。
 *
 * 録画の本日のレースを書き換え、開催日程に左右されずに確かめる。時計は録画の時刻に固定されるので、
 * 発走を "23:59" にすれば次のレースがある会場、"00:00" にすれば全レース終了の会場になる。
 * 値の決め方はレース詳細の見出しと同じ（src/utils/raceDetailHeading.js の getVenueSeriesDayLabel）。
 */

test.describe.configure({ timeout: 180_000 });

const cardOf = (page, code, prefix = "") =>
  page.locator(`a.venue-grid-card--open[href="${prefix}/venue/${code}"]`);

// 最初に races のある会場を書き換え、その会場コードを返す
function rewriteFirstVenue(page, edit) {
  const picked = { code: null };
  const ready = rewriteTodayRaces(page, (venues) => {
    const venue = venues.find((v) => (v.races ?? []).length > 0);
    picked.code = venueCodeOf(venue);
    venue.races.forEach((r, i) => {
      r.cancellationStatus = null;
      r.raceStage = null;
      edit(r, i, venue.races.length);
    });
  });
  return { picked, ready };
}

test("節の途中の日は、会場名の横に「N日目」を出す。レース単位で欠けた日目は同じ会場の値で補う", async ({
  page,
}) => {
  const { picked, ready } = rewriteFirstVenue(page, (r, i) => {
    r.startTime = "23:59";
    // 出走表の取得前のレースは日目が null（レース詳細と同じく、値のあるレースで補う）
    r.seriesDay = i === 0 ? null : 3;
    r.isFinalDay = false;
  });
  await ready;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const day = cardOf(page, await waitCode(picked)).locator(
    ".venue-grid-card__name-row .venue-grid-card__series-day",
  );
  await expect(day).toHaveText("3日目", { timeout: 30000 });
});

test("最終日は「最終日」と書き、優勝戦のバッジと並べる（A案）", async ({
  page,
}) => {
  const { picked, ready } = rewriteFirstVenue(page, (r, i, n) => {
    r.startTime = "23:59";
    r.seriesDay = 6;
    r.isFinalDay = true;
    if (i === n - 1) r.raceStage = "優勝戦";
  });
  await ready;
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = cardOf(page, await waitCode(picked));
  await expect(card.locator(".venue-grid-card__series-day")).toHaveText(
    "最終日",
    { timeout: 30000 },
  );
  await expect(card.locator(".venue-grid-card__stage")).toContainText("優勝戦");
  await expect(card).not.toContainText("6日目");
});

test("英語のトップでも同じ札を4言語の文言で出す（Last day）", async ({
  page,
}) => {
  const { picked, ready } = rewriteFirstVenue(page, (r) => {
    r.startTime = "23:59";
    r.seriesDay = 4;
    r.isFinalDay = true;
  });
  await ready;
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(
    cardOf(page, await waitCode(picked), "/en").locator(
      ".venue-grid-card__series-day",
    ),
  ).toHaveText("Last day", { timeout: 30000 });
});

test("全レース終了の会場・丸一日中止の会場・次開催の会場には出さない", async ({
  page,
}) => {
  const codes = { finished: null, cancelled: null };
  await rewriteTodayRaces(page, (venues) => {
    const open = venues.filter((v) => (v.races ?? []).length > 0);
    for (const v of open)
      for (const r of v.races) {
        r.startTime = "23:59";
        r.seriesDay = 3;
        r.isFinalDay = false;
        r.cancellationStatus = null;
      }
    // 全レース終了
    codes.finished = venueCodeOf(open[0]);
    for (const r of open[0].races) r.startTime = "00:00";
    // 丸一日中止（結果の無い confirmed）
    if (open.length >= 3) {
      codes.cancelled = venueCodeOf(open[1]);
      for (const r of open[1].races) {
        r.cancellationStatus = "confirmed";
        r.result = null;
      }
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".venue-grid-card--open, .venue-grid-card--closed").first(),
  ).toBeVisible({ timeout: 30000 });
  // 書き換えた残りの会場には出ている（判定が動いていることの確認）
  await expect(
    page.locator(".venue-grid-card__series-day").first(),
  ).toBeVisible({ timeout: 30000 });

  const finished = cardOf(page, codes.finished);
  await expect(finished).toContainText("全レース終了");
  await expect(finished.locator(".venue-grid-card__series-day")).toHaveCount(0);
  if (codes.cancelled != null) {
    await expect(
      cardOf(page, codes.cancelled).locator(".venue-grid-card__series-day"),
    ).toHaveCount(0);
  }
  await expect(
    page.locator(".venue-grid-card--closed .venue-grid-card__series-day"),
  ).toHaveCount(0);
});

// route の書き換えは応答が来たときに走るので、会場コードはページを開いた後に決まる
async function waitCode(picked) {
  await expect.poll(() => picked.code, { timeout: 30000 }).not.toBeNull();
  return picked.code;
}
