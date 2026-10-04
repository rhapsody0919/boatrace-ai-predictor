import { test, expect } from "./fixtures.js";

/**
 * 展開予測の的中は1着の艇だけで判定し、決まり手は見ない（判定と公開している的中率は変えない）。
 * そのため決まり手が外れていても、前付けで艇番と違うコースから勝っても「的中」になる。
 * 表示だけを直す（BOA-724、2026-10-03 ユーザー判断の A 案）。
 * - A-1: 「的中」は艇の印にし、決まり手の行には付けない
 * - A-2: 決まり手が違う、またはコースが艇番と違うレースでは「予想通りの展開でした」を出さない
 * - A-3: カードの「予想: 逃げ 54%」は、実際と違うときに「（実際: 差し）」を添える
 */

test("A-2: 共有文は、決まり手もコースも予想どおりのときだけ「予想通りの展開でした」と書く", async ({
  page,
}) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  const texts = await page.evaluate(async () => {
    const { generateTurnHitShareText } = await import("/src/utils/share.js");
    const base = { venue: "鳴門", raceNo: 12, date: "2026-10-02" };
    return {
      asPredicted: generateTurnHitShareText({
        ...base,
        winnerBoat: 1,
        winnerEntryCourse: 1,
        technique: "逃げ",
        actualTechnique: "逃げ",
        probability: 0.54,
      }),
      techniqueDiffers: generateTurnHitShareText({
        ...base,
        winnerBoat: 2,
        winnerEntryCourse: 2,
        technique: "差し",
        actualTechnique: "まくり",
        probability: 0.1,
      }),
      courseDiffers: generateTurnHitShareText({
        ...base,
        winnerBoat: 1,
        winnerEntryCourse: 2,
        technique: "逃げ",
        actualTechnique: "差し",
        probability: 0.54,
      }),
      // 例: 戸田 9/30 8R。本命は1号艇の逃げ、当たったのは2番手の3号艇のまくり
      secondPick: generateTurnHitShareText({
        ...base,
        winnerBoat: 3,
        winnerEntryCourse: 3,
        technique: "まくり",
        actualTechnique: "まくり",
        isTopPick: false,
        probability: 0.13,
      }),
      unknownActual: generateTurnHitShareText({
        ...base,
        winnerBoat: 3,
        winnerEntryCourse: 3,
        technique: "まくり",
        actualTechnique: null,
        probability: 0.12,
      }),
    };
  });
  expect(texts.asPredicted).toContain(
    "1号艇が1着（AIの予想: 逃げ 54%）\n予想通りの展開でした ✅",
  );
  expect(texts.techniqueDiffers).toContain(
    "2号艇が1着（AIの予想: 差し 10%、実際: まくり）\n\n",
  );
  expect(texts.techniqueDiffers).not.toContain("予想通り");
  // 例: 多摩川 9/27 11R。「2コースから逃げ」は起こりえない
  expect(texts.courseDiffers).toContain(
    "1号艇が2コースから1着（AIの予想: 逃げ 54%、実際: 差し）",
  );
  expect(texts.courseDiffers).not.toContain("予想通り");
  expect(texts.unknownActual).not.toContain("予想通り");
  // 予想と違うレースは、見出し・締めでも決まり手まで当たったように言わない（ファン評価1周目）
  for (const text of [
    texts.secondPick,
    texts.techniqueDiffers,
    texts.courseDiffers,
    texts.unknownActual,
  ]) {
    expect(text).toContain("展開予測で1着の艇が的中");
    expect(text).not.toMatch(/展開予測的中！|AIの分析力|この精度|当たった/);
  }
  // 共有はレース当日とは限らない
  for (let i = 0; i < 30; i += 1) {
    const text = await page.evaluate(async () => {
      const { generateTurnHitShareText } = await import("/src/utils/share.js");
      return generateTurnHitShareText({
        venue: "戸田",
        raceNo: 11,
        date: "2026-09-27",
        winnerBoat: 1,
        winnerEntryCourse: 1,
        technique: "逃げ",
        actualTechnique: "逃げ",
        probability: 0.6,
      });
    });
    expect(text).not.toContain("今日も");
  }
});

test("A-1: AI予想タブで、予想の決まり手が外れた的中には実際の決まり手を添える", async ({
  page,
}) => {
  test.slow();
  // 2026-09-30 大村10R: 1号艇が1着（予想は逃げ、実際は抜き）
  await page.goto("/race/2026-09-30-24-10", { waitUntil: "domcontentloaded" });
  await page.locator(".race-tabs-btn", { hasText: /^AI予想$/ }).click();
  const hitRow = page.locator(".turn-pattern-row--hit");
  await expect(hitRow).toHaveCount(1, { timeout: 60000 });
  await expect(hitRow.locator(".turn-pattern-actual")).toHaveText(
    "（実際: 抜き）",
  );
  await expect(page.locator(".turn-pattern-summary")).toHaveText(
    "✅ 上位予想の艇が1着になりました",
  );
});

