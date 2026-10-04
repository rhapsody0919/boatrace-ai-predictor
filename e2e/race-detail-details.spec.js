import { test, expect } from "./fixtures.js";

// レース詳細の表示の細部（BOA-613・618・619）
const RACE = "/race/2026-09-29-16-12"; // 児島12R（ピットレポートあり）

// 色の文字列（rgb(...)）どうしのコントラスト比（WCAG の相対輝度）
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
const contrast = (a, b) => {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

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

  test("1440px: AI予想の展開予測で、決まり手と確率が離れすぎない（BOA-619 の残り、race-detail-ui-unify FR-6）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 発走前の AI予想（.prediction-result）と確定後の振り返り（.race-ai-prediction-tab）の
    // どちらになるかは録画の時刻しだいなので、トップのレースから辿って出た方を測る
    await page.goto("/");
    await page
      .getByRole("link", { name: /\d{1,2}\s*R/ })
      .first()
      .click();
    await page.waitForURL(/\/race\//);
    await page.locator(".race-tabs-btn", { hasText: "AI予想" }).click();
    const row = page.locator(".turn-pattern-row").first();
    await expect(row).toBeVisible({ timeout: 30000 });
    // 以前は発走前の表示で約1130px 離れていた。720px の箱の中なら 600px を超えない
    await expect
      .poll(() =>
        row.evaluate((r) => {
          const range = document.createRange();
          range.selectNodeContents(r.querySelector(".turn-pattern-technique"));
          return (
            r.querySelector(".turn-pattern-prob").getBoundingClientRect().left -
            range.getBoundingClientRect().right
          );
        }),
      )
      .toBeLessThan(600);
  });

  test("確定後の展開予測の的中は緑、不的中は赤（race-detail-ui-unify R2）", async ({
    page,
  }) => {
    await page.goto(`${RACE}?tab=aiPrediction`);
    const summary = page.locator(
      ".turn-pattern-summary--hit, .turn-pattern-summary--miss",
    );
    await expect(summary).toBeVisible({ timeout: 30000 });
    const { color, success, error, hit } = await summary.evaluate((el) => {
      const probe = (v) => {
        const s = document.createElement("span");
        s.style.color = `var(${v})`;
        el.appendChild(s);
        const c = getComputedStyle(s).color;
        s.remove();
        return c;
      };
      return {
        color: getComputedStyle(el).color,
        success: probe("--color-success-text"),
        error: probe("--color-error-text"),
        hit: el.classList.contains("turn-pattern-summary--hit"),
      };
    });
    expect(color).toBe(hit ? success : error);
  });

  // 住之江・尼崎・徳山のまわり足は会場独自の計測で、他場と値の水準が違う（11〜12秒台。data-catalog E12）。
  // 行の見出しに「※」を付け、表の下に注記を出す。ほかの会場には出さない
  test("直前情報: 住之江のまわり足には「※」と会場独自の計測の注記が出て、大村には出ない", async ({
    page,
  }) => {
    await page.goto("/race/2026-10-02-12-12?tab=beforeInfo");
    const note = page.getByTestId("rbi-turn-time-venue-note");
    await expect(note).toBeVisible({ timeout: 30000 });
    await expect(note).toContainText("会場独自の計測");
    await expect(
      page.locator(".race-before-info-tab").getByText("まわり足 ※").first(),
    ).toBeVisible();

    await page.goto("/race/2026-10-02-24-01?tab=beforeInfo");
    await expect(
      page.locator(".race-before-info-tab").getByText("まわり足").first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("rbi-turn-time-venue-note")).toHaveCount(0);
    await expect(
      page.locator(".race-before-info-tab").getByText("まわり足 ※"),
    ).toHaveCount(0);
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
    const ratio = contrast(shadow, track);
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

  test("320px: 枠別情報の全コース表は切れていることが「›」で分かり、375px: ST考察は枠に収まる（BOA-607）", async ({
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

    // 全コース表が切れる幅では、横に続く手がかり（「›」）を出す。375px は余白を詰めて
    // （race-detail-ui-unify FR-1）表示枠が 345px に広がり、表がほぼ収まるようになったため、
    // 表の最小幅（320px）が表示枠を必ず超える 320px で確かめる
    await page.setViewportSize({ width: 320, height: 812 });
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
  test("枠別情報: 選んだ艇チップの艇番が、ライト・ダークとも6艇すべてで読める（BOA-693）", async ({
    page,
  }) => {
    await page.goto(`${RACE}?tab=waku`);
    const chips = page.locator(".rwit-boat-chip");
    await expect(chips).toHaveCount(6, { timeout: 30000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      for (let i = 0; i < 6; i++) {
        const chip = chips.nth(i);
        await chip.click();
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        const { boat, fg, bg } = await chip.evaluate((el) => {
          const num = el.querySelector(".rwit-boat-chip-num");
          const cs = getComputedStyle(num);
          return {
            boat: num.textContent.trim(),
            fg: cs.color,
            bg: cs.backgroundColor,
          };
        });
        // 文字のコントラストの目安（WCAG 1.4.3）は 4.5:1。以前はダークの1・5号艇で約1.2:1
        expect(
          contrast(fg, bg),
          `${theme}・${boat}号艇: 艇番 ${fg} / 丸 ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  for (const lang of ["ja", "en"]) {
    test(`AI予想の振り返り（${lang}）: 確率と丸数字の説明を出し、イン崩れ指数はレース前と同じバーで見せる（BOA-706）`, async ({
      page,
    }) => {
      await page.goto(`${lang === "ja" ? "" : "/en"}${RACE}?tab=aiPrediction`);
      const tab = page.locator(".race-ai-prediction-tab");
      await expect(tab.locator(".turn-pattern-row").first()).toBeVisible({
        timeout: 30000,
      });
      // 「47%」が何の値か・丸数字が何かを書く（以前はレース前だけ出していた）
      await expect(tab.locator(".turn-pattern-caption")).toContainText(
        lang === "ja"
          ? "丸数字の艇がその決まり手で1着になる確率"
          : "the chance that the circled lane wins",
      );
      // 指数は「会場内パーセンタイル0」と文字で出さず、0〜100 のバーで出す
      await expect(tab.getByTestId("volatility-percentile-bar")).toBeVisible();
      // バーの色の段階は、ラベル（本命有利）と同じ基準（getVolatilityLevel の low）
      await expect(tab.getByTestId("volatility-percentile-bar")).toHaveClass(
        /vpb--low/,
      );
      // 何と比べた 0〜100 かを、レース前のカードと同じ一文で書く（ファン評価1・3周目）
      await expect(tab).toContainText(
        lang === "ja"
          ? "過去90日・同会場のレースと比較"
          : "over the last 90 days",
      );
      await expect(tab).not.toContainText(
        lang === "ja" ? "パーセンタイル" : "percentile",
      );
    });
  }

  test("AI予想の振り返り: イン崩れ指数のバーの文字は、ライト・ダークとも地の色と見分けられる（BOA-706）", async ({
    page,
  }) => {
    await page.goto(`${RACE}?tab=aiPrediction`);
    const bar = page.getByTestId("volatility-percentile-bar");
    await expect(bar).toBeVisible({ timeout: 30000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      const { label, ends, bg } = await bar.evaluate((el) => ({
        label: getComputedStyle(el.querySelector(".vpb-label")).color,
        ends: getComputedStyle(el.querySelector(".vpb-ends")).color,
        bg: getComputedStyle(el).backgroundColor,
      }));
      expect(contrast(label, bg), `${theme}: 見出し`).toBeGreaterThanOrEqual(
        4.5,
      );
      // 端の「堅い・標準・崩れやすい」は小さい補助の文字。3:1 を下限にする
      expect(contrast(ends, bg), `${theme}: 端の文字`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });
  test("イン崩れ指数のバー: 今の値の位置に印を置き、「標準」の文字は真ん中の目印の真下（PR #1186 ファン評価1周目）", async ({
    page,
  }) => {
    // 児島12R は指数0。塗りが見えず、真ん中の「標準」の目印だけが目に入っていた
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=aiPrediction`);
      const bar = page.getByTestId("volatility-percentile-bar");
      await expect(bar).toBeVisible({ timeout: 30000 });
      const m = await bar.evaluate((el) => {
        const c = (q) => {
          const r = el.querySelector(q).getBoundingClientRect();
          return {
            left: r.left,
            center: (r.left + r.right) / 2,
            width: r.width,
          };
        };
        return {
          track: c(".vpb-track"),
          marker: c(".vpb-marker"),
          median: c(".vpb-median"),
          middleLabel: c(".vpb-ends > span:nth-child(2)"),
          // 値の後ろに「/ 100」が付く（BOA-711 U4）ので、先頭の数だけ読む
          value: Number.parseInt(
            el.querySelector(".vpb-value").textContent,
            10,
          ),
        };
      });
      // 印は値の位置（0なら左端）にあり、見える大きさがある
      expect(m.marker.width, `${width}px: 印の大きさ`).toBeGreaterThanOrEqual(
        10,
      );
      expect(
        Math.abs(
          m.marker.center - (m.track.left + (m.track.width * m.value) / 100),
        ),
        `${width}px: 印の位置`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(m.middleLabel.center - m.median.center),
        `${width}px: 「標準」の文字と真ん中の目印`,
      ).toBeLessThanOrEqual(2);
    }
  });

  test("375px: 直前情報の展示情報の表は、右へ送ったら「‹」で左へ戻せる（BOA-699）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${RACE}?tab=beforeInfo`);
    const table = page.locator(".rbi-card .drt-table").first();
    await expect(table).toBeVisible({ timeout: 30000 });
    // この表は 320〜390px では収まる。英語や列が増えたときに溢れても戻せることを、
    // 表を広げて確かめる
    await page.addStyleTag({
      content: ".rbi-card .drt-table { min-width: 640px; }",
    });
    // 手がかりは幅が変わったときに測り直す。広げたあとに測り直させる
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    const hint = page.locator(".rbi-card .hscroll-hint:has(.drt-table)");
    const wrapper = hint.locator(".drt-table-wrapper");
    await expect(hint.locator(".hscroll-more")).toBeVisible();
    await expect(hint.locator(".hscroll-less")).toHaveCount(0);
    await hint.locator(".hscroll-more").click();
    await expect(hint.locator(".hscroll-less")).toBeVisible();
    await hint.locator(".hscroll-less").click();
    await expect.poll(() => wrapper.evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(hint.locator(".hscroll-less")).toHaveCount(0);
  });
  test("展示情報の表: 読み込んだあとで表の幅が変わっても、手がかりを出し直す（PR #1192 ファン評価1周目）", async ({
    page,
  }) => {
    // 英語の 320px では表が3px溢れるのに、Preview では手がかりが出ていなかった。最初の計測の
    // あとに文字の読み込み等で表の幅が変わっても、窓の幅が変わらない限り測り直していなかった。
    // 窓の幅を変えずに表だけを広げて、同じ状況を作る
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${RACE}?tab=beforeInfo`);
    const hint = page.locator(".rbi-card .hscroll-hint:has(.drt-table)");
    await expect(hint.locator(".drt-table")).toBeVisible({ timeout: 30000 });
    await expect(hint.locator(":scope > .hscroll-more")).toHaveCount(0);
    await page.addStyleTag({
      content:
        ".rbi-card .drt-table { margin-right: -6px; width: calc(100% + 6px); }",
    });
    // 6px だけ溢れても「›」を出す（BOA-735。以前は 12px 以下では細いフェードだけで、380px の枠別の
    // 全コース表で「(n=20)」が「(n=2」に読めた）
    const more = hint.locator(":scope > .hscroll-more");
    await expect(more).toBeVisible();
    // 押すと右端まで送り、最後の列が欠けずに全部見える
    await more.click();
    await expect(more).toHaveCount(0);
    const cut = await hint.evaluate((el) => {
      const box = el.querySelector(".drt-table-wrapper").getBoundingClientRect();
      const cells = [...el.querySelector(".drt-table tr").children];
      return cells.at(-1).getBoundingClientRect().right - box.right;
    });
    expect(cut, "最後の列の右端が箱の外に出ていない").toBeLessThanOrEqual(1);
  });
  test("320px: 左の列を固定した表で「›」を押しても、列を読み飛ばさない（PR #1192 ファン評価2周目）", async ({
    page,
  }) => {
    // 送る幅が見える幅の8割（固定の項目名の列を含む）だったため、320px で表が溢れると
    // 「›」を押すだけでは3号艇の列が一度も見えなかった
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto(`${RACE}?tab=beforeInfo`);
    const hint = page.locator(".rbi-card .hscroll-hint:has(.drt-table)");
    await expect(hint.locator(".drt-table")).toBeVisible({ timeout: 30000 });
    await page.addStyleTag({
      content: ".rbi-card .drt-table { min-width: 640px; }",
    });
    await expect(hint.locator(".hscroll-more")).toBeVisible();
    // 押す前後で、固定の列の右に最初に全部見える列と、押す前に右端まで全部見えていた列を比べる
    const cols = () =>
      hint.evaluate((el) => {
        const box = el
          .querySelector(".drt-table-wrapper")
          .getBoundingClientRect();
        const sticky = el.querySelector("thead th").getBoundingClientRect();
        const heads = [...el.querySelectorAll("thead th.drt-boat-th")].map(
          (th) => th.getBoundingClientRect(),
        );
        return {
          lastFull: Math.max(
            ...heads.map((r, i) => (r.right <= box.right - 1 ? i : -1)),
          ),
          firstFull: heads.findIndex((r) => r.left >= sticky.right - 1),
        };
      });
    while (await hint.locator(".hscroll-more").isVisible()) {
      const before = await cols();
      await hint.locator(".hscroll-more").click();
      const after = await cols();
      expect(
        after.firstFull,
        "押したあと最初に全部見える列は、押す前に見えていた最後の列の次まで",
      ).toBeLessThanOrEqual(before.lastFull + 1);
    }
  });
  test("枠別情報: 選んだ艇チップの選手名が、ライト・ダークとも6艇すべてで地の色と4.5:1以上（BOA-703）", async ({
    page,
  }) => {
    // 公式の配色の赤・青・緑の地に白い名前だと 4.23・3.68・3.30 だった。選んだチップだけ一段濃くする
    await page.goto(`${RACE}?tab=waku`);
    const chips = page.locator(".rwit-boat-chip");
    await expect(chips).toHaveCount(6, { timeout: 30000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme,
      );
      for (let i = 0; i < 6; i++) {
        const chip = chips.nth(i);
        await chip.click();
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        const { boat, fg, bg } = await chip.evaluate((el) => ({
          boat: el.querySelector(".rwit-boat-chip-num").textContent.trim(),
          fg: getComputedStyle(el.querySelector(".rwit-boat-chip-name")).color,
          bg: getComputedStyle(el).backgroundColor,
        }));
        expect(
          contrast(fg, bg),
          `${theme}・${boat}号艇: 名前 ${fg} / 地 ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("1440px: 枠別情報の注記と選手チップの段は、下のカードと右端がそろう（BOA-703）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${RACE}?tab=waku`);
    // カードの幅は中の表が出てから決まる（表が出る前は注記と同じ幅で、比べても意味が無い）
    const card = page.locator(".rwit-card:has(.rwit-today-table)").first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const rights = await page.evaluate(() =>
      [".rwit-note", ".rwit-chip-row", ".rwit-card:has(.rwit-today-table)"].map(
        (sel) =>
          Math.round(document.querySelector(sel).getBoundingClientRect().right),
      ),
    );
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);
  });

  // 固定した列の右端と、その右で最初に見える列の左端の差（切れて隠れている幅）
  const cutAtSticky = (hint) =>
    hint.evaluate((el) => {
      const cells = [...el.querySelector("tr").children];
      let stickyRight = el.getBoundingClientRect().left;
      for (const c of cells) {
        const style = getComputedStyle(c);
        if (style.position !== "sticky" || style.left === "auto") break;
        stickyRight = c.getBoundingClientRect().right;
      }
      const firstVisible = cells
        .map((c) => c.getBoundingClientRect())
        .find((r) => r.right > stickyRight + 1);
      return firstVisible ? stickyRight - firstVisible.left : 0;
    });
  // 横に送っても、行を見分ける左端の列（艇番・選手名・日付・コース）が残り、「‹」で戻れる
  // （BOA-699・BOA-704）。以前は送ると左端の列が消え、「‹」も無い表があった
  for (const screen of [
    {
      name: "今節の得点率早見",
      path: `${RACE}?tab=meet`,
      hint: ".hscroll-hint:has(.rmt-forecast-scroll)",
      sticky: ".rmt-forecast-table tbody tr:first-child th",
      table: ".rmt-forecast-table",
      pinned: 1,
    },
    {
      name: "今節の日別表",
      path: `${RACE}?tab=meet`,
      hint: ".race-history-hscroll",
      sticky: ".race-history-table tbody tr:first-child td:first-child",
      table: ".race-history-table",
      pinned: 2,
    },
    {
      name: "モーターのコース別成績",
      path: `${RACE}?tab=motor`,
      open: async (page) => {
        await page
          .locator(".motor-ranking-row")
          .first()
          .click({ timeout: 60000 });
        await page.locator(".motor-waku-expand-btn").click();
      },
      hint: ".mwsg-hint",
      sticky: ".mwsg-table tbody tr:first-child td:first-child",
      table: ".mwsg-table",
      pinned: 1,
    },
    {
      // 枠と選手名の2列を固定する。選手名の列が残れば、その左の枠の列も残っている
      name: "モーター一覧",
      path: `${RACE}?tab=motor`,
      // 会場内順位の列は一覧の行のあとから足され、表が広がる。足されてから送る
      open: async (page) => {
        await expect(page.locator(".motor-venue-rank-head")).toBeVisible({
          timeout: 90000,
        });
      },
      hint: ".mcc-list-hint",
      sticky: ".mcc-list-table tbody tr:first-child td:nth-child(2)",
      table: ".mcc-list-table",
      pinned: 2,
    },
  ]) {
    test(`320px: ${screen.name}は横に送っても左端の列が残り、「‹」で戻れる（BOA-699・BOA-704）`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize({ width: 320, height: 812 });
      await page.goto(screen.path);
      if (screen.open) await screen.open(page);
      const hint = page.locator(screen.hint).first();
      await expect(hint).toBeVisible({ timeout: 90000 });
      // 表がどれだけ溢れるかは文字の幅で変わる（CI の Linux では 320px でも得点率早見が収まった）。
      // 送る操作そのものを確かめるため、表を広げて必ず溢れさせる
      await page.addStyleTag({
        // 表ごとの指定（例: .motor-condition-container .motor-ranking-table の min-width）に
        // 負けないよう !important にする（#1153 で、テストで当てた幅が効かなくなっていた）
        content: `${screen.table} { min-width: 640px !important; }`,
      });
      const more = hint.locator(":scope > .hscroll-more");
      await expect(more).toBeVisible({ timeout: 30000 });
      const stickyLeft = () =>
        hint.evaluate((el, sel) => {
          const cell = el.querySelector(sel).getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return Math.round(cell.left - box.left);
        }, screen.sticky);
      const before = await stickyLeft();
      await more.click();
      const less = hint.locator(":scope > .hscroll-less");
      await expect(less).toBeVisible();
      // 送った先は列の境目。固定の列のすぐ右に、切れた列の破片を残さない（PR #1202 ファン評価2周目。
      // 375px のコース別成績で「1コース 2%」（実際は 87.2%）と読めた）
      expect(
        await cutAtSticky(hint),
        "固定の列の右に切れた列が残らない",
      ).toBeLessThanOrEqual(1);
      // 送ったあとも、左端の列は同じ位置に残る
      expect(Math.abs((await stickyLeft()) - before)).toBeLessThanOrEqual(1);
      await less.click();
      await expect(less).toHaveCount(0);
    });
    // 指で送ったときも列の境目に止める（BOA-741）。止まる位置が自由だと、固定した選手名のすぐ右に
    // 頭の欠けた値が並び、「51位/60」が「1位/60」に読めた（PR #1223 ファン評価1周目。止まる位置の
    // 32〜56% で起きた）。横のホイールで、列の途中に当たる量だけ送る
    test(`320px: ${screen.name}は指で途中まで送っても、固定の列の右に切れた値を残さない（BOA-741）`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize({ width: 320, height: 812 });
      await page.goto(screen.path);
      if (screen.open) await screen.open(page);
      const hint = page.locator(screen.hint).first();
      await expect(hint).toBeVisible({ timeout: 90000 });
      // 表の min-width で広げると、余りが固定した列（選手名）に入り、固定の列が見える幅より広くなる。
      // 固定していない列だけを広げて溢れさせる
      await page.addStyleTag({
        content: `${screen.table} :is(th, td):nth-child(n + ${screen.pinned + 1}) { min-width: 64px !important; }`,
      });
      await expect(hint.locator(":scope > .hscroll-more")).toBeVisible({
        timeout: 30000,
      });
      const scrollerLeft = (reset) =>
        hint.evaluate((el, r) => {
          const scroller = [el, ...el.querySelectorAll("*")].find(
            (n) =>
              ["auto", "scroll"].includes(getComputedStyle(n).overflowX) &&
              n.scrollWidth > n.clientWidth + 1,
          );
          if (r) scroller.scrollLeft = 0;
          return scroller.scrollLeft;
        }, reset);
      // ホイールは表の本文の上で回す（見出しの上だと縦に固定した行の外になる表がある）
      const firstRow = hint.locator("tbody tr").first();
      await firstRow.scrollIntoViewIfNeeded();
      const row = await firstRow.boundingBox();
      const visible = await hint.boundingBox();
      // 行は表の幅（640px）で画面より広い。画面に見えている箱の中ほどで回す
      await page.mouse.move(
        visible.x + visible.width / 2,
        row.y + row.height / 2,
      );
      // 小さく送ると、境目に止める仕組みで元の位置（0）に戻ることがある。大きく送った回で、
      // 実際に送れたことも確かめる（送れていないと、切れた値が無いのは当たり前）
      // ホイールの送りは数フレームかけて動き、境目に止める動きも後から来る。動き出す前の 0 で
      // 判定しないよう、少し待ってから、位置が動かなくなるまで待つ
      const settledLeft = async () => {
        await page.waitForTimeout(300);
        let prev = await scrollerLeft(false);
        for (;;) {
          await page.waitForTimeout(150);
          const now = await scrollerLeft(false);
          if (now === prev) return now;
          prev = now;
        }
      };
      let moved = 0;
      for (const delta of [23, 57, 101, 149]) {
        await scrollerLeft(true);
        await page.mouse.wheel(delta, 0);
        moved = Math.max(moved, await settledLeft());
        expect(
          await cutAtSticky(hint),
          `${delta}px 送ったあと、固定の列の右に切れた列が残らない`,
        ).toBeLessThanOrEqual(1);
      }
      expect(moved, "ホイールで表が送れた").toBeGreaterThan(0);
    });
  }
  // 枠の列は幅を決めて、選手名の列をその右に固定する（BOA-699）。決めた幅に艇色のチップが
  // 収まらないと、チップが選手名の下に潜る。内余白が変わる 768px の境目と、PC幅で溢れる 800px も通す
  // 見出しの語の長さは言語で変わるので、英語（Lane）も通す
  for (const [width, lang] of [
    [320, ""],
    [768, ""],
    [800, ""],
    [1440, ""],
    [375, "/en"],
    [800, "/en"],
  ]) {
    test(`${width}px${lang}: モーター一覧の枠のチップが枠の列に収まり、選手名と重ならない（BOA-699）`, async ({
      page,
    }) => {
      test.slow();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${lang}${RACE}?tab=motor`);
      await expect(page.locator(".motor-venue-rank-head")).toBeVisible({
        timeout: 90000,
      });
      const m = await page.locator(".mcc-list-table").evaluate((t) =>
        [...t.querySelectorAll("tbody tr")].map((tr) => {
          const chip = tr.querySelector(".rr-boat-chip").getBoundingClientRect();
          const lane = tr.children[0].getBoundingClientRect();
          const name = tr.children[1].getBoundingClientRect();
          return { chipRight: chip.right, laneRight: lane.right, nameLeft: name.left };
        }),
      );
      const head = await page.locator(".mcc-list-table thead th").first().evaluate(
        (th) => th.scrollWidth - th.clientWidth,
      );
      expect(head, "枠の見出しが列からはみ出さない").toBeLessThanOrEqual(0);
      for (const r of m) {
        expect(r.chipRight).toBeLessThanOrEqual(r.laneRight);
        expect(Math.abs(r.nameLeft - r.laneRight)).toBeLessThanOrEqual(1);
      }
    });
  }
  test("モーター一覧: 固定した枠と選手名の列も、行に乗せたとき行と同じ色になる（BOA-699）", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`${RACE}?tab=motor`);
    const row = page.locator(".mcc-list-table .motor-ranking-row").first();
    await expect(row).toBeVisible({ timeout: 90000 });
    await row.hover();
    // 行の色は 0.15 秒かけて変わる（transition）。変わり終わってから比べる
    await expect
      .poll(() =>
        row.evaluate((r) => {
          const bg = (el) => getComputedStyle(el).backgroundColor;
          return [bg(r.children[0]), bg(r.children[1])].every(
            (c) => c === bg(r),
          );
        }),
      )
      .toBe(true);
  });
  test("今節の日別表: 固定した日付の列も、行に乗せたとき行と同じ色になる（PR #1202 レビュー）", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`${RACE}?tab=meet`);
    const row = page.locator(".race-history-table-row").first();
    await expect(row).toBeVisible({ timeout: 90000 });
    await row.hover();
    const [rowBg, cellBg] = await row.evaluate((r) => [
      getComputedStyle(r).backgroundColor,
      getComputedStyle(r.querySelector("td")).backgroundColor,
    ]);
    expect(cellBg).toBe(rowBg);
  });
  test("320px: 今節の日別表は日付とRの列を固定し、1日2走の日もどの走か分かる（PR #1202 ファン評価1周目）", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto(`${RACE}?tab=meet`);
    const hint = page.locator(".race-history-hscroll").first();
    await expect(hint.locator(".race-history-table-row").first()).toBeVisible({
      timeout: 90000,
    });
    // 線は送る前は引かない（表が収まる幅で空きの端を強調しない）
    const lineOf = () =>
      hint.evaluate(
        (el) =>
          getComputedStyle(
            el.querySelector(".race-history-table tbody tr td:nth-child(2)"),
          ).boxShadow,
      );
    expect(await lineOf()).toBe("none");
    await page.addStyleTag({
      content: ".race-history-table { min-width: 640px; }",
    });
    const more = hint.locator(":scope > .hscroll-more");
    while (await more.isVisible()) await more.click();
    const m = await hint.evaluate((el) => {
      const row = el.querySelector(".race-history-table tbody tr");
      const [date, race] = [...row.querySelectorAll("td")]
        .slice(0, 2)
        .map((c) => c.getBoundingClientRect());
      return {
        gap: race.left - date.right,
        raceText: row.querySelectorAll("td")[1].textContent.trim(),
        boxLeft: el.getBoundingClientRect().left,
        raceLeft: race.left,
      };
    });
    // 右端まで送っても、R の列は日付の列のすぐ右に残る
    expect(Math.abs(m.gap)).toBeLessThanOrEqual(1);
    expect(m.raceText).toMatch(/^\d+R$/);
    expect(m.raceLeft - m.boxLeft).toBeLessThan(80);
    // 送ったあとは、固定した列の右端に線を引く
    expect(await lineOf()).not.toBe("none");
  });
  test("375px: モーターのコース別成績は「›」を押すと列の境目で止まり、「1コース 2%」のような切れた値を残さない（PR #1202 ファン評価2周目）", async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${RACE}?tab=motor`);
    await page.locator(".motor-ranking-row").first().click({ timeout: 60000 });
    await page.locator(".motor-waku-expand-btn").click();
    const hint = page.locator(".mwsg-hint");
    await expect(hint).toBeVisible({ timeout: 30000 });
    // #1153 で表の余白が詰まり、375px の実データではほぼ収まる（7px だけ溢れる）。
    // 送る先が列の境目にそろうことを確かめるため、表を広げて途中で止まる長さにする
    await page.addStyleTag({
      content: ".mwsg-table { min-width: 640px !important; }",
    });
    await expect(hint.locator(":scope > .hscroll-more")).toBeVisible({
      timeout: 30000,
    });
    await hint.locator(":scope > .hscroll-more").click();
    await expect(hint.locator(":scope > .hscroll-less")).toBeVisible();
    const cut = await hint.evaluate((el) => {
      const cells = [...el.querySelector("tr").children];
      const stickyRight = cells[0].getBoundingClientRect().right;
      const firstVisible = cells
        .slice(1)
        .map((c) => c.getBoundingClientRect())
        .find((r) => r.right > stickyRight + 1);
      return stickyRight - firstVisible.left;
    });
    expect(cut).toBeLessThanOrEqual(1);
  });
  for (const screen of [
    {
      name: "今節の日別表（中止のレース）",
      path: "/race/2026-09-21-02-05?tab=meet",
      hint: ".race-history-hscroll",
      ready: ".race-history-table-row",
    },
    {
      name: "枠別情報の全コース表",
      path: `${RACE}?tab=waku`,
      hint: ".rwit-grid-hscroll",
      ready: ".rwit-fold-summary",
      open: async (page) => {
        await page.locator(".rwit-fold-summary").first().click();
      },
    },
  ]) {
    test(`320px: ${screen.name}は右端まで送っても、固定した列のすぐ右に切れた値を残さない（PR #1202 ファン評価3周目）`, async ({
      page,
    }) => {
      // 右端の位置が列の境目と一致せず、最後の1回だけ「6.71(6)」が「71(6)」に見えていた
      test.slow();
      await page.setViewportSize({ width: 320, height: 812 });
      await page.goto(screen.path);
      await expect(page.locator(screen.ready).first()).toBeVisible({
        timeout: 90000,
      });
      if (screen.open) await screen.open(page);
      const hint = page.locator(screen.hint).first();
      const more = hint.locator(":scope > .hscroll-more");
      await expect(more).toBeVisible({ timeout: 30000 });
      while (await more.isVisible()) await more.click();
      const cut = await hint.evaluate((el) => {
        const cells = [...el.querySelector("tr").children];
        let stickyRight = null;
        for (const c of cells) {
          const style = getComputedStyle(c);
          if (style.position !== "sticky" || style.left === "auto") break;
          stickyRight = c.getBoundingClientRect().right;
        }
        const firstVisible = cells
          .map((c) => c.getBoundingClientRect())
          .find((r) => r.right > stickyRight + 1);
        return stickyRight - firstVisible.left;
      });
      expect(cut, "固定の列の右に切れた列が残らない").toBeLessThanOrEqual(1);
    });
  }
  test("320px: 表の余白が外れても測り直せば、右端は列の境目にそろう（PR #1215 レビュー）", async ({
    page,
  }) => {
    // 足した余白の量を箱の側に持っていると、表だけが作り直されたとき（余白が外れたとき）に
    // 食い違い、右端が列の途中に戻る
    test.slow();
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto("/race/2026-09-21-02-05?tab=meet");
    const hint = page.locator(".race-history-hscroll").first();
    await expect(hint.locator(".race-history-table-row").first()).toBeVisible({
      timeout: 90000,
    });
    await expect
      .poll(() =>
        hint.evaluate((el) => el.querySelector("table").style.marginRight),
      )
      .not.toBe("");
    await hint.evaluate((el) => {
      el.querySelector("table").style.marginRight = "";
      window.dispatchEvent(new Event("resize"));
    });
    const more = hint.locator(":scope > .hscroll-more");
    await expect(more).toBeVisible();
    while (await more.isVisible()) await more.click();
    const cut = await hint.evaluate((el) => {
      const cells = [...el.querySelector("tr").children];
      const stickyRight = cells[1].getBoundingClientRect().right;
      const firstVisible = cells
        .map((c) => c.getBoundingClientRect())
        .find((r) => r.right > stickyRight + 1);
      return stickyRight - firstVisible.left;
    });
    expect(cut).toBeLessThanOrEqual(1);
  });
});

// モーターのコース別成績は、実際に進入したコースで集計している（列の見出し・注記も「コース」）。
// 日本語の見出しだけ「枠番別成績」が残り、「‹」で列の見出しが隠れると、枠番の表と読み違えた
// （BOA-751、PR #1225 ファン評価1周目。ほかの3言語はコース）
test("モーター: コース別成績の見出しと戻るリンクは「コース別成績」（BOA-751）", async ({
  page,
}) => {
  test.slow();
  await page.goto(`${RACE}?tab=motor`);
  await page.locator(".motor-ranking-row").first().click({ timeout: 60000 });
  const grid = page.locator(".motor-waku-stats-grid");
  await expect(grid.locator(".selected-motor-heading")).toHaveText(
    "コース別成績",
    { timeout: 30000 },
  );
  await expect(grid.locator("thead th").first()).toHaveText("コース");
  // 行を押すと、そのコースの選手ごとの成績に入る。戻るリンクも同じ呼び方
  await grid.locator(".motor-waku-row").first().click();
  await expect(page.getByText("← コース別成績に戻る")).toBeVisible({
    timeout: 30000,
  });
});
