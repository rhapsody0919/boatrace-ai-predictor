import { test, expect } from "./fixtures.js";

// BOA-440: Fバッジに「今節」の印、L（出遅れ）バッジ
test.describe("Fバッジの今節の印・Lバッジ（BOA-440）", () => {
  test("今節（前日まで）にFを切った艇にだけ「今節」の印が付き、前の節以前のF1には付かない", async ({
    page,
  }) => {
    // 今節Fの取得で例外を出さない（#1002 と #999 の組み合わせで import が抜け、
    // 「今節F取得エラー: groupIntoCurrentMeet is not defined」で印が全レースで消えた）
    const flyingErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("今節F取得エラー"))
        flyingErrors.push(msg.text());
    });
    // 2026-09-25 桐生7R: F1が5艇（1・2・3・5・6号艇）。
    // 5号艇（3740）は9/22 5R、6号艇（3654）は9/24 8Rで今節にFを切っている。
    // 1〜3号艇は今節（9/20〜）にFが無い＝期の前半のF
    await page.goto("/race/2026-09-25-01-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const basic = page.locator(".rbit-bar-row .flying-badge");
    await expect(basic).toHaveCount(5);
    await expect(page.locator(".rbit-bar-row .flying-badge-meet")).toHaveCount(
      2,
    );
    await expect(basic.filter({ hasText: "今節" }).first()).toHaveAttribute(
      "title",
      /今節の初日から前日まで.*当日のFは含みません/,
    );
    // 「今節はもう走らない」と読める言い方をしない（Fを切っても節の残りは出走する）
    const titles = await basic.evaluateAll((els) =>
      els.map((el) => el.getAttribute("title")).join(" "),
    );
    expect(titles).not.toMatch(/帰郷|休み|欠場/);

    // ST考察カード（枠別情報タブ）も同じ判定
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    await expect(page.locator(".rsc-grid .flying-badge")).toHaveCount(5);
    await expect(page.locator(".rsc-grid .flying-badge-meet")).toHaveCount(2);
    expect(flyingErrors).toEqual([]);
  });

  test("l_count が1以上の艇にはLバッジがFとは別の見た目で出る", async ({
    page,
  }) => {
    // 2026-04-11 びわこ2R: 1号艇（5186）が F1・L1
    await page.goto("/race/2026-04-11-06-02");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const late = page.locator(".rbit-bar-row .flying-badge.is-late");
    await expect(late).toHaveCount(1);
    await expect(late).toHaveText("L1");
    await expect(late).toHaveAttribute("title", /出遅れ/);
    const [lateBg, fBg] = await Promise.all([
      late.evaluate((el) => getComputedStyle(el).backgroundColor),
      page
        .locator(".rbit-bar-row .flying-badge:not(.is-late)")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(lateBg).not.toBe(fBg);
  });

  test("基本情報タブにバッジの凡例が出て、スマホでも「今節」「L」の意味が分かる（ファン評価1周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-25-01-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    const legend = page.locator(".rbit-note", { hasText: "今節" });
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("準優勝戦・優勝戦には進めません");
    await expect(legend).toContainText("当日のFは含みません");
    await expect(legend).toContainText("L＝");
    // 「F2 今節」を「2本とも今節」と読ませない（バッジの説明・「?」と同じ「そのうち」で書く。3周目）
    await expect(legend).toContainText("そのうち今節の初日から前日まで");
    await expect(legend).toContainText("節の残りのレースには出走します");
  });

  test("375px: ST考察の級別の説明が下部ナビに隠れず、末尾まで読める（ファン評価1周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-27-22-07");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    const button = page
      .locator(".rsc-label-th", { hasText: "級別" })
      .locator(".term-hint__button");
    await button.scrollIntoViewIfNeeded();
    // クッキー同意バナー（初回だけ出る）は下部ナビより前面にあるので外して、ナビとの重なりだけを見る
    await page.evaluate(() =>
      document.querySelectorAll(".cookie-consent").forEach((el) => el.remove()),
    );
    // 画面の下の方で開く（ナビと重なりやすい位置）
    await page.evaluate(() => {
      const b = document
        .querySelector(".rsc-label-th .term-hint__button")
        .getBoundingClientRect();
      window.scrollBy(0, b.top - (window.innerHeight - 260));
    });
    await button.click();
    const pop = page.locator(".term-hint__popover");
    await expect(pop).toContainText("賞典除外");
    // 要点（今節の印・賞典除外）は先頭の方に置く。後半だと小さな枠で読まれない（3周目）
    const text = await pop.textContent();
    expect(text.indexOf("「今節」の印")).toBeLessThan(40);
    expect(text.indexOf("賞典除外")).toBeLessThan(text.indexOf("あっせん停止"));
    const r = await pop.evaluate((el) => {
      const box = el.getBoundingClientRect();
      // 見えている範囲の下端近くで、最前面の要素がポップオーバー自身か
      const y = Math.min(box.bottom, window.innerHeight) - 4;
      const top = document.elementFromPoint(box.left + 20, y);
      return {
        bottom: box.bottom,
        vh: window.innerHeight,
        front: el.contains(top),
        frontEl: top?.className ?? String(top),
        scrollable:
          el.scrollHeight <= el.clientHeight ||
          getComputedStyle(el).overflowY === "auto",
      };
    });
    expect(r.bottom).toBeLessThanOrEqual(r.vh);
    expect(r.front, r.frontEl).toBe(true);
    expect(r.scrollable).toBe(true);
  });

  test("1440px: 画面の下の方で開いた「?」は上に開き、説明が全文そのまま見える（ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/race/2026-09-27-22-07");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    await page.evaluate(() =>
      document.querySelectorAll(".cookie-consent").forEach((el) => el.remove()),
    );
    await page
      .locator(".rsc-label-th .term-hint__button")
      .first()
      .waitFor({ timeout: 25000 });
    // 「?」を画面の下（y≈780）に持ってくる
    await page.evaluate(() => {
      const b = document
        .querySelector(".rsc-label-th .term-hint__button")
        .getBoundingClientRect();
      window.scrollBy(0, b.top - 780);
    });
    await page.locator(".rsc-label-th .term-hint__button").first().click();
    const pop = page.locator(".term-hint__popover");
    await expect(pop).toContainText("今節");
    const r = await pop.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        vh: window.innerHeight,
        fits: el.scrollHeight <= el.clientHeight + 1,
      };
    });
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(r.vh);
    expect(r.fits).toBe(true);
  });

  test("375px: ST考察の表が画面に収まり、6号艇の「今節」の印が切れない（ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-27-22-07");
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    const meet = page.locator(".rsc-grid .flying-badge-meet").first();
    await expect(meet).toBeVisible({ timeout: 25000 });
    const r = await page.evaluate(() => {
      const w = document.querySelector(".rsc-grid-wrapper");
      const wb = w.getBoundingClientRect();
      const mb = document
        .querySelector(".rsc-grid .flying-badge-meet")
        .getBoundingClientRect();
      return {
        sw: w.scrollWidth,
        cw: w.clientWidth,
        right: mb.right,
        wright: wb.right,
      };
    });
    expect(r.sw).toBeLessThanOrEqual(r.cw);
    expect(r.right).toBeLessThanOrEqual(r.wright);
  });
});
