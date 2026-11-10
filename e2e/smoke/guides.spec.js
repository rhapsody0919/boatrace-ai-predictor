// 旧 e2e/smoke.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect } from "../fixtures.js";

// BOA-505: 各言語の入門ガイドもタブの名前と並び順を載せる。名前は raceTabs.* の訳と一致させる
test.describe("各言語ガイドがレース詳細のタブ構成に追随している（BOA-505）", () => {
  const CASES = [
    [
      "/en/guide",
      [
        "Basic Info",
        "AI Prediction",
        "This Series",
        "Just Before",
        "Lane Stats",
        "Motor Info",
        "Odds List",
        "Result",
      ],
    ],
    [
      "/zh-TW/guide",
      [
        "基本資訊",
        "AI預測",
        "本梯次",
        "臨場資訊",
        "艇號別資訊",
        "馬達資訊",
        "賠率一覽",
        "結果",
      ],
    ],
    [
      "/ko/guide",
      [
        "기본 정보",
        "AI 예상",
        "이번 시리즈",
        "직전 정보",
        "번호별 정보",
        "모터 정보",
        "오즈 일람",
        "결과",
      ],
    ],
  ];
  for (const [path, tabs] of CASES) {
    test(`${path} に全タブが実際の並び順で載っている`, async ({ page }) => {
      await page.goto(path);
      const items = page.locator(".eg-race-tabs li");
      await expect(items).toHaveCount(tabs.length);
      for (const [index, tab] of tabs.entries()) {
        await expect(items.nth(index).locator("strong")).toHaveText(tab);
      }
    });
  }
});

test.describe("静的ガイドがレース詳細のタブ構成に追随している（BOA-456フォローアップ）", () => {
  // レース詳細がタブ構成になったあと、/how-to-use だけが追随し /about・/faq は
  // 「結果」タブにしか触れていなかった。同じ取りこぼしを繰り返さないよう、
  // タブの名前と**並び順**が両ページに載っていることを機械的に固定する。
  // 正本は PredictionPanel.jsx の tabs 配列（粒度順。結果は isFinished のときだけ）
  const TABS = [
    "基本情報",
    "AI予想",
    "今節",
    "直前情報",
    "枠別情報",
    "モータ情報",
    "オッズ一覧",
    "結果",
  ];

  test("/about に全タブが実際の並び順で載っている", async ({ page }) => {
    await page.goto("/about");
    const list = page.locator(".about-tab-list");
    await expect(list).toBeVisible();
    await expect(list.locator("li")).toHaveCount(TABS.length);
    // 並べ替え（BOA-454）に追随できていないと、名前が揃っていても順序で落ちる
    for (const [index, tab] of TABS.entries()) {
      await expect(list.locator("li").nth(index)).toContainText(tab);
    }
    // 発走前は7つ・確定すると8つ、という本数の条件も落とさない
    await expect(list.locator("li").last()).toContainText(
      "確定するまでこのタブは出ません",
    );
    // 詳しい手順は使い方ガイドが正本なので、そこへの導線を保つ
    await expect(
      page.locator('.about-section a[href="/how-to-use"]'),
    ).toHaveCount(1);
  });

  test("/faq のタブ説明に全タブが実際の並び順で載っている", async ({
    page,
  }) => {
    await page.goto("/faq");
    const question = page
      .locator(".faq-question")
      .filter({ hasText: "レース詳細ページのタブは何が違うのですか？" });
    await expect(question).toHaveCount(1);
    await question.click();
    const answer = page.locator(".faq-item.open .faq-answer p").first();
    const text = await answer.innerText();
    // 【タブ名】の登場順が実際の並び順と一致していること
    const order = TABS.map((tab) => text.indexOf(`【${tab}】`));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 発走前7つ・確定で8つ、という本数の条件
    expect(text).toContain("発走前は7つ");
    expect(text).toContain("8つになります");
  });

  test("FAQの回答の改行が段落として表示される（空白に潰れない）", async ({
    page,
  }) => {
    // 回答データは「【展開予測】…改行…【イン崩れ指数】…」と改行で項目を区切るが、
    // .faq-answer p が white-space: normal のままだと改行が空白に潰れ、
    // 項目が1段落に繋がって読めなくなる（2026-09-28に実測で発見）
    await page.goto("/faq");
    const question = page
      .locator(".faq-question")
      .filter({ hasText: "展開予測・イン崩れ指数の違いは何ですか？" });
    await question.click();
    const answer = page.locator(".faq-item.open .faq-answer p").first();
    await expect(answer).toBeVisible();
    const text = await answer.innerText();
    expect(text).toContain("\n");
    expect(text).toContain("【展開予測】");
    expect(text).toContain("【イン崩れ指数】");
  });

  test("旧UIの文言が /faq に残っていない", async ({ page }) => {
    await page.goto("/faq");
    // 全問の回答を集める。アコーディオンは1問ずつしか開かないため、当初は
    // 25問を順にクリックして開閉していたが、アニメーションぶんの待ちが積もって
    // 60秒のテストtimeoutに掛かった（実測38秒→質問追加で超過）。
    // FAQPage の JSON-LD は FAQ.jsx の faqs 配列から機械生成されており
    // 全回答の原文を持っているので、そちらを読めば同じことを決定的に検査できる
    const answers = await page.evaluate(() => {
      const schema = [
        ...document.querySelectorAll('script[type="application/ld+json"]'),
      ]
        .map((node) => {
          try {
            return JSON.parse(node.textContent);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed["@type"] === "FAQPage");
      return schema
        ? schema.mainEntity.map((q) => q.acceptedAnswer.text).join("\n")
        : null;
    });
    // schemaが取れないと「文言が無い」を無条件に満たしてしまうので先に押さえる
    expect(answers).not.toBeNull();
    expect(answers).toContain("詳細を見る");
    // ボタンは raceCard.view =「詳細を見る」、的中はヘッダーナビ nav.hits
    expect(answers).not.toContain("データ分析を見る");
    expect(answers).not.toContain("トップページの「的中レース」タブ");
  });
});
