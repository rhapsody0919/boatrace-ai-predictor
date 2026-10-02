import { test, expect } from "./fixtures.js";

/**
 * 今節タブの比較表の行と出場人数（BOA-660）。
 *
 * - まだ今節を走っていない艇も行として出す（「今節初戦」）。消すと欠場と読み違える
 * - 出場人数は出走表（当日の番組を含む）から数える。走った選手で数えると、
 *   初日の2Rで「節の出場は6人」になった
 * - Ｗ優勝戦で分けたときは「節の出場」と書かない（下の「節全体は◯人」と食い違う）
 * - 除いた人数に全欠場の選手も含め、足し算を合わせる
 * - 凡例（⚠ は3走未満 等）は、表の6艇に該当者がいるときだけ出す
 */

async function openMeetTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.locator(".race-tabs-btn", { hasText: "今節" }).click();
  await expect(page.locator(".rmt-compare tbody tr").first()).toBeVisible({
    timeout: 30000,
  });
}

test("初日の2Rでも6艇とも行が出て、出場人数は出走表から数える", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-21-09-02");
  await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6);
  await expect(page.locator(".rmt-compare .rmt-rank").first()).toHaveText(
    "今節初戦",
  );
  await expect(page.locator(".rmt-sub").first()).toContainText(
    // まだ走っていない選手も書き足す（BOA-690）
    "節の出場は47人（順位の対象は6人。まだ走っていない41人を除く）。",
  );
});

test("初日の1R（6艇とも初戦）でも表と出場人数を出し、同じ一文を2回出さない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-21-09-01");
  await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6);
  await expect(page.locator(".rmt-sub").first()).toContainText("節の出場は");
  await expect(
    page.locator(".rmt-empty", { hasText: "今節はまだ走っていません" }),
  ).toHaveCount(1);
});

test("予選序盤で今節をまだ走っていない艇も行として出す", async ({ page }) => {
  await openMeetTab(page, "2026-09-23-09-06");
  await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6);
});

test("Ｗ優勝戦で分けたときは「同じ優勝戦をめざす」人数として書く", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-25-01-07");
  await expect(page.locator(".rmt-sub").first()).toContainText(
    "同じ優勝戦をめざすのは24人（順位の対象は19人。賞典除外・途中帰郷・欠場の5人を除く）",
  );
  await expect(page.locator(".rmt-sub").first()).not.toContainText(
    "節の出場",
  );
});

test("除いた人数を足すと出場人数になり、表に無い印の凡例は出さない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-28-09-11");
  await expect(page.locator(".rmt-sub").first()).toContainText(
    "節の出場は47人（順位の対象は42人。賞典除外・途中帰郷・欠場の5人を除く）",
  );
  await expect(page.locator(".rmt-compare .rmt-warn")).toHaveCount(0);
  await expect(page.locator(".rmt-sub").first()).not.toContainText(
    "3走未満",
  );
});

test("375pxで、今節初戦の行があっても列見出し「前検」がカードからはみ出さない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMeetTab(page, "2026-09-23-09-06");
  const overflow = await page.evaluate(() => {
    const card = document.querySelector(".rmt-compare").closest(".rmt-card");
    const ths = [...document.querySelectorAll(".rmt-compare thead th")];
    const last = ths[ths.length - 1];
    const range = document.createRange();
    range.selectNodeContents(last);
    return range.getBoundingClientRect().right - card.getBoundingClientRect().right;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const path of ["/race/2026-09-25-01-07", "/en/race/2026-09-25-01-07"]) {
  test(`375pxで、節内順位と前検の値がくっつかない（${path}）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await page.locator(".race-tabs-btn").nth(2).click();
    await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6, {
      timeout: 30000,
    });
    // 列の間を詰めて見出しのはみ出しを直したら、「7 6.74」が1つの値に見えた
    // （PR #1102 ファン評価3周目）。列の間は8pxのまま、名前の列の側で吸収する
    const minGap = await page.evaluate(() => {
      const rng = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect();
      };
      let gap = Infinity;
      for (const tr of document.querySelectorAll(".rmt-compare tbody tr")) {
        const rank = tr.querySelector(".rmt-rank");
        const pre = tr.querySelector(".rmt-pretest");
        if (rank && pre && pre.innerText.trim() !== "—")
          gap = Math.min(gap, rng(pre).left - rng(rank).right);
      }
      return gap;
    });
    expect(minGap).toBeGreaterThanOrEqual(6);
  });
}

test("まだ全員が1走していない間は準優の目安を伏せ、人数にまだ走っていない選手を書き足す", async ({
  page,
}) => {
  // 下関の初日 5R。以前は走った24人の中の18位を「準優の目安は18位（2.00）」と出し、
  // 人数も「45人（対象24人）」と足し算が合わなかった（BOA-690）
  await openMeetTab(page, "2026-10-01-19-05");
  const sub = page.locator(".rmt-sub").first();
  await expect(sub).toContainText("準優の目安は、出場選手が全員1走してから出します。");
  await expect(sub).not.toContainText("準優の目安は18位");
  await expect(sub).toContainText("まだ走っていない21人を除く");
  await expect(page.locator(".rmt-needed")).toHaveCount(0);
});

test("全員が走った後は目安を出し、何走時点の目安かを断る", async ({ page }) => {
  // 津 9/23 12R（9/22 中止の翌日）。この日の途中までは初めて走る選手がいて伏せていた
  await openMeetTab(page, "2026-09-23-09-12");
  const sub = page.locator(".rmt-sub").first();
  await expect(sub).toContainText("準優の目安は18位");
  await expect(sub).toContainText(
    "走した時点の目安で、予選が終わるまでは動きます。",
  );
});

test("Ｗ優勝戦では前検の列見出しに節全体の人数を出す", async ({ page }) => {
  // 節内順位は片側24人の中、前検の順位は節全体48人の中（公式の値）。分母を見せる（BOA-690）
  await openMeetTab(page, "2026-09-24-01-03");
  await expect(page.locator(".rmt-compare thead th").last()).toHaveText(
    "前検（48人中）",
  );
});

test("中止があった日も、人数の足し算が合う", async ({ page }) => {
  // 津 9/21 は 5R 以降が中止。中止になったレースにしか番組が無かった選手が、
  // 「まだ走っていない」にも数えられず、足し算が合わなかった（PR #1184 ファン評価1周目）
  await openMeetTab(page, "2026-09-21-09-12");
  const text = await page.locator(".rmt-sub").first().innerText();
  const all = Number(text.match(/節の出場は(\d+)人/)?.[1]);
  const total = Number(text.match(/順位の対象は(\d+)人/)?.[1]);
  const excluded = Number(text.match(/欠場の(\d+)人/)?.[1] ?? 0);
  const notYet = Number(text.match(/まだ走っていない(\d+)人/)?.[1] ?? 0);
  expect(total + excluded + notYet).toBe(all);
});
