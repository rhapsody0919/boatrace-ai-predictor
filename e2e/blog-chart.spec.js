/**
 * ブログの図（src/components/blog/BlogChart.jsx、契約 docs/design/blog-charts/contract.md、
 * 承認したモック docs/design/blog-charts/mock/APPROVED.md）。
 *
 * 図を使う記事はまだ無いので、既存の記事の .md と図の JSON を route で差し替えて描く。
 * JSON は契約の例（docs/design/blog-charts/example-venue-course-win.json、24会場＋全国・直近1年の実データ）。
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const ARTICLE = "fukuoka-water-wind-guide";
const CHART_URL = "/blog-charts/test-course-win.json";
const example = JSON.parse(
  readFileSync(
    new URL(
      "../docs/design/blog-charts/example-venue-course-win.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const markdown = [
  "# 図のテスト",
  "",
  "直近1年、福岡の1コースの1着率は59.2%（2,363レース中1,400回）。全国の55.5%より高い。",
  "",
  `<ryujin-chart src="${CHART_URL}" rows="6"></ryujin-chart>`,
  "",
  "図の下の段落。",
  "",
].join("\n");

/** 記事の .md と図の JSON を差し替える。chartDelay で JSON の返事を遅らせる */
async function stubArticle(
  page,
  { chart = example, chartStatus = 200, chartDelay = 0 } = {},
) {
  await page.route(`**/blog/${ARTICLE}.md`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      body: markdown,
    }),
  );
  await page.route(`**${CHART_URL}`, async (route) => {
    if (chartDelay) await new Promise((r) => setTimeout(r, chartDelay));
    await route.fulfill({
      status: chartStatus,
      contentType: "application/json",
      body: JSON.stringify(chart),
    });
  });
}

const chartLocator = (page) =>
  page.locator(".blog-post-content figure.blog-chart");

