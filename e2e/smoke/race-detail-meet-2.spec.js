import { test, expect } from "../fixtures.js";

test.describe("レースページ再設計（BOA-168）", () => {
  test("今節タブの6艇の推移で、各走の着順を点の下に同じ横位置で出す（BOA-537）", async ({
    page,
  }) => {
    // 2026-06-20 尼崎12R: 4号艇 谷津幸宏は 6/17 11R を欠場（着順の並び 5・欠・1・3・2・1）
    await page.goto("/race/2026-06-20-13-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const yatsu = rows.filter({ hasText: "谷津" });
    await expect(yatsu.locator(".meet-sparkline-label")).toHaveText([
      "5",
      "欠",
      "1",
      "3",
      "2",
      "1",
    ]);
    // 1着は強調、欠などの記号は控えめ
    await expect(yatsu.locator(".meet-sparkline-label").nth(2)).toHaveClass(
      /is-win/,
    );
    await expect(yatsu.locator(".meet-sparkline-label").nth(1)).toHaveClass(
      /is-mark/,
    );
    // 数字どうしが重ならない（各行）
    const overlaps = await rows.evaluateAll((els) =>
      els.map((r) => {
        const ls = [...r.querySelectorAll(".meet-sparkline-label")].map((x) =>
          x.getBoundingClientRect(),
        );
        let n = 0;
        for (let i = 1; i < ls.length; i += 1)
          if (ls[i].left < ls[i - 1].right) n += 1;
        return n;
      }),
    );
    expect(overlaps.every((n) => n === 0)).toBe(true);
    await expect(page.locator(".rmt-spark-note").first()).toContainText(
      "点の下の数字はその走の着順です",
    );
    await expect(page.locator(".rmt-trend-head-sub")).toHaveText(
      "点の下＝着順",
    );
  });

  test("走数が多い節でも、375pxで点の下の着順を1段で並べ、日付の目盛りも重ならない（BOA-537・BOA-538）", async ({
    page,
  }) => {
    // 2026-09-28 津11R（最終日）: 各艇10〜11走。9/21・22 の中止レースは出走表にだけ残る
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/race/2026-09-28-09-11");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const info = await rows.evaluateAll((els) =>
      els.map((r) => {
        const labels = [...r.querySelectorAll(".meet-sparkline-label")];
        const wrap = r
          .querySelector(".meet-sparkline-wrap")
          .getBoundingClientRect();
        const gaps = [];
        for (const lower of [false, true]) {
          const ls = labels
            .filter((e) => e.classList.contains("is-lower") === lower)
            .map((x) => x.getBoundingClientRect());
          for (let i = 1; i < ls.length; i += 1)
            gaps.push(ls[i].left - ls[i - 1].right);
        }
        return {
          font: labels[0]
            ? parseFloat(getComputedStyle(labels[0]).fontSize)
            : 0,
          minGap: Math.min(...gaps),
          // 最初の着順が左側3割の中にある（中止レースの空きで右に寄らない）。
          // 日付の横軸（BOA-538）では、初日に走っていない選手は2日目の位置から始まる
          firstOffsetRatio:
            (labels[0].getBoundingClientRect().left - wrap.left) / wrap.width,
          // 全走を1段に並べる（2段に振り分けると段ごとに読んで順番を読み違える）
          lines: new Set(
            labels.map((x) => Math.round(x.getBoundingClientRect().top)),
          ).size,
        };
      }),
    );
    for (const row of info) {
      // 日付の横軸では同じ日の2走を寄せる（日の区切りが見えるように）。375pxで
      // 毎日2走の行は9.5pxまで小さくなる
      expect(row.font).toBeGreaterThanOrEqual(9);
      // 日付の横軸（BOA-538）では1日2走が近づく。隣と重ならない
      expect(row.minGap).toBeGreaterThanOrEqual(2);
      expect(row.firstOffsetRatio).toBeLessThan(0.3);
      expect(row.lines).toBe(1);
    }
    // 日付の目盛り（BOA-538）: 最初の日だけ「月/日」、ほかは日だけで、隣と重ならない
    const days = await page.locator(".rmt-trend-day").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { text: e.textContent, left: r.left, right: r.right };
      }),
    );
    expect(days[0].text).toMatch(/^\d+\/\d+$/);
    expect(days.slice(1).every((d) => /^\d+$/.test(d.text))).toBe(true);
    for (let i = 1; i < days.length; i += 1)
      expect(days[i].left).toBeGreaterThan(days[i - 1].right);
  });

  test("375pxで履歴の表の着順が初期表示に入り、前走の公式の記号を言語ごとの表記で出す（BOA-569）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-06-13 浜名湖12R: 基本情報の直近10走（11列・約930px）
    await page.goto("/race/2026-06-13-06-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const bar = page.locator(".rbit-bar-row").first();
    await bar.waitFor({ timeout: 30000 });
    await bar.click();
    const table = page.locator(".rrt-table").first();
    await table.waitFor({ timeout: 30000 });
    // 列は「日付・R・枠番・進入・ST・着順」（BOA-623）。375px で横に送らずに全部見える
    // （以前は11列・約930pxで、着順は R の右に寄せても枠番・ST は画面外だった）
    const layout = await table.evaluate((tb) => {
      const wrap = tb.closest(".rrt-wrap");
      return {
        heads: [...tb.querySelectorAll("thead th")]
          .filter((th) => getComputedStyle(th).display !== "none")
          .map((th) => th.textContent.trim()),
        scroll: wrap.scrollWidth,
        client: wrap.clientWidth,
      };
    });
    expect(layout.heads).toEqual(["日付", "R", "枠番", "進入", "ST", "着順"]);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);

    // 英語の画面で公式の記号（エ＝エンスト）を生のまま出さない（ファン評価2周目）。
    // 2026-09-30 戸田9R: 前の走がエンスト失格の艇がいる
    await page.goto("/en/race/2026-09-30-02-09");
    await page.locator(".race-tabs-btn", { hasText: "Basic Info" }).click();
    const enRow = page
      .locator("tr", { hasText: "Last race this series" })
      .first();
    await enRow.waitFor({ timeout: 30000 });
    await expect(enRow).toContainText("Eng");
    await expect(enRow).not.toContainText("エ");
    // 記号の意味をタッチでも確かめられる（BOA-592。以前は ? が日本語ページだけで、title しか無かった）
    await enRow.locator(".term-hint__button").click();
    const enHint = page.locator(".term-hint__popover");
    await expect(enHint).toContainText("Eng");
    await expect(enHint).toContainText(/engine stall/i);
    await enRow.locator(".term-hint__button").click();
    // 同じ走を直近の出走履歴でも同じ表記にする（ファン評価3周目。以前は履歴だけ「エ」）
    await page.locator(".rbit-bar-row").nth(5).click();
    const enHistory = page.locator(".rrt-table").first();
    await enHistory.waitFor({ timeout: 30000 });
    await expect(enHistory).toContainText("Eng");
    await expect(enHistory).not.toContainText("エ");

    // 「今節の展示」が無い艇は「今節初戦」のまま。
    // 2026-09-21 津1R は節の初日
    await page.goto("/race/2026-09-21-09-01");
    await page.locator(".race-tabs-btn", { hasText: "直前情報" }).click();
    const meetRow = page.locator("tr", { hasText: "今節展示情報" }).first();
    await meetRow.waitFor({ timeout: 30000 });
    await expect(meetRow).toContainText("今節初戦");
  });

  test("データ出走表の今節の前走は前日の走も拾い、節の初日の1Rは「今節初戦」（BOA-610）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-06-22 尼崎12R（優勝戦）: 公式の直前情報の前走（同じ日の前の走）は
    // 6艇とも空。今節の前走は前日の走から出す（以前は6艇とも「今節初戦」）
    await page.goto("/race/2026-06-22-13-12");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow.waitFor({ timeout: 30000 });
    await expect(prevRow).not.toContainText("今節初戦");
    await expect(prevRow).toContainText("6/21 11R");

    // 4日目の5R（2026-09-26 津）: その日まだ走っていない5艇も前日の走を出す。
    // 1R を走った6号艇は同じ日の 1R（BOA-610。以前は5艇が「初走」）
    await page.goto("/race/2026-09-26-09-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow2 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow2.waitFor({ timeout: 30000 });
    await expect(prevRow2).not.toContainText("今節初戦");
    await expect(prevRow2.locator("td").nth(6)).toContainText("9/26 1R");
    await expect(prevRow2.locator("td").nth(1)).toContainText("9/25 9R");

    // 2026-09-30 児島7R の1号艇 西村拓也: 9/29 10R（5号艇・4コース進入で2着）が今節の前走。
    // 公式の直前情報の前走は同じ日だけなので、以前は「今節初戦」と出ていた（BOA-610）
    await page.goto("/race/2026-09-30-16-07");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow3 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow3.waitFor({ timeout: 30000 });
    const nishimura = prevRow3.locator("td").nth(1);
    await expect(nishimura).toContainText("2着");
    // 進入は4コース（公式のスタート情報）。枠番の5を出さない（ファン評価1周目 P0）
    await expect(nishimura).toContainText("4コース");
    await expect(nishimura).not.toContainText("5コース");
    await expect(nishimura).toContainText("9/29 10R");
    await expect(prevRow3).not.toContainText("今節初戦");

    // 節の初日の1R は全艇「今節初戦」（2026-09-21 津1R）
    await page.goto("/race/2026-09-21-09-01");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const prevRow4 = page.locator("tr", { hasText: "今節の前走" }).first();
    await prevRow4.waitFor({ timeout: 30000 });
    await expect(prevRow4.locator("td", { hasText: "今節初戦" })).toHaveCount(
      6,
    );
    // 375px で「今節初／戦」と語の途中で折れない（ファン評価3周目）。
    // 折れると行内要素の矩形が2つになる
    const lineCounts = await prevRow4
      .locator("td .drt-sub")
      .evaluateAll((els) => els.map((el) => el.getClientRects().length));
    expect(lineCounts).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test("データ出走表の今節の前走は中止になったレースを飛ばす（BOA-610）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // 2026-09-22 戸田5R の5号艇: 前日の 9/21 5R は中止（出走表の行はあるが結果が無い）。
    // 前走は 9/20 10R（4コース6着）。中止を拾うと「—」のまま残る
    await page.goto("/race/2026-09-22-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    const row = page.locator("tr", { hasText: "今節の前走" }).first();
    await row.waitFor({ timeout: 30000 });
    const boat5 = row.locator("td").nth(5);
    await expect(boat5).toContainText("9/20 10R");
    await expect(boat5).toContainText("6着");
  });

  test("着順が付かない走は、推移・比較表・日別の表で同じ公式の記号になる（BOA-537 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-25 桐生12R: 6号艇 嶋田有里の 9/21 11R は公式の結果が「落」
    await page.goto("/race/2026-09-25-01-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const shimada = rows.filter({ hasText: "嶋田" });
    await expect(shimada.locator(".meet-sparkline-label").nth(2)).toHaveText(
      "落",
    );
    // 比較表の着順の並びも「落」（以前は「失」）
    await expect(
      page
        .locator(".rmt-compare tr", { hasText: "嶋田" })
        .locator(".rmt-finishes"),
    ).toContainText("落");
    // 日別の表も「落」（以前は「着外(順位不明)」）
    await shimada.click();
    await expect(
      page.locator("tr", { hasText: "9/21" }).filter({ hasText: "11R" }),
    ).toContainText("落");
  });

  test("今節タブの6艇の推移は、1走の選手も前走の値が右端の列にそろい、選択中の行はホバーと区別できる（BOA-550 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-21 桐生3R（予選2日目）: 1走しかない選手が3人いる。線が出ない行で
    // 前走の値が中央の列に詰まり、行の高さも半分になっていた
    await page.goto("/race/2026-09-21-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const boxes = await rows.evaluateAll((els) =>
      els.map((el) => {
        const last = el
          .querySelector(".rmt-trend-last")
          .getBoundingClientRect();
        return {
          hasLine: Boolean(el.querySelector(".meet-sparkline-wrap")),
          dots: el.querySelectorAll(".meet-sparkline > circle").length,
          height: Math.round(el.getBoundingClientRect().height),
          lastRight: Math.round(last.right),
        };
      }),
    );
    // 1走の行が実際にある（前提が崩れたらテストの意味が無い）。1走でも行が
    // 空白にならず、前走の点が1つだけ出る（2周目のファン評価で空白が
    // 「取れていない」と読まれた）
    expect(boxes.some((b) => b.dots === 1)).toBe(true);
    expect(boxes.every((b) => b.hasLine && b.dots >= 1)).toBe(true);
    expect(new Set(boxes.map((b) => b.lastRight)).size).toBe(1);
    expect(new Set(boxes.map((b) => b.height)).size).toBe(1);

    // 選択中の行だけ左の帯（inset の box-shadow）が付き、ホバー中の行には付かない
    await rows.nth(0).click();
    await rows.nth(1).hover();
    const shadows = await rows.evaluateAll((els) =>
      els.slice(0, 2).map((el) => getComputedStyle(el).boxShadow),
    );
    expect(shadows[0]).not.toBe("none");
    expect(shadows[1]).toBe("none");
  });

  test("F数バッジが基本情報タブとST考察カードで同じ値になり、f_countが無い過去レースでは出ない（phase a T5-3）", async ({
    page,
  }) => {
    // 2026-09-21 戸田5R: f_count は 1号艇2本・5号艇1本・6号艇1本で固定
    await page.goto("/race/2026-09-21-02-05");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });

    const basicBadges = page.locator(".rbit-bar-row .flying-badge");
    await expect(basicBadges).toHaveCount(3);
    // F2は赤（90日のあっせん停止で意味が違う）、F1は金
    await expect(basicBadges.nth(0)).toHaveText("F2");
    await expect(basicBadges.nth(0)).toHaveClass(/is-f2/);
    await expect(basicBadges.nth(1)).toHaveText("F1");
    await expect(basicBadges.nth(1)).not.toHaveClass(/is-f2/);

    // ST考察カードのバッジも同じ出所（race_entries.f_count）に統一した
    await page.locator(".race-tabs-btn", { hasText: "枠別情報" }).click();
    await page
      .locator(".rsc-card")
      .waitFor({ state: "visible", timeout: 25000 });
    const stBadges = page.locator(".rsc-grid .flying-badge");
    await expect(stBadges).toHaveCount(3);
    await expect(stBadges.nth(0)).toHaveText("F2");
    await expect(stBadges.nth(1)).toHaveText("F1");
    // 6艇すべての出走履歴を取り終えるまで待つ。カードは1艇分でも揃えば表を出し、
    // バッジは race_entries.f_count から出るので、上の確認は履歴の取得を待たない。
    // 履歴は選手ごとに race_start_timings を1000行ずつページングしており（2年窓で
    // 1000行を超える選手がいる）、待たずに次のレースへ移ると2ページ目が録画に入らず、
    // 速い再生でだけ出て本番へ素通りしていた（BOA-556）。走数は取得前「—」、
    // 取得後は数字（0を含む）になる
    // 走数が少ない艇は⚠が付く（race-detail-ui-unify plan §6）
    await expect(page.locator(".rsc-grid .rsc-runs")).toHaveText(
      Array(6).fill(/^⚠?\d+$/),
      // 録画（本番に繋ぐ）では6選手分の2年窓を取るので、他の待ちと同じ長さにする
      { timeout: 25000 },
    );

    // f_count が無い期間（2026-09-20以前）はバッジも空欄も出さない
    await page.goto("/race/2026-09-10-01-01");
    await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
    await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
      timeout: 25000,
    });
    await expect(page.locator(".flying-badge")).toHaveCount(0);
  });
});
