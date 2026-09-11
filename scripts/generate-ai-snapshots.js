/**
 * AIクローラー・SNSシェアボット向け静的スナップショット生成（ADR 0032）
 * `npm run build`（vite build）完了後に実行する。
 *
 * - ブログ記事（日本語、全件）: Playwrightでdist/を配信するローカルサーバーにアクセスし、
 *   レンダリング済みHTMLをそのまま保存する
 * - /winning-technique: 実データ依存の分析タブを除外し、静的な機能説明部分のみを
 *   i18n JSONから直接HTMLテンプレートとして生成する（ライブAPI非依存、ビルドの決定性を保つ）
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blogPosts } from "../src/data/blogPosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const SNAPSHOT_DIR = path.join(DIST_DIR, "ai-snapshots");
const CONCURRENCY = 4;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// index.htmlの静的<title>（サイト共通デフォルト）がReact描画後のページ固有<title>と
// 並存してしまう（React管理外の初期HTMLタグのため、Reactの重複排除が効かない）。
// デフォルトタイトルと一致する<title>を除去し、ページ固有のものだけを残す。
const DEFAULT_TITLE = "龍神レーダー - 無料のボートレースAI予想＆データ分析";

function dedupeDefaultTitle(html) {
  const titleMatches = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
  if (titleMatches.length <= 1) return html;

  let result = html;
  for (const match of titleMatches) {
    if (match[1] === DEFAULT_TITLE) {
      result = result.replace(match[0], "");
    }
  }
  return result;
}

// 固定ポートだと、同一マシンで複数のビルド（別セッション・別worktree等）が
// 並行実行された際に衝突する（このリポジトリで実際に発生した事故パターン、
// docs/design/ai-crawler-snapshot参照）。--strictPortを付けずvite自身に
// 空きポートを選ばせ、実際に採用されたポートをstdoutから読み取る
function startPreviewServer(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["vite", "preview", "--port", "0"], {
      cwd: ROOT,
      stdio: "pipe",
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(
        new Error(
          `ローカルプレビューサーバーが${timeoutMs}ms以内に起動しませんでした`,
        ),
      );
    }, timeoutMs);

    const onData = (chunk) => {
      const match = chunk.toString().match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        proc.stdout.off("data", onData);
        resolve({ proc, baseUrl: `http://localhost:${match[1]}` });
      }
    };
    proc.stdout.on("data", onData);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function generateBlogSnapshots(browser, baseUrl) {
  const outDir = path.join(SNAPSHOT_DIR, "blog");
  mkdirSync(outDir, { recursive: true });

  let index = 0;
  let succeeded = 0;
  const failed = [];

  async function worker() {
    const page = await browser.newPage();
    try {
      while (index < blogPosts.length) {
        const post = blogPosts[index];
        index += 1;
        try {
          await page.goto(`${baseUrl}/blog/${post.id}`, {
            waitUntil: "networkidle",
            timeout: 15000,
          });
          await page.waitForSelector(".blog-post-content", { timeout: 10000 });
          const html = dedupeDefaultTitle(await page.content());
          writeFileSync(path.join(outDir, `${post.id}.html`), html, "utf-8");
          succeeded += 1;
        } catch (err) {
          failed.push({ id: post.id, error: err.message });
        }
      }
    } finally {
      await page.close();
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(
    `✓ ブログ記事スナップショット: ${succeeded}/${blogPosts.length}件`,
  );
  if (failed.length > 0) {
    console.error(
      `⚠️ 生成に失敗した記事: ${failed.map((f) => `${f.id} (${f.error})`).join(", ")}`,
    );
  }
  return failed;
}

function generateWinningTechniqueSnapshot() {
  const commonJa = JSON.parse(
    readFileSync(path.join(ROOT, "src/locales/ja/common.json"), "utf-8"),
  );
  const analysisPage = commonJa.analysisPage;
  const tabKeys = Object.keys(analysisPage.tabs);

  const sections = tabKeys
    .map((key) => {
      const tabLabel = analysisPage.tabs[key];
      const feature = analysisPage.features?.[key];
      const info = analysisPage.info?.[key];
      if (!feature && !info) return "";

      const tipsHtml = (info?.tips || [])
        .map(
          (tip) =>
            `<li>${tip.strong ? `<strong>${escapeHtml(tip.strong)}</strong>` : ""}${escapeHtml(tip.text)}</li>`,
        )
        .join("\n");

      return `
    <section>
      <h2>${escapeHtml(tabLabel)}${feature ? ` — ${escapeHtml(feature.name)}` : ""}</h2>
      ${feature ? `<p>${escapeHtml(feature.description)}</p>` : ""}
      ${info?.title ? `<h3>${escapeHtml(info.title)}</h3>` : ""}
      ${info?.dataView ? `<p>${escapeHtml(info.dataView)}</p>` : ""}
      ${tipsHtml ? `<ul>\n${tipsHtml}\n      </ul>` : ""}
    </section>`;
    })
    .join("\n");

  const canonicalUrl = "https://www.boat-ai.jp/winning-technique";
  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(analysisPage.meta.title)}</title>
  <meta name="description" content="${escapeHtml(analysisPage.meta.description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta name="robots" content="index, follow" />
</head>
<body>
  <main>
    <h1>${escapeHtml(analysisPage.h1)}</h1>
    <p>${escapeHtml(analysisPage.subtitle)}</p>
${sections}
  </main>
</body>
</html>
`;

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(
    path.join(SNAPSHOT_DIR, "winning-technique.html"),
    html,
    "utf-8",
  );
  console.log("✓ /winning-technique スナップショット生成完了");
}

async function main() {
  console.log("AIクローラー向けスナップショット生成を開始します...");

  generateWinningTechniqueSnapshot();

  const { proc: previewProc, baseUrl } = await startPreviewServer();
  let browser;
  try {
    browser = await chromium.launch();
    const failed = await generateBlogSnapshots(browser, baseUrl);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    previewProc.kill();
  }

  console.log("スナップショット生成が完了しました。");
}

main().catch((err) => {
  console.error("スナップショット生成中にエラーが発生しました:", err);
  process.exit(1);
});
