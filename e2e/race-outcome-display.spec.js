import { test, expect } from "./fixtures.js";

/**
 * 不成立（全額返還）・一部返還・特払のレースを、画面で正しく見せる（BOA-543）。
 *
 * 正は race_results.race_status / refund_boats（078）と race_payouts（079）。予想一覧RPC（109）が
 * result に raceStatus・refundBoats・remark・payoutRows を足す。旧フラグ is_no_race は全行 false で
 * 機能していないため読まない。
 *
 * 本番で出ていた誤表示（2026-09-29 調査）:
 * - 浜名湖 2026-09-14 6R（不成立）: 払戻欄が黙って消え「4着以下未取得」が出た。一覧カードと
 *   AI予想タブに「展開的中」（rank1=4 は不成立で唯一フライングしなかった艇で、1着ではない）
 * - 桐生 2026-09-24 8R（一部返還）: 不成立の3連複・拡連複が払戻欄から黙って消えた
 * - 戸田 2026-09-19 9R（一部返還）: 返還艇が3着に出た
 *
 * DBの中身に依存しないよう、Edge API と Supabase REST を差し替える。値は本番の実データ
 * （2026-09-29 に execute_sql で確認）。
 */

const entries = [1, 2, 3, 4, 5, 6].map((i) => ({
  number: i,
  name: `テスト選手${i}`,
  grade: "B1",
  age: 30,
  winRate: 5.0,
  localWinRate: 5.0,
  motorNumber: i,
  motor2Rate: 35,
  boatNumber: i,
  boat2Rate: 35,
}));

