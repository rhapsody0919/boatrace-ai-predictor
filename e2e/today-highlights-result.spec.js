import { test, expect } from "./fixtures.js";

/**
 * ホームの注目レース（本日のイン崩れ注意度ハイライト）で、結果（rank1）のあるレースは
 * cancellation_status='confirmed' が残っていても中止扱いしない（BOA-542）。
 *
 * BOA-525 で画面の中止判定を「confirmed かつ 結果が無い」に変えたが、ホームのデータ
 * （get_today_races と、その代わりに使う races の直接クエリ）が結果を返さず、
 * confirmed だけで一覧から外れていた（BOA-512: 2026-09-12 に結果のある32本が confirmed のまま）。
 *
 * 経路は2つ。どちらも同じ RPC（get_today_races。110 適用後の形）の出力を、同じ整形で使う（BOA-668）。
 * - Edge API（/api/races/today → get_today_races）
 * - Edge API が失敗したとき、get_today_races を Supabase へ直接呼ぶ（以前は races への別実装の直接クエリ）
 *
 * DBの中身に依存しないよう、Edge API と Supabase REST を差し替える。
 */

// 4本。注目レースは min(5, floor(対象本数/2)) 本ずつ出る。
// 修正前は「結果あり」が外れて対象2本（通常A・通常B）→ 上位は通常A。
// 修正後は対象3本 → 上位は「結果あり」、下位は通常B。「結果なし」はどちらでも外れる
const RACES = [
  // 結果あり（confirmed が誤って残った）
  { raceNo: 1, cancellationStatus: "confirmed", rank1: 3, percentile: 0.95 },
  // 結果なし（本当の中止）
  { raceNo: 2, cancellationStatus: "confirmed", rank1: null, percentile: 0.9 },
  // 通常A
  { raceNo: 3, cancellationStatus: null, rank1: null, percentile: 0.5 },
  // 通常B
  { raceNo: 4, cancellationStatus: null, rank1: null, percentile: 0.1 },
];

const VENUE_CODE = 1; // 桐生
// 画面は日付で絞らないため、応答の日付は固定でよい
const DATE = "2026-09-29";

const raceIdOf = (raceNo) =>
  `${DATE}-${String(VENUE_CODE).padStart(2, "0")}-${String(raceNo).padStart(2, "0")}`;

/** get_today_races（110 適用後）の形 */
function edgeTodayResponse(races = RACES) {
  return {
    success: true,
    scrapedAt: new Date().toISOString(),
    data: [
      {
        place_cd: VENUE_CODE,
        place_name: "桐生",
        races: races.map((r) => ({
          raceNo: r.raceNo,
          startTime: r.startTime ?? `1${r.raceNo}:00`,
          date: DATE,
          placeCd: VENUE_CODE,
          raceGrade: null,
          cancellationStatus: r.cancellationStatus,
          seriesDay: null,
          isFinalDay: null,
          raceTitle: null,
          raceStage: null,
          result: r.rank1 != null ? { rank1: r.rank1 } : null,
          volatility: {
            percentile: r.percentile,
            isFallback: false,
            level: "standard",
          },
          turnPrediction: r.turnPrediction ?? null,
          racers: [],
        })),
      },
    ],
  };
}

// 締切前のレースだけから選ぶ（BOA-757）ので、締切を過ぎたかは今の時刻で決まる。録画の時刻に
// 左右されないよう、時刻をテストで決める。既定は全レースの締切前（09:00）
async function setup(
  page,
  { edge, races = RACES, now = "2026-09-29T09:00:00+09:00" },
) {
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route("**/api/races/today**", (route) =>
    edge
      ? route.fulfill({ json: edgeTodayResponse(races) })
      : route.fulfill({ status: 500, json: { success: false } }),
  );
  await page.route("**/rest/v1/rpc/get_today_races*", (route) =>
    route.fulfill({ status: 200, json: edgeTodayResponse(races) }),
  );
}

async function readHighlights(page) {
  const section = page.locator(".volatility-highlights");
  await expect(section).toBeVisible({ timeout: 20000 });
  return section
    .locator(".volatility-highlights__column")
    .evaluateAll((columns) =>
      columns.map((col) =>
        [...col.querySelectorAll("a")].map((a) => a.getAttribute("href")),
      ),
    );
}

test.describe("ホームの注目レース: 結果のあるレースは中止扱いしない（BOA-542）", () => {
  for (const edge of [true, false]) {
    const path = edge
      ? "Edge API（get_today_races）"
      : "RPC の直接呼び出し（Edge API 失敗時）";
    test(`${path}: confirmed でも結果があれば一覧に出し、結果の無い confirmed は外す`, async ({
      page,
    }) => {
      await setup(page, { edge });
      await page.goto("/");
      const [high, low] = await readHighlights(page);
      expect(high).toEqual([`/race/${raceIdOf(1)}`]);
      expect(low).toEqual([`/race/${raceIdOf(4)}`]);
      expect([...high, ...low]).not.toContain(`/race/${raceIdOf(2)}`);
    });
  }
});

