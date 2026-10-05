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
// 10〜15時の6本。段階は 高: 1R（95）・4R（80）、標準: 3R（60）・5R（40）、本命有利: 2R（20）・6R（5）。
// 1R は3号艇が1着の結果あり。ほかは結果がまだ無い（反映待ち）
const DAY_RACES = [95, 20, 60, 80, 40, 5].map((p, i) => ({
  raceNo: i + 1,
  startTime: `${10 + i}:00`,
  cancellationStatus: null,
  rank1: i === 0 ? 3 : null,
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
    // 締切前は 13時（80・高）・14時（40・標準）・15時（5・本命有利）の3本
    expect(high).toEqual([`/race/${raceIdOf(4)}`]);
    expect(low).toEqual([`/race/${raceIdOf(6)}`]);
    await expect(page.locator(".volatility-highlights__closed")).toHaveCount(0);
    await expect(
      page.locator(".volatility-highlights__closed-note"),
    ).toHaveCount(0);
    // 締切前のレースに結果の行は出さない
    await expect(page.locator(".volatility-highlights__result")).toHaveCount(0);
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
    expect(high).toEqual([1, 4].map((n) => `/race/${raceIdOf(n)}`));
    expect(low).toEqual([6, 2].map((n) => `/race/${raceIdOf(n)}`));
    await expect(page.locator(".volatility-highlights__closed")).toHaveCount(4);
    await expect(page.locator(".volatility-highlights__closed").first()).toHaveText(
      "締切",
    );
    await expect(
      page.locator(".volatility-highlights__closed-note"),
    ).toContainText("振り返りとして表示しています");
    // 振り返りとして結果も出す。予測（コース）と混ざらないよう「結果: N号艇が1着」の形
    const results = page.locator(".volatility-highlights__result");
    await expect(results).toHaveCount(4);
    await expect(
      page.locator(`a[href="/race/${raceIdOf(1)}"] .volatility-highlights__result`),
    ).toHaveText("結果: 3号艇が1着");
    await expect(
      page.locator(`a[href="/race/${raceIdOf(2)}"] .volatility-highlights__result`),
    ).toHaveText("結果: 反映待ち");
  });

  // 夕方の残り数本の中で上位・下位を切ると、崩れやすさ28〜33の「標準」が「イン崩れ注意（高）」に
  // 入った（PR #1248 ファン評価1周目）。列にはレース詳細と同じ段階のレースだけを入れる
  test("13:30: 締切前の「標準」（14時・40）は「イン崩れ注意（高）」に入れない", async ({
    page,
  }) => {
    await setup(page, {
      edge: true,
      races: DAY_RACES,
      now: "2026-09-29T13:30:00+09:00",
    });
    await page.goto("/");
    const columns = await readHighlights(page);
    expect(columns).toEqual([[], [`/race/${raceIdOf(6)}`]]);
    // 列は消さず、該当なしと書く（PR #1248 ファン評価2周目。列ごと消えると読み込めていないのと区別できなかった）
    await expect(page.locator(".volatility-highlights__empty")).toHaveText(
      "締切前のレースに、崩れやすさ70以上のレースはありません。",
    );
  });

  // 締切前に残ったレースが「標準」だけになると、節ごと消えていた（PR #1248 ファン評価2周目。20:38〜20:44）
  test("締切前が「標準」だけでも節を出し、両方の列に該当なしと書く", async ({
    page,
  }) => {
    const races = [
      { raceNo: 1, startTime: "10:00", cancellationStatus: null, rank1: 1, percentile: 0.95 },
      { raceNo: 2, startTime: "15:00", cancellationStatus: null, rank1: null, percentile: 0.45 },
    ];
    await setup(page, {
      edge: true,
      races,
      now: "2026-09-29T12:00:00+09:00",
    });
    await page.goto("/");
    const columns = await readHighlights(page);
    expect(columns).toEqual([[], []]);
    await expect(page.locator(".volatility-highlights__empty")).toHaveText([
      "締切前のレースに、崩れやすさ70以上のレースはありません。",
      "締切前のレースに、崩れやすさ30以下のレースはありません。",
    ]);
  });

  // 締切前が1本だけになると、まだ買えるその1本が一覧から消えていた（PR #1248 ファン評価1周目）
  test("14:30: 締切前が1本だけでも、そのレースを出す（締切の札・注記は出さない）", async ({
    page,
  }) => {
    await setup(page, {
      edge: true,
      races: DAY_RACES,
      now: "2026-09-29T14:30:00+09:00",
    });
    await page.goto("/");
    const columns = await readHighlights(page);
    expect(columns).toEqual([[], [`/race/${raceIdOf(6)}`]]);
    await expect(page.locator(".volatility-highlights__closed")).toHaveCount(0);
    await expect(
      page.locator(".volatility-highlights__closed-note"),
    ).toHaveCount(0);
  });

  // 展開予測の2行目（「1着予想: 1号艇」→「最有力の展開: ① 逃げ」）は、ほぼ全レースが逃げで見分けに使えず、
  // 「イン崩れ注意（高）」の列で逃げが最有力と言っているように見えた（PR #1248 ファン評価1・2周目）。
  // ユーザー判断で外した。データに展開予測があっても出さない
  test("展開予測（1着予想・最有力の展開）は出さない", async ({ page }) => {
    const races = DAY_RACES.map((r) => ({
      ...r,
      turnPrediction: { winnerCourse: 1, technique: "nige", probability: 0.38 },
    }));
    await setup(page, { edge: true, races });
    await page.goto("/");
    await readHighlights(page);
    const section = page.locator(".volatility-highlights");
    await expect(section).not.toContainText("最有力の展開");
    await expect(section).not.toContainText("1着予想");
    await expect(section).not.toContainText("逃げ");
  });
});
