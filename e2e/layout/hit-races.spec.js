import { test, expect, e2eTodayJST, fetchRecorded } from "../fixtures.js";
import { gotoAndSettle, inspectGrids, expectNoWastedGrids } from "./helpers.js";

/**
 * BOA-527 の再現テスト。
 *
 * `/hit-races` のカード（`.race-cards-grid`）は `repeat(auto-fill, minmax(280px, 1fr))`
 * で並んでいた。`auto-fill` はカードが足りなくても列の枠を作るため、当日の的中が
 * 列数より少ない日だけ右側に空の列が残り（1920px: 6列にカード5枚で右307px）、
 * 上の PAGES の検査が本番データの巡り合わせで落ちていた。
 *
 * 件数を固定して検査するため、「今日」の予想データの応答を生成済みの過去日
 * （HIT_RACES_FIXED_DATE）の行に差し替え、そのうち展開予測が的中したレースを
 * 先頭から `hits` 件だけ残す（検査するのは既定の「今日」タブのグリッド）。
 *
 * 的中の判定は HitRaces.jsx の extractHitRaces と同じ
 * （unified の turnPrediction のパターンに、実際の1着コースが含まれる）。
 * getPredictions はまず Edge API（`/api/predictions/{date}`。dev では vite.config.js が
 * 本番へ転送する）を読み、空・失敗なら Supabase の races への直接クエリに落ちる。
 * どちらの経路でも「今日」が固定日の的中だけになるよう、両方を差し替える。
 */
const HIT_RACES_FIXED_DATE = "2026-09-22";

/** 展開予測の的中か（HitRaces.jsx の extractHitRaces と同じ判定） */
function isTurnPredictionHit(turn, rank1) {
  if (!turn || !rank1) return false;
  return (turn.patterns || [turn]).some((p) => p.winnerCourse === rank1);
}

/** Edge API の races 要素 */
function isEdgeRaceHit(race) {
  return isTurnPredictionHit(
    race.predictions?.unified?.turnPrediction,
    race.result?.rank1,
  );
}

/** Supabase races 直接クエリの行 */
function isSupabaseRowHit(row) {
  const unified = (row.predictions || []).find((p) => p.model_id === "unified");
  const result = Array.isArray(row.race_results)
    ? row.race_results[0]
    : row.race_results;
  return isTurnPredictionHit(
    unified?.feature_contributions?.turnPrediction,
    result?.rank1,
  );
}

/**
 * 「今日」の予想データ応答を、固定日の的中レース先頭 `hits` 件（"all" なら全件）に
 * 差し替える。当日以外の日付はそのまま通す（「今日」タブのグリッドには影響しない）。
 * 返り値の `available` に固定日の的中件数が入る（ケースを作れたかの確認用）
 */
async function serveFixedHitRaces(page, hits) {
  // ブラウザの時計は録画時刻に固定されている（e2e/fixtures.js）。Node 側の「今日」も揃える
  const todayJst = e2eTodayJST();
  const state = { available: null };
  const pick = (hitRows) => {
    state.available = hitRows.length;
    return hits === "all" ? hitRows : hitRows.slice(0, hits);
  };

  await page.route(`**/api/predictions/${todayJst}*`, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = `/api/predictions/${HIT_RACES_FIXED_DATE}`;
    // route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
    const response = await fetchRecorded(route, { url: url.toString() });
    const body = await response.json();
    const races = pick((body.races || []).filter(isEdgeRaceHit));
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: { ...body, races },
    });
  });

  await page.route(/\/rest\/v1\/races\?.*race_date=eq\./, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("race_date") !== `eq.${todayJst}`) {
      await route.fallback();
      return;
    }
    url.searchParams.set("race_date", `eq.${HIT_RACES_FIXED_DATE}`);
    const response = await fetchRecorded(route, { url: url.toString() });
    const rows = await response.json();
    const kept = pick(
      (Array.isArray(rows) ? rows : []).filter(isSupabaseRowHit),
    );
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: kept,
    });
  });
  return state;
}

test.describe("レイアウト: /hit-races は的中が列数より少なくても幅を余らせない（BOA-527）", () => {
  // 1〜3件は、1440px（4列）・1920px（6列）の列数を下回る側。
  // "all" は列数以上（固定日の的中全件。表示は先頭8件に絞られる）
  for (const hits of [1, 2, 3, "all"]) {
    const label = hits === "all" ? "多数" : `${hits}件`;
    test(`的中が${label}のとき空トラックが出ない`, async ({ page }) => {
      const state = await serveFixedHitRaces(page, hits);
      await gotoAndSettle(page, "/hit-races");

      const grid = page.locator(".hit-races-section .race-cards-grid");
      await expect(
        grid,
        `.race-cards-grid が描画されていません（${HIT_RACES_FIXED_DATE} への差し替えが効いていない可能性）`,
      ).toBeVisible({ timeout: 30000 });

      // 固定日の的中が足りない・差し替えが効かず本番の当日データのまま検査する、
      // という空振りを防ぐ
      expect(
        state.available,
        `${HIT_RACES_FIXED_DATE} の的中が足りず、${label}のケースを作れません`,
      ).toBeGreaterThanOrEqual(hits === "all" ? 9 : hits);
      await expect(grid.locator(":scope > *")).toHaveCount(
        hits === "all" ? 8 : hits,
      );

      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});

/**
 * BOA-754 の再現テスト。/hit-races の期間タブ（今日・昨日・全期間（14日間））が
 * 375px で2段に割れ、「全期間」がタブに見えなかった。どの幅でも1段に並び、はみ出さないこと
 */
test.describe("レイアウト: /hit-races の期間タブは1段に並ぶ（BOA-754）", () => {
  test("期間タブの3つが同じ行にあり、枠からはみ出さない", async ({ page }) => {
    await serveFixedHitRaces(page, "all");
    await gotoAndSettle(page, "/hit-races");
    const selector = page.locator(".period-selector");
    await expect(selector).toBeVisible({ timeout: 30000 });
    const state = await selector.evaluate((el) => {
      const buttons = [...el.querySelectorAll("button")];
      const box = el.getBoundingClientRect();
      return {
        count: buttons.length,
        tops: [
          ...new Set(
            buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
          ),
        ],
        overflowRight: Math.max(
          ...buttons.map((b) => b.getBoundingClientRect().right - box.right),
        ),
      };
    });
    expect(state.count).toBe(3);
    expect(state.tops, "期間タブが2段に割れている").toHaveLength(1);
    expect(state.overflowRight).toBeLessThanOrEqual(1);
  });
});
