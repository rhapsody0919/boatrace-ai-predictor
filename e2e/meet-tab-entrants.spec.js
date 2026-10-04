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
    "節の出場は47人（順位の対象は今節を走った6人。まだ走っていない41人を除く）。",
  );
});

test("初日の1R（6艇とも初戦）でも表と出場人数を出し、同じ一文を2回出さない", async ({
  page,
}) => {
  await openMeetTab(page, "2026-09-21-09-01");
  await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6);
  // 全員が初戦なら「順位の対象は0人」と書かない（BOA-697）
  await expect(page.locator(".rmt-sub").first()).toContainText(
    "節の出場は47人（まだ全員が今節初戦）。",
  );
  await expect(page.locator(".rmt-excluded-list")).toHaveCount(0);
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
    "同じ優勝戦をめざすのは24人（順位の対象は19人。下に名前を出した5人を除く）",
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
    "節の出場は47人（順位の対象は42人。下に名前を出した5人を除く）",
  );
  await expect(page.locator(".rmt-compare .rmt-warn")).toHaveCount(0);
  // 除いた5人を理由ごとに名前で出す（BOA-697）
  const list = page.locator(".rmt-excluded-list");
  await expect(list).toContainText("順位の対象外：");
  await expect(list.locator("[translate=no]")).not.toHaveCount(0);
  await expect(list).not.toContainText("ほか");
  await expect(page.locator(".rmt-card").first()).not.toContainText(
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
  // 目安の文は人数の行と別の段落（BOA-714）
  const sub = page.locator(".rmt-sub").first();
  const border = page.locator(".rmt-border-note");
  await expect(border).toContainText("準優の目安は、出場選手が全員1走してから出します。");
  await expect(border).not.toContainText("準優の目安は18位");
  await expect(sub).toContainText("まだ走っていない21人を除く");
  await expect(page.locator(".rmt-needed")).toHaveCount(0);
});

test("全員が走った後は目安を出し、何走時点の目安かを断る", async ({ page }) => {
  // 津 9/23 12R（9/22 中止の翌日）。この日の途中までは初めて走る選手がいて伏せていた
  await openMeetTab(page, "2026-09-23-09-12");
  const sub = page.locator(".rmt-border-note");
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
  const total = Number(text.match(/順位の対象は(?:今節を走った)?(\d+)人/)?.[1]);
  const excluded = Number(text.match(/名前を出した(\d+)人/)?.[1] ?? 0);
  const notYet = Number(text.match(/まだ走っていない(\d+)人/)?.[1] ?? 0);
  expect(total + excluded + notYet).toBe(all);
});

test("予選の最終日から、予選中に帰った選手を順位の対象から外す", async ({
  page,
}) => {
  // 桐生 9/23（予選の最終日）。北川・田中は 9/22 が最後の走で、9/23 の番組に
  // 1走も無い。以前は予選の翌日（または最終日）まで順位と準優の目安の計算に残った
  await openMeetTab(page, "2026-09-23-01-09");
  await expect(page.locator(".rmt-sub").first()).toContainText(
    "同じ優勝戦をめざすのは24人（順位の対象は21人。下に名前を出した3人を除く）",
  );
  // 予選の後の扱いの説明は、予選が終わるまで出さない
  await expect(page.locator(".rmt-rank-note")).not.toContainText(
    "予選の後に帰った",
  );
});

test("予選中のレースでは、後で付いた公式の備考（途中帰郷）で外さない", async ({
  page,
}) => {
  // 児島G1 10/1 9R（予選の最終日）。公式の得点率一覧の行は予選の最終日の夜に取得した
  // もので、丸野一樹は「途中帰郷」。でもこのレースの3号艇として走っている。
  // 以前はこの備考をさかのぼって当て「対象外」にしていた（PR #1149 ファン評価2周目）
  await openMeetTab(page, "2026-10-01-16-09");
  const row = page.locator(".rmt-compare tbody tr", { hasText: "丸野一樹" });
  await expect(row.locator(".rmt-rank")).not.toContainText("対象外");
  await expect(row.locator(".rmt-rank")).toContainText("位");
});

