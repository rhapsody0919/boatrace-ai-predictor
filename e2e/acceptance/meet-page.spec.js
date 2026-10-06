// 節ページ（SG/G1/G2 の得点率ランキング・準優ボーダー・勝ち上がり）の受け入れE2E。
// 入力は docs/design/meet-page/spec.md・screens.md のみ（plan/tasks/src は読まずに書いた）。
//
// 実データの検証対象は spec の受入基準にある URL。受入基準の URL そのものが仕様なので固定値で開く
// （一覧からの導線は FR-2 のテストで別に辿る）。
//   - 児島 G1 の節: /venue/16/meet/2026-09-28（9/28〜10/3）
//   - 開幕前の節:   /venue/13/meet/2026-10-27（尼崎 SG ダービー）
//
// 児島の節は「いつ開くか」で段階が変わる。fixtures がブラウザの時計を固定するので、
// ブラウザ内の現在日（JST）を読み、受入基準が前提とする段階に達していないときだけ skip する。
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "../fixtures.js";

const KOJIMA_MEET = "/venue/16/meet/2026-09-28";
const KOJIMA_VENUE = "/venue/16";
const AMAGASAKI_PRE_OPEN = "/venue/13/meet/2026-10-27";
// spec FR-1.1: 節タイトルは NFKC で半角にそろえる（データ上は「開設７４周年」の全角）
const KOJIMA_TITLE = "児島キングカップ開設74周年記念競走";
const KOJIMA_TITLE_FULLWIDTH = "児島キングカップ開設７４周年記念競走";

// 選手名は姓名の間に空白が入る実装もありうるので、空白を許す
const name = (family, given) => new RegExp(`${family}[\\s　]*${given}`);
const FUJIWARA = name("藤原", "啓史朗");
const NISHIYAMA = name("西山", "貴浩");

const STAGES = [
  "開幕前",
  "予選中",
  "予選最終日",
  "予選終了",
  "準優勝戦の日",
  "優勝戦の日",
  "節終了",
];

// ブラウザ側の現在日（JST、YYYY-MM-DD）。fixtures の固定時計に従う
const browserTodayJst = (page) =>
  page.evaluate(() =>
    new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
  );

// spec FR-1.3: ランキングは表（<table>）。「得点率」の列見出しを持つ表をランキングとみなす
const rankingTable = (page) =>
  page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: /得点率/ }) })
    .first();

// 準優の線（行として描かれる場合）は数えない
const BORDER_RE = /準優の(目安|枠)/;
const EXCLUDED_RE = /賞典除外|途中帰郷/;

// 順位が付いた選手の行: 得点率（x.xx）を含み、順位外の理由・準優の線を含まない
const rankedRows = (page) =>
  rankingTable(page)
    .getByRole("row")
    .filter({ hasText: /\d\.\d\d/ })
    .filter({ hasNotText: EXCLUDED_RE })
    .filter({ hasNotText: BORDER_RE });

// 選手の行（順位付き＋順位外）
const playerRows = (page) =>
  rankingTable(page)
    .getByRole("row")
    .filter({ hasText: /\d\.\d\d|賞典除外|途中帰郷|－/ })
    .filter({ hasNotText: BORDER_RE });

const bodyText = (page) => page.evaluate(() => document.body.innerText);

const removeSpaces = (s) => s.replace(/[\s　]+/g, "");

// 行テキストから選手名らしい最初の和文の並び（2文字以上）を取り出す
const extractName = (rowText) => {
  const m = rowText.match(/[一-鿿々ヶ぀-ヿ][一-鿿々ヶ぀-ヿ\s　]*[一-鿿々ヶ぀-ヿ]/);
  return m ? removeSpaces(m[0]) : null;
};

