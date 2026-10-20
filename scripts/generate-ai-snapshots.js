/**
 * AIクローラー・SNSシェアボット向け静的スナップショット生成（ADR 0032）
 * `npm run build`（vite build）完了後に実行する。
 *
 * - ブログ記事（日本語、全件）: Playwrightでdist/を配信するローカルサーバーにアクセスし、
 *   レンダリング済みHTMLをそのまま保存する
 * - /winning-technique: 実データ依存の分析タブを除外し、静的な機能説明部分のみを
 *   i18n JSONから直接HTMLテンプレートとして生成する（ライブAPI非依存、ビルドの決定性を保つ）
 * - /today（BOA-402）: 同じ方式。日替わりの選手・レースは入れず、ページの目的と
 *   各指標の定義だけを src/data/morningDigestCopy.js（画面と共有）から生成する
 * - 選手ページ（BOA-848）: ブログと同じ方式（dist/ を描いて保存）。sitemap に載る選手だけ、
 *   本番のビルドだけで作る（scripts/lib/racerSnapshotPlan.js）。ページが本番 DB を anon で読む
 * - 翻訳記事とブログ一覧（BOA-848 第2段、ADR 0089 追記）: ブログと同じ方式。翻訳記事は blogPostsEn・
 *   blogPostsZhTw・blogPostsKo に載る記事の /{lang}/blog/{id}、一覧は /blog と /{lang}/blog。
 *   一覧の NEW の印は描いた時点の日付で決まるので外して保存する（ビルドから日が経つと人の画面と食い違うため）
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blogPosts } from "../src/data/blogPosts.js";
import { blogPostsEn } from "../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../src/data/blogPostsKo.js";
import {
  createPageOpener,
  renderWithFreshPage,
} from "./lib/renderWithFreshPage.js";
import { planRacerSnapshots } from "./lib/racerSnapshotPlan.js";
import { launchChromium } from "./lib/launchChromium.js";
import {
  summarizeSnapshotRun,
  addSnapshotGroup,
} from "./lib/snapshotStatus.js";
import {
  MORNING_DIGEST_DISCLAIMER,
  MORNING_DIGEST_GLOSSARY,
  MORNING_DIGEST_GLOSSARY_TITLE,
  MORNING_DIGEST_META,
  MORNING_DIGEST_SECTIONS,
  glossaryBodyToText,
} from "../src/data/morningDigestCopy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const SNAPSHOT_DIR = path.join(DIST_DIR, "ai-snapshots");
const CONCURRENCY = 4;
// 選手ページの並列数。理由は PR の説明と ADR 0032 の追記（BOA-848）
const RACER_CONCURRENCY = 4;

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

/**
 * 記事の図（src/components/blog/BlogChart.jsx）は本文を描いた後に JSON を取りに行くので、
 * .blog-post-content が出た時点ではまだ読み込み中のことがある。loading が無くなるまで待ち、
 * 図が error の記事は保存せず失敗として数える（図の無い HTML を配らない。docs/design/blog-charts/contract.md 6節）
 */
async function waitForBlogCharts(page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-chart-state="loading"]'),
    null,
    { timeout: 10000 },
  );
  const failed = await page.$$eval(
    '[data-chart-state="error"]',
    (els) => els.length,
  );
  if (failed > 0) throw new Error(`ブログの図の読み込みに失敗（${failed}件）`);
}

async function generateBlogSnapshots(openPage, baseUrl) {
  const outDir = path.join(SNAPSHOT_DIR, "blog");
  mkdirSync(outDir, { recursive: true });

  const { succeeded, failed: failedItems } = await renderWithFreshPage(
    blogPosts,
    {
      concurrency: CONCURRENCY,
      openPage,
      // 単一プロセスの Chromium では、別の記事でブラウザが落ちると同時に開いていたページも巻き添えになる。
      // 2026-10-11 の Preview で、再試行1回では巻き添えの記事が1件残った（120/121）ので2回にする
      retries: 2,
      render: async (page, post) => {
        await page.goto(`${baseUrl}/blog/${post.id}`, {
          waitUntil: "networkidle",
          timeout: 15000,
        });
        await page.waitForSelector(".blog-post-content", { timeout: 10000 });
        await waitForBlogCharts(page);
        const html = dedupeDefaultTitle(await page.content());
        writeFileSync(path.join(outDir, `${post.id}.html`), html, "utf-8");
      },
    },
  );
  const failed = failedItems.map(({ item, error }) => ({ id: item.id, error }));

  console.log(
    `✓ ブログ記事スナップショット: ${succeeded.length}/${blogPosts.length}件`,
  );
  if (failed.length > 0) {
    console.error(
      `⚠️ 生成に失敗した記事: ${failed.map((f) => `${f.id} (${f.error})`).join(", ")}`,
    );
  }
  return failed;
}

