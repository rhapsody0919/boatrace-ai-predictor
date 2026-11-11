// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, e2eTodayJST, fetchRecorded } from "../fixtures.js";
import { HIT_RACES_FIXED_DATE } from "../layout/helpers.js";

/**
 * 分析ツールが読む「今日」の races（開催会場・本日のレース・好調/不調ランキングの出走表）を、
 * 生成済みの固定の過去日に向け直す。0:00〜7:00 JST は当日の行が無く、表が出ない（BOA-1458）。
 * ほかの日付の要求はそのまま通す。route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
 */
async function serveFixedTodaysRaces(page) {
  const todayJst = e2eTodayJST();
  await page.route(/\/rest\/v1\/races\?.*race_date=eq\./, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("race_date") !== `eq.${todayJst}`) {
      await route.fallback();
      return;
    }
    url.searchParams.set("race_date", `eq.${HIT_RACES_FIXED_DATE}`);
    const response = await fetchRecorded(route, { url: url.toString() });
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });
}

test.describe("言語切替 (回帰: 対応外言語クリックでホームに飛ばされない)", () => {
  test("/en/venues で対応外言語(日本語)ボタンは無効化され、クリックしても遷移しない", async ({
    page,
  }) => {
    // 会場ガイドはja非対応（en/zh-TW/koの3言語フルセット、2026-08-11時点）
    // LanguageSwitcherは2026-09-08〜ハンバーガーメニュー内に移設
    await page.goto("/en/venues");
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const jaBtn = page.locator('.language-switcher-option:has-text("日本語")');
    await expect(jaBtn).toBeVisible();
    await expect(jaBtn).toHaveAttribute("aria-disabled", "true");
    await expect(jaBtn).toHaveClass(/unavailable/);
    // aria-disabled はネイティブ disabled と異なりクリック自体は可能なため force で実クリックを再現
    await jaBtn.click({ force: true });
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/en\/venues$/);
  });

  test("/en/venues で対応言語(繁體中文・韓国語)ボタンは正しく遷移する", async ({
    page,
  }) => {
    await page.goto("/en/venues");
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const zhBtn = page.locator(
      '.language-switcher-option:has-text("繁體中文")',
    );
    await zhBtn.click();
    await expect(page).toHaveURL(/\/zh-TW\/venues$/);

    // 言語切替のページ遷移でハンバーガーメニューが閉じるため再度開く
    await page.click(".menu-btn");
    await page.locator(".language-switcher-trigger").click();
    const koBtn = page.locator('.language-switcher-option:has-text("한국어")');
    await koBtn.click();
    await expect(page).toHaveURL(/\/ko\/venues$/);
  });
});

// BOA-653: 非jaのトップに日本語の直書きが残っていた（データ一覧の導線・ja記事のブログ・曜日・フッターの日付）
test("英語のトップに ja 専用の導線・ja 記事・日本語の日付を出さない（BOA-653） @blog", async ({
  page,
}) => {
  const JA = /[\u3040-\u30FF\u4E00-\u9FFF]/;
  await page.goto("/en/");
  await page.locator(".blog-preview-card").first().waitFor({ timeout: 30000 });
  await expect(page.locator(".home-digest-link")).toHaveCount(0);
  for (const text of await page
    .locator(".blog-preview-card .blog-preview-title")
    .allTextContents()) {
    expect(text).not.toMatch(JA);
  }
  await expect(page.locator("h2", { hasText: "🏁" }).first()).not.toContainText(
    /[日月火水木金土]\)/,
  );
  await expect(page.locator(".site-footer-updated")).not.toContainText("年");

  // ja は従来どおりデータ一覧への導線がある（言語の記憶を消してから開く）
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await expect(page.locator(".home-digest-link")).toHaveAttribute(
    "href",
    "/today",
  );
});