test.describe("ブログの図", () => {
  test("開いた時点で既定の会場（福岡）の答え・札・6行の値が文字で出る", async ({
    page,
  }) => {
    await stubArticle(page);
    await page.goto(`/blog/${ARTICLE}`);
    const chart = chartLocator(page);
    await expect(chart).toHaveAttribute("data-chart-state", "ready");
    await expect(chart.locator(".blog-chart__title")).toHaveText(
      "進入コース別の1着率",
    );
    await expect(chart.locator(".blog-chart__answer")).toContainText(
      "59.2%（2,363レース中1,400回）",
    );
    await expect(chart.locator(".blog-chart__badges")).toHaveText(
      /福岡.*2025\/10\/20〜2026\/10\/19.*全2,363レース/,
    );
    const values = chart.locator(".blog-chart__value");
    await expect(values).toHaveCount(6);
    await expect(values.first()).toHaveText("59.2%");
    // 1着が30回未満の行（福岡の6コースは19回）は回数を添える
    await expect(values.nth(5)).toHaveText("0.8%（19回）");
    await expect(values.nth(4)).toHaveText("3.6%");
    // 進入コースの行には艇の色の印を付けない（枠番と誤読される）
    await expect(chart.locator(".blog-chart__boat")).toHaveCount(0);
    await expect(chart.locator("figcaption")).toContainText(
      "出典: ボートレース公式の競走成績（龍神レーダー集計）（集計日 2026/10/20）",
    );
  });

  test("図は段落の中に入らない（p の中に figure を置かない）", async ({
    page,
  }) => {
    await stubArticle(page);
    await page.goto(`/blog/${ARTICLE}`);
    await expect(chartLocator(page)).toHaveAttribute(
      "data-chart-state",
      "ready",
    );
    await expect(page.locator(".blog-post-content p figure")).toHaveCount(0);
    await expect(
      page.locator(".blog-post-content p:has(ryujin-chart)"),
    ).toHaveCount(0);
  });

  test("会場を切り替えると、棒・値・札が替わる（25の選択肢は選ぶ箱）", async ({
    page,
  }) => {
    await stubArticle(page);
    await page.goto(`/blog/${ARTICLE}`);
    const chart = chartLocator(page);
    const select = chart.locator("select");
    await expect(select).toHaveValue("22");
    await select.selectOption("02");
    await expect(chart.locator(".blog-chart__badges")).toHaveText(
      /戸田.*全2,256レース/,
    );
    await expect(chart.locator(".blog-chart__value").first()).toHaveText(
      "42.6%",
    );
  });

  test("選択肢が6つまでならボタンで切り替える", async ({ page }) => {
    const small = {
      ...example,
      description:
        "直近1年の1コースの1着率は、戸田が42.6%、福岡が59.2%、徳山が61.6%。",
      switch: { label: "会場", default: "02" },
      views: example.views.filter((v) => ["02", "22", "18"].includes(v.key)),
    };
    await stubArticle(page, { chart: small });
    await page.goto(`/blog/${ARTICLE}`);
    const chart = chartLocator(page);
    const buttons = chart.locator(".blog-chart__buttons button");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.first()).toHaveAttribute("aria-pressed", "true");
    const tokuyama = buttons.filter({ hasText: "徳山" });
    await tokuyama.click();
    await expect(tokuyama).toHaveAttribute("aria-pressed", "true");
    await expect(chart.locator(".blog-chart__value").first()).toHaveText(
      "61.6%",
    );
  });

  test("読み込み中から描き終わるまで、図の高さで下の段落が動かない（CLS）", async ({
    page,
  }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await stubArticle(page, { chartDelay: 800 });
      await page.goto(`/blog/${ARTICLE}`);
      const chart = chartLocator(page);
      await expect(chart).toHaveAttribute("data-chart-state", "loading");
      const below = page.locator(".blog-post-content p", {
        hasText: "図の下の段落。",
      });
      const before = await below.boundingBox();
      await expect(chart).toHaveAttribute("data-chart-state", "ready");
      const after = await below.boundingBox();
      expect(
        Math.abs(after.y - before.y),
        `${width}px: 下の段落の移動`,
      ).toBeLessThanOrEqual(1);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("JSON が取れない・契約に合わないときは、同じ場所に失敗を出す（データなしにしない）", async ({
    page,
  }) => {
    await stubArticle(page, { chartStatus: 404 });
    await page.goto(`/blog/${ARTICLE}`);
    const chart = chartLocator(page);
    await expect(chart).toHaveAttribute("data-chart-state", "error");
    await expect(chart).toContainText(
      "図のデータを読み込めませんでした。ページを読み込み直してください。",
    );
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubArticle(page, { chart: { ...example, kind: "pie" } });
    await page.goto(`/blog/${ARTICLE}`);
    await expect(chartLocator(page)).toHaveAttribute(
      "data-chart-state",
      "error",
    );
  });

  test("375〜1920px で図が横にはみ出さず、値の文字がカードの中に収まる", async ({
    page,
  }) => {
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await stubArticle(page);
      await page.goto(`/blog/${ARTICLE}`);
      const chart = chartLocator(page);
      await expect(chart).toHaveAttribute("data-chart-state", "ready");
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${width}px: ページの横はみ出し`).toBeLessThanOrEqual(0);
      const box = await chart.boundingBox();
      for (const v of await chart.locator(".blog-chart__value").all()) {
        const vb = await v.boundingBox();
        expect(
          vb.x + vb.width,
          `${width}px: 値「${await v.textContent()}」がカードの右端を越える`,
        ).toBeLessThanOrEqual(box.x + box.width);
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("ダークでも棒と値の文字が見える（値の文字は意味のトークン）", async ({
    page,
  }) => {
    await stubArticle(page);
    await page.goto(`/blog/${ARTICLE}`);
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    const chart = chartLocator(page);
    await expect(chart).toHaveAttribute("data-chart-state", "ready");
    const colors = await chart.evaluate((el) => ({
      fill: getComputedStyle(el.querySelector(".blog-chart__fill"))
        .backgroundColor,
      value: getComputedStyle(el.querySelector(".blog-chart__value")).color,
      card: getComputedStyle(el).backgroundColor,
    }));
    expect(colors.fill).toBe("rgb(201, 162, 39)");
    expect(colors.value).not.toBe(colors.card);
  });
});
