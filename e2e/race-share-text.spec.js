import { test, expect } from "./fixtures.js";

/**
 * レース詳細のSNSシェア（X）の文面を、中止・予想なしのレースに合わせる。
 *
 * 中止確定（isRaceCancelled）でも race_entries と predictions が残っていると
 * 「龍神レーダー予想 本命: X号艇」の文面でシェアでき、予想の無いレースでは
 * 「本命: ?号艇」になっていた（BOA-424 の範囲外として見つけた件）。
 *
 * react-share の X ボタンは href を持たず window.open で intent URL を開くので、
 * window.open を差し替えて開こうとした URL を読む。
 * DBに依存しないよう Edge API と Supabase REST を差し替える（race-cancelled-ai.spec.js と同じ）。
 */

const DATE = "2026-09-22";
const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
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
}));
const unified = {
  topPick: 1,
  top3: [1, 2, 3],
  confidence: 50,
  volatilityPercentile: 0.85,
  volatilityPercentileIsFallback: false,
  turnPrediction: {
    patterns: [{ technique: "逃げ", winnerCourse: 1, probability: 0.6 }],
  },
};
const race = (n, cancellationStatus, predictions) => ({
  raceId: `${DATE}-09-${String(n).padStart(2, "0")}`,
  venueCode: 9,
  venue: "津",
  raceNumber: n,
  startTime: "23:50",
  cancellationStatus,
  entries,
  predictions,
  exhibitionData: [],
  result: null,
});
const edgeData = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  races: [
    // 1R: 中止確定・結果なし・選手と予想は残っている
    race(1, "confirmed", { unified }),
    // 2R: 通常の未確定レース
    race(2, null, { unified }),
    // 3R: 中止ではないが予想データが無い
    race(3, null, {}),
  ],
};

async function setup(page, lang) {
  await page.addInitScript((l) => {
    localStorage.setItem("boatai-language", l);
    window.__sharedUrls = [];
    window.open = (url) => {
      window.__sharedUrls.push(String(url));
      return null;
    };
  }, lang);
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

/** X ボタンを押し、intent URL の text を返す */
async function shareTextOnX(page, path) {
  await page.goto(path);
  const xButton = page
    .locator(".social-share-wrapper .social-share-button")
    .first();
  await expect(xButton).toBeVisible({ timeout: 20000 });
  await xButton.click();
  const url = await page.waitForFunction(() => window.__sharedUrls[0]);
  const shared = new URL(await url.jsonValue());
  expect(shared.hostname).toBe("twitter.com");
  return shared.searchParams.get("text");
}

test.describe("レース詳細のSNSシェア文面（中止・予想なし）", () => {
  test("通常のレース: 従来どおり本命・推奨を含む予想の文面", async ({
    page,
  }) => {
    await setup(page, "ja");
    const text = await shareTextOnX(page, `/race/${DATE}-09-02`);
    expect(text).toContain("龍神レーダー予想");
    expect(text).toContain("津2R");
    expect(text).toContain("本命: 1号艇");
    expect(text).toContain("推奨: 1-");
  });

  test("中止確定のレース: 中止の文面で、本命を含まない", async ({ page }) => {
    await setup(page, "ja");
    const text = await shareTextOnX(page, `/race/${DATE}-09-01`);
    expect(text).toContain("このレースは中止になりました");
    expect(text).toContain("09/22 津1R");
    expect(text).not.toContain("本命");
    expect(text).not.toContain("推奨");
    expect(text).not.toContain("龍神レーダー予想");
  });

  test("予想データの無いレース: 「?号艇」を出さず、本命・推奨を省く", async ({
    page,
  }) => {
    await setup(page, "ja");
    const text = await shareTextOnX(page, `/race/${DATE}-09-03`);
    expect(text).toContain("09/22 津3R");
    expect(text).not.toContain("?号艇");
    expect(text).not.toContain("?-?-?");
    expect(text).not.toContain("本命");
    expect(text).not.toContain("推奨");
  });

  test("英語: 中止の文面が翻訳される", async ({ page }) => {
    await setup(page, "en");
    const text = await shareTextOnX(page, `/en/race/${DATE}-09-01`);
    expect(text).toContain("This race has been cancelled");
    expect(text).not.toContain("本命");
    expect(text).not.toContain("中止");
  });
});
