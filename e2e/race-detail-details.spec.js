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
    await expect(hint).not.toHaveAttribute("data-hscroll-peek", "true");
    await page.addStyleTag({
      content:
        ".rbi-card .drt-table { margin-right: -6px; width: calc(100% + 6px); }",
    });
    await expect(hint).toHaveAttribute("data-hscroll-peek", "true");
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
});