test("A-1: AI予想タブの「的中」は、決まり手と%の後ろではなく艇番の隣に付ける", async ({
  page,
}) => {
  test.slow();
  // 2026-09-27 戸田11R: 1号艇が1着（的中）
  await page.goto("/race/2026-09-27-02-11", { waitUntil: "domcontentloaded" });
  await page.locator(".race-tabs-btn", { hasText: /^AI予想$/ }).click();
  const tag = page.locator(".turn-pattern-hit-tag");
  await expect(tag).toHaveCount(1, { timeout: 60000 });
  const order = await tag.evaluate((el) => ({
    prev: el.previousElementSibling?.className ?? "",
    next: el.nextElementSibling?.className ?? "",
  }));
  expect(order.prev).toContain("turn-pattern-boat");
  expect(order.next).toContain("turn-pattern-technique");
  // 「的中 差し」と続いて決まり手が当たったと読めたので、艇の印は「1着」と書く（ファン評価2周目）
  await expect(tag).toHaveText("1着");
});

test("A-3: 的中レースのカードは、予想の決まり手が実際と違うときに実際の決まり手を添える", async ({
  page,
}) => {
  test.slow();
  await page.goto("/hit-races", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /全期間/ }).click();
  const more = page.locator(".show-more-button");
  await more.waitFor({ timeout: 60000 });
  await more.click();
  const actual = page.locator(".turn-hit-actual");
  await expect(actual.first()).toBeVisible({ timeout: 60000 });
  const rows = await page
    .locator(".turn-hit-probability")
    .evaluateAll((els) => els.map((el) => el.textContent));
  const withActual = rows.filter((r) => r.includes("実際"));
  expect(withActual.length).toBeGreaterThan(0);
  for (const row of withActual) {
    const m = row.match(/^予想: (\S+) \d+%（実際: (\S+)）$/);
    expect(m, row).not.toBeNull();
    // 予想と実際が同じなら添えない
    expect(m[1]).not.toBe(m[2]);
  }
  // 当たった候補が何番手か（本命か、予想N番手か）を添える（ファン評価2周目）
  const labels = await page
    .locator(".turn-hit-course-label")
    .evaluateAll((els) => els.map((el) => el.textContent));
  for (const label of labels) {
    expect(label).toMatch(/^的中した候補（(本命|予想\d番手)）$/);
  }
  expect(labels.some((l) => l.includes("本命"))).toBe(true);
  expect(labels.some((l) => /予想[2-9]番手/.test(l))).toBe(true);
  // 全期間の見出しが白地に白文字にならない（ファン評価1周目）
  const bg = await page
    .locator(".hit-races-section.all")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("gradient");
});

test("A-2 (b): AI予想タブのまとめは、本命が予想どおりに勝ったときだけ「予想通り」と言う", async ({
  page,
}) => {
  test.slow();
  const summaryOf = async (raceId) => {
    await page.goto(`/race/${raceId}`, { waitUntil: "domcontentloaded" });
    await page.locator(".race-tabs-btn", { hasText: /^AI予想$/ }).click();
    const summary = page.locator(".turn-pattern-summary--hit");
    await expect(summary).toHaveCount(1, { timeout: 60000 });
    return summary;
  };
  // 戸田 9/30 8R: 本命は1号艇の逃げ、当たったのは2番手の3号艇のまくり
  await expect(await summaryOf("2026-09-30-02-08")).toHaveText(
    "✅ 上位予想の艇が1着になりました",
  );
  // 戸田 9/27 11R: 本命の1号艇が1コースから逃げ
  await expect(await summaryOf("2026-09-27-02-11")).toHaveText(
    "✅ 予想通りの展開でした（本命の艇が予想の決まり手で1着）",
  );
});

test("ファン評価3周目: 1着の艇の行は、AIが一番に推した決まり手のまま出し、外れは「実際」で示す", async ({
  page,
}) => {
  test.slow();
  // 2026-09-29 大村10R: AIの本命は1号艇の逃げ（46%）。1号艇が抜きで1着。
  // 以前は1号艇の行が「抜き 11%」に差し替わり、本命の%が2番手より低く見えた
  await page.goto("/race/2026-09-29-24-10", { waitUntil: "domcontentloaded" });
  await page.locator(".race-tabs-btn", { hasText: /^AI予想$/ }).click();
  const hitRow = page.locator(".turn-pattern-row--hit");
  await expect(hitRow).toHaveCount(1, { timeout: 60000 });
  await expect(hitRow.locator(".turn-pattern-technique")).toHaveText(
    "逃げ（実際: 抜き）",
  );
  const probs = await page
    .locator(".turn-pattern-prob")
    .evaluateAll((els) => els.map((el) => parseInt(el.textContent, 10)));
  // 予想の順位（🥇🥈🥉）どおりに%が並ぶ
  expect([...probs].sort((a, b) => b - a)).toEqual(probs);
  // 結果確定後の説明に、メダルは予想の順位だと書く（着順に見えた。BOA-748 の原因）
  await expect(page.locator(".turn-pattern-caption")).toContainText(
    "予想の順位（着順ではありません）",
  );
});

test("ファン評価3周目: 的中カードの「（本命）」「（2コース進入）」を語の途中で折り返さない", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/hit-races", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /全期間/ }).click();
  const more = page.locator(".show-more-button");
  await more.waitFor({ timeout: 60000 });
  await more.click();
  await expect(page.locator(".turn-hit-nowrap").first()).toBeVisible({
    timeout: 60000,
  });
  // 1行に収まっている＝文字の矩形の上端がすべて同じ（括弧と中身で text node が分かれるため、
  // 矩形の数ではなく行数で見る）
  const rows = await page.locator(".turn-hit-nowrap").evaluateAll((els) =>
    els.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set(
        [...range.getClientRects()].map((r) => Math.round(r.top)),
      );
      return { text: el.textContent, lines: tops.size };
    }),
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter((r) => r.lines !== 1)).toEqual([]);
});
