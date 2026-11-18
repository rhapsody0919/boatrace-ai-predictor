/**
 * AI スナップショット（scripts/generate-ai-snapshots.js）が dist/ を配るローカルの静的サーバーと、描く間のブラウザ。
 * generate-ai-snapshots.js の main の越え（178行・複雑さ24）を分けたときに、ファイルの行を増やさないため字のまま移した
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createPageOpener } from "../lib/renderWithFreshPage.js";
import { launchChromium } from "../lib/launchChromium.js";

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

// 当初はvite previewを子プロセス（npx経由）で起動していたが、Vercelの
// ビルドサンドボックス環境では起動が20秒のタイムアウト内に完了せず、
// npm run build全体を失敗させ本番デプロイを10時間以上止めた実績がある
// （2026-09-11〜09-12インシデント、詳細はPR#624参照）。npx解決・子プロセス
// spawn・stdoutの正規表現マッチという複数の不確実要素を排除するため、
// 同一プロセス内で完結する最小限の静的サーバーに置き換えた。
// SPAのクライアントサイドルーティングに対応するため、存在しないパスは
// index.htmlにフォールバックする（history APIルーティングと同じ挙動）。
export function startStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      (async () => {
        try {
          const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
          let filePath = path.join(distDir, urlPath);

          let fileExists = false;
          try {
            fileExists = (await stat(filePath)).isFile();
          } catch {
            fileExists = false;
          }

          if (!fileExists) {
            filePath = path.join(distDir, "index.html");
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

/**
 * 静的サーバーとブラウザを立てて render(openPage, baseUrl) を回し、最後に必ず閉じる。
 * ブログ記事スナップショット生成が万一失敗しても、ビルド全体は成功させ
 * /winning-technique・/today分だけは配信を継続する（2026-09-11〜09-12インシデントの
 * 再発防止、詳細はPR#624参照）。返す: { relaunches, fatalError }
 */
export async function withSnapshotBrowser(distDir, render) {
  let fatalError = null;
  let relaunches = 0;
  let server;
  try {
    const started = await startStaticServer(distDir);
    server = started.server;
    const baseUrl = started.baseUrl;
    // ブラウザが落ちたら起動し直す（Vercel の Chromium は単一プロセスで、ページが落ちるとブラウザごと落ちる）
    const opener = createPageOpener(launchChromium);
    try {
      await render(opener.openPage, baseUrl);
    } finally {
      relaunches = Math.max(0, opener.launches() - 1);
      await opener.close();
    }
  } catch (err) {
    fatalError = err.message;
    console.error(
      "⚠️ ブログ記事スナップショットの生成に失敗しましたが、ビルドは継続します（/winning-technique・/today分は生成済み）:",
      err.message,
    );
  } finally {
    if (server) server.close();
  }
  return { relaunches, fatalError };
}
