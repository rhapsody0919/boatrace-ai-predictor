// 今節タブ「6艇の今節の推移」を共通の推移の図（TrendChart）1枚に重ね、横軸を日付にした後の試験
// （R-43、オーナー 2026-11-26「重ねて日付で」）。前の6段の小さな線を固定していた試験（race-detail-meet-2.spec.js・
// meet-tab-st-avg.spec.js）を、題を変えずにここへ移し、守っていたこと（着順が読める・日付の目盛り・前走・選んだ行・
// 平均 ST の1行）を新しい図に当て直した
import { test, expect } from "../fixtures.js";

const trendCard = (page) =>
  page.locator(".rmt-card").filter({ has: page.locator(".rmt-trend-rows") });

// 選んだ艇の線（点の中の着順と、上の帯の値の無い走の記号を持つ）
const activeLine = (card) => card.locator(".rmt-trend-series.is-active");

// 箱どうしが重なる組の数
const overlapsOf = (boxes) => {
  let n = 0;
  for (let i = 1; i < boxes.length; i += 1)
    for (let j = 0; j < i; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5
      )
        n += 1;
    }
  return n;
};
const rectsOf = (loc) =>
  loc.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );

test("今節のSTだけに平均・順位を控えめに表示し375pxで折り返さない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/race/2026-09-28-09-11");
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  const card = trendCard(page);
  await expect(card.locator(".rmt-trend-row")).toHaveCount(6, {
    timeout: 30000,
  });
  await card.getByRole("button", { name: "ST", exact: true }).click();
  const summaries = card.locator(".rmt-trend-st-avg");
  await expect(summaries).toHaveCount(6);
  await expect(card.locator(".rmt-trend-st-avg-note")).toContainText("未検証");
  await expect(card.locator(".rmt-trend-last .rmt-trend-st-avg")).toHaveCount(
    0,
  );
  await expect(card.locator(".rmt-trend-row > .rmt-trend-st-avg")).toHaveCount(
    6,
  );
  await expect(card.locator(".rmt-trend-st-avg-note")).not.toHaveClass(
    /rmt-spark-note/,
  );
  await expect(card.locator(".rmt-spark-note").first()).toContainText(
    "点の中の数字はその走の着順です",
  );
  const chartBounds = () =>
    card.locator(".trc-svg").evaluateAll((els) =>
      els.map((el) => {
        const { left, right } = el.getBoundingClientRect();
        return { left, right };
      }),
    );
  const stBounds = await chartBounds();
  expect(stBounds).toHaveLength(1);
  // 選んだ艇の点の中の着順（丸 r=9）が 375px で重ならない
  expect(
    overlapsOf(await rectsOf(activeLine(card).locator(".trc-mark-dot"))),
  ).toBe(0);
  for (const summary of await summaries.all()) {
    await expect(summary).toHaveText(
      /^(平均\d+\.\d{2}・[1-6]位（\d+走）|[0-2]走のため出さない)$/,
    );
    expect(
      await summary.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = el.getBoundingClientRect();
        return (
          range.getClientRects().length === 1 &&
          el.scrollWidth <= el.clientWidth &&
          box.right <= window.innerWidth
        );
      }),
    ).toBe(true);
  }
  // 右端の6艇の札は縦にそろう
  const ends = await card
    .locator(".trc-end")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
  expect(ends).toHaveLength(6);
  expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await card.getByRole("button", { name: "展示", exact: true }).click();
  await expect(summaries).toHaveCount(0);
  expect(await chartBounds()).toEqual(stBounds);
  await expect(card.locator(".rmt-trend-st-avg-note")).toHaveCount(0);
});