const raceIdOf = ({ date, venueCode, raceNumber }) =>
  `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;

function edgeData(races) {
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    races: races.map((race) => ({
      raceId: raceIdOf(race),
      venueCode: race.venueCode,
      venue: race.venue,
      raceNumber: race.raceNumber,
      startTime: "13:00",
      entries,
      predictions: {
        unified: {
          topPick: 1,
          top3: [1, 2, 3],
          confidence: 50,
          volatilityPercentile: 0.85,
          volatilityPercentileIsFallback: false,
          turnPrediction: {
            patterns: (race.turnCourses ?? [1, 3, 4]).map((course, i) => ({
              technique: "逃げ",
              winnerCourse: course,
              probability: 0.5 - i * 0.1,
            })),
          },
        },
      },
      exhibitionData: [],
      result: race.result,
    })),
  };
}

const st = (boat, startTiming, finishMark, finishRank) => ({
  boat_number: boat,
  start_timing: startTiming,
  is_flying: finishMark === "F",
  is_late_start: finishMark === "L",
  finish_mark: finishMark,
  finish_rank: finishRank,
});

const pay = (betType, seq, combination, payout, payoutStatus, popularity) => ({
  betType,
  seq,
  combination,
  payout,
  payoutStatus,
  popularity,
});
const NO_RACE_ROWS = [
  "win",
  "place",
  "3tan",
  "3fuku",
  "2tan",
  "2fuku",
  "wide",
].map((b) => pay(b, 1, null, null, "no_race", null));

// 浜名湖 2026-09-14 6R（不成立）
const HAMANAKO = {
  date: "2026-09-14",
  venueCode: 6,
  venue: "浜名湖",
  raceNumber: 6,
  turnCourses: [1, 3, 4],
  result: {
    rank1: 4,
    rank2: 1,
    rank3: 2,
    raceStatus: "no_race",
    refundBoats: [1, 2, 3, 5, 6],
    remark: "【返還艇あり】",
    payoutRows: NO_RACE_ROWS,
  },
  startTimings: [
    st(1, 0.11, "F", null),
    st(2, 0.09, "F", null),
    st(3, 0.03, "F", null),
    st(4, 0.02, "_", null),
    st(5, 0.03, "F", null),
    st(6, 0.01, "F", null),
  ],
};

// 桐生 2026-09-24 8R（一部返還。3=欠、5・6=F）
const KIRYU = {
  date: "2026-09-24",
  venueCode: 1,
  venue: "桐生",
  raceNumber: 8,
  turnCourses: [2, 1, 3],
  result: {
    rank1: 2,
    rank2: 1,
    rank3: 4,
    winningTechnique: "差し",
    payoutWin: 580,
    payoutTrio: 870,
    raceStatus: "partial_refund",
    refundBoats: [3, 5, 6],
    remark: "【返還艇あり】",
    payoutRows: [
      pay("2fuku", 1, "1-2", 100, "paid", 1),
      pay("2tan", 1, "2-1", 600, "paid", 3),
      pay("3fuku", 1, null, null, "no_race", null),
      pay("3tan", 1, "2-1-4", 870, "paid", 3),
      pay("place", 1, "2", 100, "paid", null),
      pay("place", 2, "1", 100, "paid", null),
      pay("wide", 1, null, null, "no_race", null),
      pay("win", 1, "2", 580, "paid", null),
    ],
  },
  startTimings: [
    st(1, 0.01, "2", 2),
    st(2, 0.02, "1", 1),
    st(3, null, "欠", null),
    st(4, 0.01, "3", 3),
    st(5, 0.02, "F", null),
    st(6, 0.01, "F", null),
  ],
};

// 戸田 2026-09-19 9R（一部返還。rank3=3 は返還艇）
const TODA = {
  date: "2026-09-19",
  venueCode: 2,
  venue: "戸田",
  raceNumber: 9,
  result: {
    rank1: 1,
    rank2: 2,
    rank3: 3,
    payoutWin: 100,
    raceStatus: "partial_refund",
    refundBoats: [3, 4, 5, 6],
    remark: "【返還艇あり】",
  },
};

async function setup(
  page,
  races,
  { startTimings = [], startTimingRoute } = {},
) {
  await page.addInitScript(() => localStorage.setItem("boatai-language", "ja"));
  await page.route("**/api/predictions/**", (route) =>
    route.fulfill({ json: edgeData(races) }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // 後から登録したルートが優先される
  await page.route(
    "**/rest/v1/race_start_timings**",
    startTimingRoute ??
      ((route) => route.fulfill({ status: 200, json: startTimings })),
  );
}

async function openResult(page, race, options) {
  await setup(page, [race], { startTimings: race.startTimings, ...options });
  await page.goto(`/race/${raceIdOf(race)}`);
  const root = page.locator(".race-result");
  await expect(root.locator(".rr-table")).toBeVisible({ timeout: 20000 });
  return root;
}

async function readRows(root) {
  return root.locator(".rr-table .rr-row").evaluateAll((rows) =>
    rows.map((row) => ({
      pos: row.querySelector(".rr-pos")?.textContent.trim(),
      boat: row.querySelector(".rr-boat-chip")?.textContent.trim(),
      label: row.querySelector(".rr-mark-label")?.textContent.trim() ?? null,
      podium: /is-(winner|second|third)/.test(row.className),
    })),
  );
}

async function readPayouts(root) {
  return root
    .locator(".rr-payout-row")
    .evaluateAll((rows) =>
      rows.map((row) =>
        [
          row.querySelector(".rr-payout-type")?.textContent.trim(),
          row
            .querySelector(".rr-combo")
            ?.textContent.replace(/\s+/g, "")
            .trim(),
          row.querySelector(".rr-pop")?.textContent.trim(),
          row.querySelector(".rr-amount")?.textContent.trim(),
          row.classList.contains("is-best") ? "best" : "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    );
}

test.describe("不成立・返還の表示（BOA-543）", () => {
  test("不成立（浜名湖 9/14 6R）: 見出し・6艇の記号・払戻はすべて「不成立（返還）」", async ({
    page,
  }) => {
    const root = await openResult(page, HAMANAKO);

    await expect(root.locator(".rr-head h4")).toContainText(
      "レース不成立・全額返還",
    );
    await expect(root.locator(".rr-outcome-note")).toHaveText(
      "フライング5艇（1・2・3・5・6号艇）で不成立。舟券はすべて返還",
    );
    // 決まり手タグ・「4着以下未取得」の注記は出さない
    await expect(root.locator(".rr-tag")).toHaveCount(0);
    await expect(root.locator(".rr-note-missing-ranks")).toHaveCount(0);

    const rows = await readRows(root);
    expect(rows).toEqual(
      [1, 2, 3, 4, 5, 6].map((boat) => ({
        pos: boat === 4 ? "—" : "F",
        boat: String(boat),
        label: boat === 4 ? "着順なし（不成立）" : "F（フライング・返還）",
        podium: false,
      })),
    );

    const payouts = await readPayouts(root);
    expect(payouts).toEqual(
      ["単勝", "複勝", "3連単", "3連複", "2連単", "2連複", "拡連複"].map(
        (type) => `${type} 不成立（返還）`,
      ),
    );
    await expect(root.locator(".rr-payout-table")).not.toContainText("¥");
  });

  test("不成立で払戻明細が届いていない（直接クエリ経路）ときも7勝式を「不成立（返還）」で出す", async ({
    page,
  }) => {
    const race = {
      ...HAMANAKO,
      result: { ...HAMANAKO.result, payoutRows: undefined },
    };
    const root = await openResult(page, race);
    const payouts = await readPayouts(root);
    expect(payouts).toHaveLength(7);
    expect(payouts.every((p) => p.endsWith("不成立（返還）"))).toBe(true);
  });

  test("一部返還（桐生 9/24 8R）: 返還艇は繰り上げず記号とラベル、不成立の勝式を出す", async ({
    page,
  }) => {
    const root = await openResult(page, KIRYU);

    await expect(root.locator(".rr-head h4")).toHaveText("🏁 レース結果");
    await expect(root.locator(".rr-refund-tag")).toHaveText("返還艇あり");
    await expect(root.locator(".rr-tag")).toContainText("差し");

    const rows = await readRows(root);
    expect(
      rows.map(({ pos, boat, label }) => `${pos}:${boat}:${label}`),
    ).toEqual([
      "1着:2:null",
      "2着:1:null",
      "3着:4:null",
      "欠:3:欠（欠場・返還）",
      "F:5:F（フライング・返還）",
      "F:6:F（フライング・返還）",
    ]);

    const payouts = await readPayouts(root);
    expect(payouts).toEqual([
      "単勝 2 ¥580",
      "複勝 2 ¥100",
      "複勝 1 ¥100",
      "3連単 2-1-4 3人気 ¥870 best",
      "3連複 不成立（返還）",
      "2連単 2-1 3人気 ¥600",
      "2連複 1=2 1人気 ¥100",
      "拡連複 不成立（返還）",
    ]);
  });

  test("一部返還でスタート情報の取得に失敗したとき: 返還艇（戸田9R の3号艇）を3着に出さない", async ({
    page,
  }) => {
    await setup(page, [TODA], {
      startTimingRoute: (route) =>
        route.fulfill({
          status: 500,
          json: { message: "boom", code: "XX000" },
        }),
    });
    await page.goto(`/race/${raceIdOf(TODA)}`);
    const root = page.locator(".race-result");
    await expect(root.locator(".inline-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    const rows = await readRows(root);
    expect(
      rows.map(({ pos, boat, label }) => `${pos}:${boat}:${label}`),
    ).toEqual([
      "1着:1:null",
      "2着:2:null",
      "—:3:返還",
      "—:4:返還",
      "—:5:返還",
      "—:6:返還",
    ]);
  });

  test("特払（2026-07-24 17R3）: 単勝は組番の位置に「特払」、金額なしの複勝は組番だけ", async ({
    page,
  }) => {
    const race = {
      date: "2026-07-24",
      venueCode: 17,
      venue: "宮島",
      raceNumber: 3,
      result: {
        rank1: 6,
        rank2: 4,
        rank3: 1,
        payoutWin: 70,
        raceStatus: "normal",
        refundBoats: [],
        payoutRows: [
          pay("win", 1, null, 70, "special", null),
          pay("place", 1, "6", 1800, "paid", null),
          pay("place", 2, "4", null, "no_amount", null),
          pay("3tan", 1, "6-4-1", 92140, "paid", 85),
        ],
      },
      startTimings: [
        st(1, 0.1, "3", 3),
        st(2, 0.1, "5", 5),
        st(3, 0.1, "6", 6),
        st(4, 0.1, "2", 2),
        st(5, 0.1, "4", 4),
        st(6, 0.1, "1", 1),
      ],
    };
    const root = await openResult(page, race);
    const payouts = await readPayouts(root);
    expect(payouts).toEqual([
      "単勝 特払 ¥70",
      "複勝 6 ¥1,800",
      "複勝 4",
      "3連単 6-4-1 85人気 ¥92,140 best",
    ]);
    await expect(root.locator(".rr-refund-tag")).toHaveCount(0);
  });

  test("マイグレーション未適用（raceStatus なし）: 従来どおりの見出しと旧列の払戻", async ({
    page,
  }) => {
    const race = {
      ...HAMANAKO,
      result: { rank1: 4, rank2: 1, rank3: 2 },
    };
    const root = await openResult(page, race);
    await expect(root.locator(".rr-head h4")).toHaveText("🏁 レース結果");
    await expect(root.locator(".rr-outcome-note")).toHaveCount(0);
    // #949 の着順修正は効いたまま（F の艇を2着・3着に出さない）
    const rows = await readRows(root);
    expect(rows.filter((r) => r.podium)).toHaveLength(0);
    expect(rows.map((r) => r.pos)).not.toContain("2着");
  });

  test("読み込み中: スタート情報が届くまで rank1〜 の着順を出さない", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await setup(page, [HAMANAKO], {
      startTimingRoute: async (route) => {
        await gate;
        await route.fulfill({ status: 200, json: HAMANAKO.startTimings });
      },
    });
    await page.goto(`/race/${raceIdOf(HAMANAKO)}`);
    const root = page.locator(".race-result");
    await expect(root.locator(".rr-table-skeleton")).toBeVisible({
      timeout: 20000,
    });
    await expect(root.locator(".rr-table")).toHaveCount(0);
    await expect(root).not.toContainText("2着");

    release();
    await expect(root.locator(".rr-table")).toBeVisible();
    await expect(root.locator(".rr-table-skeleton")).toHaveCount(0);
  });

  test("一覧カード: 不成立は「不成立」だけ、一部返還は的中・外れの横に「返還あり」", async ({
    page,
  }) => {
    const sameDay = (race, raceNumber) => ({
      ...race,
      date: "2026-09-24",
      venueCode: 1,
      venue: "桐生",
      raceNumber,
    });
    await setup(page, [sameDay(HAMANAKO, 6), sameDay(KIRYU, 8)]);
    await page.goto("/races/2026-09-24/1");
    const cards = page.locator(".race-card");
    await expect(cards).toHaveCount(2, { timeout: 20000 });

    const noRace = cards.nth(0).locator(".race-card-header");
    await expect(noRace).toContainText("不成立");
    await expect(noRace).not.toContainText("展開的中");
    await expect(noRace).not.toContainText("外れ");

    const partial = cards.nth(1).locator(".race-card-header");
    await expect(partial).toContainText("展開的中");
    await expect(partial).toContainText("返還あり");
  });

  test("AI予想タブ: 不成立は展開予測とイン崩れの振り返りを「判定対象外（不成立）」にする", async ({
    page,
  }) => {
    await setup(page, [HAMANAKO], { startTimings: HAMANAKO.startTimings });
    await page.goto(`/race/${raceIdOf(HAMANAKO)}`);
    await page.getByRole("tab", { name: "AI予想" }).click({ timeout: 20000 });
    const tab = page.locator(".race-ai-prediction-tab");
    await expect(tab).toBeVisible();
    await expect(tab.locator(".turn-pattern-summary--void")).toContainText(
      "判定対象外（不成立）",
    );
    await expect(tab.locator(".turn-pattern-hit-tag")).toHaveCount(0);
    // 不成立は行ごとの「返還」印を付けず、まとめの1行だけにする（モックどおり）
    await expect(tab.locator(".turn-pattern-void-tag")).toHaveCount(0);
    await expect(tab.locator(".turn-pattern-row--void")).toHaveCount(3);
    await expect(tab).not.toContainText("的中しました");
    await expect(tab.locator(".result-volatility-line").nth(1)).toContainText(
      "判定対象外（不成立）",
    );
  });

  test("AI予想タブ: 一部返還は1着で判定し、返還艇の候補に「返還（判定対象外）」を付ける", async ({
    page,
  }) => {
    await setup(page, [KIRYU], { startTimings: KIRYU.startTimings });
    await page.goto(`/race/${raceIdOf(KIRYU)}`);
    await page.getByRole("tab", { name: "AI予想" }).click({ timeout: 20000 });
    const tab = page.locator(".race-ai-prediction-tab");
    await expect(tab.locator(".turn-pattern-hit-tag")).toHaveCount(1);
    await expect(tab.locator(".turn-pattern-void-tag")).toHaveText(
      "返還（判定対象外）",
    );
    await expect(tab.locator(".turn-pattern-summary")).toContainText(
      "上位予想の1つが的中しました",
    );
  });
});
