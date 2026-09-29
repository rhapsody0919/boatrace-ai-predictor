import { test, expect } from "./fixtures.js";

/**
 * 結果タブで、返還艇（F・L・欠）や不成立レースの艇を着順に並べない（BOA-543 の一部）。
 *
 * race_results の rank1〜rank6 は公式ページの並び順のままで、返還艇も入っている。
 * 本番で次の誤表示が出ていた。
 * - 浜名湖 2026-09-14 6R（不成立、返還 1・2・3・5・6）: rank=4-1-2 のまま
 *   「2着 1号艇 F0.11」「3着 2号艇 F0.09」と出た
 * - 戸田 2026-09-19 9R（一部返還、返還 3・4・5・6）: 「3着 3号艇 F0.04」と出た
 *
 * 結果タブは race_start_timings の finish_rank・finish_mark で着順を組み立てる。
 * DBの中身に依存しないよう、Edge API と Supabase REST を差し替えて本番の形を再現する。
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

// 表の各行を「着欄 / 艇番」の組にする
async function readRows(table) {
  return table.locator(".rr-row").evaluateAll((rows) =>
    rows.map((row) => ({
      pos: row.querySelector(".rr-pos")?.textContent.trim(),
      boat: row.querySelector(".rr-boat-chip")?.textContent.trim(),
      className: row.className,
    })),
  );
}

test.describe("結果タブで返還艇を着順に出さない（BOA-543）", () => {
  test("不成立（浜名湖 2026-09-14 6R）: F の艇を 2着・3着に出さない", async ({
    page,
  }) => {
    const table = await openResult(page, {
      race: {
        date: "2026-09-14",
        venueCode: 6,
        venue: "浜名湖",
        raceNumber: 6,
        result: { rank1: 4, rank2: 1, rank3: 2 },
      },
      startTimings: [
        st(1, 0.11, "F", null),
        st(2, 0.09, "F", null),
        st(3, 0.03, "F", null),
        st(4, 0.02, "_", null),
        st(5, 0.03, "F", null),
        st(6, 0.01, "F", null),
      ],
    });

    // finish_mark が反映されるまで待つ（取得前は rank1〜 の表示）
    await expect(table.locator(".rr-row")).toHaveCount(6);
    const rows = await readRows(table);
    expect(rows.map((r) => r.pos)).not.toContain("2着");
    expect(rows.map((r) => r.pos)).not.toContain("3着");
    expect(
      rows.filter((r) => /is-(winner|second|third)/.test(r.className)),
    ).toHaveLength(0);
    expect(rows).toEqual(
      [1, 2, 3, 4, 5, 6].map((boat) =>
        expect.objectContaining({
          boat: String(boat),
          pos: boat === 4 ? "_" : "F",
        }),
      ),
    );
    // 6艇ぶんの行があるので「4着以下未取得」の注記は出さない
    await expect(page.locator(".rr-note-missing-ranks")).toHaveCount(0);
  });

  test("一部返還（戸田 2026-09-19 9R）: 3着に F の艇を出さない", async ({
    page,
  }) => {
    const table = await openResult(page, {
      race: {
        date: "2026-09-19",
        venueCode: 2,
        venue: "戸田",
        raceNumber: 9,
        result: { rank1: 1, rank2: 2, rank3: 3 },
      },
      startTimings: [
        st(1, 0.01, "1", 1),
        st(2, 0.02, "2", 2),
        st(3, 0.04, "F", null),
        st(4, 0.03, "F", null),
        st(5, 0.07, "F", null),
        st(6, 0.04, "F", null),
      ],
    });

    await expect(table.locator(".rr-row")).toHaveCount(6);
    const rows = await readRows(table);
    expect(rows.map(({ pos, boat }) => `${pos}:${boat}`)).toEqual([
      "1着:1",
      "2着:2",
      "F:3",
      "F:4",
      "F:5",
      "F:6",
    ]);
    expect(rows.filter((r) => r.className.includes("is-third"))).toHaveLength(
      0,
    );
    await expect(page.locator(".rr-note-missing-ranks")).toHaveCount(0);
  });

  test("通常のレース: finish_rank どおりに 1〜6着を出す（欠場艇は末尾に記号で出す）", async ({
    page,
  }) => {
    const table = await openResult(page, {
      race: {
        date: "2026-09-28",
        venueCode: 15,
        venue: "丸亀",
        raceNumber: 12,
        result: { rank1: 2, rank2: 1, rank3: 5, rank4: 3, rank5: 6, rank6: 4 },
      },
      startTimings: [
        st(1, 0.12, "2", 2),
        st(2, 0.1, "1", 1),
        st(3, 0.15, "4", 4),
        st(4, null, "欠", null),
        st(5, 0.13, "3", 3),
        st(6, 0.18, "5", 5),
      ],
    });

    await expect(table.locator(".rr-row").last()).toContainText("欠");
    const rows = await readRows(table);
    expect(rows.map(({ pos, boat }) => `${pos}:${boat}`)).toEqual([
      "1着:2",
      "2着:1",
      "3着:5",
      "4着:3",
      "5着:6",
      "欠:4",
    ]);
  });

  test("finish_mark が無い過去のレース・取得失敗は、従来どおり rank1〜 を着順に出す", async ({
    page,
  }) => {
    const race = {
      date: "2026-03-01",
      venueCode: 1,
      venue: "桐生",
      raceNumber: 1,
      result: { rank1: 1, rank2: 3, rank3: 2 },
    };
    const table = await openResult(page, {
      race,
      startTimings: [1, 2, 3, 4, 5, 6].map((boat) =>
        st(boat, 0.1 + boat / 100, null, null),
      ),
    });
    await expect(table.locator(".rr-row")).toHaveCount(3);
    let rows = await readRows(table);
    expect(rows.map(({ pos, boat }) => `${pos}:${boat}`)).toEqual([
      "1着:1",
      "2着:3",
      "3着:2",
    ]);
    // 3行しか無いので注記は出る（従来どおり）
    await expect(page.locator(".rr-note-missing-ranks")).toHaveCount(1);

    // 取得失敗: 「データなし」と区別してエラー表示を出し、着順は rank1〜 に倒す
    await page.route("**/rest/v1/race_start_timings**", (route) =>
      route.fulfill({
        status: 500,
        json: { message: "boom", code: "XX000" },
      }),
    );
    await page.reload();
    await expect(page.locator(".race-result .inline-fetch-error")).toBeVisible({
      timeout: 20000,
    });
    rows = await readRows(page.locator(".race-result .rr-table"));
    expect(rows.map(({ pos, boat }) => `${pos}:${boat}`)).toEqual([
      "1着:1",
      "2着:3",
      "3着:2",
    ]);
  });
});
