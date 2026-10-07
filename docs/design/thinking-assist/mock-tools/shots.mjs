import { chromium } from "/Users/terukina/boatrace-ai-predictor/node_modules/playwright/index.mjs";
import fs from "node:fs";
const D = "/private/tmp/claude-501/-Users-terukina-boatrace-ai-predictor--claude-worktrees-gracious-dijkstra-1d3fae/95e707e0-86c6-412a-84a9-baa9db6b5768/scratchpad/";
const OUT = D + "shots/";
fs.mkdirSync(OUT, { recursive: true });
const URL = "file://" + D + "assist-mock/index.html";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const go = async () => { await page.goto(URL); await page.waitForTimeout(500); };
const phone = async (name) => {
  const el = await page.$("#phone");
  await el.screenshot({ path: OUT + name + ".png" });
};
await go();
for (const v of [2, 1, 3]) {
  await page.click(`[data-v="${v}"]`);
  for (const lens of ["axis", "flow", "power", "bet"]) {
    await page.click(`[data-lens="${lens}"]`);
    await page.waitForTimeout(300);
    await phone(`v${v}-${lens}`);
  }
}
// 案② 展示前の機力・展開
await page.click('[data-v="2"]');
await page.click('[data-stage="pre"]');
for (const lens of ["flow", "power"]) { await page.click(`[data-lens="${lens}"]`); await page.waitForTimeout(300); await phone(`v2-${lens}-pre`); }
await page.click('[data-stage="post"]');
// 深掘り（1号艇）と2段目（平均ST の6艇比較）
await page.click('[data-lens="axis"]');
await page.click('.lane[data-row="1"] .bbtn');
await page.waitForTimeout(300);
await phone("v2-deep-1");
await page.click('#deep [data-metric="st_mean30"]');
await page.waitForTimeout(300);
await phone("v2-deep-1-metric-st");
await page.click("#closeDeep");
// セオリーカード（実測・準備中・差がつく材料）
await page.click('[data-lens="flow"]');
await page.click('[data-theory="TC-H5"]');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "card-hint.png" });
await page.click("[data-close]");
await page.click('[data-theory="TC-T7"]');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "card-prep.png" });
await page.click("[data-close]");
await page.click('[data-lens="axis"]');
await page.click('#sum [data-fact="1:st_mean30"]');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "card-fact.png" });
await page.click("[data-close]");
// マークシート
await page.click("#openSheet");
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "sheet.png" });
await page.click("[data-close]");
// ガイド 1〜5
await page.click("#guideBtn");
for (let i = 1; i <= 5; i++) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + `guide-${i}.png` });
  if (i < 5) await page.click('[data-g="next"]');
}
await page.click('[data-g="close"]');
// パソコン幅の全体（対応表を含む）
await page.setViewportSize({ width: 1440, height: 900 });
await go();
await page.screenshot({ path: OUT + "desktop-full.png", fullPage: true });
console.log(fs.readdirSync(OUT).join("\n"), "\nerrors", errors);
await browser.close();
