import { test, expect } from "./fixtures.js";

// RA22: 基本情報タブ（RaceBasicInfoTab）の値を固める。既存の e2e は見出し・注記・平均ST（公式）の値までで、
// 勝率／2連対率／3連対率の棒の値・「当地」の切り替え・得意会場の順位の行・条件別の表の値と n を
// 見ていなかった（計算は verify-frontend-pure-functions が見るが、画面に出す所で壊れても落ちなかった）。
// 戸田5R 2026-09-21。棒（公式）は出走表の値で動かない。得意会場・条件別は当社集計だが、
// recordsBeforeRace でこのレースより前の走に閉じている（basic-2 の (n=24) と同じ形）
const RACE = "/race/2026-09-21-02-05";

async function openBasic(page) {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).first().click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
}

const barValues = (page) =>
  page
    .locator(".rbit-bar-row .rbit-value-num")
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));

async function expectBars(page, values) {
  await expect.poll(() => barValues(page), { timeout: 25000 }).toEqual(values);
}

const activeChip = (page, label) =>
  expect(page.locator(".rbit-chip.is-active", { hasText: label })).toHaveCount(
    1,
  );

test.describe("基本情報タブの値（RA22）", () => {
  test("棒: 勝率／2連対率／3連対率（公式・全国）の6艇の値と最良の印。「当地」に替えると当地の勝率になる", async ({
    page,
  }) => {
    await openBasic(page);
    await activeChip(page, "勝率");
    await activeChip(page, "全国");
    await expectBars(page, ["5.69", "4.51", "4.92", "7.12", "3.97", "1.15"]);
    await expect(page.locator(".rbit-bar-row .ind-best")).toHaveText(["7.12"]);

    await page.locator(".rbit-chip", { hasText: "2連対率" }).first().click();
    await expectBars(page, [
      "39.3%",
      "24.7%",
      "32.2%",
      "54.6%",
      "20.4%",
      "0.0%",
    ]);
    await expect(page.locator(".rbit-bar-row .ind-best")).toHaveText(["54.6%"]);

    await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
    await expectBars(page, [
      "58.4%",
      "38.4%",
      "41.4%",
      "78.2%",
      "36.7%",
      "0.0%",
    ]);
    await expect(page.locator(".rbit-bar-row .ind-best")).toHaveText(["78.2%"]);

    // 当地（戸田）の公式の勝率。全国と違う値に替わる
    await page.locator(".rbit-chip", { hasText: "勝率" }).first().click();
    await page.locator(".rbit-chip", { hasText: "当地" }).first().click();
    await activeChip(page, "当地");
    await expectBars(page, ["6.34", "3.29", "4.60", "6.80", "3.14", "1.50"]);
    await expect(page.locator(".rbit-bar-row .ind-best")).toHaveText(["6.80"]);

    // 全国に戻すと元の値
    await page.locator(".rbit-chip", { hasText: "全国" }).first().click();
    await expectBars(page, ["5.69", "4.51", "4.92", "7.12", "3.97", "1.15"]);
  });

  test("得意会場: 1号艇の1着率の順位の行（上位5）と「この会場は◯位」。3連対率に替えると順位が替わる", async ({
    page,
  }) => {
    await openBasic(page);
    await page.locator(".rbit-bar-row").first().click();
    await page.locator(".rbit-expanded-tab", { hasText: "得意会場" }).click();
    const ranking = page.locator(".rbit-venue-ranking");
    await expect(ranking.locator(".rbit-venue-metric-label")).toHaveText(
      "1着率のランキング",
      { timeout: 25000 },
    );
    await expect(ranking.locator(".rbit-venue-current-rank")).toHaveText(
      "今節の戸田は全14会場中2位",
    );
    const items = ranking.locator(".rbit-venue-list .rbit-venue-item");
    await expect(items).toHaveCount(5);
    await expect(items.locator(".rbit-venue-rank")).toHaveText([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    await expect(items.locator(".rbit-venue-name")).toHaveText([
      "多摩川",
      "戸田",
      "若松",
      "徳山",
      "尼崎",
    ]);
    await expect(items.locator(".rbit-venue-rate")).toHaveText([
      "83.3%",
      "46.7%",
      "44.4%",
      "44.4%",
      "37.5%",
    ]);
    await expect(items.locator(".rbit-venue-n")).toHaveText([
      "(n=6)",
      "(n=15)",
      "(n=9)",
      "(n=9)",
      "(n=8)",
    ]);
    // 今節の会場（戸田）の行だけに印
    await expect(ranking.locator(".rbit-venue-item.is-current")).toHaveCount(1);
    await expect(
      ranking.locator(".rbit-venue-item.is-current .rbit-venue-name"),
    ).toHaveText("戸田");

    await page.locator(".rbit-chip", { hasText: "3連対率" }).first().click();
    await expect(ranking.locator(".rbit-venue-metric-label")).toHaveText(
      "3連対率のランキング",
    );
    await expect(ranking.locator(".rbit-venue-current-rank")).toHaveText(
      "今節の戸田は全14会場中5位",
    );
    await expect(items.locator(".rbit-venue-name")).toHaveText([
      "多摩川",
      "若松",
      "びわこ",
      "三国",
      "戸田",
    ]);
    await expect(items.locator(".rbit-venue-rate")).toHaveText([
      "100.0%",
      "77.8%",
      "72.7%",
      "72.7%",
      "66.7%",
    ]);
    await expect(items.locator(".rbit-venue-n")).toHaveText([
      "(n=6)",
      "(n=9)",
      "(n=11)",
      "(n=11)",
      "(n=15)",
    ]);
  });

  test("条件別: 1号艇の1着率の表の値と n。少数（n=4）の行だけに⚠", async ({
    page,
  }) => {
    await openBasic(page);
    await page.locator(".rbit-bar-row").first().click();
    await page.locator(".rbit-expanded-tab", { hasText: "条件別" }).click();
    const table = page.locator(".rbit-conditions-table");
    await expect(table).toBeVisible({ timeout: 25000 });
    await expect(table.locator("th")).toHaveText([
      "全国",
      "当地",
      "一般戦",
      "初日",
      "最終日",
      "波5cm以上",
      "F持ち",
      "Fなし",
    ]);
    await expect(table.locator(".rbit-conditions-value")).toHaveText([
      "27.8%",
      "46.7%",
      "27.8%",
      "20.6%",
      "50.0%",
      "22.2%",
      "25.0%",
      "25.0%",
    ]);
    await expect(table.locator(".rbit-conditions-n")).toHaveText([
      "(n=187)",
      "(n=15)",
      "(n=187)",
      "(n=34)",
      "(n=32)",
      "(n=18)",
      "⚠(n=4)",
      "(n=44)",
    ]);
    await expect(table.locator(".rbit-conditions-warn")).toHaveCount(1);
    await expect(
      table
        .locator("tr", { has: page.locator(".rbit-conditions-warn") })
        .locator("th"),
    ).toHaveText("F持ち");
    await expect(
      table.locator(".rbit-conditions-value.is-small-sample"),
    ).toHaveCount(1);
  });
});
