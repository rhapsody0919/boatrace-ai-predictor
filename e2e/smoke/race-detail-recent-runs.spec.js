import { test, expect } from "../fixtures.js";

test.describe("レースページ再設計（BOA-168）", () => {
  test("基本情報の直近10走は新しい順で、同じ日の2走も R の大きい順に並ぶ（BOA-588・BOA-623）", async ({
    page,
  }) => {
    // 2026-09-29 戸田12R の1号艇: 9/27 と 9/28 に2走ずつある。以前は日付は古い順
    // なのに、同じ日の中だけ「12R → 5R」と新しい順になっていた
    await page.goto("/race/2026-09-29-02-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    // 行は日付のリンク先（race_id = 日付＋会場＋R）で読む（BOA-623 で日付は月日だけになった）
    const ids = await table
      .locator(".rrt-row .rrt-link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(-16)));
    // 同じ日が2走以上ある日が、少なくとも1つあること（前提の確認）
    const sameDay = ids.filter(
      (id, i) => i > 0 && id.slice(0, 10) === ids[i - 1].slice(0, 10),
    );
    expect(sameDay.length).toBeGreaterThan(0);
    // 表全体が「日付 → R」の新しい順（race_id の降順）。いちばん上が前走（BOA-623）。
    // 同じ日の2走で R の順が日の中だけ逆になる不具合（BOA-588）もこれで見る
    expect(ids).toEqual([...ids].sort().reverse());
  });

  test("直近10走は、表示中のレースより前の走を節の見出し行つきの6列で出し、PCでは中央に置く（BOA-623・BOA-602）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-30 児島7R の1号艇 西村拓也。以前はこのレース自身（9/30 7R）まで「直近」に入っていた
    await page.goto("/race/2026-09-30-16-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    const ids = await table
      .locator(".rrt-row .rrt-link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(-16)));
    expect(ids.length).toBe(10);
    expect(ids.every((id) => id < "2026-09-30-16-07")).toBe(true);
    // 会場・レース名は節の見出し行に1回だけ（期間に年を出す）
    const groups = table.locator(".rrt-group");
    // 新しい順なので、最初の見出しは児島（今節）、次が徳山
    await expect(groups.first()).toContainText("児島");
    await expect(groups.nth(1)).toContainText("徳山");
    await expect(groups.nth(1)).toContainText("ダイヤモンドカップ");
    // 9/29 10R は5号艇・4コース進入で、ST は6艇中3番目。2着
    const r = table.locator("tr", {
      has: page.locator('a[href$="/race/2026-09-29-16-10"]'),
    });
    const cells = (await r.locator("td").allInnerTexts()).map((c) =>
      c.replace(/\s+/g, ""),
    );
    expect(cells.slice(2, 6)).toEqual(["5", "4", ".08(3)", "2"]);
    // いちばん上が前走（9/29 10R）。選手ページのレース一覧と同じ新しい順
    expect(ids[0]).toBe("2026-09-29-16-10");
    // 見出し行は年月だけ（日の範囲は節の開催期間に読まれるため出さない）
    await expect(groups.first()).toHaveText(/2026\/9$/);
    // ST の ( ) の意味を表の下に出す（選手ページにも同じ凡例が出る）
    await expect(page.locator(".rrt-legend").first()).toContainText(
      "6艇の中の順位",
    );
    // 単勝配当は 375px では出さない
    await expect(table.locator("th.rrt-pc")).toBeHidden();

    // PC では単勝配当を出し、表は中央に置く（左寄せで右に大きな空きを残さない）
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(table.locator("th.rrt-pc")).toBeVisible();
    const gap = await table.evaluate((tb) => {
      const t = tb.getBoundingClientRect();
      const w = tb.closest(".rrt-wrap").getBoundingClientRect();
      return { left: t.left - w.left, right: w.right - t.right };
    });
    expect(Math.abs(gap.left - gap.right)).toBeLessThanOrEqual(2);
  });

  test("英語版の375pxでも直近10走の着順が画面内に入る（BOA-623 ファン評価1周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-30 戸田9R: 決まり手「Makuri-zashi (Sweep & pass)」などの長い語で、表が
    // 414px（枠 293px）になった（1周目、1号艇）。順位不明の「Unplaced (rank unknown)」で
    // 着順の列が 190px になった（3号艇）。6艇とも見る
    await page.goto("/en/race/2026-09-30-02-09");
    await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
    await page.locator(".rbit-bar-row").first().waitFor({ timeout: 30000 });
    for (let i = 0; i < 6; i += 1) {
      const bar = page.locator(".rbit-bar-row").nth(i);
      await bar.click();
      const wrap = page.locator(".rrt-wrap").first();
      await wrap.waitFor({ timeout: 30000 });
      const w = await wrap.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(w[0], `${i + 1}号艇`).toBeLessThanOrEqual(w[1]);
      // 決まり手・種別は1行に収める（2周目: 折り返すと「ウインウイン７」が1文字ずつ
      // 縦に並び、行の高さがばらばらになった）
      const subLines = await wrap
        .locator(".rrt-sub")
        .evaluateAll((els) =>
          els.map((el) =>
            Math.round(
              el.getBoundingClientRect().height /
                parseFloat(getComputedStyle(el).lineHeight || "12"),
            ),
          ),
        );
      // 決まり手（.rrt-technique）はハイフンで2行まで折り返す（3周目: 省略すると
      // 「Makuri…」で読めなかった）。括弧の説明は出さない
      expect(
        subLines.every((n) => n <= 2),
        `${i + 1}号艇`,
      ).toBe(true);
      const techniques = await wrap.locator(".rrt-technique").allInnerTexts();
      expect(
        techniques.some((x) => x.includes("(")),
        `${i + 1}号艇`,
      ).toBe(false);
      await bar.click();
    }
  });

  test("PC の選手ページのレース一覧で、種別を途中で折らず省略もしない（BOA-623 ファン評価2周目）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // 選手5250: 「予選特賞女子」「ＤＤ目玉女子」が「女 / 子」で折れていた
    await page.goto("/racer/5250");
    const table = page.locator(".racer-vc-race-list .rrt-table");
    await table.waitFor({ timeout: 30000 });
    const bad = await table
      .locator(".rrt-sub")
      .evaluateAll((els) =>
        els
          .filter(
            (el) =>
              el.scrollWidth > el.clientWidth + 1 ||
              el.getClientRects().length > 1 ||
              el.getBoundingClientRect().height >
                parseFloat(getComputedStyle(el).lineHeight) * 1.5,
          )
          .map((el) => el.textContent),
      );
    expect(bad).toEqual([]);
  });

  test("選手ページのレース一覧も、節の見出し行つきの6列で出す（BOA-623）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/racer/5250");
    const table = page.locator(".racer-vc-race-list .rrt-table");
    await table.waitFor({ timeout: 30000 });
    await expect(table.locator(".rrt-group").first()).toContainText("2026/");
    const wrap = await table.evaluate((tb) => {
      const w = tb.closest(".rrt-wrap");
      return [w.scrollWidth, w.clientWidth];
    });
    expect(wrap[0]).toBeLessThanOrEqual(wrap[1]);
  });
});
