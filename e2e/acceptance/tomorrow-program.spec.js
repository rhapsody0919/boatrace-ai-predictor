import { test, expect } from "../fixtures.js";

// 入力: docs/design/tomorrow-program/spec.md・screens.md のみ（2026-10-02 更新版）。
// 時計は fixtures が録画時刻に固定する。公開状況（公開前・公開途中・全公開）は
// 録画時点の B ファイルの状態で決まるため、成立しない状態は test.skip で外す。
// 明日の出走表ページのパスは /step2 で決まるため、会場カードから辿る。

const PUBLISH_BEFORE = "明日の出走表は14時ごろから順に公開されます";
const PUBLISHING = /(\d+)\s*\/\s*(\d+)\s*会場の出走表を公開中/;
const PREPARING = "出走表準備中";
const NO_RACE = "明日開催なし";
const DASH = "—";
const NOTE_TIME = /\d{1,2}\/\d{1,2}\s*\d{1,2}:\d{2}\s*時点（JST）/;
const NOTE_TAIL = "欠場・選手交代は当日の出走表で確認してください";
const DEADLINE = /締切予定\s*\d{1,2}:\d{2}（JST）/;
const DAY_LABEL = /初日|\d+日目|最終日/;
const WIDTHS = [375, 768, 1024, 1440, 1920];

const todayTab = (page) =>
  page.getByRole("tab", { name: /本日\s*\d{1,2}\/\d{1,2}/ });
const tomorrowTab = (page) =>
  page.getByRole("tab", { name: /明日\s*\d{1,2}\/\d{1,2}/ });

// fixtures が固定した時計で JST の M/D を得る
const jstMD = (page, offsetDays) =>
  page.evaluate((off) => {
    const d = new Date(Date.now() + 9 * 3600 * 1000 + off * 86400 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }, offsetDays);

const jstHour = (page) =>
  page.evaluate(() => new Date(Date.now() + 9 * 3600 * 1000).getUTCHours());

const openTomorrow = async (page) => {
  await page.goto("/");
  await tomorrowTab(page).click();
  await expect(page).toHaveURL(/[?&]day=tomorrow/);
  await expect(tomorrowTab(page)).toHaveAttribute("aria-selected", "true");
};

// 出走表ありのカード: 日次を含むリンク
const programCards = (page) =>
  page.getByRole("link").filter({ hasText: DAY_LABEL });

const countStates = async (page) => ({
  program: await programCards(page).count(),
  preparing: await page.getByText(PREPARING, { exact: true }).count(),
  noRace: await page.getByText(NO_RACE).count(),
  dash: await page.getByText(DASH, { exact: true }).count(),
});

const noHorizontalScroll = async (page) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
};

