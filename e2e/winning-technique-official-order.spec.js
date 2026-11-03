import { test, expect } from "./fixtures.js";

const officialOrder = ["逃げ", "まくり", "差し", "まくり差し", "抜き", "恵まれ"];
// 色の番号は公式の表示順とは別（BOA-1028）。
const colorNumbers = { 逃げ: 1, 差し: 2, まくり: 3, まくり差し: 4, 抜き: 5, 恵まれ: 6 };

// 枠内は割合順。Set で集めるだけでは公式順にならない応答を固定する。
const winningRows = [
  [1, "逃げ", 100],
  [2, "差し", 60],
  [2, "まくり", 40],
  [3, "まくり差し", 100],
  [4, "抜き", 100],
  [5, "恵まれ", 100],
];
const losingRows = [
  [1, "差し", 60],
  [1, "まくり", 40],
  [2, "逃げ", 100],
  [3, "恵まれ", 100],
];

function statsRows(rows, techniqueKey) {
  return rows.map(([boat_number, technique, percentage]) => ({
    venue_code: 3,
    boat_number,
    [techniqueKey]: technique,
    count_90days: percentage,
    total_races: 100,
    total_losses_90days: 100,
    percentage,
    last_updated: "2026-10-27",
  }));
}

test("決まり手と負け決まり手の棒・凡例は公式順、色と表の行順は維持する", async ({ page }) => {
  await page.route("**/rest/v1/winning_technique_stats?*", (route) =>
    route.fulfill({ json: statsRows(winningRows, "winning_technique") }),
  );
  await page.route("**/rest/v1/losing_technique_stats?*", (route) =>
    route.fulfill({ json: statsRows(losingRows, "losing_technique") }),
  );
  await page.goto("/winning-technique");

  for (const [tab, rows] of [
    ["🎯 決まり手", winningRows],
    ["💔 負け決まり手", losingRows],
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    const chart = page.locator(".winning-technique-container");
    await expect(chart.locator("select")).toHaveValue("03");
    const expected = officialOrder.filter((name) => rows.some((row) => row[1] === name));
    await expect(chart.locator(".recharts-legend-item-text")).toHaveText(expected);
    // SVG 内の系列も同じ順で積み上がり、名前ごとの色を維持する。
    const bars = chart.locator(".recharts-bar");
    await expect(bars).toHaveCount(expected.length);
    for (const [index, name] of expected.entries()) {
      await expect(bars.nth(index).locator(".recharts-bar-rectangle path").first())
        .toHaveAttribute("fill", `var(--technique-color-${colorNumbers[name]})`);
    }
    await expect(chart.locator("tbody tr td:nth-last-child(3)"))
      .toHaveText(rows.map((row) => row[1]));
  }
});