test("対象外の一覧は理由を先に表のセルと同じ書き方で出し、人数の行の直後に置く", async ({
  page,
}) => {
  // 桐生 9/23 5R（予選中のＷ優勝戦）。以前は「大澤普司（賞典除外・今節F）」と
  // 名前の後ろに理由を付け、表のセル「賞典除外（今節F）」と書き方が違った。
  // 人数の行と一覧の間に準優の目安の文が入り、Ｗ優勝戦の注記は人数の行の後ろにあった（BOA-714）
  await openMeetTab(page, "2026-09-23-01-05");
  const list = page.locator(".rmt-excluded-list");
  await expect(list).toContainText("順位の対象外：賞典除外（今節F） 大澤普司");
  await expect(list).toContainText("／途中帰郷 ");
  // 上から: 表 → Ｗ優勝戦の注記 → 準優の目安（点線の意味、BOA-722）→ 人数の行 →
  // 対象外の一覧 → 表の印の説明（金枠・⚠ 等、BOA-722）。人数の行と一覧は隣り合う（BOA-714）。
  // Ｗ優勝戦の注記を目安より先に置くのは、「12位」を母数（24人）の説明より先に
  // 出すと、見出しの「48人中」の12位と読めたため（BOA-722 ファン評価1周目）
  const order = await page.evaluate(() =>
    [
      ".rmt-compare",
      ".rmt-series-note",
      ".rmt-border-note",
      ".rmt-sub",
      ".rmt-excluded-list",
      ".rmt-table-notes",
    ].map((sel) => document.querySelector(sel).getBoundingClientRect().top),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(page.locator(".rmt-border-note")).toContainText("準優の目安は");
  // 人数の行は凡例の後ろに付けず、段落の頭から始まる（BOA-722）
  await expect(page.locator(".rmt-sub").first()).not.toContainText("金の枠");
  await expect(page.locator(".rmt-table-notes")).toContainText("金の枠");
});

test("英語の対象外の一覧で、見出しと理由のコロンが二重にならない", async ({ page }) => {
  // 理由を前に出したら「Not ranked: Withdrew: …」とコロンが続いた（BOA-714 セルフレビュー）
  await page.goto("/en/race/2026-09-25-01-07");
  await page.locator(".race-tabs-btn").nth(2).click();
  const list = page.locator(".rmt-excluded-list");
  await expect(list).toContainText(
    "Not ranked: Excluded from prizes (F this series) – 大澤普司; Withdrew – ",
    { timeout: 30000 },
  );
});

test("375pxで、対象外の一覧の選手名が途中で改行されない", async ({ page }) => {
  // 「北川」で改行して次の行が「幸典」になっていた（BOA-714 ファン評価1周目）
  await page.setViewportSize({ width: 375, height: 812 });
  await openMeetTab(page, "2026-09-25-01-07");
  const names = page.locator(".rmt-excluded-list .rmt-excluded-name");
  await expect(names).not.toHaveCount(0);
  const multiLine = await names.evaluateAll((els) =>
    els
      .filter((el) => el.getClientRects().length > 1)
      .map((el) => el.textContent),
  );
  expect(multiLine).toEqual([]);
});

test("⚠の説明は表のすぐ下に出し、金枠の凡例と印の説明は段落を分ける", async ({
  page,
}) => {
  // 津 9/23 12R（予選中）。6艇すべてに⚠が付くのに、説明は表の下4段落目にあった。
  // 金枠の凡例と印の説明も1段落に混ざっていた（BOA-738、ファン評価2周続けて）
  await openMeetTab(page, "2026-09-23-09-12");
  const hints = page.locator(".rmt-hint");
  await expect(hints.nth(1)).toHaveText("⚠ は3走未満（得点率がまだ荒い）。");
  const [hintTop, borderTop] = await page.evaluate(() =>
    [".rmt-hint + .rmt-hint", ".rmt-border-note"].map(
      (sel) => document.querySelector(sel).getBoundingClientRect().top,
    ),
  );
  expect(hintTop).toBeLessThan(borderTop);
  await expect(page.locator(".rmt-table-notes")).not.toContainText("⚠ は3走未満");
});

test("和文の注記で句点の後に半角スペースを入れない（英語は入れる）", async ({
  page,
}) => {
  // 「準優の目安は12位（5.40）。 点線より上が…」と空白が入っていた（BOA-738）
  await openMeetTab(page, "2026-09-23-09-12");
  const ja = await page.locator(".rmt-border-note").innerText();
  expect(ja).toContain("。青い点線より上が");
  expect(ja).not.toMatch(/。 /);
  await page.goto("/en/race/2026-09-23-09-12");
  await page.locator(".race-tabs-btn").nth(2).click();
  const en = await page.locator(".rmt-border-note").innerText({ timeout: 30000 });
  expect(en).toMatch(/\)\. \S/);
});