test.describe("レースページ再設計（BOA-168）", () => {
  test("今節タブの6艇の推移で、各走の着順を点の下に同じ横位置で出す（BOA-537）", async ({
    page,
  }) => {
    // 2026-06-20 尼崎12R: 4号艇 谷津幸宏は 6/17 11R を欠場（着順の並び 5・欠・1・3・2・1）
    await page.goto("/race/2026-06-20-13-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const card = trendCard(page);
    await rows.filter({ hasText: "谷津" }).click();
    // 共通の図では着順は点の中。欠場の走は値が無いので点を描かず、上の帯に「欠」
    const line = activeLine(card);
    await expect(line.locator(".trc-mark-text")).toHaveText([
      "5",
      "1",
      "3",
      "2",
      "1",
    ]);
    await expect(line.locator(".trc-flag text")).toHaveText(["欠"]);
    // 1着は強調、欠などの記号は点でなく帯の札
    await expect(line.locator(".trc-mark-text").nth(1)).toHaveClass(/is-win/);
    await expect(line.locator(".trc-flag-tag")).toHaveCount(1);
    // 数字どうしが重ならない
    expect(overlapsOf(await rectsOf(line.locator(".trc-mark-dot")))).toBe(0);
    await expect(page.locator(".rmt-spark-note").first()).toContainText(
      "点の中の数字はその走の着順です",
    );
    await expect(card.locator(".trc-svg")).toHaveAttribute(
      "aria-label",
      "6艇の今節の推移",
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
    const card = trendCard(page);
    const svg = card.locator(".trc-svg");
    const info = [];
    for (let k = 0; k < 6; k += 1) {
      await rows.nth(k).click();
      await expect(rows.nth(k)).toHaveAttribute("aria-pressed", "true");
      const line = activeLine(card);
      const marks = line.locator(".trc-mark-text");
      const box = await svg.boundingBox();
      const dots = await rectsOf(line.locator(".trc-mark-dot"));
      info.push({
        font: (await marks.count())
          ? await marks
              .first()
              .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
          : 0,
        overlaps: overlapsOf(dots),
        // 最初の着順が左側3割の中にある（中止レースの空きで右に寄らない）
        firstOffsetRatio: dots.length ? (dots[0].left - box.x) / box.width : 0,
      });
    }
    for (const row of info) {
      // 点の中の着順は 11px（点の下に並べていた頃の 9.5px より大きい）
      expect(row.font).toBeGreaterThanOrEqual(9);
      // 同じ日の2走の丸が重ならない
      expect(row.overlaps).toBe(0);
      expect(row.firstOffsetRatio).toBeLessThan(0.3);
    }
    // 6艇とも見た
    expect(info).toHaveLength(6);
    // 日付の目盛り（BOA-538）: 最初の日だけ「月/日」、ほかは日だけで、隣と重ならない
    const days = await card.locator(".trc-day").evaluateAll((els) =>
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

  test("着順が付かない走は、推移・比較表・日別の表で同じ公式の記号になる（BOA-537 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-25 桐生12R: 6号艇 嶋田有里の 9/21 11R は公式の結果が「落」
    await page.goto("/race/2026-09-25-01-12");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const shimada = rows.filter({ hasText: "嶋田" });
    await shimada.click();
    // 推移の図では、選んだ艇の点の中（値がある走）か上の帯（値が無い走）に「落」
    await expect(
      activeLine(trendCard(page)).locator(".trc-mark-text, .trc-flag text", {
        hasText: "落",
      }),
    ).toHaveCount(1);
    // 比較表の着順の並びも「落」（以前は「失」）
    await expect(
      page
        .locator(".rmt-compare tr", { hasText: "嶋田" })
        .locator(".rmt-finishes"),
    ).toContainText("落");
    // 日別の表も「落」（以前は「着外(順位不明)」）
    await expect(
      page.locator("tr", { hasText: "9/21" }).filter({ hasText: "11R" }),
    ).toContainText("落");
  });

  test("今節タブの6艇の推移は、1走の選手も前走の値が右端の列にそろい、選択中の行はホバーと区別できる（BOA-550 ファン評価）", async ({
    page,
  }) => {
    // 2026-09-21 桐生3R（予選2日目）: 1走しかない選手が3人いる。線が引けない艇でも
    // 図の右端の札と行の前走の値が出る
    await page.goto("/race/2026-09-21-01-03");
    await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
    const rows = page.locator(".rmt-trend-row");
    await expect(rows).toHaveCount(6, { timeout: 25000 });
    const card = trendCard(page);
    const boxes = await rows.evaluateAll((els) =>
      els.map((el) => {
        const last = el
          .querySelector(".rmt-trend-last")
          .getBoundingClientRect();
        return {
          height: Math.round(el.getBoundingClientRect().height),
          lastRight: Math.round(last.right),
          hasLast: el.querySelector(".rmt-trend-last").textContent !== "—",
        };
      }),
    );
    // 1走の艇（線の点が1つ）が実際にある（前提が崩れたらテストの意味が無い）。1走でも図から消えず、
    // 右端の札が出る（空白だと「取れていない」と読まれた）
    const strokes = await card
      .locator(".rmt-trend-series")
      .evaluateAll((els) =>
        els.map((g) =>
          [...g.querySelectorAll(".trc-stroke")].reduce(
            (n, el) => n + el.getAttribute("points").trim().split(" ").length,
            0,
          ),
        ),
      );
    expect(strokes.some((n) => n === 1)).toBe(true);
    expect(boxes.every((b) => b.hasLast)).toBe(true);
    await expect(card.locator(".trc-end")).toHaveCount(6);
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
});
