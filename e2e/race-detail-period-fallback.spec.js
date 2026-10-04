import { test, expect, fetchRecorded } from "./fixtures.js";

/**
 * 期替わり直後（公式の期別成績 fan が公開される前）の「前期」欄の固定。
 *
 * fan は期の終わりから15〜60日遅れて公開される。その間は racer_period_stats に前期の行が1行も無く、
 * 以前は前期欄が全レースで消えていた。いまは前々期を「前々期」と名乗って出し、公開待ちを注記し、
 * 出走表との差は出さない（出走表の値だけ残す）。判定は表全体で行う（basicInfoStats.pickPeriodStats）。
 *
 * 開催日程に左右されないよう、2026-09-29 のレース（前期 = 2026年2期、算出期間 2025-11-01〜2026-04-30）を開き、
 * racer_period_stats の応答から前期の行を抜いて「まだ取り込んでいない」状態を作る。
 */
test.describe.configure({ timeout: 180_000 });

const PERIOD_STATS = /\/rest\/v1\/racer_period_stats/;

async function hidePreviousTerm(page) {
  await page.route(PERIOD_STATS, async (route) => {
    const response = await fetchRecorded(route);
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) return route.fulfill({ response });
    // 前期（2026年2期）の行を抜く。「前期を取り込んだか」の確認（period_year=eq.2026&period_no=eq.2、
    // racer_id だけを返す）は列で見分けられないので、URL で見分けて空にする
    const url = route.request().url();
    const isLatestCheck =
      url.includes("period_year=eq.2026") && url.includes("period_no=eq.2");
    const json = isLatestCheck
      ? []
      : body.filter((r) => !(r.period_year === 2026 && r.period_no === 2));
    // 書き換えた本文と食い違うので、元の長さ・圧縮のヘッダは渡さない
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: response.status(), headers, json });
  });
}

test("前期を取り込む前は、前々期を名乗って出し、公開待ちを注記し、出走表との差は出さない", async ({
  page,
}) => {
  await hidePreviousTerm(page);

  await page.goto("/race/2026-09-29-13-12");
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
  await page.locator(".rbit-bar-row").first().click();
  await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();

  // 見出しは実際の期を名乗る（「前期」と書かない）
  await expect(page.locator(".rbit-period-heading")).toHaveText(
    "前々期（2025-05-01〜2025-10-31・公式の期別成績）",
    { timeout: 25000 },
  );
  const notes = page.locator(".rbit-period-note");
  // 値の行は通常と同じ見た目なので、公開待ちの注記は本文と同じ大きさで出す（ファン評価1周目 P2）
  await expect(notes.first()).toHaveClass(/rbit-period-pending/);
  await expect(notes.first()).toHaveText(
    "※前期（2025-11-01〜2026-04-30）の成績をまだ取り込んでいないため、前々期を表示しています",
  );

  // 出走表の値は残し、差は出さない。差を出さない理由を添える
  const diffs = page.locator(".rbit-period-diff");
  await expect(diffs.first()).toHaveText(/^（出走表・全国 \d+\.\d{2}）$/);
  await expect(diffs.nth(1)).toHaveText(/^（出走表・全国 \d+\.\d%）$/);
  // 注記は「前期を取り込んでいない」という事実だけを書く。「公式の公開待ち」「出走表は前期に近い」は、
  // 期の初め3か月を過ぎたこのレース（2026-09-29）では事実と違う（ファン評価2周目 P2）
  await expect(notes.nth(1)).toHaveText(
    "※前期の成績を取り込むまで、出走表の値との差は出していません",
  );

  // 古い期の値が主役に見えないよう、欄に is-fallback を付けて値を薄くする（ファン評価2周目 P2）
  await expect(page.locator(".rbit-period")).toHaveClass(/is-fallback/);

  // 直近2年は前々期で終わる4期にずらし、その範囲を出す
  await expect(page.locator(".rbit-period-recent")).toHaveText(
    /^前々期までの2年（2023\/11〜2025\/10）優出 \d+回・優勝 \d+回$/,
  );
});

test("期の初め3か月のレースでは、前期との差を出し始める日付を注記する（公開されても差はすぐには出ない）", async ({
  page,
}) => {
  await hidePreviousTerm(page);
  // 2026-05-20: 前期（2026年2期、〜2026-04-30）を取り込んでも、差は 2026-08-01 以降のレースで出す
  await page.goto("/race/2026-05-20-01-12");
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
  await page.locator(".rbit-bar-row").first().click();
  await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
  await expect(page.locator(".rbit-period-heading")).toHaveText(
    "前々期（2025-05-01〜2025-10-31・公式の期別成績）",
    { timeout: 25000 },
  );
  await expect(page.locator(".rbit-period-note").nth(1)).toHaveText(
    "※前期の成績を取り込むまで、出走表の値との差は出していません（前期との差は2026-08-01以降のレースで出します）",
  );
});

test("375pxで、前々期までの2年の回数は1つの塊で折り返す（「回」だけが次の行に落ちない）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await hidePreviousTerm(page);
  await page.goto("/race/2026-05-20-01-12");
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
  await page.locator(".rbit-bar-row").first().click();
  await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
  const counts = page.locator(".rbit-period-recent-counts");
  await expect(counts).toHaveText(/^優出 \d+回・優勝 \d+回$/, {
    timeout: 25000,
  });
  // 1行に収まっている（折り返すと高さが行の高さの2倍近くになる）
  const lines = await counts.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    return el.getBoundingClientRect().height / lh;
  });
  expect(lines).toBeLessThan(1.5);
});
