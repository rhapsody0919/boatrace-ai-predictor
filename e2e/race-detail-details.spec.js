import { test, expect } from "./fixtures.js";

// レース詳細の表示の細部（BOA-613・618・619）
const RACE = "/race/2026-09-29-16-12"; // 児島12R（ピットレポートあり）

test.describe("レース詳細の表示の細部", () => {
  test.slow();

  test("直前情報の展示タイム: 数値は13px、1号艇の白い棒に輪郭、ツールチップの項目名は「展示タイム」（BOA-613・618）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    // 展示タイムの数値ラベル（6.58 等）を持つグラフ
    const timeLabel = page
      .locator(".recharts-label-list .recharts-label")
      .filter({ hasText: /^\d\.\d{2}$/ });
    const chart = page
      .locator(".recharts-wrapper")
      .filter({ has: timeLabel })
      .first();
    await expect(chart).toBeVisible({ timeout: 30000 });
    const label = chart.locator(".recharts-label-list .recharts-label").first();
    // Recharts は描画のアニメーション中にラベルを差し替えるため、落ち着くまで読み直す
    // （差し替え直後の要素では computed の font-size が空文字になり NaN になった）
    await expect
      .poll(async () =>
        Number.parseFloat(
          await label.evaluate((el) => getComputedStyle(el).fontSize),
        ),
      )
      .toBeGreaterThanOrEqual(13);
    const firstBar = chart.locator(".recharts-bar-rectangle path").first();
    expect(await firstBar.getAttribute("stroke")).not.toBe("none");
    await chart.scrollIntoViewIfNeeded();
    await firstBar.hover({ force: true });
    const tip = chart.locator(".recharts-tooltip-wrapper");
    await expect(tip).toContainText("展示タイム");
    await expect(tip).not.toContainText("lead");
  });

  test("基本情報の勝率バー: 最下位の艇も棒が空にならない（BOA-618）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 30000,
    });
    // 行は値より先に出る。6本の棒に長さが付くまで読み直す（行だけを待つと、値の読み込み前に
    // 測ってしまう。CI で列見出しを読み込み前に測って落ちたのと同じ形）
    await expect
      .poll(
        async () => {
          const widths = await page
            .locator(".rbit-bar-fill")
            .evaluateAll((els) => els.map((el) => parseFloat(el.style.width)));
          return widths.length === 6 ? Math.min(...widths) : -1;
        },
        { timeout: 30000 },
      )
      .toBeGreaterThanOrEqual(10);
    // 長さは6艇の中の相対比較なので、差の大きさは数字で見るよう書き添える（ファン評価2周目 P1）
    await expect(page.locator(".rbit-relative-note")).toContainText(
      "この6艇の中での比較",
    );
  });

  test("基本情報の勝率バー: 1号艇（白）の棒の輪郭がライトモードの地と見分けられる（ファン評価1周目 P2）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 30000,
    });
    // 棒（.rbit-bar-fill）は値の読み込みが終わってから描かれる。行だけを待つと、
    // CI で棒の無い時点で測って落ちた
    const firstRow = page.locator(".rbit-bar-row").first();
    await expect(firstRow.locator(".rbit-bar-fill")).toBeVisible({
      timeout: 30000,
    });
    const [shadow, track] = await firstRow.evaluate((row) => [
      getComputedStyle(row.querySelector(".rbit-bar-fill")).boxShadow,
      getComputedStyle(row.querySelector(".rbit-bar-track")).backgroundColor,
    ]);
    const rgb = (s) =>
      s
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const [a, b] = [lum(rgb(shadow)), lum(rgb(track))];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    // 非テキストの図形のコントラストの目安（WCAG 1.4.11）は 3:1
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  test("ピットレポートの名前は全角スペースを1つの空白にまとめる（BOA-618）", async ({
    page,
  }) => {
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    const names = page.locator(".rpr-racer-name");
    await expect(names.first()).toBeVisible({ timeout: 30000 });
    const texts = await names.allTextContents();
    for (const n of texts) expect(n).not.toMatch(/　/);
  });

  test("1440・1920px: ST考察の6艇の列は等幅、枠別情報のカードの右端がそろう（BOA-619）", async ({
    page,
  }) => {
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/race/2026-09-25-01-07");
      await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
      // カードの枠はデータより先に出る。6艇の列見出しがそろうまで待ってから測る
      // （枠だけを待っていたため、CI では列が0本の時点で測って落ちた）
      const heads = page.locator(".rsc-grid thead th.rsc-boat-th");
      await expect(heads).toHaveCount(6, { timeout: 30000 });
      const cols = await heads.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().width),
      );
      expect(cols).toHaveLength(6);
      expect(Math.max(...cols) - Math.min(...cols)).toBeLessThanOrEqual(2);
      if (width === 1920) {
        const w = await page
          .locator(".rsc-card")
          .evaluate((el) => el.getBoundingClientRect().width);
        expect(w).toBeLessThanOrEqual(1200);
      }
    }
  });

  test("375px: ST考察の級別の行で、バッジの有無にかかわらず級別の高さがそろう（ファン評価2周目 P2）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 桐生7R: 5・6号艇は「F1 今節」で2段、4号艇はバッジなし
    await page.goto("/race/2026-09-25-01-07");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const grades = page.locator(".rsc-grid .rsc-cell-meta .rsc-grade");
    await expect(grades).toHaveCount(6, { timeout: 30000 });
    await expect(page.locator(".rsc-grid .flying-badge-meet")).toHaveCount(2);
    const tops = await grades.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().top),
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  });

  test("平均ST: 表示が同じ数字の艇は、棒の長さも同じ（ファン評価3周目 P2）", async ({
    page,
  }) => {
    // 児島12R: 1・3・5・6号艇がいずれも「0.13」と表示される
    await page.goto(RACE);
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await page.locator(".rbit-chip", { hasText: "平均ST" }).click();
    await expect
      .poll(
        async () =>
          page
            .locator(".rbit-bar-row")
            .evaluateAll(
              (rows) =>
                rows.filter((r) => r.querySelector(".rbit-bar-fill")).length,
            ),
        { timeout: 30000 },
      )
      .toBe(6);
    const rows = await page.locator(".rbit-bar-row").evaluateAll((rows) =>
      rows.map((r) => ({
        text: r.querySelector(".rbit-value").textContent.trim(),
        width: parseFloat(r.querySelector(".rbit-bar-fill").style.width),
      })),
    );
    const byText = new Map();
    for (const r of rows) {
      const key = r.text.match(/\d\.\d{2}/)?.[0];
      if (!key) continue;
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(r.width);
    }
    const same = [...byText.values()].filter((ws) => ws.length >= 2);
    expect(same.length).toBeGreaterThan(0);
    for (const ws of same) {
      expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(0.01);
    }
  });

  test("375px: 枠別情報の全コース表は切れていることが「›」で分かり、ST考察は枠に収まる（BOA-607）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-26 津5R（チケットの再現レース）
    await page.goto("/race/2026-09-26-09-05");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    // ST考察の表は 375px で6艇とも枠の中（#1064 で等幅・最小幅を外した）
    const rsc = page.locator(".rsc-grid-wrapper").first();
    await expect(rsc).toBeVisible({ timeout: 30000 });
    expect(
      await rsc.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);

    // 全コース表は 5〜6コースが切れる。横に続く手がかり（「›」）を出す
    await page.locator(".rwit-fold-summary").click();
    const grid = page.locator(".rwit-grid-wrapper");
    await expect(grid.locator(".rwit-grid")).toBeVisible({ timeout: 30000 });
    expect(
      await grid.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeGreaterThan(4);
    const more = page.locator(".rwit-grid-hscroll .hscroll-more");
    await expect(more).toBeVisible();
    // 押すと右へ送られ、左へ戻す「‹」が出る
    await more.click();
    await expect
      .poll(() => grid.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await expect(
      page.locator(".rwit-grid-hscroll .hscroll-less"),
    ).toBeVisible();

    // フェードを付ける箱が、スクロールする箱の右端まで覆う。以前は箱が4px内側で終わり、
    // フェードの外に切れた列の文字がくっきり残った（#1130 ファン評価1周目）
    const edges = await page.evaluate(() => {
      const hint = document
        .querySelector(".rwit-grid-hscroll")
        .getBoundingClientRect();
      const wrap = document
        .querySelector(".rwit-grid-wrapper")
        .getBoundingClientRect();
      return { hintRight: hint.right, wrapRight: wrap.right };
    });
    expect(edges.hintRight).toBeGreaterThanOrEqual(edges.wrapRight - 0.5);

    // 想定コースが外の選手（4〜6号艇）を選んでも、「想定」の列が初めから見える位置まで送られ、
    // 右端のフェード（幅40px）と「›」の下にも入らない。指標を替えても同じ（#1130 ファン評価
    // 1・2周目）。行見出しはスクロールする箱の左端にぴったり付き、左に流れた数字が覗かない
    await page.locator(".rwit-grid-hscroll .hscroll-less").click();
    await expect.poll(() => grid.evaluate((el) => el.scrollLeft)).toBe(0);
    const todayColumnState = () =>
      page.evaluate(() => {
        const wrap = document.querySelector(".rwit-grid-wrapper");
        const th = wrap.querySelector(".rwit-grid-course-th.is-today");
        if (!th) return "no-today";
        const w = wrap.getBoundingClientRect();
        const c = th.getBoundingClientRect();
        const label = wrap
          .querySelector(".rwit-grid-label-th")
          .getBoundingClientRect();
        const hasMore =
          wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 4;
        const rightLimit = w.right - (hasMore ? 40 : 0);
        if (label.left - w.left > 0.5)
          return `label-gap ${label.left - w.left}`;
        // 行見出しの右端で途中まで隠れた列が無い（右端まで送り切った時を除く。同 3周目）
        const atMax =
          wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 1;
        if (!atMax) {
          for (const head of wrap.querySelectorAll(".rwit-grid-course-th")) {
            const r = head.getBoundingClientRect();
            if (r.left < label.right - 0.5 && r.right > label.right + 0.5) {
              return `straddle ${head.textContent.trim()} ${Math.round(r.left)}-${Math.round(r.right)} / ${Math.round(label.right)}`;
            }
          }
        }
        return c.right <= rightLimit + 0.5 && c.left >= label.right - 0.5
          ? "visible"
          : `hidden ${Math.round(c.left)}-${Math.round(c.right)} / ${Math.round(label.right)}-${Math.round(rightLimit)}`;
      });
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      for (const boat of ["4", "5", "6"]) {
        await page
          .locator(".rwit-boat-chip")
          .filter({
            has: page.locator(".rwit-boat-chip-num", {
              hasText: new RegExp(`^${boat}$`),
            }),
          })
          .click();
        for (const metric of ["1着率", "2連対率", "3連対率"]) {
          await page
            .locator(".rwit-metric-row .rwit-chip", { hasText: metric })
            .click();
          await expect
            .poll(todayColumnState, {
              message: `${width}px・${boat}号艇・${metric}`,
            })
            .toBe("visible");
        }
      }
    }
  });
});