const noHorizontalScroll = async (page) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe("児島 G1 の節（/venue/16/meet/2026-09-28）", () => {
  test("[spec FR-1.1] 見出しに会場名・節タイトル（NFKCで半角数字）・グレード・開催期間が出る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page.getByText("児島").first()).toBeVisible();
    await expect(page.getByText(KOJIMA_TITLE).first()).toBeVisible();
    await expect(page.getByText("G1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/9\/28\s*〜\s*10\/3/).first()).toBeVisible();
    // 全角数字のままの表記は出さない
    await expect(page.getByText(KOJIMA_TITLE_FULLWIDTH)).toHaveCount(0);
  });

  test("[spec FR-1.1] 節の期間中は今日が何日目かと、日に応じた節の段階が出る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(
      today < "2026-09-28" || today > "2026-10-03",
      `ブラウザの現在日 ${today} が節の期間外`,
    );
    const day =
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) -
          Date.parse("2026-09-28T00:00:00Z")) /
          86400000,
      ) + 1;
    await expect(
      page.getByText(new RegExp(`${day}日目`)).first(),
    ).toBeVisible();
    // 1〜3日目=予選中、4日目=予選最終日（レース後は予選終了もありうる）、5日目=準優勝戦の日、6日目=優勝戦の日
    const expected = {
      1: /予選中/,
      2: /予選中/,
      3: /予選中/,
      4: /予選最終日|予選終了/,
      5: /準優勝戦の日/,
      6: /優勝戦の日|節終了/,
    }[day];
    await expect(page.getByText(expected).first()).toBeVisible();
  });

  test("[spec FR-1.1] 節の最終日より後は段階が「節終了」と出る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today <= "2026-10-03", `ブラウザの現在日 ${today} は最終日以前`);
    await expect(page.getByText("節終了").first()).toBeVisible();
  });

  test("[spec FR-1.1] 段階の表示名は定められた7つのいずれか", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page.getByText(KOJIMA_TITLE).first()).toBeVisible();
    const text = await bodyText(page);
    expect(STAGES.some((s) => text.includes(s))).toBe(true);
  });

  test("[spec FR-1.2] 予選終了後、46人に順位が付き1位が藤原啓史朗 8.67・18位が西山貴浩 5.50", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);

    const rows = rankedRows(page);
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(46);

    const first = rows.nth(0);
    await expect(first).toContainText(FUJIWARA);
    await expect(first).toContainText("8.67");
    await expect(first).toHaveText(/^\s*1(?!\d)/);

    const eighteenth = rows.nth(17);
    await expect(eighteenth).toContainText(NISHIYAMA);
    await expect(eighteenth).toContainText("5.50");
    await expect(eighteenth).toHaveText(/^\s*18(?!\d)/);
  });

  test("[spec FR-1.2] 着順の並びは日ごとに区切らずに出る（藤原啓史朗 1 3 3 1 1 1）", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);
    const row = rankedRows(page).filter({ hasText: FUJIWARA }).first();
    // 空白の有無は問わないが、日の区切り（／・| 等の記号）は入らない
    await expect(row).toContainText(/1[ 　]*3[ 　]*3[ 　]*1[ 　]*1[ 　]*1/);
  });

  test("[spec FR-1.2・FR-1.3] 順位外の6人（賞典除外2・途中帰郷4）が同じ表の末尾に「－」と理由つきで出る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);

    const rows = playerRows(page);
    await expect(rows.first()).toBeVisible();
    await expect(rows).toHaveCount(52);

    const texts = await rows.allInnerTexts();
    // 先頭46行は順位付き、末尾6行が順位外
    expect(texts.slice(0, 46).some((t) => EXCLUDED_RE.test(t))).toBe(false);
    const tail = texts.slice(46);
    expect(tail.filter((t) => /賞典除外/.test(t))).toHaveLength(2);
    expect(tail.filter((t) => /途中帰郷/.test(t))).toHaveLength(4);
    for (const t of tail) expect(t).toMatch(/^\s*－/);
  });

  test("[spec FR-1.3] 18位と19位の間に準優の線が出る", async ({ page }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);

    const rows = rankedRows(page);
    await expect(rows.nth(18)).toBeVisible();
    const r18 = await rows.nth(17).boundingBox();
    const r19 = await rows.nth(18).boundingBox();
    expect(r18 && r19).toBeTruthy();

    const labels = page.getByText(BORDER_RE);
    const boxes = await Promise.all(
      (await labels.all()).map((l) => l.boundingBox()),
    );
    const between = boxes.filter(
      (b) => b && b.y >= r18.y + r18.height - 1 && b.y + b.height <= r19.y + 1,
    );
    expect(between.length, "18位と19位の間に準優の線が無い").toBeGreaterThan(0);
  });

  test("[spec FR-1.3] 予選終了後は「準優の枠 18位 5.50（確定）」と出し、「準優の目安」は出さない", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);
    await expect(
      page.getByText(/準優の枠\s*18位\s*5\.50\s*（確定）/).first(),
    ).toBeVisible();
    await expect(page.getByText(/準優の目安/)).toHaveCount(0);
  });

  test("[spec FR-1.4] 予選終了後は残り走数・必要得点・勝負駆けを出さない", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);
    await expect(rankedRows(page).first()).toBeVisible();
    const text = await bodyText(page);
    expect(text).not.toMatch(/残り\s*\d+\s*走/);
    expect(text).not.toMatch(/あと\s*[\d.]+\s*点/);
    await expect(page.getByText(/勝負駆け/)).toHaveCount(0);
  });

  test.describe("375px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("[spec FR-1.5] 10/2以降は準優 10R・11R・12R が出て、18人（フルネーム）がランキング1〜18位と一致する", async ({
      page,
    }) => {
      await page.goto(KOJIMA_MEET);
      const today = await browserTodayJst(page);
      test.skip(
        today < "2026-10-02",
        `ブラウザの現在日 ${today} は準優の番組発表前`,
      );

      const heading = page.getByRole("heading", { name: /勝ち上がり/ }).first();
      await expect(heading).toBeVisible();
      const rows = rankedRows(page);
      await expect(rows.nth(17)).toBeVisible();
      const top18 = (
        await Promise.all(
          Array.from({ length: 18 }, (_, i) => rows.nth(i).innerText()),
        )
      ).map(extractName);

      // 375px は勝ち上がりがランキングの下なので、本文の「勝ち上がり」以降を勝ち上がり欄とみなす
      const text = await bodyText(page);
      const section = removeSpaces(text.slice(text.lastIndexOf("勝ち上がり")));
      expect(section).toContain("準優勝戦");
      for (const r of ["10R", "11R", "12R"]) expect(section).toContain(r);
      for (const n of top18) {
        expect(n, "ランキング行から選手名を取り出せない").toBeTruthy();
        expect(section, `準優メンバーに ${n} がいない`).toContain(n);
      }
    });

    test("[spec FR-1.5] 準優の各レースからレース詳細へ移動できる", async ({
      page,
    }) => {
      await page.goto(KOJIMA_MEET);
      const today = await browserTodayJst(page);
      test.skip(
        today < "2026-10-02",
        `ブラウザの現在日 ${today} は準優の番組発表前`,
      );
      await page.getByRole("link", { name: /12R/ }).first().click();
      await expect(page).not.toHaveURL(/\/meet\//);
    });

    test("[spec 非機能・モック承認] 375pxで横スクロールが出ず、52人を畳まずに全員並べる", async ({
      page,
    }) => {
      await page.goto(KOJIMA_MEET);
      const today = await browserTodayJst(page);
      test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);
      const rows = playerRows(page);
      await expect(rows).toHaveCount(52);
      await expect(rows.nth(51)).toBeVisible();
      await noHorizontalScroll(page);
    });

    test("[spec モック承認・screens 2.1] 375pxでは勝ち上がりがランキングの下に出る", async ({
      page,
    }) => {
      await page.goto(KOJIMA_MEET);
      const ranking = page
        .getByRole("heading", { name: /得点率ランキング/ })
        .first();
      const qualifiers = page
        .getByRole("heading", { name: /勝ち上がり/ })
        .first();
      await expect(ranking).toBeVisible();
      await expect(qualifiers).toBeVisible();
      const a = await ranking.boundingBox();
      const b = await qualifiers.boundingBox();
      expect(b.y).toBeGreaterThan(a.y);
    });
  });

  test.describe("1440px", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("[spec モック承認・screens 2.2] 1440pxでは勝ち上がりがランキングの右カラムに出る", async ({
      page,
    }) => {
      await page.goto(KOJIMA_MEET);
      const ranking = page
        .getByRole("heading", { name: /得点率ランキング/ })
        .first();
      const qualifiers = page
        .getByRole("heading", { name: /勝ち上がり/ })
        .first();
      await expect(ranking).toBeVisible();
      await expect(qualifiers).toBeVisible();
      const a = await ranking.boundingBox();
      const b = await qualifiers.boundingBox();
      expect(b.x).toBeGreaterThan(a.x + a.width / 2);
    });

    test("[spec 非機能] 1440pxで横スクロールが出ない", async ({ page }) => {
      await page.goto(KOJIMA_MEET);
      await expect(page.getByText(KOJIMA_TITLE).first()).toBeVisible();
      await noHorizontalScroll(page);
    });
  });

  test('[spec 非機能] 選手名に translate="no" が付く', async ({ page }) => {
    await page.goto(KOJIMA_MEET);
    const nameEl = page.getByText(FUJIWARA).first();
    await expect(nameEl).toBeVisible();
    const noTranslate = await nameEl.evaluate(
      (el) => el.closest('[translate="no"]') !== null,
    );
    expect(noTranslate).toBe(true);
  });

  test("[spec 制約] 公式の得点率一覧の値を出すので出典を表記する", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page.getByText(/出典/).first()).toBeVisible();
  });

  test("[spec 制約・FR-1.7] 画面内に「競艇」を出さない", async ({ page }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page.getByText(KOJIMA_TITLE).first()).toBeVisible();
    expect(await bodyText(page)).not.toContain("競艇");
  });

  test("[spec FR-1.7] title が「児島競艇 {節タイトル} 得点率ランキング・準優ボーダー | 龍神レーダー」", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page).toHaveTitle(
      `児島競艇 ${KOJIMA_TITLE} 得点率ランキング・準優ボーダー | 龍神レーダー`,
    );
  });

  test("[spec FR-1.7] description に節タイトル・会場名・得点率・準優ボーダーが入る", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page).toHaveTitle(/得点率ランキング/);
    const desc = await page.evaluate(
      () =>
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? "",
    );
    expect(desc).toContain(KOJIMA_TITLE);
    expect(desc).not.toContain(KOJIMA_TITLE_FULLWIDTH);
    expect(desc).toContain("児島");
    expect(desc).toContain("得点率");
    expect(desc).toMatch(/準優\s*ボーダー/);
  });

  test("[spec FR-1.7] canonical が自分自身の URL", async ({ page }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page).toHaveTitle(/得点率ランキング/);
    const canonicals = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="canonical"]')].map(
        (l) => l.href,
      ),
    );
    expect(canonicals).toHaveLength(1);
    expect(new URL(canonicals[0]).pathname).toBe(KOJIMA_MEET);
  });

  test("[spec FR-1.7] 構造化データ BreadcrumbList がトップ > 会場 > 節の3段", async ({
    page,
  }) => {
    await page.goto(KOJIMA_MEET);
    await expect(page.getByText(KOJIMA_TITLE).first()).toBeVisible();
    const lists = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .flatMap((s) => {
          try {
            const j = JSON.parse(s.textContent);
            return Array.isArray(j) ? j : [j];
          } catch {
            return [];
          }
        })
        .filter((j) => j && j["@type"] === "BreadcrumbList"),
    );
    expect(lists).toHaveLength(1);
    const items = lists[0].itemListElement;
    expect(items).toHaveLength(3);
    expect(JSON.stringify(items[1])).toContain("児島");
    expect(JSON.stringify(items[1])).toMatch(/\/venue\/16(?!\/)/);
    expect(JSON.stringify(items[2])).toContain("/venue/16/meet/2026-09-28");
  });

  test("[spec FR-1] 言語プレフィックス付き（/en/...）でも同じ形の URL で開ける", async ({
    page,
  }) => {
    await page.goto(`/en${KOJIMA_MEET}`);
    await expect(page).toHaveURL(new RegExp(`/en${KOJIMA_MEET}$`));
    const today = await browserTodayJst(page);
    test.skip(today < "2026-10-02", `ブラウザの現在日 ${today} は予選終了前`);
    await expect(page.getByText("8.67").first()).toBeVisible();
  });
});