// BOA-655: 分析ツールの非ja表示に日本語が残っていた（会場名・注記・選手ページのリンク）
test("英語の分析ツールで会場名・注記・選手ページのリンクを日本語で出さない（BOA-655）", async ({
  page,
}) => {
  await page.goto("/en/winning-technique?tab=volatility");
  // 会場別の表は折りたたみの中。会場コードは "04" のようにゼロ埋めで来る
  await page.locator(".vas-venue-details summary").click();
  const names = page.locator(".volatility-venue-table__name");
  await names.first().waitFor({ timeout: 30000 });
  for (const text of await names.allTextContents()) {
    expect(text).not.toMatch(/[\u3040-\u30FF\u4E00-\u9FFF]/);
  }
  const note = page.locator(".volatility-accuracy-chart-note");
  await expect(note).toBeVisible();
  await expect(note).not.toContainText("件を集計中");

  await serveFixedTodaysRaces(page);
  await page.goto("/en/winning-technique?tab=formranking");
  const link = page.locator(".racer-page-link-inline").first();
  await link.waitFor({ timeout: 30000 });
  await expect(link).toHaveText("Racer page (JA)");
});

// BOA-654: レース詳細の非ja表示に日本語が残っていた（今節の記号「エ」・払戻「円」・パンくずのラベル）
test("英語のレース詳細に公式の記号・円・日本語のラベルを生のまま出さない（BOA-654）", async ({
  page,
}) => {
  // 2026-09-30 戸田9R: 6号艇の今節の走にエンストがある
  await page.goto("/en/race/2026-09-30-02-09");
  await page.locator(".race-tabs-btn", { hasText: "This Series" }).click();
  await expect(page.locator("nav.breadcrumb")).toHaveAttribute(
    "aria-label",
    "Breadcrumb",
  );
  const labels = page.locator(".meet-sparkline-label");
  await labels.first().waitFor({ timeout: 30000 });
  await expect(labels.filter({ hasText: "エ" })).toHaveCount(0);
  await expect(labels.filter({ hasText: "Eng" }).first()).toBeVisible();
  const history = page.locator(".race-history-table").first();
  await history.waitFor({ timeout: 30000 });
  await expect(history).toContainText("¥");
  await expect(history).not.toContainText("円");

  // 基本情報タブの直近10走（RecentRunsTable）の払戻も同じ表記にする
  await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
  await page.locator(".rbit-bar-row").nth(5).click();
  const recent = page.locator(".rrt-table").first();
  await recent.waitFor({ timeout: 30000 });
  await expect(recent).not.toContainText("円");
});

// BOA-656: 会場特性の要約は「水面・傾向」を日本語の中黒で連結していた（全言語で「Freshwater ・ Balanced」）
// BOA-1202: 傾向（venues.cluster）の表示を外したので、要約は水面だけ。中黒・傾向の語が出ないことを守る
test("会場特性の要約に日本語の中黒と傾向の語が出ない（BOA-656・BOA-1202）", async ({
  page,
}) => {
  // venue-characteristics-teaser は VenueCharacteristicsCard が collapsible
  // （VenueRaceListPage の showCardsInGrid＝その日にまだ発走前のレースがある。
  // getRaceStatus は race.result.finished を最優先で見るため、時計を戸田の
  // 開催中時刻に固定するだけでは不十分（BOA-688）。2026-09-29は実際の開催日から
  // 日が経つほど全レースの結果が確定済みになり、BOA-608・#1080と同じ時刻固定を
  // 真似ても「当日まだ発走前のレースがある」状態そのものが時間とともに崩れて
  // record モード（本番）で再現できなくなる。そこで /api/predictions/2026-09-29
  // の応答を差し替え、戸田の最終レースだけ未発走（result null・発走前の時刻）に
  // 固定し、実際のレース結果の経過に左右されないようにする
  const DATE = "2026-09-29";
  await page.clock.setFixedTime(new Date(`${DATE}T15:04:00+09:00`));
  await page.route(`**/api/predictions/${DATE}*`, async (route) => {
    // route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
    const response = await fetchRecorded(route);
    const body = await response.json();
    const todaRaceNumbers = (body.races || [])
      .filter((r) => r.venueCode === 2)
      .map((r) => r.raceNumber);
    const lastRaceNumber = Math.max(...todaRaceNumbers);
    const races = (body.races || []).map((race) =>
      race.venueCode === 2 && race.raceNumber === lastRaceNumber
        ? { ...race, result: null, startTime: "23:59" }
        : race,
    );
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: { ...body, races },
    });
  });
  for (const path of ["/en/venue/2", "/zh-TW/venue/2"]) {
    await page.goto(path);
    const teaser = page.getByTestId("venue-characteristics-teaser");
    await teaser.waitFor({ timeout: 30000 });
    await expect(teaser).not.toContainText("・");
    await expect(teaser).not.toContainText(/Balanced|Inside|Outside/i);
  }
});

