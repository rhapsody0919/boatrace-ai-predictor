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
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { blogPosts } from "../src/data/blogPosts.js";
import { blogPostsEn } from "../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../src/data/blogPostsKo.js";
import { renderWithFreshPage } from "./lib/renderWithFreshPage.js";
import { planBlogSnapshots } from "./lib/previewSnapshotPlan.js";
import { withSnapshotBrowser } from "./aiSnapshots/staticServer.js";
import {
  addChartPngStatus,
  addRacerStatus,
  addTranslatedStatus,
  exportChartPngsSafely,
  generateBlogFamily,
  generateRacerSnapshotsSafely,
} from "./aiSnapshots/runSteps.js";
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
import {
  ROOT,
  DIST_DIR,
  SNAPSHOT_DIR,
  dedupeDefaultTitle,
  generateRacerSnapshots,
} from "./generateAiSnapshotsRacers.js";

const CONCURRENCY = 4;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 記事の図（src/components/blog/BlogChart.jsx）は、JSON を本文と一緒に取ってから描く（src/utils/blogChartLoader.js）ので、
 * .blog-post-content が出た時点で図も出ている。図が error の記事は保存せず失敗として数える
 * （図の無い HTML を配らず、ボットには SPA を返す。ADR 0089 の「失敗したら SPA」と同じ。docs/design/blog-charts/contract.md 6節）
 */
async function waitForBlogCharts(page) {
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

// ブログ記事（ja）・翻訳記事・ブログ一覧を描く関数（scripts/aiSnapshots/runSteps.js の generateBlogFamily が順に呼ぶ）
const BLOG_STEPS = {
  generateBlogSnapshots,
  generateTranslatedBlogSnapshots,
  generateBlogListSnapshots,
};

async function main() {
  console.log("AIクローラー向けスナップショット生成を開始します...");

  generateWinningTechniqueSnapshot();
  generateTodaySnapshot();

  const blogPlan = planBlogSnapshots({
    vercelEnv: process.env.VERCEL_ENV,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    optIn: process.env.BOT_SNAPSHOTS_ON_PREVIEW,
  });
  console.log(`ブログ・翻訳・一覧のスナップショット: ${blogPlan.reason}`);

  let failed = [];
  let racerResult = null;
  let translatedResult = null;
  let listResult = null;
  let chartPngResult = null;
  const { relaunches, fatalError } = await withSnapshotBrowser(
    DIST_DIR,
    async (openPage, baseUrl) => {
      // ブログ・翻訳記事・ブログ一覧。Preview では印のあるコミットだけで作る（planBlogSnapshots、Vercel の費用 2026-11-05）
      if (blogPlan.build) {
        ({ failed, translatedResult, listResult } = await generateBlogFamily(
          openPage,
          baseUrl,
          BLOG_STEPS,
        ));
      }
      chartPngResult = await exportChartPngsSafely(openPage, baseUrl, {
        root: ROOT,
        distDir: DIST_DIR,
      });
      racerResult = await generateRacerSnapshotsSafely(
        generateRacerSnapshots,
        openPage,
        baseUrl,
      );
    },
  );

  // 失敗をログの途中に埋もれさせない。最後にまとめを出し、配信物にも残す（毎日の照合が読む）
  const { status, lines } = summarizeSnapshotRun({
    total: blogPosts.length,
    failed,
    fatalError,
    relaunches,
    generatedAt: new Date().toISOString(),
    skipped: blogPlan.build ? null : blogPlan.reason,
  });
  if (racerResult) addRacerStatus(status, racerResult);
  if (translatedResult) addTranslatedStatus(status, lines, translatedResult);
  if (listResult) addSnapshotGroup(status, lines, "blogList", listResult);
  if (chartPngResult) addChartPngStatus(status, lines, chartPngResult);

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
