/**
 * ブログの図（src/components/blog/BlogChart.jsx、契約 docs/design/blog-charts/contract.md、
 * 承認したモック docs/design/blog-charts/mock/APPROVED.md）。
 *
 * 図を使う記事はまだ無いので、既存の記事の .md と図の JSON を route で差し替えて描く。
 * JSON は契約の例（docs/design/blog-charts/example-venue-course-win.json、24会場＋全国・直近1年の実データ）。
 */
import { test, expect } from "./fixtures.js";
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

/** 記事の .md と図の JSON を差し替える。chartDelay で JSON の返事を遅らせる（遅れても本文と図が同時に出ることを見る） */
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

  test("会場を切り替えると、棒・値・札・答えの文が替わる（25の選択肢は選ぶ箱）", async ({
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
    // 答えの1文も切り替えた会場のものに替わる（2026-10-20 オーナー決定、契約3節）
    await expect(chart.locator(".blog-chart__answer")).toHaveText(
      "戸田は1コースの1着率が42.6%（2,256レース中960回）で、全国の55.5%（55,414レース中30,732回）より低い。",
    );
    await expect(chart.locator(".blog-chart__value").first()).toHaveText(
      "42.6%",
    );
  });

  test("選択肢が6つまでならボタンで切り替える", async ({ page }) => {
    const small = {
      ...example,
      // 最上位の答えは既定の view（戸田）の答えと同じにする（契約3節）
      description: "戸田の1コースの1着率は42.6%。",
      switch: { label: "会場", default: "02" },
      // 全国の view を外すので、答えの文はその view の数字だけにする（検査が全国の数字を許さない）
      views: example.views
        .filter((v) => ["02", "22", "18"].includes(v.key))
        .map((v) => ({
          ...v,
          description: `${v.label}の1コースの1着率は${v.series[0].values[0]}%。`,
        })),
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
    // ボタンで切り替えても、答えの1文がその会場の文に替わる
    await expect(chart.locator(".blog-chart__answer")).toHaveText(
      "徳山の1コースの1着率は61.6%。",
    );
    await expect(chart.locator(".blog-chart__value").first()).toHaveText(
      "61.6%",
    );
  });

  // 契約の字数の上限（題40字・答え90字・注記70字）と、6つのボタン。最悪の高さでも下の段落を動かさない
  const LONGEST_ANSWER =
    "福岡は1コースの1着率が59.2%（2,363レース中1,400回）で、全国の55.5%（55,414レース中30,732回）より高い。2コースは15.0%。"
      .padEnd(90, "あ")
      .slice(0, 90);
  // 部品が描くのは選んだ view の答えなので、既定の view（福岡）の答えも上限の長さにする
  const withLongestDefault = (views) =>
    views.map((v) =>
      v.key === "22" ? { ...v, description: LONGEST_ANSWER } : v,
    );
  const longest = {
    ...example,
    title:
      "進入コース別の1着率と全国との比べ方、会場ごとの直近1年の進入コース別の1着".slice(
        0,
        40,
      ),
    description: LONGEST_ANSWER,
    views: withLongestDefault(example.views),
    note: "進入コース別（枠番ではない）。中止・不成立のレースを除く。4〜6コースは1着の件数が少なく、会場の順位は年によって変わりうる。"
      .padEnd(70, "い")
      .slice(0, 70),
  };
  const longestButtons = {
    ...longest,
    views: withLongestDefault(
      example.views
        .filter((v) => ["all", "01", "02", "03", "04", "22"].includes(v.key))
        .map((v) => ({ ...v, label: "あいう" })),
    ),
  };
  // 1件で10幅を順に開くと60秒の上限に当たり、他の PR の CI を落とした（2026-10-20 #1699）。
  // 幅ごとに1件に分ける。幅は CSS の境目（360・480・600・768/769・1024）の前後とよく使う幅（375・1440・1920）
  const CLS_WIDTHS = [320, 360, 375, 481, 600, 768, 769, 1024, 1440, 1920];
  for (const [name, chart] of [
    ["契約の例", example],
    ["字数の上限・選ぶ箱", longest],
    ["字数の上限・ボタン6つ", longestButtons],
  ]) {
    for (const width of CLS_WIDTHS) {
      test(`本文が出た最初の描画で図も出ていて、後から図の高さが変わらない（CLS、${name}、${width}px）`, async ({
        page,
      }) => {
        // 本文（.blog-post-content）が DOM に入った瞬間の、図の状態と図の高さを記録する。
        // 下の段落の位置で比べると、図より上の要素（CI の Linux でのフォントの差し替え等）の動きも拾って
        // 図と関係なく落ちる（2026-10-20 CI の 481px で 7.6px）。図が原因の動きは図の高さの変化で見る
        await page.addInitScript(() => {
          const observer = new MutationObserver(() => {
            const content = document.querySelector(".blog-post-content");
            if (!content || window.__firstPaint) return;
            const figure = content.querySelector("figure.blog-chart");
            window.__firstPaint = {
              chartState: figure?.dataset.chartState ?? null,
              height: figure ? figure.getBoundingClientRect().height : null,
            };
          });
          observer.observe(document, { childList: true, subtree: true });
        });
        await page.setViewportSize({ width, height: 900 });
        await stubArticle(page, { chart, chartDelay: 500 });
        await page.goto(`/blog/${ARTICLE}`);
        await expect(chartLocator(page)).toHaveAttribute(
          "data-chart-state",
          "ready",
        );
        const first = await page.evaluate(() => window.__firstPaint);
        expect(first.chartState, "最初の描画の図").toBe("ready");
        const afterHeight = await chartLocator(page).evaluate(
          (el) => el.getBoundingClientRect().height,
        );
        expect(
          Math.abs(afterHeight - first.height),
          "図の高さの変化",
        ).toBeLessThanOrEqual(1);
      });
    }
  }

  test("8字の行のラベルも棒に隠れず、全行で棒の始まりがそろう", async ({
    page,
  }) => {
    const chart = {
      ...example,
      rows: example.rows.map((r, i) => ({
        ...r,
        label: i === 0 ? "あいうえおかきく" : r.label,
      })),
    };
    await page.setViewportSize({ width: 375, height: 900 });
    await stubArticle(page, { chart });
    await page.goto(`/blog/${ARTICLE}`);
    const figure = chartLocator(page);
    await expect(figure).toHaveAttribute("data-chart-state", "ready");
    const boxes = await figure.evaluate((el) =>
      [...el.querySelectorAll(".blog-chart__row")].map((row) => {
        const label = row
          .querySelector(".blog-chart__label")
          .getBoundingClientRect();
        const track = row
          .querySelector(".blog-chart__track")
          .getBoundingClientRect();
        return { labelRight: label.right, trackLeft: track.left };
      }),
    );
    for (const b of boxes)
      expect(b.labelRight).toBeLessThanOrEqual(b.trackLeft);
    expect(new Set(boxes.map((b) => Math.round(b.trackLeft))).size).toBe(1);
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
    await stubArticle(page, { chart: { ...example, kind: "pie" } });
    await page.goto(`/blog/${ARTICLE}`);
    await expect(chartLocator(page)).toHaveAttribute(
      "data-chart-state",
      "error",
    );
  });

  // 幅ごとに1件（1件で全幅を順に開くと CI で60秒の上限に近づく。2026-10-20 #1699）
  for (const width of [375, 768, 1024, 1440, 1920]) {
    test(`${width}px で図が横にはみ出さず、値の文字がカードの中に収まる`, async ({
      page,
    }) => {
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
    });
  }

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
  test("同じ図を2回置いても id が重ならず、図の名前は目次に入らない", async ({
    page,
  }) => {
    await page.route(`**/blog/${ARTICLE}.md`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: `# t\n\n## 見出し\n\n<ryujin-chart src="${CHART_URL}" rows="6"></ryujin-chart>\n\n<ryujin-chart src="${CHART_URL}" rows="6"></ryujin-chart>\n\n本文\n`,
      }),
    );
    await page.route(`**${CHART_URL}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(example),
      }),
    );
    await page.goto(`/blog/${ARTICLE}`);
    await expect(
      page.locator('figure.blog-chart[data-chart-state="ready"]'),
    ).toHaveCount(2);
    const ids = await page
      .locator("figure.blog-chart [id]")
      .evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.locator(".blog-post-content h3")).toHaveCount(0);
  });

  test("src が無い（許可リストで落ちた）タグは、取りに行かずに失敗を出す", async ({
    page,
  }) => {
    await page.route(`**/blog/${ARTICLE}.md`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: '# t\n\n<ryujin-chart src="https://example.com/x.json" rows="6"></ryujin-chart>\n\n本文\n',
      }),
    );
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(`/blog/${ARTICLE}`);
    await expect(chartLocator(page)).toHaveAttribute(
      "data-chart-state",
      "error",
    );
    expect(
      requested.filter(
        (u) => u.includes("example.com") || u.endsWith("/undefined"),
      ),
    ).toEqual([]);
  });
});

test.describe("ブログの図（ブラウザの言語がドイツ語）", () => {
  test.use({ locale: "de-DE" });
  test("札の母数の桁区切りはブラウザの言語に左右されない", async ({ page }) => {
    await stubArticle(page);
    await page.goto(`/blog/${ARTICLE}`);
    await expect(
      chartLocator(page).locator(".blog-chart__badges"),
    ).toContainText("全2,363レース");
  });
});

test.describe("ブログの図（記事を移るとき）", () => {
  test("図の取得が遅い記事から別の記事へ移っても、前の記事の本文で上書きされない", async ({
    page,
  }) => {
    const OTHER = "10000-races-analysis";
    await stubArticle(page, { chartDelay: 3000 });
    await page.route(`**/blog/${OTHER}.md`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: "# 移った先の記事\n\n移った先の本文。\n",
      }),
    );
    await page.goto(`/blog/${ARTICLE}`);
    await page.waitForTimeout(300);
    await page.evaluate((other) => {
      window.history.pushState({}, "", `/blog/${other}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, OTHER);
    await expect(page.locator(".blog-post-content")).toContainText(
      "移った先の本文。",
    );
    // 前の記事の図の JSON が返った後（3秒後）も、移った先の本文のまま
    await page.waitForTimeout(3500);
    await expect(page.locator(".blog-post-content")).toContainText(
      "移った先の本文。",
    );
    await expect(page.locator(".blog-post-content")).not.toContainText(
      "図の下の段落。",
    );
  });

  test("コードブロックの中に書いたタグの JSON は取りに行かない", async ({
    page,
  }) => {
    await page.route(`**/blog/${ARTICLE}.md`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: '# t\n\n```\n<ryujin-chart src="/blog-charts/in-code.json" rows="6"></ryujin-chart>\n```\n\n本文\n',
      }),
    );
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(`/blog/${ARTICLE}`);
    await expect(page.locator(".blog-post-content")).toContainText("本文");
    expect(requested.filter((u) => u.includes("in-code.json"))).toEqual([]);
  });
});