// BOA-669: 部品交換の部品名（公式表記・日本語）が非jaでも日本語のまま出ていた
test("英語のデータ出走表で部品交換の部品名を英語で出す（BOA-669）", async ({
  page,
}) => {
  // 2026-09-30 浜名湖1R: 2号艇がキャブを交換
  await page.goto("/en/race/2026-09-30-05-01");
  await page.locator(".race-tabs-btn", { hasText: "Just Before" }).click();
  const row = page.locator("tr", { hasText: "Parts changed" }).first();
  await row.waitFor({ timeout: 30000 });
  await expect(row).toContainText("Carburetor");
  await expect(row).not.toContainText("キャブ");
});

// BOA-665: 更新ボタン（clearCache）が boatai: で始まるキーをすべて消し、Cookie の同意・
// 初回訪問・案内バナーを閉じた記録まで消えていた（同意バナーが再表示される）
test("更新ボタンはデータキャッシュだけを消し、Cookie の同意などの設定は残す（BOA-665）", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".refresh-button").waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    localStorage.setItem("boatai:cookie-consent", "granted");
    localStorage.setItem("boatai:visited-before", "true");
    localStorage.setItem("boatai:intro-banner-dismissed", "true");
    localStorage.setItem(
      "boatai:e2e-dummy-cache",
      JSON.stringify({ data: { x: 1 }, timestamp: Date.now() }),
    );
  });
  await page.locator(".refresh-button").click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("boatai:e2e-dummy-cache")),
    )
    .toBeNull();
  const kept = await page.evaluate(() => [
    localStorage.getItem("boatai:cookie-consent"),
    localStorage.getItem("boatai:visited-before"),
    localStorage.getItem("boatai:intro-banner-dismissed"),
  ]);
  expect(kept).toEqual(["granted", "true", "true"]);
});

// BOA-621: 直近10走の表のレース種別（公式の自由記述）が非jaでも日本語のまま出ていた。
// 分類できるもの（予選・優勝戦等）は区分の訳、会場独自の名前は公式表記のまま translate="no"
test("英語の直近10走の表でレース種別を区分の訳で出し、ja は公式表記のまま（BOA-621）", async ({
  page,
}) => {
  const JA = /[\u3040-\u30FF\u4E00-\u9FFF]/;
  await page.goto("/en/race/2026-09-30-02-09");
  await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
  await page.locator(".rbit-bar-row").nth(5).click();
  const subs = page.locator(".rrt-table .rrt-stage");
  await subs.first().waitFor({ timeout: 30000 });
  let translated = 0;
  for (const sub of await subs.all()) {
    const text = (await sub.textContent()) ?? "";
    if (JA.test(text)) {
      // 日本語のまま出すのは、分類できない会場独自の名前だけ
      await expect(sub).toHaveAttribute("translate", "no");
    } else {
      translated += 1;
      await expect(sub).toHaveAttribute("title", JA);
    }
  }
  expect(translated).toBeGreaterThan(0);

  await page.evaluate(() => localStorage.clear());
  await page.goto("/race/2026-09-30-02-09");
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await page.locator(".rbit-bar-row").nth(5).click();
  const jaSubs = page.locator(".rrt-table .rrt-stage");
  await jaSubs.first().waitFor({ timeout: 30000 });
  for (const text of await jaSubs.allTextContents()) {
    expect(text).toMatch(JA);
  }
});

