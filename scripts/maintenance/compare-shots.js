/**
 * compare-shots.js - 画面の before/after の比較画像を作る（オーナーに画面の判断を聞く返答に添える 1100px の JPG）。
 *
 * 前の URL の基と後の URL の基で同じパスを、幅×明暗×スクロールの位置ごとに Playwright で撮り、
 * 赤（前）と緑（後）の帯に説明を付けて1枚に並べる。スマホの幅（768px 以下）は左右に、PC の幅は上下に並べる。
 * Cookie の帯は同意を「拒否」で済ませて消す（計測は動かさない）。ImageMagick は使わない（並べるのも Playwright）。
 * 出力は既定で out/compare-shots/（.gitignore 済み。作業ツリーの中なので SendUserFile で送れる）。
 * 本番は読み込みが遅いことがあるので、--wait に本文の要素を渡すとそれが出るまで待つ。
 *
 * 使い方: node scripts/maintenance/compare-shots.js --before=https://www.boat-ai.jp --after=http://localhost:5173 \
 *   --paths=/blog,/blog/nige-simulation-guide --widths=375,1440 --themes=light,dark --scrolls=0,2 --wait=main
 * 引数の解釈と撮る物の並びは compareShotsPlan.js（再現テスト: verify-compare-shots-plan.js）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { parseCompareArgs, planShots } from "./compareShotsPlan.js";

const COMPOSE_WIDTH = 1100;
const CONSENT_KEY = "boatai:cookie-consent";

async function shoot(page, url, shot, wait) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (wait) {
    try {
      await page.waitForSelector(wait, { timeout: 30000 });
    } catch {
      // 待つ要素が出なくても撮る（白い画面なら比較画像で分かる）。どの URL かを残す
      console.warn(`警告: ${url} で ${wait} が30秒で出なかった。その時の画面を撮る`);
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.evaluate((y) => window.scrollTo(0, y), shot.scroll * shot.height);
  await page.waitForTimeout(400);
  return page.screenshot({ type: "png" });
}

function composeHtml(shot, opts, beforePng, afterPng) {
  const side = shot.width <= 768;
  const panel = (color, label, url, png) => `
    <figure style="margin:0;flex:1;min-width:0">
      <figcaption style="background:${color};color:#fff;font:700 20px 'Hiragino Sans',sans-serif;padding:8px 12px">${label}: ${url}（${shot.width}px・${shot.theme}）</figcaption>
      <img style="display:block;width:100%" src="data:image/png;base64,${png.toString("base64")}">
    </figure>`;
  return `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="display:flex;flex-direction:${side ? "row" : "column"};gap:8px;width:${COMPOSE_WIDTH}px">
      ${panel("#b91c1c", opts.labelBefore, opts.before + shot.path, beforePng)}
      ${panel("#15803d", opts.labelAfter, opts.after + shot.path, afterPng)}
    </div></body></html>`;
}

async function main() {
  const opts = parseCompareArgs(process.argv.slice(2));
  const shots = planShots(opts);
  await mkdir(opts.out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const composer = await browser.newPage({ viewport: { width: COMPOSE_WIDTH, height: 600 } });
    for (const shot of shots) {
      const ctx = await browser.newContext({
        viewport: { width: shot.width, height: shot.height },
        colorScheme: shot.theme,
      });
      await ctx.addInitScript((key) => localStorage.setItem(key, "rejected"), CONSENT_KEY);
      const page = await ctx.newPage();
      const beforePng = await shoot(page, opts.before + shot.path, shot, opts.wait);
      const afterPng = await shoot(page, opts.after + shot.path, shot, opts.wait);
      await ctx.close();
      await composer.setContent(composeHtml(shot, opts, beforePng, afterPng));
      const jpg = await composer.screenshot({ type: "jpeg", quality: 82, fullPage: true });
      const file = join(opts.out, shot.file);
      await writeFile(file, jpg);
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`compare-shots: ${e.message}`);
  process.exit(1);
});
