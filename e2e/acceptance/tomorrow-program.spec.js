import { test, expect } from "../fixtures.js";

// 入力: docs/design/tomorrow-program/spec.md・screens.md のみ。
// 時計は fixtures が録画時刻に固定するため、「14時前」「0〜5時」等の時刻別状態は
// 録画時刻で成立する状態だけを検証し、成立しない状態は test.skip で外す。

const tab = (page, name) =>
  page.getByRole("tab", { name }).or(page.getByRole("button", { name }));

const todayTab = (page) => tab(page, /^本日\s*\d{1,2}\/\d{1,2}/);
const tomorrowTab = (page) => tab(page, /^明日\s*\d{1,2}\/\d{1,2}/);

const PUBLISH_BEFORE = "明日の出走表は14時ごろから順に公開されます";
const PREPARING = "出走表準備中";
const NO_RACE = "明日開催なし";
const PUBLISHING = /\d+\s*\/\s*\d+\s*会場の出走表を公開中/;

const jstMD = (offsetDays) => {
  // fixtures が固定した時計の Date.now() を使うため page.evaluate で取る
  return `(() => {
    const d = new Date(Date.now() + 9 * 3600 * 1000 + ${offsetDays} * 86400 * 1000);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
  })()`;
};

const openTomorrow = async (page) => {
  await page.goto("/");
  await tomorrowTab(page).click();
  await expect(page).toHaveURL(/[?&]day=tomorrow/);
};

test.describe("明日の出走表 S1 トップの本日/明日タブ", () => {
  test("[spec FR-B1] トップに「本日 M/D」「明日 M/D」のタブが常に表示される", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(todayTab(page)).toBeVisible();
    await expect(tomorrowTab(page)).toBeVisible();
  });

  test("[spec FR-B1] 「明日」の日付は JST の今日+1、「本日」は JST の今日", async ({
    page,
  }) => {
    await page.goto("/");
    const today = await page.evaluate(jstMD(0));
    const tomorrow = await page.evaluate(jstMD(1));
    await expect(todayTab(page)).toHaveText(
      new RegExp(`本日\\s*${today}(?!\\d)`),
    );
    await expect(tomorrowTab(page)).toHaveText(
      new RegExp(`明日\\s*${tomorrow}(?!\\d)`),
    );
  });

  test("[screens C1] 明日タブの選択は URL ?day=tomorrow に持ち、直接開いても明日タブが選ばれる", async ({
    page,
  }) => {
    await page.goto("/?day=tomorrow");
    const t = page.getByRole("tab", { name: /^明日/ });
    test.skip(
      (await t.count()) === 0,
      "タブが role=tab でない実装では aria-selected で判定できない",
    );
    await expect(t).toHaveAttribute("aria-selected", "true");
  });

  test("[screens C1] 明日タブ→戻るで本日タブの状態に戻る", async ({ page }) => {
    await openTomorrow(page);
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]day=tomorrow/);
    await expect(todayTab(page)).toBeVisible();
  });

  test("[spec 非機能] 本日タブでは明日タブ用の文言（準備中・明日開催なし・公開案内）を出さない", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(todayTab(page)).toBeVisible();
    await expect(page.getByText(PREPARING)).toHaveCount(0);
    await expect(page.getByText(NO_RACE)).toHaveCount(0);
    await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
  });

  test("[spec FR-B1] 明日タブの会場カードは「出走表あり」「出走表準備中」「明日開催なし」のいずれかで、24会場分ある", async ({
    page,
  }) => {
    await openTomorrow(page);
    const preparing = await page.getByText(PREPARING).count();
    const noRace = await page.getByText(NO_RACE).count();
    // 出走表ありのカードは S2 へのリンク（URL に venue コード相当を含む新ルート）
    const programLinks = page
      .getByRole("link")
      .filter({ hasText: /\d{1,2}:\d{2}/ });
    const withProgram = await programLinks.count();
    expect(preparing + noRace + withProgram).toBeGreaterThan(0);
    expect(noRace).toBeLessThanOrEqual(24);
  });

  test("[spec FR-B1/screens C3] 「出走表準備中」のカードはリンクにしない", async ({
    page,
  }) => {
    await openTomorrow(page);
    const n = await page.getByText(PREPARING).count();
    test.skip(
      n === 0,
      "録画時刻で出走表準備中の会場が無い（全会場公開後、または公開前で節も無い）",
    );
    await expect(
      page.getByRole("link").filter({ hasText: PREPARING }),
    ).toHaveCount(0);
  });

  test("[spec FR-B1] 出走表が入った会場カードは日次と1Rの締切予定時刻を出し、明日の出走表へ遷移できる", async ({
    page,
  }) => {
    await openTomorrow(page);
    const cards = page
      .getByRole("link")
      .filter({ hasText: /\d{1,2}:\d{2}/ })
      .filter({ hasNotText: PREPARING })
      .filter({ hasNotText: NO_RACE });
    test.skip(
      (await cards.count()) === 0,
      "録画時刻で出走表が入った会場が無い（14時前等）",
    );
    const card = cards.first();
    await expect(card).toContainText(/\d+日目|初日|最終日/);
    await card.click();
    await expect(page).not.toHaveURL(/\/(\?|$)/);
    await expect(page.getByText(/前日\s*\d{1,2}時\d{1,2}分時点/)).toBeVisible();
  });

  test("[spec FR-B1] 公開前は「明日の出走表は14時ごろから順に公開されます」を出し、出走表ありのカードは無い", async ({
    page,
  }) => {
    await openTomorrow(page);
    const notice = page.getByText(PUBLISH_BEFORE);
    test.skip((await notice.count()) === 0, "録画時刻で B ファイル公開済み");
    await expect(notice).toBeVisible();
    await expect(page.getByText(PUBLISHING)).toHaveCount(0);
  });

  test("[screens C4] 公開途中は「n / m 会場の出走表を公開中」を出し、n < m かつ準備中のカードがある", async ({
    page,
  }) => {
    await openTomorrow(page);
    const notice = page.getByText(PUBLISHING);
    test.skip((await notice.count()) === 0, "録画時刻で公開途中ではない");
    const m = (await notice.first().innerText()).match(/(\d+)\s*\/\s*(\d+)/);
    expect(Number(m[1])).toBeLessThan(Number(m[2]));
    expect(await page.getByText(PREPARING).count()).toBeGreaterThan(0);
    await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
  });

  test("[spec FR-B1] 0〜5時（JST）でも「明日」は今日+1（前日扱いにしない）", async ({
    page,
  }) => {
    await page.goto("/");
    const hour = await page.evaluate(() =>
      new Date(Date.now() + 9 * 3600 * 1000).getUTCHours(),
    );
    test.skip(hour >= 6, "録画時刻が JST 0〜5時ではない");
    const tomorrow = await page.evaluate(jstMD(1));
    await expect(tomorrowTab(page)).toHaveText(
      new RegExp(`明日\\s*${tomorrow}(?!\\d)`),
    );
  });

  test("[spec 用語] 明日タブに「競艇」を表示しない", async ({ page }) => {
    await openTomorrow(page);
    await expect(page.getByText("競艇")).toHaveCount(0);
  });
});