test.describe("多言語: 未翻訳パスのjaリダイレクト", () => {
  test("未翻訳ページ（/en/faq等）はja版へリダイレクトされlang=jaで配信される", async ({
    page,
  }) => {
    await page.goto("/en/faq");
    await expect(page).toHaveURL(/\/faq$/);
    // lang属性はLanguageSyncのeffectで非同期に同期されるためポーリングで待つ
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe("ja");
  });

  // BOA-430: 思考アシストは /race 配下（翻訳済み）だが ja 専用。言語付きの URL は ja 版へ移る。2026-10-10 に公開したので noindex は付けない
  test("思考アシスト（/en/race/{id}/assist）はja版へリダイレクトされ、公開後は noindex を付けない", async ({
    page,
  }) => {
    await page.goto("/en/race/2026-10-06-18-10/assist");
    await expect(page).toHaveURL(/\/race\/2026-10-06-18-10\/assist$/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe("ja");
    // 見出しは「{会場} {R}R 思考アシスト」（ページ名は視覚的に隠した文字。PR3 で画面を入れた）
    await expect(
      page.getByRole("heading", { level: 1, name: /思考アシスト/ }),
    ).toBeVisible();
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]'),
    ).toHaveCount(0);
  });

  // BOA-430 PR3: 機能フラグが無くても URL 直接で開け、1段目のデータ（出走表）でレースの図が出る（spec FR-1・N-5）
  test("思考アシストはフラグ無しでも開き、軸レンズのレースの図に1〜6号艇が出る", async ({
    page,
  }) => {
    await page.goto("/race/2026-10-06-18-10/assist");
    await expect(
      page.getByRole("figure", { name: "レースの図（軸）" }),
    ).toBeVisible();
    for (let n = 1; n <= 6; n++)
      await expect(
        page.getByRole("button", { name: new RegExp(`^${n}号艇\\s`) }),
      ).toBeVisible();
    await expect(page.getByRole("region", { name: "買い目" })).toBeVisible();
  });

  // BOA-990 ①: 思考アシストの買い目に券種（3連単・2連単）のタブと「券種で比べる」の小表を足した
  test("思考アシストの買い目レンズに券種のタブ（3連単・3連複・2連単・2連複・拡連複）と券種で比べるの表が出る", async ({
    page,
  }) => {
    await page.goto("/race/2026-10-06-18-10/assist");
    await page
      .getByRole("tablist", { name: "見方" })
      .getByRole("tab", { name: "買い目", exact: true })
      .click();
    const types = page.getByRole("group", { name: "券種" });
    await expect(types.getByRole("button", { name: "3連単" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(types.getByRole("button", { name: "2連単" })).toBeVisible();
    // BOA-990 ②: 3連複・2連複のタブ。押すとフッターの頭がその券種になる
    for (const name of ["3連複", "2連複", "拡連複"]) {
      await types.getByRole("button", { name, exact: true }).click();
      await expect(
        types.getByRole("button", { name, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("region", { name: "買い目" })).toContainText(
        name,
      );
    }
    await expect(
      page.getByRole("region", { name: "券種で比べる（同じ候補）" }),
    ).toBeVisible();
  });

  test("翻訳済みページ（/en/guide）はリダイレクトされずlang=enで配信される", async ({
    page,
  }) => {
    await page.goto("/en/guide");
    await expect(page).toHaveURL(/\/en\/guide$/);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("en");
  });

  // BOA-202: 各言語ガイドはApp外で描画されるため、共通フッターを個別に置かないと法的リンクへの導線が消える
  for (const [path, privacyLabel] of [
    ["/en/guide", "Privacy Policy"],
    ["/zh-TW/guide", "隱私權政策"],
    ["/ko/guide", "개인정보 처리방침"],
    // BOA-632: 会場ガイド（一覧・詳細）も同じくApp外
    ["/en/venues", "Privacy Policy"],
    ["/zh-TW/venues/heiwajima", "隱私權政策"],
    ["/ko/venues/heiwajima", "개인정보 처리방침"],
  ]) {
    test(`${path} に各言語のラベルでフッターが出る`, async ({ page }) => {
      await page.goto(path);
      const footer = page.locator("footer.site-footer");
      await expect(footer).toBeVisible();
      await expect(
        footer.getByRole("link", { name: privacyLabel }),
      ).toBeVisible();
      await expect(footer.locator(".site-footer-copyright")).toBeVisible();
    });
  }
});
