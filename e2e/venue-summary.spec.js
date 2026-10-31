import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";
import { VENUE_SUMMARY_STATS as S } from "../src/data/venueSummaryStats.js";

/**
 * 会場ページ（/venue/N）の常設の要約2行・title・「この会場の特徴」カード・節のページへの帯（BOA-1189 GS02-b）。
 *
 * - 24場で、見出しの直下に要約2行が出て、title が「{会場}競艇の予想・出走表」で始まる
 * - 全国と比べる文（高い・低い）は、Bonferroni を通った会場（vsNational.course1）だけ。ほかは「差ははっきりしない」
 * - カードは直近1年・進入コース別。以前の「過去90日・枠番別の1着率」を同じ画面に並べない
 * - SG・G1・G2 の開催中だけ、節のページへの帯を出す。取得に失敗したら、帯が無いのと区別してエラーを出す
 *
 * 数字は月1回作り直す静的な値なので、期待の文は src/data/venueSummaryStats.js から組む。
 */

const DATE = "2026-09-28";
const n = (x) => x.toLocaleString("en-US");
const r1 = (b) => b.courses[0].rate.toFixed(1);
const nat = `全国（${n(S.national.races)}レース）の${r1(S.national)}%`;

// 会場のレース（Edge API の差し替え）。グレード・節タイトルを指定できる
const edgeData = (venue, { grade = null, title = null } = {}) => ({
  generatedAt: `${DATE}T00:00:00Z`,
  updatedAt: `${DATE}T00:00:00Z`,
  races: Array.from({ length: 12 }, (_, i) => i + 1).map((no) => ({
    raceId: `${DATE}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`,
    venueCode: venue,
    raceNumber: no,
    startTime: "23:00",
    raceGrade: grade,
    raceTitle: title,
    entries: [],
    predictions: {},
    exhibitionData: [],
    result: null,
  })),
});

// 取得のキャッシュ（localStorage）に前の開き方のレースが残らないよう、開くたびに消す
const clearCacheOnLoad = (page) =>
  page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      // 保存できない環境では何もしない
    }
  });

async function openVenue(page, venue, options = {}, path = `/venue/${venue}`) {
  await clearCacheOnLoad(page);
  await page.clock.setFixedTime(new Date(`${DATE}T10:00:00+09:00`));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(venue, options) }),
  );
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".race-card")).toHaveCount(12, { timeout: 20000 });
}

