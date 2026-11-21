import { test, expect } from "./fixtures.js";
import { e2eTodayJST } from "./fixtures.js";
import { rewriteTodayRaces, setJstNoon } from "./today-races-rewrite.js";

/**
 * トップの「まもなく締切のレース」の節（PV09 T1・案 B、BOA-1690）。
 *
 * 録画の本日のレースを作った会場に置き換え、時計を JST の正午に固定して、開催日程に左右されずに確かめる。
 * 行の選び方は src/pure/upcomingDeadlineRaces.js（単体の試験は scripts/tests/upcomingDeadlineRaces.test.js）。
 * 見た目の目標は hq の drafts/media/proto-pv09-t1-20261121/（B-375・B-375-open・B-1280・finished-*）。
 */

test.describe.configure({ timeout: 180_000 });

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

const racer1 = (name, rank = "A1") => [
  { waku: 1, name, rank },
  { waku: 2, name: "二号　艇", rank: "B1" },
];

function makeRace(placeCd, raceNo, startTime, extra = {}) {
  return {
    raceNo,
    startTime,
    date: e2eTodayJST(),
    placeCd,
    raceGrade: null,
    raceTitle: null,
    raceStage: null,
    cancellationStatus: null,
    seriesDay: null,
    isFinalDay: null,
    result: null,
    inCaution: null,
    volatility: null,
    racers: racer1("井上　　晴"),
    ...extra,
  };
}

// 正午の時点で締切前の7行（6行だけ出る）と、締切を過ぎた行・中止の行。
// 近い順: 戸田4R 12:08 → 丸亀4R 12:19 → 平和島4R 12:20 → 徳山12R 12:25（優勝戦・注意度 高）→ 桐生5R 12:30 → 大村3R 12:40 →（7行目）若松7R 13:00
function openDay() {
  return [
    {
      place_cd: 2,
      races: [
        makeRace(2, 3, "11:50"),
        makeRace(2, 4, "12:08", {
          raceGrade: "G3",
          inCaution: { pct: 30, level: "mid" },
        }),
      ],
    },
    {
      place_cd: 15,
      races: [makeRace(15, 4, "12:19", { racers: racer1("佐藤　一真") })],
    },
    {
      place_cd: 4,
      races: [
        makeRace(4, 4, "12:20", {
          raceGrade: "G1",
          racers: racer1("伊藤　涼", "B1"),
        }),
      ],
    },
    {
      place_cd: 18,
      races: [
        makeRace(18, 12, "12:25", {
          raceStage: "優勝戦",
          inCaution: { pct: 62, level: "high" },
          racers: racer1("田中　光"),
        }),
      ],
    },
    {
      place_cd: 1,
      races: [
        makeRace(1, 4, "12:28", { cancellationStatus: "confirmed" }),
        makeRace(1, 5, "12:30", { racers: racer1("鈴木　大地", "A2") }),
      ],
    },
    {
      place_cd: 24,
      races: [makeRace(24, 3, "12:40", { racers: racer1("高橋　翔") })],
    },
    { place_cd: 20, races: [makeRace(20, 7, "13:00")] },
  ];
}

// 全レース終了（正午より前の締切だけ）
function finishedDay() {
  return openDay().map((v) => ({
    ...v,
    races: v.races.map((r) => ({ ...r, startTime: "10:00" })),
  }));
}

async function openTop(page, { day = openDay, returning = true, query = "" } = {}) {
  await page.addInitScript((returningVisit) => {
    localStorage.setItem("boatai-language", "ja");
    if (returningVisit) localStorage.setItem("boatai:visited-before", "true");
    else localStorage.removeItem("boatai:visited-before");
  }, returning);
  await setJstNoon(page);
  await rewriteTodayRaces(page, (venues) => {
    venues.splice(0, venues.length, ...day());
  });
  await page.goto(`/${query}`, { waitUntil: "domcontentloaded" });
  // 読み込みの終わり（会場のカードが出る）まで待つ
  await expect(page.locator(".venue-grid-card--open").first()).toBeVisible({
    timeout: 30000,
  });
}

const section = (page) => page.locator("section.upcoming-deadline");
const visibleRows = (page) =>
  section(page).locator(".upcoming-deadline__item:visible");

