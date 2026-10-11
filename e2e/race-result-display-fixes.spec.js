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
  name: i === 1 ? "丹下　　　将" : i === 2 ? "土屋　実沙希" : `テスト選手${i}`,
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
  // 進入（枠なり）。結果タブのスタート隊形の絵はコース順に並べる（BOA-811）
  entry_course: boat,
});

// スタート隊形の絵（BOA-811）の艇ごとの位置。SVG の座標（幅351）で測るので画面の幅によらない。
// tip は艇の舳先（右端）、slit はスリット線の x
async function formationTips(page) {
  const fig = page.locator(".rr-formation-svg");
  await expect(fig).toBeVisible({ timeout: 20000 });
  return fig.evaluate((svg) => {
    const slit = Number(svg.querySelector(".rr-fm-slit").getAttribute("x1"));
    const out = { slit };
    for (const g of svg.querySelectorAll("g[data-boat]")) {
      const hull = g.querySelector(".rr-fm-hull");
      if (!hull) continue;
      const b = hull.getBBox();
      out[g.dataset.boat] = {
        tip: b.x + b.width,
        text: g.querySelector(".rr-fm-st")?.textContent ?? "",
        stroke: hull.getAttribute("stroke"),
      };
    }
    return out;
  });
}

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

test("フライング艇はスタート隊形の絵でスリット線より先に、遅れていない艇は線の手前に描く（BOA-559 を BOA-811 の絵に移した）", async ({
  page,
}) => {
  const table = await openResult(page, {
    race: HAMANAKO,
    startTimings: HAMANAKO_ST,
  });
  await expect(table.locator(".rr-row")).toHaveCount(6);
  const f = await formationTips(page);
  for (const b of ["1", "2", "3", "5", "6"])
    expect(f[b].tip, b).toBeGreaterThan(f.slit);
  expect(f["4"].tip).toBeLessThan(f.slit);
  // F.11（1号艇）は F.01（6号艇）より先
  expect(f["1"].tip).toBeGreaterThan(f["6"].tip);
  // 大きな F でも絵の右端（351）からはみ出さない
  for (const b of ["1", "2", "3", "5", "6"])
    expect(f[b].tip).toBeLessThanOrEqual(351);
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
    els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
  );
  expect(clipped).toEqual([]);
  await expect(table).toContainText("土屋 実沙希");
});

test("STが0.15より遅い艇も、遅いほどスリット線から離れて描く（0.16と0.27が重ならない。BOA-811 の絵）", async ({
  page,
}) => {
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
  const f = await formationTips(page);
  const left = Object.fromEntries(
    ["1", "2", "3", "5", "6"].map((b) => [b, f[b].tip]),
  );
  // 遅いほど左（線から離れる）: 0.12 > 0.16 > 0.18 > 0.20 > 0.27
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
    const overflow = await page.$$eval(
      ".rcdt-table-wrapper",
      (ws) => ws.filter((w) => w.scrollWidth > w.clientWidth + 1).length,
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

test("スタート隊形の絵の艇には輪郭を付け、2号艇（黒）も暗い水面で見える（BOA-711 を BOA-811 の絵に移した）", async ({
  page,
}) => {
  // 戸田 2026-09-19 9R
  await page.goto("/race/2026-09-19-02-09");
  await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
  const f = await formationTips(page);
  expect(f["2"].stroke).toBe("#ffffff");
  expect(f["1"].stroke).toBe("#ffffff");
});

test("正常なST0.01の艇の舳先はスリット線を越えず、フライングの艇だけが越える（BOA-811 の絵）", async ({
  page,
}) => {
  // 戸田 2026-09-19 9R: 1号艇 .01（正常・1着）、2号艇 .02、3〜6号艇はF
  await page.goto("/race/2026-09-19-02-09");
  await page.locator(".race-tabs-btn", { hasText: "結果" }).click();
  const f = await formationTips(page);
  const boats = Object.keys(f).filter((k) => k !== "slit");
  expect(boats.length).toBe(6);
  for (const b of boats) {
    if (f[b].text.startsWith("F")) expect(f[b].tip, b).toBeGreaterThan(f.slit);
    else expect(f[b].tip, b).toBeLessThanOrEqual(f.slit);
  }
  // 表の下の読み方（矢印は外し、並びは上の絵で見る）
  await expect(page.locator(".rr-st-legend")).toContainText("上の絵");
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

test.describe("結果タブのスタート隊形の絵（BOA-811）", () => {
  const svgRows = (page) =>
    page.locator(".rr-formation-svg").evaluate((svg) =>
      [...svg.querySelectorAll("g[data-boat]")].map((g) => ({
        boat: g.dataset.boat,
        course: g.dataset.course ?? null,
        mae: g.dataset.mae === "true",
        absent: g.dataset.absent === "true",
        text: g.textContent,
      })),
    );

  test("欠場は一番下に薄く残し、欠場で繰り上がった艇は前付けにしない（江戸川 2026-09-26 11R）", async ({
    page,
  }) => {
    const row = (b, c, t, mark, rank) => ({
      ...st(b, t, mark, rank),
      entry_course: c,
    });
    await openResult(page, {
      race: {
        date: "2026-09-26",
        venueCode: 3,
        venue: "江戸川",
        raceNumber: 11,
        result: { rank1: 1, rank2: 3, rank3: 2, rank4: 4, rank5: 6 },
      },
      startTimings: [
        row(1, 1, 0.2, "1", 1),
        row(2, 2, 0.25, "3", 3),
        row(3, 3, 0.21, "2", 2),
        row(4, 4, 0.28, "4", 4),
        row(6, 5, 0.26, "5", 5),
        row(5, null, null, "欠", null),
      ],
    });
    const rows = await svgRows(page);
    expect(rows.map((r) => r.boat)).toEqual(["1", "2", "3", "4", "6", "5"]);
    expect(rows[5].absent).toBe(true);
    expect(rows[5].text).toContain("5号艇は欠場");
    expect(rows.some((r) => r.mae)).toBe(false);
  });

  test("出遅れは ST なしで行に残し、最速は F・出遅れを除いた一番早い艇（若松 2026-09-27 10R）", async ({
    page,
  }) => {
    await openResult(page, {
      race: {
        date: "2026-09-27",
        venueCode: 20,
        venue: "若松",
        raceNumber: 10,
        result: { rank1: 3, rank2: 1, rank3: 5, rank4: 2, rank5: 6 },
      },
      startTimings: [
        st(1, 0.23, "2", 2),
        st(2, 0.17, "4", 4),
        st(3, 0.19, "1", 1),
        { ...st(4, null, "L", null), is_late_start: true },
        st(5, 0.27, "3", 3),
        st(6, 0.21, "5", 5),
      ],
    });
    const rows = await svgRows(page);
    expect(rows.map((r) => r.boat)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(rows[3].text).toContain("L 出遅れ（ST なし）");
    expect(rows[1].text).toContain("0.17 最速");
    // 結果の表の ST の列は数字だけ（矢印は外した）
    await expect(page.locator(".rr-st-track")).toHaveCount(0);
  });
});
