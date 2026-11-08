import { test, expect } from "../fixtures.js";
import { gotoAndSettle, inspectGrids, expectNoWastedGrids } from "./helpers.js";

for (const theme of ["light", "dark"]) {
  for (const target of [
    {
      name: "注目記事",
      path: "/",
      selector: ".blog-preview-grid >> nth=0",
      card: ".blog-preview-card",
    },
    {
      name: "新着記事",
      path: "/",
      selector: ".blog-preview-grid >> nth=1",
      card: ".blog-preview-card",
    },
    {
      name: "ガイド",
      path: "/guide",
      selector: ".article-grid",
      card: ".article-card",
    },
  ]) {
    test(`BOA-1014: ${target.name}のカードが${theme}のホバー後も読める @blog`, async ({
      page,
    }) => {
      await page.goto(target.path);
      const card = page
        .locator(target.selector)
        .first()
        .locator(target.card)
        .first();
      await expect(card).toBeVisible();
      await page.mouse.move(0, 0);
      await page.evaluate((theme) => {
        document.documentElement.setAttribute("data-theme", theme);
      }, theme);
      const background =
        theme === "dark" ? "rgb(13, 27, 46)" : "rgb(247, 243, 234)";
      await expect(card).toHaveCSS("background-color", background);
      const before = await card.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await card.hover();
      await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -4)");
      const colors = await card.evaluate((element) => {
        // WCAG の sRGB 相対輝度。透明色を不透明色として誤判定しない。
        const luminance = (color) => {
          const channels = color.match(/[\d.]+/g).map(Number);
          if (channels.length === 4 && channels[3] !== 1) {
            throw new Error(`透明な色: ${color}`);
          }
          const [r, g, b] = channels.slice(0, 3).map((value) => {
            const s = value / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const style = getComputedStyle(element);
        const bg = luminance(style.backgroundColor);
        const contrast = (selector) => {
          const fg = luminance(
            getComputedStyle(element.querySelector(selector)).color,
          );
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        };
        const probe = document.createElement("span");
        probe.style.borderColor = "var(--brand-accent-secondary)";
        probe.style.boxShadow = "var(--shadow-xl)";
        element.append(probe);
        const tokenStyle = getComputedStyle(probe);
        const result = {
          background: style.backgroundColor,
          title: contrast("h3"),
          description: contrast("p"),
          border: style.borderTopColor,
          shadow: style.boxShadow,
          expectedBorder: tokenStyle.borderTopColor,
          expectedShadow: tokenStyle.boxShadow,
        };
        probe.remove();
        return result;
      });
      expect.soft(colors.title, JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
      expect
        .soft(colors.description, JSON.stringify(colors))
        .toBeGreaterThanOrEqual(4.5);
      expect.soft(colors.background).toBe(before);
      expect.soft(colors.border).toBe(colors.expectedBorder);
      expect.soft(colors.shadow).toBe(colors.expectedShadow);
    });
  }
}

for (const path of [
  "/blog/10000-races-analysis",
  "/en/blog/10000-races-analysis",
]) {
  test(`ブログ記事の戻るリンクとカテゴリに375pxで余白がある: ${path} @blog`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    const header = page.locator(".blog-post-header");
    await expect(header.locator(".back-link")).toBeVisible();
    await expect(header.locator(".category-badge")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.evaluate(() => document.fonts.ready);
    const spacing = await header.evaluate((element) => {
      const link = element.querySelector(".back-link").getBoundingClientRect();
      const badge = element
        .querySelector(".category-badge")
        .getBoundingClientRect();
      return {
        horizontal: badge.left - link.right,
        wrapped: badge.top >= link.bottom,
      };
    });
    expect(
      spacing.wrapped || spacing.horizontal >= 8,
      JSON.stringify(spacing),
    ).toBe(true);
  });
}

for (const venue of ["heiwajima", "biwako", "marugame"]) {
  test(`ブログ記事の表: ${venue} の1列目が375pxで折り返さない @blog`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/blog/${venue}-water-wind-guide`);
    const tables = page.locator(".blog-post-content table");
    await expect(tables.first()).toBeVisible();
    // 1列目の文字が何行になったかを、文字の行の矩形の上端の数で数える（BOA-870）。
    // セルの高さは2列目以降の折り返しでも伸びるので、1列目の折り返しの判定には使わない
    const measurements = await tables.evaluateAll((elements) =>
      elements.map((table) => {
        const lines = [...table.querySelectorAll("tr > :first-child")]
          .filter((cell) => cell.textContent.trim())
          .map((cell) => {
            const range = document.createRange();
            range.selectNodeContents(cell);
            // 太字などで同じ行でも上端が少しずれるので、4px 以内は同じ行とみなす
            const tops = [...range.getClientRects()]
              .filter((r) => r.width > 0)
              .map((r) => r.top)
              .sort((x, y) => x - y);
            const lines = tops.filter(
              (t, i) => i === 0 || t - tops[i - 1] > 4,
            ).length;
            return { label: cell.textContent.trim(), lines };
          });
        return {
          lines,
          laterColumns: [
            ...table.querySelectorAll(
              "th:not(:first-child), td:not(:first-child)",
            ),
          ].map((element) => getComputedStyle(element).whiteSpace),
          overflowX: getComputedStyle(table).overflowX,
        };
      }),
    );
    expect(measurements.length).toBeGreaterThan(0);
    for (const measurement of measurements) {
      const wrapped = measurement.lines.filter((l) => l.lines > 1);
      expect(wrapped, `${venue}: 1列目が折り返したセル`).toEqual([]);
      expect(measurement.laterColumns).not.toContain("nowrap");
      expect(measurement.overflowX).toBe("auto");
    }
  });
}

/**
 * BOA-528 の再現テスト（/blog のカテゴリ絞り込み）。
 *
 * `/blog` の記事一覧（`.blog-grid`）は `repeat(auto-fill, minmax(320px, 1fr))` で
 * 並んでいた。上の PAGES は「すべて」（121件）のまま測るため列が埋まって通るが、
 * カテゴリで絞ると件数が列数を下回る（「リスク管理」1件・「実績分析」2件・
 * 「上級者向け」3件）。1440px以上は3列なので、1件のカテゴリで右に2列分の空白が残る。
 *
 * 記事はバンドルされた静的データ（src/data/blog-posts/*.json）なので、本番データにも
 * 通信にも依存しない。カテゴリを全部押して、そのたびにグリッドを検査する。
 */
test.describe("レイアウト: /blog はカテゴリで絞って件数が列数より少なくても幅を余らせない（BOA-528） @blog", () => {
  test("どのカテゴリでも空トラックが出ない", async ({ page }) => {
    await gotoAndSettle(page, "/blog");
    const grid = page.locator(".blog-grid");
    await expect(grid.locator(":scope > *").first()).toBeVisible();

    const buttons = page.locator(".category-filter button");
    const total = await buttons.count();
    expect(total, "カテゴリのボタンが見つかりません").toBeGreaterThan(1);

    const counts = {};
    const found = [];
    // 先頭は「すべて」。PAGES の検査で見ているので飛ばす
    for (let i = 1; i < total; i += 1) {
      const button = buttons.nth(i);
      const category = (await button.textContent()).trim();
      await button.click();
      await expect(button).toHaveClass(/active/);
      counts[category] = await grid.locator(":scope > *").count();
      const result = await inspectGrids(page);
      for (const f of result.found) found.push({ category, ...f });
    }

    // 件数の少ないカテゴリが無くなると、このテストは何も検査しなくなる
    // （無言の空振り対策）。1440px以上の3列を下回るカテゴリが残っていることを確かめる
    expect(
      Math.min(...Object.values(counts)),
      `列数を下回るカテゴリがありません: ${JSON.stringify(counts)}`,
    ).toBeLessThanOrEqual(2);

    expectNoWastedGrids({ found, gridsChecked: total - 1 });
  });
});

for (const theme of ["light", "dark"]) {
  test(`BOA-1010: スコープ外に戻るリンクの基本指定が漏れない ${theme} @blog`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/blog/10000-races-analysis");
    await expect(page.locator(".blog-post-header .back-link")).toBeVisible();
    const styles = await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      const link = document.createElement("a");
      link.className = "back-link";
      link.href = "#";
      link.textContent = "x";
      document.body.append(link);
      const style = getComputedStyle(link);
      const result = { display: style.display, weight: style.fontWeight };
      link.remove();
      return result;
    }, theme);
    expect(styles).toEqual({ display: "inline", weight: "400" });
  });

  test(`BOA-1010: ブログの戻るリンクの色・ホバー・余白を保つ ${theme} @blog`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/blog/10000-races-analysis");
    const link = page.locator(".blog-post-header .back-link");
    await expect(link).toBeVisible();
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, theme);
    const tokenColor = (token) => page.evaluate((token) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, token);
    const spacing = await link.evaluate((link) => {
      const probe = document.createElement("span");
      probe.style.marginRight = "var(--spacing-3)";
      link.parentElement.append(probe);
      const margin = getComputedStyle(probe).marginRight;
      probe.remove();
      return margin;
    });
    await expect(link).toHaveCSS("color", await tokenColor("--brand-accent-secondary"));
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await expect(link).toHaveCSS("margin-right", spacing);
    await expect(link).toHaveCSS("display", "inline-block");
    await expect(link).toHaveCSS("font-weight", "500");
    await link.hover();
    await expect(link).toHaveCSS("color", await tokenColor("--text-primary"));
    await expect(link).toHaveCSS("text-decoration-line", "underline");
  });

  test(`BOA-1010: レース詳細の空状態の戻るリンクの表示を保つ ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/invalid");
    const link = page.locator(".race-detail-page-v2__empty .back-link");
    await expect(link).toBeVisible();
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, theme);
    await expect(link).toHaveCSS("display", "block");
    await expect(link).toHaveCSS("font-weight", "500");
    await expect(link).toHaveCSS("margin-bottom", "16px");
  });
}