test("24場で要約2行と title が出て、全国と比べる文は差が確かめられた会場だけ（BOA-1189）", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: { generatedAt: null, updatedAt: null, races: [] } }),
  );
  const venueNames = JSON.parse(
    readFileSync(new URL("../src/locales/ja/common.json", import.meta.url), "utf8"),
  ).venues;
  // 24場を1回の読み込みで回る（アプリ内の移動。1場ずつ読み込み直すと CI で時間が足りない）
  await page.goto("/venue/1", { waitUntil: "domcontentloaded" });
  for (let code = 1; code <= 24; code += 1) {
    const v = S.venues[code];
    const name = venueNames[code];
    await page.evaluate((path) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/venue/${code}`);
    await expect(page.locator(".venue-race-list-page h1")).toContainText(name);
    const summary = page.getByTestId("venue-summary-lines");
    await expect(summary).toBeVisible({ timeout: 20000 });
    const head = `${name}の直近1年（${S.to.replaceAll("-", "/")}まで、${n(v.races)}レース）、1コースの1着率は${r1(v)}%`;
    const first = summary.locator("p").first();
    if (v.vsNational.course1 === "higher") {
      await expect(first).toHaveText(`${head}で、${nat}より高い`);
    } else if (v.vsNational.course1 === "lower") {
      await expect(first).toHaveText(`${head}で、${nat}より低い`);
    } else {
      await expect(first).toHaveText(`${head}。${nat}との差ははっきりしない`);
    }
    await expect(summary.locator("p").nth(1)).toContainText(
      "逃げ以外の決まり手の上位3つは",
    );
    await expect(page).toHaveTitle(new RegExp(`^${name}競艇の予想・出走表`));
    // h1 の直下（見出しのヘッダーの次の要素）
    expect(
      await summary.evaluate((el) =>
        el.previousElementSibling?.classList.contains("page-header"),
      ),
    ).toBe(true);
  }
});

test("若松は全国より高い・多摩川は差ははっきりしない、と英語でも出し分ける（BOA-1189）", async ({
  page,
}) => {
  await openVenue(page, 20, {}, "/en/venue/20");
  await expect(page.getByTestId("venue-summary-lines")).toContainText(
    `higher than the national ${r1(S.national)}%`,
  );
  await openVenue(page, 5, {}, "/en/venue/5");
  await expect(page.getByTestId("venue-summary-lines")).toContainText(
    "is not clear",
  );
  await expect(page.getByTestId("venue-summary-lines")).not.toContainText(
    /higher than|lower than/,
  );
});

test("カードは直近1年・進入コース別で、過去90日の枠番別の1着率を並べない（BOA-1189）", async ({
  page,
}) => {
  await openVenue(page, 22);
  const card = page.locator(".venue-characteristics-card");
  await expect(card).toBeVisible();
  // 折りたたまれていたら開く
  const fold = card.locator(".collapsible-section");
  if ((await fold.count()) > 0 && !(await fold.evaluate((el) => el.open))) {
    await fold.locator("summary").first().click();
  }
  await expect(card.locator("h2")).toContainText("直近1年");
  const v = S.venues[22];
  await expect(page.getByTestId("venue-hud-course-1")).toContainText(
    `1コース${r1(v)}%`,
  );
  // 福岡の6コースは1着が30回未満なので回数を添える
  const c6 = v.courses[5];
  expect(c6.wins).toBeLessThan(30);
  await expect(page.getByTestId("venue-hud-course-6")).toContainText(
    `6コース${c6.rate.toFixed(1)}%${n(v.courseRaces)}レース中${c6.wins}回`,
  );
  // 決まり手の表は全レースのうちの割合（逃げも載せる）
  const table = page.getByTestId("venue-technique-table");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(table.locator("tbody tr").first()).toContainText(
    `${v.techniques.nige.rate.toFixed(1)}%`,
  );
  // 脚注の母数は「レース」（「走」と書かない）と期間
  const footnote = card.locator(".venue-characteristics-footnote");
  await expect(footnote).toContainText(`${n(v.races)}レース`);
  await expect(footnote).toContainText(S.from.replaceAll("-", "/"));
  await expect(footnote).not.toContainText("走");
  // 全国の値の母数も脚注に書く
  await expect(footnote).toContainText(`全国の値は同じ期間の${n(S.national.races)}レース`);
  // もっと詳しくの表に1着率の列を出さない（上の直近1年と期間の違う同じ指標になる）
  const details = page.getByTestId("venue-details");
  await details.waitFor({ state: "attached", timeout: 30000 });
  await details.locator("summary").click();
  await expect(details.locator("thead th")).toHaveCount(3);
  await expect(details.locator("thead")).not.toContainText("1着率");
});

test("SG・G1・G2 の開催中だけ節のページへの帯を出す（BOA-1189）", async ({
  page,
}) => {
  await page.route("**/rest/v1/race_series*", (route) =>
    route.fulfill({ json: [{ start_date: "2026-09-25" }] }),
  );
  await openVenue(page, 13, {
    grade: "SG",
    title: "第７３回ボートレースダービー",
  });
  const banner = page.getByTestId("venue-meet-banner");
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(banner).toHaveAttribute("href", "/venue/13/meet/2026-09-25");
  await expect(banner).toContainText("SG 第73回ボートレースダービー 開催中");
  await expect(banner).toContainText("得点率ランキング・勝ち上がり");

  // 英語のページでは言語の接頭辞を付ける
  await openVenue(
    page,
    13,
    { grade: "G2", title: "モーターボート大賞" },
    "/en/venue/13",
  );
  await expect(page.getByTestId("venue-meet-banner")).toHaveAttribute(
    "href",
    "/en/venue/13/meet/2026-09-25",
  );

  // 一般戦・G3 では出さない
  for (const grade of ["ippan", "G3"]) {
    await openVenue(page, 13, { grade, title: "何かの杯" });
    await expect(page.getByTestId("venue-summary-lines")).toBeVisible();
    await expect(page.getByTestId("venue-meet-banner")).toHaveCount(0);
  }
  // 節のページの対象外の節（グランプリ）でも出さない
  await openVenue(page, 13, { grade: "SG", title: "第４１回グランプリ" });
  await expect(page.getByTestId("venue-meet-banner")).toHaveCount(0);
});

test("節の取得に失敗したら、帯が無いのと区別してエラーを出す（BOA-1189）", async ({
  page,
}) => {
  await page.route("**/rest/v1/race_series*", (route) =>
    route.fulfill({ status: 500, json: { message: "boom" } }),
  );
  await openVenue(page, 12, { grade: "G1", title: "高松宮記念" });
  await expect(
    page.getByText("開催中の節のページへの入口を読み込めませんでした。"),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("venue-meet-banner")).toHaveCount(0);
});

for (const width of [375, 768, 1440]) {
  test(`${width}pxで要約・帯・カードが横にはみ出さない（BOA-1189）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/rest/v1/race_series*", (route) =>
      route.fulfill({ json: [{ start_date: "2026-09-25" }] }),
    );
    await openVenue(page, 13, {
      grade: "SG",
      title: "第７３回ボートレースダービー",
    });
    await expect(page.getByTestId("venue-meet-banner")).toBeVisible({
      timeout: 20000,
    });
    const card = page.locator(".venue-characteristics-card");
    const fold = card.locator(".collapsible-section");
    if ((await fold.count()) > 0 && !(await fold.evaluate((el) => el.open))) {
      await fold.locator("summary").first().click();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const sel of [
      '[data-testid="venue-summary-lines"]',
      '[data-testid="venue-meet-banner"]',
      ".venue-characteristics-card",
    ]) {
      const box = await page.locator(sel).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    }
  });
}

test("375pxの英語で、コース名と30回未満の回数がそれぞれの列からはみ出さない（BOA-1189）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  // 福岡は6コースの1着が30回未満（回数の行が出る）
  await openVenue(page, 22, {}, "/en/venue/22");
  const card = page.locator(".venue-characteristics-card");
  const fold = card.locator(".collapsible-section");
  if ((await fold.count()) > 0 && !(await fold.evaluate((el) => el.open))) {
    await fold.locator("summary").first().click();
  }
  await expect(page.locator(".venue-hud-count")).toHaveCount(1);
  const overflows = await page.evaluate(() =>
    [...document.querySelectorAll(".venue-hud-lane, .venue-hud-values > span")]
      .filter((el) => el.scrollWidth > el.parentElement.clientWidth + 0.5 || el.scrollWidth > el.clientWidth + 0.5)
      .map((el) => el.textContent),
  );
  expect(overflows).toEqual([]);
});