async function expectNoHorizontalOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe("1280px", () => {
  test.use({ viewport: DESKTOP });

  test("6行を全部見せ、各行がレースへのリンクで、時刻・締切予定・1号艇の選手名を持つ", async ({
    page,
  }) => {
    await openTop(page);
    const rows = visibleRows(page);
    await expect(rows).toHaveCount(6);
    const links = section(page).locator('a[href^="/race/"]:visible');
    await expect(links).toHaveCount(6);
    await expect(links.first()).toHaveAttribute(
      "href",
      `/race/${e2eTodayJST()}-02-04`,
    );
    const names = ["井上 晴", "佐藤 一真", "伊藤 涼", "田中 光", "鈴木 大地", "高橋 翔"];
    for (let i = 0; i < 6; i++) {
      const row = rows.nth(i);
      await expect(row).toContainText("締切予定");
      await expect(row).toContainText(/\d{2}:\d{2}/);
      await expect(row).toContainText(names[i]);
    }
    // 近い順（締切を過ぎた戸田3R・中止の桐生4R・7行目の若松7R は入らない）
    await expect(rows.nth(0)).toContainText("戸田 4R");
    await expect(rows.nth(3)).toContainText("徳山 12R");
    await expect(rows.nth(3)).toContainText("優勝戦");
    await expect(rows.nth(2)).toContainText("G1");
    await expect(section(page)).not.toContainText("若松");
    await expect(section(page).locator(".upcoming-deadline__more")).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("全レース終了なら節が DOM に無い", async ({ page }) => {
    await openTop(page, { day: finishedDay });
    await expect(section(page)).toHaveCount(0);
    await expect(page.locator(".upcoming-deadline")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("注意度の札は段が「高」の行だけ（機能の内部確認の印 ?caution=1 のとき）", async ({
    page,
  }) => {
    await openTop(page, { query: "?caution=1" });
    const badges = section(page).locator(".in-caution-badge");
    await expect(badges).toHaveCount(1);
    await expect(
      visibleRows(page).nth(3).locator(".in-caution-badge--high"),
    ).toHaveCount(1);
  });

  test("節の中に「あと○分」・的中率・回収率・% が無い", async ({ page }) => {
    await openTop(page, { query: "?caution=1" });
    const text = await section(page).innerText();
    for (const word of ["あと", "分", "的中率", "回収率", "%", "競艇"])
      expect(text).not.toContain(word);
  });
});

test.describe("375px", () => {
  test.use({ viewport: MOBILE, isMobile: true, hasTouch: true });

  test("初めは3行と「もっと見る」（隠れた会場の名前つき）。押すと6行になりボタンが消える", async ({
    page,
  }) => {
    await openTop(page);
    await expect(visibleRows(page)).toHaveCount(3);
    const more = section(page).locator("button.upcoming-deadline__more");
    // 隠れた行: 徳山12R（優勝戦）・桐生5R・大村3R。名前は先頭の2会場、残りがあるので「ほか」
    await expect(more).toHaveText("もっと見る（徳山 優勝戦・桐生ほか）");
    await more.click();
    await expect(visibleRows(page)).toHaveCount(6);
    await expect(more).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  for (const returning of [false, true]) {
    const who = returning ? "2回目以降（IntroBanner）" : "初めての人（FirstVisitGuideCard）";
    test(`${who}でも節の1行目が最初の画面に入り、節は案内より前に在る`, async ({
      page,
    }) => {
      await openTop(page, { returning });
      const guide = page.locator(
        returning ? ".intro-banner" : ".first-visit-guide-card",
      );
      await expect(guide).toBeVisible();
      const first = visibleRows(page).first();
      await expect(first).toBeVisible();
      const box = await first.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(MOBILE.height);
      const before = await page.evaluate(
        ([a, b]) => {
          const s = document.querySelector(a);
          const g = document.querySelector(b);
          return Boolean(
            s.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
        },
        [
          "section.upcoming-deadline",
          returning ? ".intro-banner" : ".first-visit-guide-card",
        ],
      );
      expect(before).toBe(true);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("会場のカードの先頭は、節の高さ（3行＋ボタン）の分を超えて下がらない", async ({
    page,
  }) => {
    // 同じページで、節の無い日（全レース終了）を読み直して比べる
    const state = { day: finishedDay };
    await openTop(page, { day: () => state.day() });
    await expect(section(page)).toHaveCount(0);
    const baseTop = (await page.locator(".venue-grid").boundingBox()).y;

    state.day = openDay;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(visibleRows(page)).toHaveCount(3, { timeout: 30000 });
    const sectionBox = await section(page).boundingBox();
    const cardTop = (await page.locator(".venue-grid").boundingBox()).y;
    // 節の下の余白（margin-bottom 1rem = 16px）までは節の高さに含める
    expect(cardTop - baseTop).toBeLessThanOrEqual(sectionBox.height + 16);
  });
});
