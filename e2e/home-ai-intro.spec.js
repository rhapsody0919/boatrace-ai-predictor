import { test, expect } from "./fixtures.js";

/**
 * トップの「龍神レーダーのボートレースAI予想」セクション（集客レーン Phase3）の固定。
 *
 * - 本文（見出し・説明）と /accuracy・/hit-races へのリンクは常に出る
 * - 的中率・回収率の数値は出さない（2026-10-01 ユーザー判断。展開予測の実測的中率は、決まり手を見ずに
 *   判定しており、予想なしの基準を下回ることが分かった。BOA-617）
 * - 言語プレフィックス付きのトップでも、日本語のみのページへは言語プレフィックス無しでリンクする
 */

test.describe("トップのAI予想説明セクション", () => {
  test("本文とリンクが出て、的中率・回収率の数値は出さない", async ({
    page,
  }) => {
    let accuracyRequested = false;
    page.on("request", (req) => {
      if (req.url().includes("/rest/v1/accuracy_cache")) {
        accuracyRequested = true;
      }
    });
    await page.goto("/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "龍神レーダーのボートレースAI予想",
    );
    await expect(section).toContainText("全国24場");
    await expect(section).not.toContainText("的中率");
    await expect(section).not.toContainText("回収率");
    await expect(section).not.toContainText("%");

    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);

    // トップは実績の数値を取りに行かない（このセクションのために accuracy_cache を読まない）
    expect(accuracyRequested).toBe(false);
  });

  test("英語のトップでも日本語ページへは言語プレフィックス無しでリンクする", async ({
    page,
  }) => {
    await page.goto("/en/");

    const section = page.locator(".home-ai-intro");
    await expect(section.locator("h2")).toHaveText(
      "Ryujin Radar's AI Boat Race Predictions",
    );
    await expect(section).not.toContainText("hit rate");
    const hrefs = await section
      .locator(".home-ai-intro__links a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(["/accuracy", "/hit-races"]);
  });
});

// SEO 施策 B1（2026-10-11 ユーザー承認のモック）。トップの AI 説明に、龍神ソナー・思考アシストで
// 答えられる問いと操作順を足し、2段落目から廃止の方向の「展開予測」「イン崩れ指数」の説明を外した
test.describe("ソナー・思考アシストの問いと操作順（B1）", () => {
  test.describe.configure({ timeout: 120000 });

  const intro = (page) => page.locator(".home-ai-intro");

  test("ja: ソナーと思考アシストのカード、3段の操作、会場一覧へのリンクがある", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section.locator(".home-ai-intro__tool")).toHaveCount(2);
    await expect(section).toContainText("龍神ソナー");
    await expect(section).toContainText("思考アシスト");
    await expect(section.locator(".home-ai-intro__steps li")).toHaveCount(3);
    // 2段目は会場カードの実際のボタン名を使う
    await expect(
      section.locator(".home-ai-intro__steps li").nth(1),
    ).toContainText("「詳細を見る」");
    // 2段落目に廃止の方向の機能名を出さない
    const method = section.locator("p").nth(1);
    await expect(method).not.toContainText("展開予測");
    await expect(method).not.toContainText("イン崩れ指数");
    // 「開催中の会場から選ぶ」で会場一覧へ飛ぶ
    const link = section.locator(".home-ai-intro__venues-link");
    await expect(link).toHaveAttribute("href", "#today-venues");
    await expect(page.locator("#today-venues")).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/#today-venues$/);
  });

  test("en: 思考アシスト（ja だけの切り替え）は出さず、ソナーだけの操作にする", async ({
    page,
  }) => {
    await page.goto("/en/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section.locator(".home-ai-intro__tool")).toHaveCount(1);
    await expect(section).toContainText("Ryujin Sonar");
    await expect(section).not.toContainText("Thinking Assist");
    await expect(section.locator(".home-ai-intro__steps li").nth(2)).toHaveText(
      'Open the "Ryujin Sonar" tab',
    );
  });

  test("375px: カードが縦に並び、横にはみ出さず、リンクの高さは44px以上", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    const tools = section.locator(".home-ai-intro__tool");
    const a = await tools.nth(0).boundingBox();
    const b = await tools.nth(1).boundingBox();
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const link = await section
      .locator(".home-ai-intro__venues-link")
      .boundingBox();
    expect(link.height).toBeGreaterThanOrEqual(44);
  });
});