test.describe("開幕前の節（/venue/13/meet/2026-10-27）", () => {
  test("[spec FR-1.6] 開幕前に開くと「10月27日開幕。得点率は初日のレース後から出ます」が出る", async ({
    page,
  }) => {
    await page.goto(AMAGASAKI_PRE_OPEN);
    const today = await browserTodayJst(page);
    test.skip(today >= "2026-10-27", `ブラウザの現在日 ${today} は開幕後`);
    await expect(
      page.getByText("10月27日開幕。得点率は初日のレース後から出ます").first(),
    ).toBeVisible();
  });

  test("[spec FR-1.6] 開幕前はグレードを判定せず、対象外・見つからない・エラーを出さない", async ({
    page,
  }) => {
    await page.goto(AMAGASAKI_PRE_OPEN);
    const today = await browserTodayJst(page);
    test.skip(today >= "2026-10-27", `ブラウザの現在日 ${today} は開幕後`);
    await expect(
      page.getByText(/得点率は初日のレース後から出ます/).first(),
    ).toBeVisible();
    await expect(page.getByText(/節ページの対象外/)).toHaveCount(0);
    await expect(page.getByText(/この節は見つかりませんでした/)).toHaveCount(0);
    await expect(page.getByText(/エラー|読み込みに失敗/)).toHaveCount(0);
  });

  test("[spec FR-1.1] 開幕前は段階が「開幕前」と出る", async ({ page }) => {
    await page.goto(AMAGASAKI_PRE_OPEN);
    const today = await browserTodayJst(page);
    test.skip(today >= "2026-10-27", `ブラウザの現在日 ${today} は開幕後`);
    await expect(
      page.getByText(/得点率は初日のレース後から出ます/).first(),
    ).toBeVisible();
    // 案内文の「開幕。」とは別に、段階の表示名として「開幕前」が出る
    await expect(
      page.getByText("開幕前", { exact: true }).first(),
    ).toBeVisible();
  });
});

