/**
 * ブログの図の PNG をビルドで書き出す（ADR 0099、docs/design/blog-charts/contract.md 8節）。
 *
 * scripts/generate-ai-snapshots.js が、dist/ を配るローカルのサーバーと同じ Chromium（scripts/lib/launchChromium.js）で呼ぶ。
 * 図の JSON（public/blog-charts/*.json）ごとに、その記事（JSON の article）を開き、部品（src/components/blog/BlogChart.jsx）を
 * 撮影の形（[data-chart-export]、BlogChart.css）にして、固定の一覧（src/utils/blogChartPng.js）の大きさで撮る。
 * 撮るのは既定の view、日本語の記事だけ。鍵は要らない。
 *
 * 失敗（図が出ない・枠からはみ出す）はビルドを止めず、{id}.{preset} ごとに返す。呼ぶ側が status.json に残す。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BLOG_CHART_PNG_CREDIT,
  BLOG_CHART_PNG_PRESETS,
  blogChartPngPath,
} from "../../src/utils/blogChartPng.js";
import { renderWithFreshPage } from "./renderWithFreshPage.js";

/**
 * 撮る図の一覧を記事ごとにまとめる。
 * @param {string} chartsDir public/blog-charts（無ければ空）
 * @returns {{ article: string, ids: string[] }[]}
 */
export function planBlogChartPngs(chartsDir) {
  let names;
  try {
    names = readdirSync(chartsDir).filter((n) => n.endsWith(".json"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const byArticle = new Map();
  for (const name of names.sort()) {
    const chart = JSON.parse(readFileSync(path.join(chartsDir, name), "utf8"));
    // 形の検査は CI（verify-blog-charts.js）が済ませている。名前の材料だけを読む
    if (typeof chart.id !== "string" || typeof chart.article !== "string") {
      throw new Error(`${name}: id・article が無い`);
    }
    byArticle.set(chart.article, [
      ...(byArticle.get(chart.article) ?? []),
      chart.id,
    ]);
  }
  return [...byArticle].map(([article, ids]) => ({ article, ids }));
}

/**
 * 1つの図を撮影の形にして、はみ出しを測る。ページの中で動く（関数の外の変数を使わない）
 * @returns {{ found: boolean, state?: string, overflowY?: number, overflowX?: number }}
 */
export function enterExportMode({ id, preset, credit }) {
  const fig = document.querySelector(
    `figure.blog-chart[data-chart-id="${CSS.escape(id)}"]`,
  );
  if (!fig) return { found: false };
  fig.setAttribute("data-chart-export", preset);
  const caption = fig.querySelector(".blog-chart__caption");
  caption?.setAttribute("data-chart-credit-name", credit.name);
  caption?.setAttribute("data-chart-credit-site", credit.site);
  return {
    found: true,
    state: fig.getAttribute("data-chart-state"),
    overflowY: fig.scrollHeight - fig.clientHeight,
    overflowX: fig.scrollWidth - fig.clientWidth,
  };
}

function leaveExportMode(id) {
  const fig = document.querySelector(
    `figure.blog-chart[data-chart-id="${CSS.escape(id)}"]`,
  );
  fig?.removeAttribute("data-chart-export");
  const caption = fig?.querySelector(".blog-chart__caption");
  caption?.removeAttribute("data-chart-credit-name");
  caption?.removeAttribute("data-chart-credit-site");
}

/** 1つの記事の図を1つの大きさで撮る。返り値は書いたパスと失敗 */
async function shootArticle(page, { baseUrl, outDir, article, ids, preset }) {
  const { cssWidth, cssHeight } = BLOG_CHART_PNG_PRESETS[preset];
  const done = [];
  const bad = [];
  const skip = [];
  await page.setViewportSize({ width: cssWidth, height: cssHeight });
  await page.goto(`${baseUrl}/blog/${article}`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });
  await page.waitForSelector(".blog-post-content", { timeout: 10000 });
  // 日本語のフォント（Vercel では launchChromium.js が置く Noto Sans JP）を読み終えてから測る。折り返しが変わるため
  await page.evaluate(() => document.fonts.ready);
  for (const id of ids) {
    const key = `${id}.${preset}`;
    const m = await page.evaluate(enterExportMode, {
      id,
      preset,
      credit: BLOG_CHART_PNG_CREDIT,
    });
    try {
      if (!m.found) {
        bad.push({ id: key, error: `記事 ${article} に図が無い` });
      } else if (m.state !== "ready") {
        bad.push({ id: key, error: `図が描けていない（${m.state}）` });
      } else if (m.overflowY > 0 || m.overflowX > 0) {
        // 字を縮めて押し込まない（スマホで読めなくなる）。行を減らすか、この大きさを使わない
        skip.push({
          id: key,
          error: `枠からはみ出す（縦 ${Math.max(0, m.overflowY)}px・横 ${Math.max(0, m.overflowX)}px、CSS の画素）。字は縮めないので、この大きさは作らない`,
        });
      } else {
        const urlPath = blogChartPngPath(id, preset);
        const png = await page.screenshot({
          clip: { x: 0, y: 0, width: cssWidth, height: cssHeight },
          animations: "disabled",
        });
        writeFileSync(path.join(outDir, urlPath), png);
        done.push(urlPath);
      }
    } finally {
      await page.evaluate(leaveExportMode, id);
    }
  }
  return { done, bad, skip };
}

/**
 * @param {{ openPage: (options?: object) => Promise<import("playwright").Page>, baseUrl: string,
 *   plan: { article: string, ids: string[] }[], outDir: string }} options outDir は dist（PNG は outDir/blog-charts/ に置く）
 * @returns {Promise<{ total: number, files: string[], failed: { id: string, error: string }[],
 *   skipped: { id: string, error: string }[], seconds: number }>}
 *   total・failed・skipped の単位は {図id}.{preset}。files は書いた PNG の URL のパス。
 *   skipped は枠に収まらず作らなかったもの（図の行が多い等、作り手の側の事情。描画の失敗 failed とは分ける。
 *   失敗に数えると、行の多い図がある限り status.json の ok が毎日 false になり、本当の失敗が埋もれる）
 */
export async function exportBlogChartPngs({ openPage, baseUrl, plan, outDir }) {
  const startedAt = Date.now();
  const presets = Object.keys(BLOG_CHART_PNG_PRESETS);
  const files = [];
  const failed = [];
  const skipped = [];
  mkdirSync(path.join(outDir, "blog-charts"), { recursive: true });

  // 倍率はページを開くときに決まるので、大きさごとにページを開き直す
  for (const preset of presets) {
    const { failed: failedArticles } = await renderWithFreshPage(plan, {
      concurrency: 1,
      retries: 1,
      // 色は記事の既定（ライト）で撮る。閲覧者・ヘッドレスの既定に左右されない
      openPage: () =>
        openPage({
          deviceScaleFactor: BLOG_CHART_PNG_PRESETS[preset].scale,
          colorScheme: "light",
        }),
      render: async (page, { article, ids }) => {
        // 再試行のときに前の試行の結果を重ねないよう、記事が終わってから足す
        const { done, bad, skip } = await shootArticle(page, {
          baseUrl,
          outDir,
          article,
          ids,
          preset,
        });
        files.push(...done);
        failed.push(...bad);
        skipped.push(...skip);
      },
    });
    for (const { item, error } of failedArticles)
      for (const id of item.ids)
        failed.push({ id: `${id}.${preset}`, error: error.split("\n")[0] });
  }

  const total = plan.reduce((n, p) => n + p.ids.length, 0) * presets.length;
  return {
    total,
    files,
    failed,
    skipped,
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
}