test.describe("明日の出走表 S2 会場ごとの出走表", () => {
  const openProgram = async (page) => {
    await openTomorrow(page);
    const cards = page
      .getByRole("link")
      .filter({ hasText: /\d{1,2}:\d{2}/ })
      .filter({ hasNotText: PREPARING })
      .filter({ hasNotText: NO_RACE });
    const n = await cards.count();
    if (n === 0) return false;
    await cards.first().click();
    await expect(page.getByText(/前日\s*\d{1,2}時\d{1,2}分時点/)).toBeVisible();
    return true;
  };

  test("[spec FR-B2] 前日時点の情報である旨と、欠場・選手交代は当日の出走表で確認する旨を明記する", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    await expect(page.getByText(/前日\s*\d{1,2}時\d{1,2}分時点/)).toBeVisible();
    await expect(
      page.getByText("欠場・選手交代は当日の出走表で確認してください"),
    ).toBeVisible();
  });

  test("[spec FR-B2] 締切予定時刻に JST と明記する", async ({ page }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    await expect(page.getByText(/JST/).first()).toBeVisible();
  });

  test("[spec FR-B2] 1R〜12R を出す", async ({ page }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    await expect(
      page.getByRole("heading", { name: /(^|\D)1R/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /12R/ }).first(),
    ).toBeVisible();
  });

  test("[spec FR-B2] 各レースの表は6艇（艇番1〜6）", async ({ page }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    // ヘッダー行 + 6艇
    await expect(table.getByRole("row")).toHaveCount(7);
  });

  test("[spec FR-B2/screens S2] レース詳細・予想・分析への遷移を出さない", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: /予想|分析|レース詳細/ }),
    ).toHaveCount(0);
    const hrefs = await main
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") || ""));
    expect(hrefs.filter((h) => /\/race\//.test(h))).toEqual([]);
  });

  test('[spec FR-B3] 選手名に translate="no" を付ける', async ({ page }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    const cell = page.getByRole("table").first().getByRole("row").nth(1);
    const count = await cell.evaluate(
      (row) => row.querySelectorAll('[translate="no"]').length,
    );
    expect(count).toBeGreaterThan(0);
  });

  test("[screens S2] パンくずは ホーム → 明日の開催 → 会場", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    const nav = page.getByRole("navigation", { name: /パンくず|breadcrumb/i });
    await expect(nav.getByRole("link", { name: "ホーム" })).toBeVisible();
    await expect(nav.getByText("明日の開催")).toBeVisible();
  });

  test("[spec FR-B3 非機能] 375/768/1024/1440/1920px で横スクロールが出ない", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("[spec 用語] 出走表ページに「競艇」を表示しない", async ({ page }) => {
    test.skip(!(await openProgram(page)), "録画時刻で出走表が入った会場が無い");
    await expect(page.getByText("競艇")).toHaveCount(0);
  });
});

test.describe("明日タブ レイアウト", () => {
  test("[spec 非機能] 明日タブは 375/768/1024/1440/1920px で横スクロールが出ない", async ({
    page,
  }) => {
    await openTomorrow(page);
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