const noHorizontalScrollAt320 = async (page) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe("S1 トップの本日/明日タブ", () => {
  test("[spec FR-B1] 「本日 M/D」「明日 M/D」のタブを常に表示する", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(todayTab(page)).toBeVisible();
    await expect(tomorrowTab(page)).toBeVisible();
  });

  test("[spec FR-B1] 「本日」は JST の今日、「明日」は JST の今日+1", async ({
    page,
  }) => {
    await page.goto("/");
    const today = await jstMD(page, 0);
    const tomorrow = await jstMD(page, 1);
    await expect(todayTab(page)).toHaveText(
      new RegExp(`本日\\s*${today}(?!\\d)`),
    );
    await expect(tomorrowTab(page)).toHaveText(
      new RegExp(`明日\\s*${tomorrow}(?!\\d)`),
    );
  });

  test("[spec FR-B3] タブは role=tab で、初期表示は本日が aria-selected=true", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(todayTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(tomorrowTab(page)).toHaveAttribute("aria-selected", "false");
  });

  test("[screens C1] 明日タブを押すと URL が ?day=tomorrow になり aria-selected が移る", async ({
    page,
  }) => {
    await openTomorrow(page);
    await expect(todayTab(page)).toHaveAttribute("aria-selected", "false");
  });

  test("[screens C1] /?day=tomorrow を直接開くと明日タブが選ばれている", async ({
    page,
  }) => {
    await page.goto("/?day=tomorrow");
    await expect(tomorrowTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("[screens C1] 明日タブから戻ると本日タブが選ばれた状態に戻る", async ({
    page,
  }) => {
    await openTomorrow(page);
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]day=tomorrow/);
    await expect(todayTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("[spec 非機能] 本日タブには明日用の文言（準備中・明日開催なし・公開案内）を出さない", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(todayTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(PREPARING, { exact: true })).toHaveCount(0);
    await expect(page.getByText(NO_RACE)).toHaveCount(0);
    await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
    await expect(page.getByText(PUBLISHING)).toHaveCount(0);
  });

  test("[spec FR-B1] 明日タブは24会場を出し、各カードは4状態（出走表あり／準備中／明日開催なし／—）のいずれか", async ({
    page,
  }) => {
    await openTomorrow(page);
    await expect(async () => {
      const s = await countStates(page);
      expect(s.program + s.preparing + s.noRace + s.dash).toBe(24);
    }).toPass();
  });

  test("[spec FR-B1] 公開前は案内「明日の出走表は14時ごろから順に公開されます」を出し、24会場すべて「—」", async ({
    page,
  }) => {
    await openTomorrow(page);
    const notice = page.getByText(PUBLISH_BEFORE);
    test.skip((await notice.count()) === 0, "録画時点で B ファイルが公開済み");
    await expect(notice).toBeVisible();
    await expect(page.getByText(DASH, { exact: true })).toHaveCount(24);
    // 公開前は開催の有無を出さない
    await expect(page.getByText(NO_RACE)).toHaveCount(0);
    await expect(page.getByText(PREPARING, { exact: true })).toHaveCount(0);
    await expect(programCards(page)).toHaveCount(0);
    await expect(page.getByText(PUBLISHING)).toHaveCount(0);
  });

  test("[spec FR-B1] 公開途中は「n / m 会場の出走表を公開中」で、n=出走表ありの数、m=n+準備中の数", async ({
    page,
  }) => {
    await openTomorrow(page);
    const notice = page.getByText(PUBLISHING);
    test.skip((await notice.count()) === 0, "録画時点で公開途中ではない");
    const [, n, m] = (await notice.first().innerText()).match(PUBLISHING);
    const s = await countStates(page);
    expect(Number(n)).toBeLessThan(Number(m));
    expect(s.program).toBe(Number(n));
    expect(s.program + s.preparing).toBe(Number(m));
    expect(s.noRace).toBe(24 - Number(m));
    expect(s.dash).toBe(0);
    await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
  });

  test("[spec FR-B1] 全会場公開後は案内を出さず、「出走表準備中」「—」のカードも無い", async ({
    page,
  }) => {
    await openTomorrow(page);
    await expect(async () => {
      const s = await countStates(page);
      expect(s.program + s.preparing + s.noRace + s.dash).toBe(24);
    }).toPass();
    const s = await countStates(page);
    test.skip(
      s.program === 0 || s.preparing > 0,
      "録画時点で全会場公開後ではない",
    );
    await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
    await expect(page.getByText(PUBLISHING)).toHaveCount(0);
    expect(s.dash).toBe(0);
  });

  test("[spec FR-B1/screens C3] 「出走表準備中」「明日開催なし」「—」のカードはタップできない（リンクにしない）", async ({
    page,
  }) => {
    await openTomorrow(page);
    await expect(
      page.getByRole("link").filter({ hasText: PREPARING }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link").filter({ hasText: NO_RACE }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: DASH, exact: true }),
    ).toHaveCount(0);
  });

  test("[spec FR-B1] 出走表ありのカードは節名・日次（初日/N日目/最終日）・1Rの締切予定時刻を出し、タップで明日の出走表へ", async ({
    page,
  }) => {
    await openTomorrow(page);
    const cards = programCards(page);
    test.skip(
      (await cards.count()) === 0,
      "録画時点で出走表ありの会場が無い（公開前）",
    );
    const card = cards.first();
    await expect(card).toContainText(DAY_LABEL);
    await expect(card).toContainText(/\d{1,2}:\d{2}/);
    await card.click();
    await expect(page).not.toHaveURL(/[?&]day=tomorrow/);
    await expect(page.getByText(NOTE_TIME)).toBeVisible();
  });

  test("[spec FR-B1] 0〜5時（JST）でも「明日」は今日+1", async ({ page }) => {
    await page.goto("/");
    test.skip((await jstHour(page)) >= 6, "録画時刻が JST 0〜5時ではない");
    const tomorrow = await jstMD(page, 1);
    await expect(tomorrowTab(page)).toHaveText(
      new RegExp(`明日\\s*${tomorrow}(?!\\d)`),
    );
  });

  test("[spec 用語] 明日タブに「競艇」を表示しない", async ({ page }) => {
    await openTomorrow(page);
    await expect(page.getByText("競艇")).toHaveCount(0);
  });

  test("[spec FR-B3 非機能] 明日タブは 375/768/1024/1440/1920px で横スクロールしない", async ({
    page,
  }) => {
    await openTomorrow(page);
    await noHorizontalScroll(page);
  });

  test("[spec 非機能] 明日タブは 320px で横スクロールしない", async ({
    page,
  }) => {
    await openTomorrow(page);
    await noHorizontalScrollAt320(page);
  });
});

test.describe("S2 明日の出走表（会場ごと）", () => {
  // 出走表ありのカードから辿る。無ければ false
  const openProgram = async (page) => {
    await openTomorrow(page);
    const cards = programCards(page);
    if ((await cards.count()) === 0) return false;
    await cards.first().click();
    await expect(page.getByText(NOTE_TIME)).toBeVisible();
    return true;
  };
  const SKIP = "録画時点で出走表ありの会場が無い（公開前）";

  test("[spec FR-B2] 注記「M/D HH:MM 時点（JST）の公式番組表です。欠場・選手交代は当日の出走表で確認してください」", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    await expect(page.getByText(NOTE_TIME)).toBeVisible();
    await expect(page.getByText(/時点（JST）の公式番組表です/)).toBeVisible();
    await expect(page.getByText(NOTE_TAIL)).toBeVisible();
  });

  test("[spec FR-B2] 注記の日付は今日または明日より前（前日時点の情報）", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const text = await page.getByText(NOTE_TIME).first().innerText();
    const md = text.match(/(\d{1,2}\/\d{1,2})/)[1];
    const tomorrow = await jstMD(page, 1);
    expect(md).not.toBe(tomorrow);
  });

  test("[spec FR-B2] 1R〜12R の見出しがあり、各見出しに「締切予定 HH:MM（JST）」が付く", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const headings = page.getByRole("heading").filter({ hasText: DEADLINE });
    const n = await headings.count();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(12);
    await expect(headings.first()).toContainText(/(^|\D)1\s*R/);
    for (let i = 0; i < n; i++) {
      await expect(headings.nth(i)).toContainText(DEADLINE);
    }
  });

  test("[spec FR-B2] 1レース1表で、各表は見出し行＋6艇の7行", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const raceCount = await page
      .getByRole("heading")
      .filter({ hasText: DEADLINE })
      .count();
    const tables = page.getByRole("table");
    await expect(tables).toHaveCount(raceCount);
    for (let i = 0; i < raceCount; i++) {
      await expect(tables.nth(i).getByRole("row")).toHaveCount(7);
    }
  });

  test("[spec FR-B2] 表の列見出しに艇番・選手名・級別・全国勝率・当地勝率・モーターがある", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const header = page.getByRole("table").first().getByRole("row").first();
    for (const name of [/艇/, /選手/, /級/, /全国/, /当地/, /モーター/]) {
      await expect(header.getByRole("columnheader", { name })).toHaveCount(1);
    }
  });

  test("[spec FR-B2] ページに会場名・節名と日次を出す", async ({ page }) => {
    test.skip(!(await openProgram(page)), SKIP);
    await expect(page.getByText(DAY_LABEL).first()).toBeVisible();
  });

  test("[spec FR-B2] パンくず ホーム → 明日の開催 → 会場。「明日の開催」は /?day=tomorrow へ", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const nav = page.getByRole("navigation", { name: /パンくず|breadcrumb/i });
    await expect(nav.getByRole("link", { name: "ホーム" })).toBeVisible();
    await nav.getByRole("link", { name: "明日の開催" }).click();
    await expect(page).toHaveURL(/\/\?day=tomorrow$/);
    await expect(tomorrowTab(page)).toHaveAttribute("aria-selected", "true");
  });

  test("[spec FR-B2] レース詳細・予想・分析への遷移を出さない", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: /予想|分析|レース詳細/ }),
    ).toHaveCount(0);
    for (const table of await main.getByRole("table").all()) {
      await expect(table.getByRole("link")).toHaveCount(0);
    }
  });

  test('[spec FR-B3] 選手名に translate="no" を付ける', async ({ page }) => {
    test.skip(!(await openProgram(page)), SKIP);
    const row = page.getByRole("table").first().getByRole("row").nth(1);
    const n = await row.evaluate(
      (el) => el.querySelectorAll('[translate="no"]').length,
    );
    expect(n).toBeGreaterThan(0);
  });

  test("[spec 用語] 出走表ページに「競艇」を表示しない", async ({ page }) => {
    test.skip(!(await openProgram(page)), SKIP);
    await expect(page.getByText("競艇")).toHaveCount(0);
  });

  test("[spec FR-B3 非機能] 出走表ページは 375/768/1024/1440/1920px で横スクロールしない", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    await noHorizontalScroll(page);
  });

  test("[spec 非機能] 出走表ページは 320px で横スクロールしない", async ({
    page,
  }) => {
    test.skip(!(await openProgram(page)), SKIP);
    await noHorizontalScrollAt320(page);
  });
});