// 翻訳記事の言語と記事の一覧（src/config/languages.js の BLOG_TRANSLATION_SOURCES と同じ）
const BLOG_TRANSLATIONS = {
  en: blogPostsEn,
  "zh-TW": blogPostsZhTw,
  ko: blogPostsKo,
};

/**
 * 描いて保存するページの組を、ブログと同じ方式で作る（翻訳記事・ブログ一覧、BOA-848 第2段）
 *
 * @param {{label: string, items: {key: string, url: string, file: string}[], waitSelector: string,
 *   beforeSave?: (page: import("playwright").Page) => Promise<void>}} spec
 *   url はローカルサーバーからのパス、file は SNAPSHOT_DIR からの相対パス
 * @returns {Promise<{total: number, failed: {id: string, error: string}[]}>}
 */
async function generateRenderedPages(
  openPage,
  baseUrl,
  { label, items, waitSelector, beforeSave },
) {
  const startedAt = Date.now();
  const { succeeded, failed: failedItems } = await renderWithFreshPage(items, {
    concurrency: CONCURRENCY,
    openPage,
    retries: 2,
    render: async (page, item) => {
      await page.goto(`${baseUrl}${item.url}`, {
        waitUntil: "networkidle",
        timeout: 15000,
      });
      await page.waitForSelector(waitSelector, { timeout: 10000 });
      if (beforeSave) await beforeSave(page);
      const html = dedupeDefaultTitle(await page.content());
      const out = path.join(SNAPSHOT_DIR, item.file);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, html, "utf-8");
    },
  });
  const failed = failedItems.map(({ item, error }) => ({
    id: item.key,
    error: error.split("\n")[0],
  }));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `✓ ${label}: ${succeeded.length}/${items.length}件（${seconds}秒）`,
  );
  if (failed.length > 0) {
    console.error(
      `⚠️ 生成に失敗した${label}: ${failed.map((f) => `${f.id} (${f.error})`).join(", ")}`,
    );
  }
  return { total: items.length, failed };
}

/** 翻訳記事（/{lang}/blog/{id}）。保存先は ai-snapshots/{lang}/blog/{id}.html。言語ごとの結果を返す */
async function generateTranslatedBlogSnapshots(openPage, baseUrl) {
  const results = {};
  for (const [lang, posts] of Object.entries(BLOG_TRANSLATIONS)) {
    results[lang] = await generateRenderedPages(openPage, baseUrl, {
      label: `翻訳記事（${lang}）`,
      items: posts.map((post) => ({
        key: post.id,
        url: `/${lang}/blog/${post.id}`,
        file: `${lang}/blog/${post.id}.html`,
      })),
      waitSelector: ".blog-post-content",
      beforeSave: waitForBlogCharts,
    });
  }
  return results;
}

/** ブログ一覧（/blog と /{lang}/blog）。保存先は ai-snapshots/blog-list.html と ai-snapshots/{lang}/blog-list.html */
async function generateBlogListSnapshots(openPage, baseUrl) {
  return generateRenderedPages(openPage, baseUrl, {
    label: "ブログ一覧",
    items: ["ja", ...Object.keys(BLOG_TRANSLATIONS)].map((lang) =>
      lang === "ja"
        ? { key: "ja", url: "/blog", file: "blog-list.html" }
        : { key: lang, url: `/${lang}/blog`, file: `${lang}/blog-list.html` },
    ),
    waitSelector: ".blog-grid .blog-card",
    // NEW の印（投稿から7日以内）は描いた日で決まる。ビルドから日が経つと、人の画面に無い NEW が残るので外す
    beforeSave: (page) =>
      page.evaluate(() => {
        document.querySelectorAll(".new-badge").forEach((el) => el.remove());
      }),
  });
}

