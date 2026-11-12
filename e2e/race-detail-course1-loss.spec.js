// 枠別情報タブ「1号艇の1コースでの まくられ・差され」（BOA-1331、spec §1.8）
import { test, expect } from "./fixtures.js";
import { stubRacerScopedRuns, runDates } from "./racer-scoped-stub.js";

const RACE = "/race/2026-09-27-02-11";

function runs({ wins = 0, makurare = 0, sashi = 0, otherCourse = 0 }) {
  const kinds = [
    ...Array(wins).fill({ course: 1, rank1: 1, technique: "逃げ" }),
    ...Array(makurare).fill({ course: 1, rank1: 3, technique: "まくり" }),
    ...Array(sashi).fill({ course: 1, rank1: 2, technique: "差し" }),
    ...Array(otherCourse).fill({ course: 3, rank1: 1, technique: "逃げ" }),
  ];
  const dates = runDates(kinds.length);
  return kinds.map((k, i) => ({ ...k, date: dates[i], venue: 5 }));
}

// 戸田（venue 2）の「1コースが逃げたとき」の2着の分布。本番 DB（e2e-live）や録画の中身に依らず逃げのカードを出す（BOA-1491）
const NIGE_ROWS = [2, 3, 4, 5, 6].map((second, i) => ({
  venue_code: 2,
  second_course: second,
  window_start: "2025-12-02",
  window_end: "2026-11-11",
  window_days: 345,
  total_races: 2110,
  nige_races: 844,
  second_count: [302, 220, 160, 100, 62][i],
  second_rate: [35.78, 26.07, 18.96, 11.85, 7.35][i],
  exacta_rate: [14.31, 10.43, 7.58, 4.74, 2.94][i],
}));

async function stubNigeSimulation(page) {
  await page.route("**/rest/v1/nige_second_by_course?*", (route) =>
    route.fulfill({ json: NIGE_ROWS }),
  );
}

async function open(page, path = RACE, tab = "枠別情報") {
  await page.goto(path);
  await page
    .locator(".race-tabs-btn", { hasText: new RegExp(`^${tab}$`) })
    .click();
  return page.getByTestId("course1-loss");
}

test("1コース34走: まくられ・差されを件数と割合で出し、逃げのカードの直前に置く 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await stubRacerScopedRuns(page, runs({ wins: 25, makurare: 5, sashi: 4 }));
  await stubNigeSimulation(page);
  const card = await open(page);
  await expect(card).toContainText("1号艇の1コースでの まくられ・差され");
  for (const value of [
    "34走中5走",
    "15%",
    "34走中4走",
    "12%",
    "2026/01/05〜2026/02/07",
  ]) {
    await expect(card).toContainText(value);
  }
  await expect(card.locator("[translate=no]")).toBeVisible();
  await expect(card).toContainText("※割合の分母は1コースで走った全ての走です");
  // 直後の兄弟が「1コースが逃げたとき」のカード。逃げのカードは取得（上の stub）の後に非同期で出るので、出るまで待つ
  // （BOA-1491: 待たずに読むと取得の応答の前に兄弟を見て落ちた）
  await expect(card.locator("xpath=following-sibling::*[1]")).toHaveClass(
    /nsc-card/,
  );
  // 6艇の表の期間を切り替えても値は変わらない
  await page.locator(".six-boat-course button", { hasText: /^当地$/ }).click();
  await expect(card).toContainText("34走中5走");
  await expect(card).toContainText("2026/01/05〜2026/02/07");
  // 注記の「上の表」は選んだ期間に合わせる（/code-review の指摘の再現）
  await expect(card).toContainText("この会場だけの成績");
  await expect(card).not.toContainText("上の表は直近3期（公式）");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});

test("1コース18走: 件数だけで割合を出さない", async ({ page }) => {
  await stubRacerScopedRuns(page, runs({ wins: 15, makurare: 2, sashi: 1 }));
  const card = await open(page);
  await expect(card).toContainText("18走中2走");
  await expect(card).toContainText("18走中1走");
  await expect(card).toContainText("30走未満のため割合は出しません");
  await expect(card).not.toContainText("%");
});

test("1コース0走: 走が無いことの1文だけ", async ({ page }) => {
  await stubRacerScopedRuns(page, runs({ otherCourse: 5 }));
  const card = await open(page);
  await expect(card).toContainText("進入1コースで走った走はありません");
  await expect(card).not.toContainText("走中");
  await expect(card).not.toContainText("※割合の分母");
});

test("取得失敗は alert を出し、0走の文に倒さない", async ({ page }) => {
  await stubRacerScopedRuns(page, [], { fail: true });
  const card = await open(page);
  await expect(card.getByRole("alert")).toHaveText(
    "1コースでの まくられ・差され を読み込めませんでした。",
  );
  await expect(card).not.toContainText("走はありません");
  await expect(card).not.toContainText("走中");
});

test("/en/ では選手名のほかに日本語が混ざらない", async ({ page }) => {
  await stubRacerScopedRuns(page, runs({ wins: 25, makurare: 5, sashi: 4 }));
  const card = await open(page, `/en${RACE}`, "Lane Stats");
  await expect(card).toContainText("15%");
  const text = await card.evaluate((el) => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("[translate=no]").forEach((n) => n.remove());
    return clone.textContent;
  });
  expect(text).not.toMatch(/[぀-ヿ一-龯]/);
});