test.describe("見つからない節", () => {
  test("[screens 3] 初日の日付が違う URL は「この節は見つかりませんでした」を出す", async ({
    page,
  }) => {
    // 児島の節の2日目（初日ではない日付）。screens 3 の「初日の日付が違う等」の例として固定値を使う
    await page.goto("/venue/16/meet/2026-09-29");
    await expect(
      page.getByText("この節は見つかりませんでした").first(),
    ).toBeVisible();
  });
});

test.describe("導線（BOA-683）", () => {
  test("[spec FR-2.1] 児島の会場ページに「今節の得点率ランキング」カードが出て、節ページへ移動できる", async ({
    page,
  }) => {
    await page.goto(KOJIMA_VENUE);
    const today = await browserTodayJst(page);
    test.skip(
      today < "2026-09-28" || today > "2026-10-03",
      `ブラウザの現在日 ${today} は児島 G1 の開催日ではない`,
    );
    await expect(
      page.getByText("今節の得点率ランキング").first(),
    ).toBeVisible();
    await page.getByRole("link", { name: /全選手の得点率を見る/ }).click();
    await expect(page).toHaveURL(/\/venue\/16\/meet\/2026-09-28$/);
  });

  test("[spec FR-2.1] 予選終了後のカードは1位 藤原啓史朗 8.67 とボーダー 18位 5.50 を出す", async ({
    page,
  }) => {
    await page.goto(KOJIMA_VENUE);
    const today = await browserTodayJst(page);
    test.skip(
      today < "2026-10-02" || today > "2026-10-03",
      `ブラウザの現在日 ${today} は予選終了後の開催日ではない`,
    );
    await expect(
      page.getByText("今節の得点率ランキング").first(),
    ).toBeVisible();
    await expect(page.getByText(FUJIWARA).first()).toBeVisible();
    await expect(page.getByText("8.67").first()).toBeVisible();
    await expect(page.getByText(/18位\s*5\.50/).first()).toBeVisible();
  });

  test("[spec FR-2.2] レース詳細の今節タブに「全選手を見る」リンクがあり、節ページへ移動できる", async ({
    page,
  }) => {
    // 導線: 節ページの勝ち上がり → 準優のレース詳細 → 今節タブ
    await page.goto(KOJIMA_MEET);
    const today = await browserTodayJst(page);
    test.skip(
      today < "2026-10-02",
      `ブラウザの現在日 ${today} は準優の番組発表前`,
    );
    await page.getByRole("link", { name: /12R/ }).first().click();
    await expect(page).not.toHaveURL(/\/meet\//);
    await page
      .getByRole("tab", { name: /今節/ })
      .or(page.getByRole("button", { name: /今節/ }))
      .first()
      .click();
    await page.getByRole("link", { name: /全選手を見る/ }).click();
    await expect(page).toHaveURL(/\/venue\/16\/meet\/2026-09-28$/);
  });
});

test.describe("予選中の節（会場ページのカードから辿る）", () => {
  // 予選中の SG/G1/G2 の節は日によって会場が変わるので、24会場の会場ページを順に開き、
  // 「全選手の得点率を見る」から節ページへ移って、段階が stageRe に合う節を探す。見つからない日は skip。
  const findMeetAtStage = async (page, stageRe) => {
    for (let i = 1; i <= 24; i++) {
      const code = String(i).padStart(2, "0");
      await page.goto(`/venue/${code}`);
      await page.waitForLoadState("networkidle");
      const link = page.getByRole("link", { name: /全選手の得点率を見る/ });
      if ((await link.count()) === 0) continue;
      await link.first().click();
      await expect(page).toHaveURL(/\/meet\/\d{4}-\d{2}-\d{2}$/);
      await page.waitForLoadState("networkidle");
      if ((await page.getByText(stageRe).count()) > 0) return page.url();
    }
    return null;
  };

  test("[spec FR-1.4] 予選1〜3日目は残り走数・必要得点・「勝負駆けだけ」を出さず、予選最終日に出る旨を案内する", async ({
    page,
  }) => {
    test.slow();
    const url = await findMeetAtStage(page, /^予選中$/);
    test.skip(url === null, "予選1〜3日目の SG/G1/G2 の節がこの日は無い");

    await expect(
      page.getByText("勝負駆けは予選最終日（4日目）に出ます").first(),
    ).toBeVisible();
    await expect(page.getByText("勝負駆けだけ")).toHaveCount(0);
    await expect(rankedRows(page).first()).toBeVisible();
    const text = await bodyText(page);
    expect(text).not.toMatch(/残り\s*\d+\s*走/);
    expect(text).not.toMatch(/あと\s*[\d.]+\s*点/);
  });

  test("[spec FR-1.3] 予選中はボーダーを「準優の目安 18位 {得点率}」と出す", async ({
    page,
  }) => {
    test.slow();
    const url = await findMeetAtStage(page, /^(予選中|予選最終日)$/);
    test.skip(url === null, "予選中・予選最終日の SG/G1/G2 の節がこの日は無い");
    await expect(
      page.getByText(/準優の目安\s*\d+位\s*\d+\.\d\d/).first(),
    ).toBeVisible();
    await expect(page.getByText(/（確定）/)).toHaveCount(0);
  });

  test("[spec FR-1.4] 予選最終日は残り走数を出し、残り0走の選手には必要得点を出さない", async ({
    page,
  }) => {
    test.slow();
    const url = await findMeetAtStage(page, /^予選最終日$/);
    test.skip(url === null, "予選最終日の SG/G1/G2 の節がこの日は無い");

    const rows = rankedRows(page);
    await expect(rows.first()).toBeVisible();
    const texts = await rows.allInnerTexts();
    expect(texts.some((t) => /残り\s*\d+\s*走/.test(t))).toBe(true);
    const finished = texts.filter((t) => /残り\s*0\s*走/.test(t));
    for (const t of finished) expect(t).not.toMatch(/あと\s*[\d.]+\s*点/);
  });

  test("[spec FR-1.4] 予選最終日は「勝負駆けだけ」で行を絞り込め、「全員」で戻せる", async ({
    page,
  }) => {
    test.slow();
    const url = await findMeetAtStage(page, /^予選最終日$/);
    test.skip(url === null, "予選最終日の SG/G1/G2 の節がこの日は無い");

    const rows = rankedRows(page);
    await expect(rows.first()).toBeVisible();
    const all = await rows.count();

    const control = (label) =>
      page
        .getByRole("button", { name: label })
        .or(page.getByRole("tab", { name: label }))
        .or(page.getByRole("radio", { name: label }))
        .first();

    await control("勝負駆けだけ").click();
    await expect.poll(() => rows.count()).toBeLessThan(all);

    await control("全員").click();
    await expect.poll(() => rows.count()).toBe(all);
  });

  test("[spec FR-1.5] 予選中は準優勝戦の番組がまだである案内が出る", async ({
    page,
  }) => {
    test.slow();
    const url = await findMeetAtStage(page, /^(予選中|予選最終日)$/);
    test.skip(url === null, "予選中・予選最終日の SG/G1/G2 の節がこの日は無い");
    await expect(
      page.getByText(/準優勝戦の番組は予選終了後に発表/).first(),
    ).toBeVisible();
  });
});

test.describe("sitemap", () => {
  // sitemap は毎晩 CI で生成するファイルで、dev サーバーでは返らないことがある（依頼元の指示）。
  // public/sitemap.xml を直接読み、無ければ skip する。
  const publicDir = path.resolve(process.cwd(), "public");
  const rootSitemap = path.join(publicDir, "sitemap.xml");

  const readSitemapUrls = () => {
    const root = fs.readFileSync(rootSitemap, "utf8");
    if (!root.includes("<sitemapindex")) return root.split("<url>").slice(1);
    return [...root.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => path.join(publicDir, new URL(m[1]).pathname))
      .filter((p) => fs.existsSync(p))
      .flatMap((p) => fs.readFileSync(p, "utf8").split("<url>").slice(1));
  };

  test("[spec FR-1.7] sitemap に児島の節の URL が lastmod=最終日（2026-10-03）で載る", async () => {
    test.skip(
      !fs.existsSync(rootSitemap),
      "public/sitemap.xml が無い（CI で生成するファイル）",
    );
    const entry = readSitemapUrls().find((u) =>
      /<loc>[^<]*\/venue\/16\/meet\/2026-09-28<\/loc>/.test(u),
    );
    expect(entry, "sitemap に /venue/16/meet/2026-09-28 が無い").toBeTruthy();
    expect(entry).toMatch(/<lastmod>2026-10-03/);
  });
});
