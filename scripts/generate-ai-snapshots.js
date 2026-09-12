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
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blogPosts } from "../src/data/blogPosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const SNAPSHOT_DIR = path.join(DIST_DIR, "ai-snapshots");
const CONCURRENCY = 4;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

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

// 当初はvite previewを子プロセス（npx経由）で起動していたが、Vercelの
// ビルドサンドボックス環境では起動が20秒のタイムアウト内に完了せず、
// npm run build全体を失敗させ本番デプロイを10時間以上止めた実績がある
// （2026-09-11〜09-12インシデント、詳細はPR#624参照）。npx解決・子プロセス
// spawn・stdoutの正規表現マッチという複数の不確実要素を排除するため、
// 同一プロセス内で完結する最小限の静的サーバーに置き換えた。
// SPAのクライアントサイドルーティングに対応するため、存在しないパスは
// index.htmlにフォールバックする（history APIルーティングと同じ挙動）。
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      (async () => {
        try {
          const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
          let filePath = path.join(DIST_DIR, urlPath);

          let fileExists = false;
          try {
            fileExists = (await stat(filePath)).isFile();
          } catch {
            fileExists = false;
          }

          if (!fileExists) {
            filePath = path.join(DIST_DIR, "index.html");
          }

          const content = await readFile(filePath);
          const ext = path.extname(filePath);
          res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          });
          res.end(content);
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
      })();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
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

  // ブログ記事スナップショット生成が万一失敗しても、ビルド全体は成功させ
  // /winning-technique分だけは配信を継続する（2026-09-11〜09-12インシデントの
  // 再発防止、詳細はPR#624参照）。
  let server;
  try {
    const started = await startStaticServer();
    server = started.server;
    const baseUrl = started.baseUrl;
    let browser;
    try {
      browser = await chromium.launch();
      const failed = await generateBlogSnapshots(browser, baseUrl);
      if (failed.length > 0) {
        console.error(
          `⚠️ ${failed.length}件のブログ記事スナップショット生成に失敗しましたが、ビルドは継続します。`,
        );
      }
    } finally {
      if (browser) await browser.close();
    }
  } catch (err) {
    console.error(
      "⚠️ ブログ記事スナップショットの生成に失敗しましたが、ビルドは継続します（/winning-technique分は生成済み）:",
      err.message,
    );
  } finally {
    if (server) server.close();
  }

  console.log("スナップショット生成が完了しました。");
}

main().catch((err) => {
  // ここに到達するのはgenerateWinningTechniqueSnapshot()自体の失敗のみ
  // （ブログ側のエラーは上のtry-catchで既に吸収済み）。同期的なテンプレート
  // 生成なので、失敗する場合は環境差異ではなく実際のバグの可能性が高く、
  // ビルドを失敗させて気づけるようにする。
  console.error("スナップショット生成中にエラーが発生しました:", err);
  process.exit(1);
});