// 4言語: URL は既存の言語接頭辞（spec FR-B3）。訳文は仕様に無いため、
// 構造（タブ2つ・aria-selected・24会場・リンク遷移）と日本語文言が出ないこと・崩れないことを見る
test.describe("多言語（en/zh-TW/ko）", () => {
  for (const lang of ["en", "zh-TW", "ko"]) {
    test(`[spec FR-B3] /${lang}/?day=tomorrow で明日タブが選ばれ、日本語の案内・状態文言を出さない`, async ({
      page,
    }) => {
      await page.goto(`/${lang}/?day=tomorrow`);
      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(2);
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(PUBLISH_BEFORE)).toHaveCount(0);
      await expect(page.getByText(PREPARING, { exact: true })).toHaveCount(0);
      await expect(page.getByText(NO_RACE)).toHaveCount(0);
    });

    test(`[spec FR-B3] /${lang}/?day=tomorrow は 375/768/1024/1440/1920px で横スクロールしない`, async ({
      page,
    }) => {
      await page.goto(`/${lang}/?day=tomorrow`);
      await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await noHorizontalScroll(page);
    });

    test(`[spec FR-B3] /${lang} の明日の出走表は言語接頭辞を保ち、横スクロールしない`, async ({
      page,
    }) => {
      await page.goto(`/${lang}/?day=tomorrow`);
      await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // 訳文が仕様に無いため、時刻（HH:MM）を含むカードのリンクを出走表ありとみなす
      const cards = page
        .getByRole("main")
        .getByRole("link")
        .filter({ hasText: /\d{1,2}:\d{2}/ });
      test.skip(
        (await cards.count()) === 0,
        "録画時点で出走表ありの会場が無い（公開前）",
      );
      await cards.first().click();
      await expect(page).toHaveURL(new RegExp(`/${lang}/`));
      await expect(
        page.getByRole("table").first().getByRole("row"),
      ).toHaveCount(7);
      await expect(page.getByText(NOTE_TAIL)).toHaveCount(0);
      await noHorizontalScroll(page);
    });
  }
});