// BOA-711 U4（2026-10-03 ユーザー判断）: 「95%」は確率に読まれたので、レース詳細の比較バーと同じく
// 「95 / 100」（0〜100 の物差し）で出す。崩れやすい側の見出しのアイコンはカードと同じ 🌪️
test("ホームの注目レース: 崩れやすさは「/ 100」で出し、% を付けない。見出しは 🌪️（BOA-711）", async ({
  page,
}) => {
  await setup(page, { edge: true });
  await page.goto("/");
  await readHighlights(page);
  const values = await page
    .locator(".volatility-highlights__percentile")
    .allInnerTexts();
  expect(values.length).toBeGreaterThan(0);
  for (const v of values) {
    expect(v).toMatch(/^\d+\s*\/ 100$/);
  }
  await expect(page.locator(".volatility-highlights")).toContainText("🌪️");
  await expect(page.locator(".volatility-highlights")).not.toContainText("⚠️");
  // 数字が確率に読まれないよう、物差しの意味を書く。すぐ下の「イン崩れ注意（高）」と食い違わないよう、
  // 「確率ではない」とは書かず順位だと書く（ファン評価1・2周目）
  await expect(
    page.locator(".volatility-highlights__scale-note"),
  ).toContainText("100が最も崩れやすい");
});

// BOA-757: 締切を過ぎたレースが締切前と区別なく並び、これから見るレースを選ぶ導線にならなかった。
// 締切前のレースが2本以上あれば締切前だけから選び、残っていなければ締切済みから選んで札と注記を付ける
const DAY_RACES = [95, 80, 60, 40, 20, 5].map((p, i) => ({
  raceNo: i + 1,
  startTime: `${10 + i}:00`,
  cancellationStatus: null,
  rank1: null,
  percentile: p / 100,
}));

test.describe("ホームの注目レース: 締切前のレースから選ぶ（BOA-757）", () => {
  test("12:30: 締切済み（10〜12時）は選ばず、締切の札も注記も出ない", async ({
    page,
  }) => {
    await setup(page, {
      edge: true,
      races: DAY_RACES,
      now: "2026-09-29T12:30:00+09:00",
    });
    await page.goto("/");
    const [high, low] = await readHighlights(page);
    // 締切前は 13・14・15時の3本 → 上位・下位1本ずつ
    expect(high).toEqual([`/race/${raceIdOf(4)}`]);
    expect(low).toEqual([`/race/${raceIdOf(6)}`]);
    await expect(page.locator(".volatility-highlights__closed")).toHaveCount(0);
    await expect(
      page.locator(".volatility-highlights__closed-note"),
    ).toHaveCount(0);
  });

  test("16:00: 全レースが締切済みなら締切済みから選び、札と注記を付ける", async ({
    page,
  }) => {
    await setup(page, {
      edge: true,
      races: DAY_RACES,
      now: "2026-09-29T16:00:00+09:00",
    });
    await page.goto("/");
    const [high, low] = await readHighlights(page);
    expect(high).toEqual([1, 2, 3].map((n) => `/race/${raceIdOf(n)}`));
    expect(low).toEqual([6, 5, 4].map((n) => `/race/${raceIdOf(n)}`));
    await expect(page.locator(".volatility-highlights__closed")).toHaveCount(6);
    await expect(page.locator(".volatility-highlights__closed").first()).toHaveText(
      "締切",
    );
    await expect(
      page.locator(".volatility-highlights__closed-note"),
    ).toContainText("締切済みのレースから選んでいます");
  });

  // 「崩れやすさ100」と「1着予想: 1号艇」が並び矛盾して見えた。最有力の1パターンで、値はコース番号
  test("2行目は「最有力の展開: 1コース逃げ 38%」（1着予想・号艇とは書かない）", async ({
    page,
  }) => {
    const races = DAY_RACES.map((r) => ({
      ...r,
      turnPrediction: { winnerCourse: 1, technique: "nige", probability: 0.38 },
    }));
    await setup(page, { edge: true, races });
    await page.goto("/");
    await readHighlights(page);
    const turn = page.locator(".volatility-highlights__turn").first();
    await expect(turn).toHaveText("最有力の展開: 1コース逃げ 38%");
    await expect(page.locator(".volatility-highlights")).not.toContainText(
      "1着予想",
    );
  });
});