/**
 * 選手ページ（/racer/{番号}）のスナップショット（BOA-848）。
 *
 * 人の画面を描いた HTML をそのまま保存するので、人の画面に無い文言は入らない（ADR 0089 決定3）。
 * 保存するのは、プロフィールと成績が揃った目印（RacerProfile.jsx の data-snapshot-ready）が付いてから。
 * 失敗したページは保存しない（vercel.json の catch-all で SPA の外枠に戻る。ブログと同じ）。
 * 描いたページが noindex なら保存しない（sitemap が書かれた後に条件から外れた選手）。
 */
async function generateRacerSnapshots(openPage, baseUrl) {
  const { ids, reason } = planRacerSnapshots({
    vercelEnv: process.env.VERCEL_ENV,
    limit: process.env.RACER_SNAPSHOT_LIMIT,
    sitemapXml: readFileSync(path.join(DIST_DIR, "sitemap.xml"), "utf-8"),
  });
  console.log(`選手ページのスナップショット: ${reason}`);
  if (ids.length === 0) return { total: 0, failed: [], skipped: [] };

  const outDir = path.join(SNAPSHOT_DIR, "racer");
  mkdirSync(outDir, { recursive: true });

  const skipped = [];
  const startedAt = Date.now();
  const { succeeded, failed: failedItems } = await renderWithFreshPage(ids, {
    concurrency: RACER_CONCURRENCY,
    openPage,
    retries: 2,
    render: async (page, id) => {
      await page.goto(`${baseUrl}/racer/${id}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForSelector('[data-snapshot-ready="true"]', {
        timeout: 20000,
      });
      const robots = await page.getAttribute('meta[name="robots"]', "content");
      if (robots?.includes("noindex")) {
        skipped.push(id);
        return;
      }
      const html = dedupeDefaultTitle(await page.content());
      writeFileSync(path.join(outDir, `${id}.html`), html, "utf-8");
    },
  });
  const failed = failedItems.map(({ item, error }) => ({
    id: item,
    error: error.split("\n")[0],
  }));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(
    `✓ 選手ページスナップショット: ${succeeded.length - skipped.length}/${ids.length}件（${seconds}秒、並列${RACER_CONCURRENCY}）`,
  );
  if (skipped.length > 0) {
    console.log(`  noindex のため保存しなかった選手: ${skipped.join(", ")}`);
  }
  if (failed.length > 0) {
    console.error(
      `⚠️ 生成に失敗した選手（SPA の外枠に戻る）: ${failed.map((f) => `${f.id} (${f.error})`).join(", ")}`,
    );
  }
  return { total: ids.length, failed, skipped };
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

/**
 * /today（「本日のデータ一覧」、BOA-402）のスナップショット。
 *
 * **ビルド時生成なので日替わりの中身は入れない。** 載せるのはページの目的と各指標の定義だけ
 * （plan.md §5、/winning-technique と同じ方針）。文言は画面と共有の
 * src/data/morningDigestCopy.js から取るため、片方だけ古くなることがない。
 */
function generateTodaySnapshot() {
  const sections = MORNING_DIGEST_SECTIONS.map(
    (section) => `
    <section>
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.description)}</p>${
        section.notice ? `\n      <p>${escapeHtml(section.notice)}</p>` : ""
      }
    </section>`,
  ).join("\n");

  const glossary = MORNING_DIGEST_GLOSSARY.map(
    (entry) => `
      <dt>${escapeHtml(entry.term)}</dt>
      <dd>${escapeHtml(glossaryBodyToText(entry.body))}</dd>`,
  ).join("");

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(MORNING_DIGEST_META.title)}</title>
  <meta name="description" content="${escapeHtml(MORNING_DIGEST_META.description)}" />
  <link rel="canonical" href="${MORNING_DIGEST_META.canonical}" />
  <meta name="robots" content="index, follow" />
</head>
<body>
  <main>
    <h1>${escapeHtml(MORNING_DIGEST_META.h1)}</h1>
    <p>${escapeHtml(MORNING_DIGEST_META.lead)}</p>
    <p>掲載している選手・レースは毎朝入れ替わります。最新の内容は ${MORNING_DIGEST_META.canonical} を参照してください。</p>
${sections}
    <section>
      <h2>${escapeHtml(MORNING_DIGEST_GLOSSARY_TITLE)}</h2>
      <dl>${glossary}
      </dl>
      <p>${escapeHtml(MORNING_DIGEST_DISCLAIMER)}</p>
    </section>
  </main>
</body>
</html>
`;

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(path.join(SNAPSHOT_DIR, "today.html"), html, "utf-8");
  console.log("✓ /today スナップショット生成完了");
}

async function main() {
  console.log("AIクローラー向けスナップショット生成を開始します...");

  generateWinningTechniqueSnapshot();
  generateTodaySnapshot();

  // ブログ記事スナップショット生成が万一失敗しても、ビルド全体は成功させ
  // /winning-technique・/today分だけは配信を継続する（2026-09-11〜09-12インシデントの
  // 再発防止、詳細はPR#624参照）。
  let failed = [];
  let fatalError = null;
  let relaunches = 0;
  let racerResult = null;
  let translatedResult = null;
  let listResult = null;
  let server;
  try {
    const started = await startStaticServer();
    server = started.server;
    const baseUrl = started.baseUrl;
    // ブラウザが落ちたら起動し直す（Vercel の Chromium は単一プロセスで、ページが落ちるとブラウザごと落ちる）
    const opener = createPageOpener(launchChromium);
    try {
      failed = await generateBlogSnapshots(opener.openPage, baseUrl);
      // 翻訳記事・一覧（BOA-848 第2段）。止まっても ja の記事・選手ページの結果には影響させない
      try {
        translatedResult = await generateTranslatedBlogSnapshots(
          opener.openPage,
          baseUrl,
        );
      } catch (err) {
        translatedResult = { fatalError: err.message };
        console.error(
          "⚠️ 翻訳記事のスナップショット生成が途中で止まった:",
          err.message,
        );
      }
      try {
        listResult = await generateBlogListSnapshots(opener.openPage, baseUrl);
      } catch (err) {
        listResult = { total: null, failed: [], fatalError: err.message };
        console.error(
          "⚠️ ブログ一覧のスナップショット生成が途中で止まった:",
          err.message,
        );
      }
      // 選手ページの失敗は、ブログの生成結果に影響させない（それぞれ別に落ちてよい）
      try {
        racerResult = await generateRacerSnapshots(opener.openPage, baseUrl);
      } catch (err) {
        racerResult = {
          total: null,
          failed: [],
          skipped: [],
          fatalError: err.message,
        };
        console.error(
          "⚠️ 選手ページのスナップショット生成が途中で止まりましたが、ビルドは継続します:",
          err.message,
        );
      }
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

  // 失敗をログの途中に埋もれさせない。最後にまとめを出し、配信物にも残す（毎日の照合が読む）
  const { status, lines } = summarizeSnapshotRun({
    total: blogPosts.length,
    failed,
    fatalError,
    relaunches,
    generatedAt: new Date().toISOString(),
  });
  // 選手ページ（BOA-848）の結果も残す。ok はブログの結果のまま（選手の失敗は記録だけ。判断は毎日の照合の側で見て決める）
  if (racerResult) {
    status.racer = {
      total: racerResult.total,
      succeeded:
        racerResult.total == null
          ? null
          : racerResult.total -
            racerResult.failed.length -
            racerResult.skipped.length,
      failedIds: racerResult.failed.map((f) => f.id),
      skippedIds: racerResult.skipped,
      fatalError: racerResult.fatalError ?? null,
    };
  }
  // 翻訳記事・一覧（BOA-848 第2段）。失敗があれば ok を false にする（毎日の照合が Slack に流す）
  if (translatedResult) {
    if (translatedResult.fatalError) {
      addSnapshotGroup(status, lines, "blogI18n", {
        total: null,
        failed: [],
        fatalError: translatedResult.fatalError,
      });
    } else {
      for (const [lang, r] of Object.entries(translatedResult)) {
        addSnapshotGroup(status, lines, `blogI18n.${lang}`, r);
      }
    }
  }
  if (listResult) addSnapshotGroup(status, lines, "blogList", listResult);
  writeFileSync(
    path.join(SNAPSHOT_DIR, "status.json"),
    `${JSON.stringify(status, null, 2)}\n`,
    "utf-8",
  );
  (status.ok ? console.log : console.error)(lines.join("\n"));

  console.log("スナップショット生成が完了しました。");
}

main().catch((err) => {
  // ここに到達するのはgenerateWinningTechniqueSnapshot()・generateTodaySnapshot()自体の失敗のみ
  // （ブログ側のエラーは上のtry-catchで既に吸収済み）。同期的なテンプレート
  // 生成なので、失敗する場合は環境差異ではなく実際のバグの可能性が高く、
  // ビルドを失敗させて気づけるようにする。
  console.error("スナップショット生成中にエラーが発生しました:", err);
  process.exit(1);
});
