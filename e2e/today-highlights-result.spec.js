import { test, expect } from "./fixtures.js";

/**
 * ホームの注目レース（本日のイン崩れ注意度ハイライト）で、結果（rank1）のあるレースは
 * cancellation_status='confirmed' が残っていても中止扱いしない（BOA-542）。
 *
 * BOA-525 で画面の中止判定を「confirmed かつ 結果が無い」に変えたが、ホームのデータ
 * （get_today_races と、その代わりに使う races の直接クエリ）が結果を返さず、
 * confirmed だけで一覧から外れていた（BOA-512: 2026-09-12 に結果のある32本が confirmed のまま）。
 *
 * 経路は2つ。どちらも result を {rank1} / null で返す。
 * - Edge API（/api/races/today → get_today_races。110 適用後の形）
 * - 直接クエリ（Edge API が失敗したとき。races に race_results(rank1) を埋め込む）
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
function edgeTodayResponse() {
  return {
    success: true,
    scrapedAt: new Date().toISOString(),
    data: [
      {
        place_cd: VENUE_CODE,
        place_name: "桐生",
        races: RACES.map((r) => ({
          raceNo: r.raceNo,
          startTime: `1${r.raceNo}:00`,
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
          turnPrediction: null,
          racers: [],
        })),
      },
    ],
  };
}

/** races の直接クエリの応答（race_results は1対1の埋め込みでオブジェクト） */
function directRacesRows() {
  return RACES.map((r) => ({
    race_id: raceIdOf(r.raceNo),
    race_date: DATE,
    venue_code: VENUE_CODE,
    race_number: r.raceNo,
    start_time: `1${r.raceNo}:00:00`,
    race_grade: null,
    cancellation_status: r.cancellationStatus,
    race_conditions: null,
    race_results: r.rank1 != null ? { rank1: r.rank1 } : null,
    race_entries: [],
  }));
}

function directPredictionRows() {
  return RACES.map((r) => ({
    race_id: raceIdOf(r.raceNo),
    feature_contributions: {
      volatilityPercentile: r.percentile,
      volatilityPercentileIsFallback: false,
    },
  }));
}

async function setup(page, { edge }) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route("**/api/races/today**", (route) =>
    edge
      ? route.fulfill({ json: edgeTodayResponse() })
      : route.fulfill({ status: 500, json: { success: false } }),
  );
  await page.route("**/rest/v1/races?**", (route) =>
    route.request().url().includes("race_entries")
      ? route.fulfill({ status: 200, json: directRacesRows() })
      : route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/rest/v1/predictions?**", (route) =>
    route.fulfill({ status: 200, json: directPredictionRows() }),
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
      : "直接クエリ（Edge API 失敗時）";
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
