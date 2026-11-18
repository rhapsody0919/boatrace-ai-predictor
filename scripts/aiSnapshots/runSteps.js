/**
 * AI スナップショット（scripts/generate-ai-snapshots.js）の main の部品。図の PNG・選手ページは止まっても
 * ほかの結果に影響させない包み、status.json へ足す選手ページ・翻訳記事・図の PNG の結果。
 * generate-ai-snapshots.js の main の越え（178行・複雑さ24）を分けた。本文は元の main のまま
 */
import path from "node:path";
import { exportBlogChartPngs, planBlogChartPngs } from "../lib/blogChartPng.js";
import { RACER_SNAPSHOT_TEMPLATE_VERSION } from "../lib/racerSnapshotPlan.js";
import { addSnapshotGroup } from "../lib/snapshotStatus.js";

/**
 * ブログ記事（ja）・翻訳記事・ブログ一覧。翻訳・一覧が止まっても ja の記事の結果には影響させない。
 * steps: generate-ai-snapshots.js の generateBlogSnapshots・generateTranslatedBlogSnapshots・generateBlogListSnapshots
 */
export async function generateBlogFamily(openPage, baseUrl, steps) {
  const failed = await steps.generateBlogSnapshots(openPage, baseUrl);
  // 翻訳記事・一覧（BOA-848 第2段）
  let translatedResult;
  try {
    translatedResult = await steps.generateTranslatedBlogSnapshots(
      openPage,
      baseUrl,
    );
  } catch (err) {
    translatedResult = { fatalError: err.message };
    console.error(
      "⚠️ 翻訳記事のスナップショット生成が途中で止まった:",
      err.message,
    );
  }
  let listResult;
  try {
    listResult = await steps.generateBlogListSnapshots(openPage, baseUrl);
  } catch (err) {
    listResult = { total: null, failed: [], fatalError: err.message };
    console.error(
      "⚠️ ブログ一覧のスナップショット生成が途中で止まった:",
      err.message,
    );
  }
  return { failed, translatedResult, listResult };
}

/** ブログの図の PNG（ADR 0099）。止まっても記事・選手ページの結果には影響させない */
export async function exportChartPngsSafely(
  openPage,
  baseUrl,
  { root, distDir },
) {
  try {
    const chartPngResult = await exportBlogChartPngs({
      openPage,
      baseUrl,
      plan: planBlogChartPngs(path.join(root, "public", "blog-charts")),
      outDir: distDir,
    });
    console.log(
      `✓ ブログの図の PNG: ${chartPngResult.files.length}/${chartPngResult.total}枚（${chartPngResult.seconds}秒）`,
    );
    for (const f of chartPngResult.failed)
      console.error(`⚠️ 図の PNG を作れなかった: ${f.id}: ${f.error}`);
    for (const f of chartPngResult.skipped)
      console.log(`- 図の PNG を作らなかった: ${f.id}: ${f.error}`);
    return chartPngResult;
  } catch (err) {
    console.error(
      "⚠️ ブログの図の PNG の書き出しが途中で止まった:",
      err.message,
    );
    return { total: null, failed: [], skipped: [], fatalError: err.message };
  }
}

/** 選手ページの失敗は、ブログの生成結果に影響させない（それぞれ別に落ちてよい） */
export async function generateRacerSnapshotsSafely(
  generate,
  openPage,
  baseUrl,
) {
  try {
    return await generate(openPage, baseUrl);
  } catch (err) {
    console.error(
      "⚠️ 選手ページのスナップショット生成が途中で止まりましたが、ビルドは継続します:",
      err.message,
    );
    return { total: null, failed: [], skipped: [], fatalError: err.message };
  }
}

/** 選手ページ（BOA-848）の結果も残す。ok はブログの結果のまま（選手の失敗は記録だけ。判断は毎日の照合の側で見て決める） */
export function addRacerStatus(status, racerResult) {
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
  // 写したか描いたか（ADR 0032 追記、Vercel の費用 2026-11-05）。次の本番ビルドが写せるかの判定と、毎日の照合の古さの判定が読む
  if (racerResult.mode) {
    Object.assign(status.racer, {
      mode: racerResult.mode,
      decisionReason: racerResult.decisionReason,
      renderedAt: racerResult.renderedAt,
      templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION,
      copied: racerResult.copied,
      rendered: racerResult.rendered,
      copyFailures: racerResult.copyFailures,
      seconds: racerResult.seconds,
    });
  }
}

/** 翻訳記事・一覧（BOA-848 第2段）。失敗があれば ok を false にする（毎日の照合が Slack に流す） */
export function addTranslatedStatus(status, lines, translatedResult) {
  if (translatedResult.fatalError) {
    addSnapshotGroup(status, lines, "blogI18n", {
      total: null,
      failed: [],
      fatalError: translatedResult.fatalError,
    });
    return;
  }
  for (const [lang, r] of Object.entries(translatedResult)) {
    addSnapshotGroup(status, lines, `blogI18n.${lang}`, r);
  }
}

/**
 * 図の PNG（ADR 0099）。失敗の理由と書いた URL も残す（作り手・朝夜のまとめが読む）。
 * 枠に収まらず作らなかったもの（skipped）は撮る対象から外して数える（失敗にも成功にも入れない）
 */
export function addChartPngStatus(status, lines, chartPngResult) {
  const skipped = chartPngResult.skipped ?? [];
  addSnapshotGroup(status, lines, "blogChartPng", {
    ...chartPngResult,
    total:
      chartPngResult.total == null
        ? null
        : chartPngResult.total - skipped.length,
  });
  Object.assign(status.blogChartPng, {
    // 朝夜のまとめ（scripts/content/blog-chart-png-digest.js）が、配られた版までの JSON の変更を数えるのに使う
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    files: chartPngResult.files ?? [],
    errors: Object.fromEntries(
      chartPngResult.failed.map((f) => [f.id, f.error]),
    ),
    skipped: Object.fromEntries(skipped.map((f) => [f.id, f.error])),
    seconds: chartPngResult.seconds ?? null,
  });
}
