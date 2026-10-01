import { test, expect } from "./fixtures.js";

/**
 * 結果タブ・一覧カードの既存の表示崩れ（BOA-559）。
 * 1. フライング艇のスタート矢印が、ラインの手前（遅いスタート）に描かれていた
 * 2. 375px で、全角スペースで詰めた選手名（「丹下　　　将」）が姓だけに切れ、級別も見えない
 * 3. 一覧カードの出走表で、768px 以上だと6号艇の列が切れる（表の最小幅がカードより広い）
 */

const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  // 公式の元データと同じく、姓と名の間を全角スペースで詰めた名前（BOA-559）
  name:
    i === 1 ? "丹下　　　将" : i === 2 ? "土屋　実沙希" : `テスト選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));

function edgeData({ date, venueCode, venue, raceNumber, result }) {
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: [
      {
        raceId: `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`,
        venueCode,
        venue,
        raceNumber,
        startTime: "13:00",
        entries,
        predictions: {
          unified: {
            topPick: 1,
            top3: [1, 2, 3],
            confidence: 50,
            turnPrediction: {
              patterns: [
                { technique: "逃げ", winnerCourse: 1, probability: 0.6 },
              ],
            },
          },
        },
        exhibitionData: [],
        result,
      },
    ],
  };
}

// race_start_timings の行（本番の値そのまま。2026-09-29 に execute_sql で確認）
const st = (boat, startTiming, finishMark, finishRank) => ({
  boat_number: boat,
  start_timing: startTiming,
  is_flying: finishMark === "F",
  is_late_start: false,
  finish_mark: finishMark,
  finish_rank: finishRank,
});

async function openResult(page, { race, startTimings }) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(race) }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route("**/rest/v1/race_start_timings**", (route) =>
    route.fulfill({ status: 200, json: startTimings }),
  );
  const raceId = edgeData(race).races[0].raceId;
  await page.goto(`/race/${raceId}`);
  const table = page.locator(".race-result .rr-table");
  await expect(table).toBeVisible({ timeout: 20000 });
  return table;
}


// 浜名湖 2026-09-14 6R（不成立。1・2・3・5・6号艇がF、4号艇は0.02）
const HAMANAKO = {
  date: "2026-09-14",
  venueCode: 6,
  venue: "浜名湖",
  raceNumber: 6,
  result: { rank1: 4, rank2: 1, rank3: 2 },
};
const HAMANAKO_ST = [
  st(1, 0.11, "F", null),
  st(2, 0.09, "F", null),
  st(3, 0.03, "F", null),
  st(4, 0.02, "_", null),
  st(5, 0.03, "F", null),
  st(6, 0.01, "F", null),
];

test("フライング艇の矢印はスタートラインより先に、遅れていない艇はラインの手前に描く", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const table = await openResult(page, {
    race: HAMANAKO,
    startTimings: HAMANAKO_ST,
  });
  await expect(table.locator(".rr-row")).toHaveCount(6);
  const dots = await table.locator(".rr-row").evaluateAll((rows) =>
    rows.map((row) => {
      const boat = row.querySelector(".rr-boat-chip")?.textContent.trim();
      const dot = row.querySelector(".rr-st-dot");
      return { boat, left: parseFloat(dot?.style.left ?? "NaN") };
    }),
  );
  // スタートラインの位置（RaceResult.jsx の START_ANIM.LINE_PERCENT）。F 側の幅を取るため
  // 84% から 72% に下げた（BOA-586）
  const LINE = 72;
  for (const d of dots) {
    if (d.boat === "4") expect(d.left, d.boat).toBeLessThan(LINE);
    else expect(d.left, d.boat).toBeGreaterThan(LINE);
  }
  // F0.11（1号艇）は F0.01（6号艇）より先
  const left = (b) => dots.find((d) => d.boat === b).left;
  expect(left("1")).toBeGreaterThan(left("6"));
});

test("375px: 全角スペースで詰めた選手名は空白を1つにまとめ、名前と級別が切れずに見える", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const table = await openResult(page, {
    race: HAMANAKO,
    startTimings: HAMANAKO_ST,
  });
  const row1 = table
    .locator(".rr-row")
    .filter({ has: page.locator(".rr-boat-chip", { hasText: /^1$/ }) });
  const name = row1.locator(".rr-name-text");
  await expect(name).toHaveText("丹下 将B1");
  // 5文字の名前（「土屋 実沙希」）も級別まで切れない（級別は名前の下の行。ファン評価1周目）
  const names = table.locator(".rr-name-text");
  const clipped = await names.evaluateAll((els) =>
    els
      .filter((e) => e.scrollWidth > e.clientWidth)
      .map((e) => e.textContent),
  );
  expect(clipped).toEqual([]);
  await expect(table).toContainText("土屋 実沙希");
});

test("STが0.15より遅い艇も、遅いほどラインから離れて描く（0.16と0.27が重ならない）", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const table = await openResult(page, {
    race: {
      date: "2026-09-29",
      venueCode: 16,
      venue: "児島",
      raceNumber: 12,
      result: { rank1: 1, rank2: 2, rank3: 3, rank4: 4, rank5: 5, rank6: 6 },
    },
    startTimings: [
      st(1, 0.18, "1", 1),
      st(2, 0.16, "2", 2),
      st(3, 0.12, "3", 3),
      st(4, 0.12, "4", 4),
      st(5, 0.2, "5", 5),
      st(6, 0.27, "6", 6),
    ],
  });
  await expect(table.locator(".rr-row")).toHaveCount(6);
  const left = await table.locator(".rr-row").evaluateAll((rows) =>
    Object.fromEntries(
      rows.map((row) => [
        row.querySelector(".rr-boat-chip")?.textContent.trim(),
        parseFloat(row.querySelector(".rr-st-dot")?.style.left ?? "NaN"),
      ]),
    ),
  );
  // 遅いほど左（ラインから離れる）: 0.12 > 0.16 > 0.18 > 0.20 > 0.27
  expect(left["3"]).toBeGreaterThan(left["2"]);
  expect(left["2"]).toBeGreaterThan(left["1"]);
  expect(left["1"]).toBeGreaterThan(left["5"]);
  expect(left["5"]).toBeGreaterThan(left["6"]);
});

for (const width of [768, 1024, 1440]) {
  test(`${width}px: 一覧カードの出走表は6号艇の列まで切れずに収まる`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/races/2026-09-14/6");
    await expect(page.locator(".rcdt-table").first()).toBeVisible({
      timeout: 30000,
    });
    const overflow = await page.$$eval(".rcdt-table-wrapper", (ws) =>
      ws.filter((w) => w.scrollWidth > w.clientWidth + 1).length,
    );
    expect(overflow).toBe(0);

    // 名前は姓と名の境目で折り返し、名前の途中（「小森信/雄」）では折れない。
    // 文字も10.5pxより小さくしない（ファン評価2周目: 9.5pxまで縮み、途中で折れていた）
    const names = await page.$$eval(".rcdt-name-th", (ths) =>
      ths.map((th) => ({
        text: th.textContent,
        fontSize: parseFloat(getComputedStyle(th).fontSize),
        parts: [...th.querySelectorAll(".rcdt-name-part")].map((p) => ({
          chars: p.textContent.length,
          lines: Math.round(
            p.getBoundingClientRect().height /
              parseFloat(getComputedStyle(p).lineHeight),
          ),
        })),
      })),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n.fontSize, n.text).toBeGreaterThanOrEqual(10.5);
      expect(n.parts.length, n.text).toBeGreaterThanOrEqual(1);
      // 3文字以下の塊（姓・名のほぼ全て）は1行に収まる
      for (const part of n.parts.filter((p) => p.chars <= 3)) {
        expect(part.lines, n.text).toBe(1);
      }
    }
  });
}

test("1号艇（白）のST矢印に輪郭が付き、形が切り取られない", async ({ page }) => {
  // 戸田 2026-09-19 9R: 1着が1号艇（ST 0.01）で、1着行のクリーム地に白い矢印が乗る
  await page.goto("/race/2026-09-19-02-09");
  await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
  const white = page.locator(".rr-st-dot.is-white");
  await expect(white.first()).toBeAttached({ timeout: 30000 });
  const style = await white
    .first()
    .evaluate((el) => ({
      filter: getComputedStyle(el).filter,
      clip: getComputedStyle(el).clipPath,
      shapeClip: getComputedStyle(el.querySelector(".rr-st-dot-shape"))
        .clipPath,
    }));
  // 輪郭（drop-shadow）は親、形（clip-path）は子。親に clip-path があると輪郭ごと切れる
  expect(style.filter).toContain("drop-shadow");
  expect(style.clip).toBe("none");
  expect(style.shapeClip).toContain("polygon");
});

test("正常なST0.01の矢印の舳先はスタートラインを越えず、フライングの矢印だけが越える", async ({
  page,
}) => {
  // 戸田 2026-09-19 9R: 1号艇 .01（正常・1着）、2号艇 .02、3〜6号艇はF。
  // 矢印の中心を位置に合わせていたため、0.01の舳先がラインを4px越えてフライングに見えた（ファン評価3周目）
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/race/2026-09-19-02-09");
  await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
  const rows = page.locator(".rr-row");
  await expect(rows.first().locator(".rr-st-dot")).toBeAttached({
    timeout: 30000,
  });
  const boxes = await rows.evaluateAll((els) =>
    els
      .filter((row) => row.querySelector(".rr-st-dot"))
      .map((row) => {
        const dot = row.querySelector(".rr-st-dot").getBoundingClientRect();
        const line = row.querySelector(".rr-st-line").getBoundingClientRect();
        return {
          value: row.querySelector(".rr-st-value").textContent.trim(),
          tip: dot.right,
          lineLeft: line.left,
          lineRight: line.right,
        };
      }),
  );
  expect(boxes.length).toBe(6);
  for (const b of boxes) {
    if (b.value.startsWith("F"))
      expect(b.tip, b.value).toBeGreaterThan(b.lineRight);
    else expect(b.tip, b.value).toBeLessThanOrEqual(b.lineLeft + 0.5);
  }
  // 読み方の凡例が出る
  await expect(page.locator(".rr-st-legend")).toContainText("スタートライン");
});

// 姓と名は常に別の行にする。inline-block だと、日本語は1文字ごとに折り返せるため名の塊が前の行の余りに
// 縮んで入り、名の途中で折れた（ファン評価3周目）。なお6文字の名前（「安河内鈴之介」）は元データに
// 姓と名の間の空白が無く境目が分からないため、この扱いの対象外（幅で折り返す）
for (const width of [375, 1440]) {
  test(`${width}px: 一覧カードの名前は姓と名を別の行に置き、どちらも途中で折れない`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/races/2026-09-14/7");
    const th = page
      .locator(".rcdt-name-th")
      .filter({ hasText: "中山翔太" })
      .first();
    await expect(th).toBeVisible({ timeout: 30000 });
    const parts = await th.locator(".rcdt-name-part").evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent,
        top: Math.round(el.getBoundingClientRect().top),
        lines: Math.round(
          el.getBoundingClientRect().height /
            parseFloat(getComputedStyle(el).lineHeight),
        ),
      })),
    );
    expect(parts.map((p) => p.text)).toEqual(["中山", "翔太"]);
    expect(parts[1].top).toBeGreaterThan(parts[0].top);
    expect(parts.map((p) => p.lines)).toEqual([1, 1]);
  });
}
