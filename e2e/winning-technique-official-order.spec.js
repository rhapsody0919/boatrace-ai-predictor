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

// 結論の一言と枠ごとの1着率（#3258 の #5）。棒は枠ごとに100%へそろえた内訳なので、枠どうしの1着の多さは
// 別に回数と1着率で出す。1着が30回未満の枠は棒の中を割合でなく回数で書く
test("決まり手は結論の一言・枠ごとの1着率を上に出し、件数の表は畳む", async ({ page }) => {
  const rows = [
    [1, "逃げ", 239, 263, 90.87],
    [1, "抜き", 24, 263, 9.13],
    [2, "差し", 50, 83, 60.24],
    [2, "まくり", 33, 83, 39.76],
    [6, "まくり差し", 15, 25, 60],
    [6, "まくり", 10, 25, 40],
  ];
  await page.route("**/rest/v1/winning_technique_stats?*", (route) =>
    route.fulfill({
      json: rows.map(([boat_number, winning_technique, count_90days, total_races, percentage]) => ({
        venue_code: 3,
        boat_number,
        winning_technique,
        count_90days,
        total_races,
        percentage,
        last_updated: "2026-11-23",
      })),
    }),
  );
  await page.goto("/winning-technique?tab=technique");
  const chart = page.locator(".winning-technique-container");
  // 母数 263+83+25=371。1号艇 263/371=70.9%、そのうち逃げ239回
  await expect(chart.locator(".wt-headline")).toHaveText(
    "江戸川の過去90日では、1号艇の1着は371レース中263回（70.9%）。その263回のうち239回が逃げ",
  );
  await expect(chart.locator(".wt-boat-rate-pct")).toHaveText(["70.9%", "22.4%", "6.7%"]);
  await expect(chart.locator(".wt-boat-rate-count")).toHaveText(["263回", "83回", "25回"]);
  // 6号艇（25回）は棒の中が回数、1号艇は割合
  await expect(chart.locator(".recharts-label-list text", { hasText: "15回" })).toHaveCount(1);
  await expect(chart.locator(".recharts-label-list text", { hasText: "91%" })).toHaveCount(1);
  // 積み上げの端の値（2号艇はまくり40%の上に差しが積まれて100%）でなく、その段の割合を書く
  await expect(chart.locator(".recharts-label-list text", { hasText: "60%" })).toHaveCount(1);
  await expect(chart.locator(".recharts-label-list text", { hasText: "100%" })).toHaveCount(0);
  // 件数の表は畳んである
  await expect(chart.locator("details.wt-table-details")).not.toHaveAttribute("open", "");
  await expect(chart.locator(".winning-technique-table")).toBeHidden();
});

// 艇番は #3271 で縦の軸（YAxis）に移った。ko の「N번 보트」・en の「Boat N」が左で切れない（BOA-615 の重なりの後継）
for (const lang of ["ko", "en"]) {
  test(`${lang}: 決まり手の艇番の札が 375px で軸の枠の内に収まる`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route("**/rest/v1/winning_technique_stats?*", (route) =>
      route.fulfill({ json: statsRows(winningRows, "winning_technique") }),
    );
    await page.goto(`/${lang}/winning-technique?tab=technique`);
    const labels = page.locator(".winning-technique-container .recharts-yAxis-tick-labels text");
    await expect(labels).toHaveCount(5);
    const lefts = await labels.evaluateAll((nodes) => {
      const svg = nodes[0].ownerSVGElement.getBoundingClientRect();
      return nodes.map((n) => n.getBoundingClientRect().left - svg.left);
    });
    // 1px 未満は小数の誤差（CI の Linux で −0.34px）。札が切れて読めないのは数px以上のとき
    for (const left of lefts) expect(left).toBeGreaterThanOrEqual(-1);
  });
}
