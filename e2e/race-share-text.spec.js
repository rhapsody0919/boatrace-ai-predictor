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

/**
 * @param {string} lang
 * @param {number} [variant] - 通常の予想文面（5種）のどれを出すか（0〜4）。
 *   指定時は Math.random を固定値に差し替える（文面の選択は Math.random で決まる）
 */
async function setup(page, lang, variant) {
  await page.addInitScript(
    ({ l, v }) => {
      localStorage.setItem("boatai-language", l);
      window.__sharedUrls = [];
      window.open = (url) => {
        window.__sharedUrls.push(String(url));
        return null;
      };
      if (v != null) Math.random = () => (v + 0.5) / 5;
    },
    { l: lang, v: variant },
  );
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

/** X ボタンを押し、intent URL の text を返す */
async function shareTextOnX(page, path) {
  return (await shareOnX(page, path)).text;
}

/** X ボタンを押し、intent URL の text と hashtags を返す */
async function shareOnX(page, path) {
  await page.goto(path);
  const xButton = page
    .locator(".social-share-wrapper .social-share-button")
    .first();
  await expect(xButton).toBeVisible({ timeout: 20000 });
  await xButton.click();
  const url = await page.waitForFunction(() => window.__sharedUrls[0]);
  const shared = new URL(await url.jsonValue());
  expect(shared.hostname).toBe("twitter.com");
  return {
    text: shared.searchParams.get("text"),
    hashtags: (shared.searchParams.get("hashtags") || "").split(","),
    url: shared.searchParams.get("url"),
  };
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

// 日本語の通常文面（5種）。i18n 化の前に share.js に直書きしていた文面と一字一句同じであることを確かめる
const JA_HEAD =
  "🏁 龍神レーダー予想【09/22 津2R】\n\nモデル: AI予想\n本命: 1号艇\n推奨: 1-2\n\n";
const JA_BODIES = [
  "展開予測から分析した結果、この並びが来そう！\nデータ的にも期待できるかも👀",
  "1マーク展開予測とモーター性能を分析した結果、\nこの組み合わせに注目してます📊",
  "無料でここまで精度の高い予想が見られるのは嬉しい✨\n今日も当たりますように！",
  "展開予測から見て、この予想は信頼できそう！\n皆さんはどう思いますか？🤔",
  "最近的中率が上がってきてて嬉しい😊\nAIの予想、参考にしてみてください！",
];

// 各言語の通常文面に必ず入る部分（見出し・モデル名・本命）
const LOCALIZED = [
  {
    lang: "en",
    prefix: "/en",
    expected: [
      "Ryujin Radar Prediction",
      "Model: AI Prediction",
      "Top pick: Boat 1",
      "Picks: 1-2",
    ],
  },
  {
    lang: "zh-TW",
    prefix: "/zh-TW",
    expected: ["龍神雷達預測", "模型：AI預測", "首選：1號艇", "推薦：1-2"],
  },
  {
    lang: "ko",
    prefix: "/ko",
    expected: [
      "용신 레이더 예상",
      "모델: AI 예상",
      "본명: 1번 보트",
      "추천: 1-2",
    ],
  },
];

// ひらがな・カタカナ（日本語の文面が混ざっていないかの判定。漢字は zh-TW と共通なので見ない）
const KANA = /[\u3040-\u30ff]/;

test.describe("レース詳細のSNSシェア文面（言語・ハッシュタグ）", () => {
  for (let v = 0; v < 5; v++) {
    test(`日本語: 通常の文面${v + 1}が従来どおり`, async ({ page }) => {
      await setup(page, "ja", v);
      const { text, hashtags } = await shareOnX(page, `/race/${DATE}-09-02`);
      expect(text).toBe(JA_HEAD + JA_BODIES[v]);
      expect(hashtags).toEqual(["ボートレース", "AI予想", "龍神レーダー"]);
    });
  }

  for (const { lang, prefix, expected } of LOCALIZED) {
    test(`${lang}: 通常の文面5種が各言語で出て、日本語が混ざらない`, async ({
      page,
    }) => {
      const texts = [];
      for (let v = 0; v < 5; v++) {
        await setup(page, lang, v);
        texts.push(await shareTextOnX(page, `${prefix}/race/${DATE}-09-02`));
      }
      for (const text of texts) {
        expect(text).not.toMatch(KANA);
        for (const part of expected) expect(text).toContain(part);
      }
      // 5種とも別の文面になっている（どれかが欠けて同じキーに落ちていない）
      expect(new Set(texts).size).toBe(5);
    });
  }

  for (const { lang, prefix } of [{ lang: "ja", prefix: "" }, ...LOCALIZED]) {
    test(`${lang}: 中止のレースでは「#AI予想」のタグを付けない`, async ({
      page,
    }) => {
      await setup(page, lang);
      const { hashtags } = await shareOnX(page, `${prefix}/race/${DATE}-09-01`);
      expect(hashtags).toEqual(["ボートレース", "龍神レーダー"]);
    });
  }
});

// BOA-691: 共有する URL は今見ているレース（以前はどのページでもトップ固定で、
// 受け取った人がそのレースに戻れなかった）。言語・選んだタブ・艇（BOA-493）も含める
test.describe("シェアボタンの共有 URL（BOA-691）", () => {
  test("レース詳細から共有すると、そのレースの URL を送る", async ({
    page,
  }) => {
    await setup(page, "ja");
    const { url } = await shareOnX(page, `/race/${DATE}-09-02`);
    expect(url).toBe(`https://www.boat-ai.jp/race/${DATE}-09-02`);
  });

  test("言語・タブ・艇を選んだ状態のまま共有する", async ({ page }) => {
    await setup(page, "en");
    const { url } = await shareOnX(
      page,
      `/en/race/${DATE}-09-02?tab=meet&boat=3`,
    );
    expect(url).toBe(
      `https://www.boat-ai.jp/en/race/${DATE}-09-02?tab=meet&boat=3`,
    );
  });

  test("レース詳細は og:url を持たない（Facebook 等がトップとして扱わないように）", async ({
    page,
  }) => {
    await setup(page, "ja");
    await page.goto(`/race/${DATE}-09-02`);
    await expect(
      page.locator(".social-share-wrapper .social-share-button").first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  });

  test("記事ページは記事の og:url を持ち、離れると消える（useSocialMeta）", async ({
    page,
  }) => {
    await page.goto("/blog/odds-expected-value-guide");
    const ogUrl = page.locator('meta[property="og:url"]');
    await expect(ogUrl).toHaveCount(1, { timeout: 30000 });
    await expect(ogUrl).toHaveAttribute(
      "content",
      "https://www.boat-ai.jp/blog/odds-expected-value-guide",
    );
    // 一覧へ戻ると記事の og:url は消え、一覧の URL の1件だけになる（重複しない）
    await page.locator('a[href="/blog"]').first().click();
    await expect(page).toHaveURL(/\/blog$/);
    await expect(ogUrl).toHaveCount(1);
    await expect(ogUrl).toHaveAttribute(
      "content",
      "https://www.boat-ai.jp/blog",
    );
  });
});