// SEO 施策 A2（2026-10-12 オーナー承認の原稿）。トップの AI 説明に短文とよくある質問5問を足した。
// 答えは <details> の中にあり、閉じていても DOM にある。FAQPage の JSON-LD は画面の問いと答えと同じ文字列
test.describe("よくある質問と FAQPage（A2）", () => {
  test.describe.configure({ timeout: 120000 });

  const intro = (page) => page.locator(".home-ai-intro");

  // 画面の問いと答え（summary と p の文字列）を順に取る
  const readFaq = (section) =>
    section.locator(".home-ai-intro__faq-item").evaluateAll((items) =>
      items.map((d) => ({
        question: d.querySelector("summary").textContent.trim(),
        answer: d.querySelector("p").textContent.trim(),
      })),
    );

  // ページ内の FAQPage の JSON-LD（ちょうど1つ）を問いと答えの組にして返す
  const readFaqLd = async (page) => {
    const lds = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((ss) => ss.map((s) => JSON.parse(s.textContent)));
    const faq = lds.filter((ld) => ld["@type"] === "FAQPage");
    expect(faq).toHaveLength(1);
    return faq[0].mainEntity.map((q) => ({
      question: q.name,
      answer: q.acceptedAnswer.text,
    }));
  };

  test("ja: 短文とよくある質問5問が出て、答えは閉じていても DOM にある", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section.locator(".home-ai-intro__tools-intro")).toContainText(
      "思考アシストでは",
    );
    await expect(section.locator(".home-ai-intro__faq h3")).toHaveText(
      "よくある質問",
    );
    const faq = await readFaq(section);
    expect(faq.map((f) => f.question)).toEqual([
      "ボートレースのAI予想は無料で見られますか？",
      "AI予想を見るとき、どのデータを確かめられますか？",
      "龍神ソナーと思考アシストは、どの順番で使いますか？",
      "展示前でも見られますか？",
      "過去の割合は、今回のレースの予測確率ですか？",
    ]);
    expect(faq.every((f) => f.answer.length > 0)).toBe(true);
    expect(faq[0].answer).toContain("無料・会員登録なし");

    // 閉じた状態で始まり、押すと答えが見える
    const first = section.locator(".home-ai-intro__faq-item").first();
    await expect(first.locator("p")).toBeHidden();
    await first.locator("summary").click();
    await expect(first.locator("p")).toBeVisible();
  });

  test("ja: FAQPage の JSON-LD は画面の問いと答えと一致し、index.html の型と重ならない", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    expect(await readFaqLd(page)).toEqual(await readFaq(section));
    // index.html の WebSite・SoftwareApplication・Organization は1つずつのまま
    const types = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((ss) => ss.map((s) => JSON.parse(s.textContent)["@type"]));
    for (const type of ["WebSite", "SoftwareApplication", "Organization"]) {
      expect(types.filter((x) => x === type)).toHaveLength(1);
    }
  });

  test("en: 思考アシストに触れず龍神ソナーだけの言い方にし、JSON-LD も画面と同じ", async ({
    page,
  }) => {
    await page.goto("/en/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    await expect(section.locator(".home-ai-intro__tools-intro")).toContainText(
      "Ryujin Sonar",
    );
    const faq = await readFaq(section);
    expect(faq).toHaveLength(5);
    expect(faq[2].question).toBe("In what order should I read Ryujin Sonar?");
    for (const f of faq) {
      expect(`${f.question} ${f.answer}`).not.toContain("Thinking Assist");
    }
    expect(await readFaqLd(page)).toEqual(faq);
  });

  test("375px: よくある質問を開いても横にはみ出さず、問いの行は44px以上", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const section = intro(page);
    await expect(section).toBeVisible({ timeout: 30000 });
    const items = section.locator(".home-ai-intro__faq-item");
    await expect(items).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await items.nth(i).locator("summary").click();
      const box = await items.nth(i).locator("summary").boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