test("韓国語の⚠の説明は走数と分かる書き方にする", async ({ page }) => {
  // 「3주 미만」が「3週間未満」と読めた。表のすぐ下に出すようにしたので目立つ（BOA-738 ファン評価1周目）
  await page.goto("/ko/race/2026-09-23-09-12");
  await page.locator(".race-tabs-btn").nth(2).click();
  const hint = page.locator(".rmt-hint").nth(1);
  await expect(hint).toHaveText("⚠는 출주 3회 미만입니다(득점률이 아직 불안정).", {
    timeout: 30000,
  });
});

test("表に⚠が無いときは、金枠の凡例で⚠に触れない", async ({ page }) => {
  // 桐生 9/25 7R（予選後、6艇とも3走以上）。⚠の説明は出ないのに、凡例だけが
  // 「走数の少ない⚠の艇のときは…」と⚠に触れていた（BOA-746）
  await openMeetTab(page, "2026-09-25-01-07");
  const legend = page.locator(".rmt-table-notes");
  await expect(legend).toContainText("金の枠は6艇の中で最も良い値");
  await expect(legend).not.toContainText("⚠");
  // ⚠があるレースでは断りを出す（津 9/23 12R、6艇すべて⚠）
  await openMeetTab(page, "2026-09-23-09-12");
  await expect(page.locator(".rmt-table-notes")).toContainText(
    "（同じ値は全部）。得点率・節内順位で最も良い値が走数の少ない⚠の艇のときは、その列は",
  );
  // ⚠の艇でも前検には金枠が付く。凡例が列を書かないと「⚠の艇には付かない」と読め、
  // 前検の金枠と食い違って見えた（BOA-738 ファン評価2周目）
  await expect(page.locator(".rmt-compare .rmt-pretest.ind-best").first()).toBeVisible();
});

test("得点率早見の得点率にも、走数が少ないときは⚠を付ける", async ({ page }) => {
  // 津 9/23 12R（予選中、6艇とも3走未満）。比較表には⚠があるのに、早見の得点率には無く、
  // 目安に届いて青い得点率が当てになる値に見えた（BOA-757）
  await openMeetTab(page, "2026-09-23-09-12");
  await expect(page.locator(".rmt-forecast-table td.rmt-rate .rmt-warn")).toHaveCount(6);
});

test("推移の ST/展示 の選択中の枠と、選んだ艇の ST の線に金を使わない", async ({
  page,
}) => {
  // 金は「6艇で最良」の印。選択中の枠と ST の線が金で、ダークでは5号艇の線と同じ色に
  // 見えた（BOA-757）
  // 津 9/28 11R（最終日、選んだ艇が今節を何走もしていて ST の線が引かれる）
  await openMeetTab(page, "2026-09-28-09-11");
  await expect(page.locator(".rmt-metric-chip.is-active")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.locator(".rmt-spark .meet-sparkline-line").first(),
  ).toBeAttached({ timeout: 30000 });
  const colors = await page.evaluate(() => {
    const css = (v) => {
      const el = document.createElement("span");
      el.style.color = v;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    const chip = document.querySelector(".rmt-metric-chip.is-active");
    const line = document.querySelector(".rmt-spark .meet-sparkline-line");
    return {
      gold: css("var(--brand-accent-primary)"),
      chip: chip ? getComputedStyle(chip).borderTopColor : null,
      line: line ? getComputedStyle(line).stroke : null,
    };
  });
  expect(colors.chip).not.toBeNull();
  expect(colors.chip).not.toBe(colors.gold);
  expect(colors.line).not.toBeNull();
  expect(colors.line).not.toBe(colors.gold);
});
