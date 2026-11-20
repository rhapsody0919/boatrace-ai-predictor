import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderWithFreshPage } from "./lib/renderWithFreshPage.js";
import {
  adaptCopiedRacerHtml,
  canSaveRacerSnapshot,
  decideRacerSnapshotSource,
  mainAssetsOf,
  olderIso,
  planRacerSnapshots,
  sourceChangedDuringCopy,
} from "./lib/racerSnapshotPlan.js";
import { mapWithConcurrency } from "./lib/scrapeJobs/concurrency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const SNAPSHOT_DIR = path.join(DIST_DIR, "ai-snapshots");

// 選手ページの並列数。理由は PR の説明と ADR 0032 の追記（BOA-848）
const RACER_CONCURRENCY = 4;
// 選手ページを写す元（今の本番、ADR 0032 追記）と、写すときの並列数（静的ファイルの取得だけで DB は読まない）。
// RACER_SNAPSHOT_SOURCE_ORIGIN は手元で写す道を確かめる用
const RACER_SOURCE_ORIGIN =
  process.env.RACER_SNAPSHOT_SOURCE_ORIGIN || "https://www.boat-ai.jp";
const RACER_COPY_CONCURRENCY = 16;

// index.htmlの静的<title>（サイト共通デフォルト）がReact描画後のページ固有<title>と
// 並存してしまう（React管理外の初期HTMLタグのため、Reactの重複排除が効かない）。
// デフォルトタイトルと一致する<title>を除去し、ページ固有のものだけを残す。
const DEFAULT_TITLE = "ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー";

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

/** 写す元（今の本番）から文字列を取る。HTTP の状態と本文を返す（失敗は例外） */
async function fetchFromSource(urlPath) {
  const res = await fetch(`${RACER_SOURCE_ORIGIN}${urlPath}`, {
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: await res.text() };
}

/** 今の本番の status.json。取れない・JSON でないときは null（理由はログに出す） */
async function fetchSourceStatus() {
  try {
    const { status, body } = await fetchFromSource("/ai-snapshots/status.json");
    if (status !== 200) {
      console.log(`  今の本番の status.json が HTTP ${status}`);
      return null;
    }
    return JSON.parse(body);
  } catch (err) {
    console.log(`  今の本番の status.json を読めない: ${err.message}`);
    return null;
  }
}

/** このビルドの dist に、そのパスのファイルが在るか */
function distHas(urlPath) {
  try {
    return statSync(path.join(DIST_DIR, decodeURIComponent(urlPath))).isFile();
  } catch {
    return false;
  }
}

/** fetch の失敗の理由（undici は err.cause に ECONNREFUSED・ENOTFOUND 等の code を持つ） */
const fetchErrorReason = (err) =>
  `取得の失敗: ${err.name}${err.cause?.code ? ` ${err.cause.code}` : ""}`;

/** 1人を写す。写せなければ理由を返す（例外は投げない。1人の失敗で他の選手を止めない） */
async function copyOneRacer(id, outDir, mainAssets) {
  let res;
  try {
    res = await fetchFromSource(`/ai-snapshots/racer/${id}.html`);
  } catch (err) {
    return {
      id,
      ok: false,
      reason: fetchErrorReason(err),
      detail: err.message,
    };
  }
  if (res.status !== 200)
    return { id, ok: false, reason: `HTTP ${res.status}` };
  const adapted = adaptCopiedRacerHtml(res.body, { mainAssets, distHas });
  if (!adapted.ok) return { id, ok: false, reason: adapted.reason };
  try {
    writeFileSync(path.join(outDir, `${id}.html`), adapted.html, "utf-8");
  } catch (err) {
    return {
      id,
      ok: false,
      reason: `書き込みの失敗: ${err.code ?? err.name}`,
      detail: err.message,
    };
  }
  return { id, ok: true };
}

/**
 * 今の本番の /ai-snapshots/racer/{id}.html を写す（Vercel の費用、2026-11-05、ADR 0032 追記）。
 * 写せなかった選手は返り値の failures に入れ、呼び出し側が描く。
 */
async function copyRacerSnapshots(ids, outDir) {
  const mainAssets = mainAssetsOf(
    readFileSync(path.join(DIST_DIR, "index.html"), "utf-8"),
  );
  if (!mainAssets) {
    return {
      copied: [],
      failures: ids.map((id) => ({
        id,
        reason: "dist/index.html に main の js・css が無い",
      })),
    };
  }
  const results = await mapWithConcurrency(ids, RACER_COPY_CONCURRENCY, (id) =>
    copyOneRacer(id, outDir, mainAssets),
  );
  return {
    copied: results.filter((r) => r.ok).map((r) => r.id),
    failures: results.filter((r) => !r.ok),
  };
}

/** 理由ごとの件数（status.json に残す。理由の文の後ろの番号などは束ねない） */
function countReasons(failures) {
  const counts = {};
  for (const { reason } of failures) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

/**
 * 選手ページを Playwright で描いて保存する（BOA-848）。
 *
 * 人の画面を描いた HTML をそのまま保存するので、人の画面に無い文言は入らない（ADR 0089 決定3）。
 * 保存するのは、プロフィール・成績・モーター・履歴が揃った目印（RacerProfile.jsx の data-snapshot-ready）が付いてから。
 * 失敗したページは保存しない（vercel.json の catch-all で SPA の外枠に戻る。ブログと同じ）。
 * 描いたページが noindex なら保存しない（sitemap が書かれた後に条件から外れた選手）。
 */
async function renderRacerSnapshots(openPage, baseUrl, ids, outDir) {
  const skipped = [];
  const { succeeded, failed: failedItems } = await renderWithFreshPage(ids, {
    concurrency: RACER_CONCURRENCY,
    openPage,
    retries: 2,
    render: async (page, id) => {
      await page.goto(`${baseUrl}/racer/${id}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      try {
        await page.waitForSelector('[data-snapshot-ready="true"]', {
          timeout: 20000,
        });
      } catch (err) {
        if (err.name !== "TimeoutError") throw err;
        skipped.push(id);
        return;
      }
      const robots = await page.getAttribute('meta[name="robots"]', "content");
      if (robots?.includes("noindex")) {
        skipped.push(id);
        return;
      }
      const html = dedupeDefaultTitle(await page.content());
      if (!canSaveRacerSnapshot(html)) {
        skipped.push(id);
        return;
      }
      writeFileSync(path.join(outDir, `${id}.html`), html, "utf-8");
    },
  });
  const failed = failedItems.map(({ item, error }) => ({
    id: item,
    error: error.split("\n")[0],
  }));
  return { saved: succeeded.length - skipped.length, failed, skipped };
}

/**
 * 選手ページ（/racer/{番号}）のスナップショット（BOA-848）。
 *
 * 本番のビルドだけで作る（planRacerSnapshots）。全員を描くのは1日1回で、ほかの本番ビルドでは今の本番から写し、
 * 写せなかった選手だけを描く（decideRacerSnapshotSource、Vercel の費用 2026-11-05）。
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
  const startedAt = Date.now();

  // 写すのは本番のビルドだけ（Preview の RACER_SNAPSHOT_LIMIT は描いて確かめる用）
  const decision =
    process.env.VERCEL_ENV === "production"
      ? decideRacerSnapshotSource({
          sourceStatus: await fetchSourceStatus(),
          nowMs: startedAt,
          forceRender: process.env.RACER_SNAPSHOT_FORCE_RENDER === "1",
        })
      : { mode: "render", reason: "本番以外のビルドは写さない" };
  console.log(
    `  ${decision.mode === "copy" ? "写す" : "全員を描く"}: ${decision.reason}`,
  );

let mode = decision.mode;
let decisionReason = decision.reason;
let copied = [];
let copyFailures = [];
let renderedAt = new Date(startedAt).toISOString();
if (decision.mode === "copy") {
  ({ copied, failures: copyFailures } = await copyRacerSnapshots(ids, outDir));
  console.log(
    `  写した: ${copied.length}/${ids.length}人（${((Date.now() - startedAt) / 1000).toFixed(1)}秒）`,
  );
  const after = await fetchSourceStatus();
  const changed = sourceChangedDuringCopy(after);
  if (changed) {
    // 写した HTML は別の版のものかもしれないので捨てて、全員を描く
    for (const id of copied)
      rmSync(path.join(outDir, `${id}.html`), { force: true });
    console.log(`  写したものを捨てて全員を描く: ${changed}`);
    mode = "render";
    decisionReason = changed;
    copied = [];
    copyFailures = [];
  } else {
    // 写している間に alias が同じ版の別のビルドへ切り替わることがある。描いた時刻は古い方を残す
    if (copied.length > 0)
      renderedAt = olderIso(decision.renderedAt, after?.racer?.renderedAt);
    if (copyFailures.length > 0) {
      console.log(
        `  写せなかったので描く: ${copyFailures.map((f) => `${f.id}（${f.reason}${f.detail ? `: ${f.detail}` : ""}）`).join(", ")}`,
      );
    }
  }
}

const toRender = mode === "copy" ? copyFailures.map((f) => f.id) : ids;
const rendered =
  toRender.length > 0
    ? await renderRacerSnapshots(openPage, baseUrl, toRender, outDir)
    : { saved: 0, failed: [], skipped: [] };
const { failed, skipped } = rendered;
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(
    `✓ 選手ページスナップショット: ${copied.length + rendered.saved}/${ids.length}件（写した ${copied.length}・描いた ${rendered.saved}、${seconds}秒、描く並列${RACER_CONCURRENCY}）`,
  );
  if (skipped.length > 0) {
    console.log(
      `  noindex・未完了・取得失敗のため保存しなかった選手: ${skipped.join(", ")}`,
    );
  }
  if (failed.length > 0) {
    console.error(
      `⚠️ 生成に失敗した選手（SPA の外枠に戻る）: ${failed.map((f) => `${f.id} (${f.error})`).join(", ")}`,
    );
  }
  return {
    total: ids.length,
    failed,
    skipped,
    mode,
    decisionReason,
    renderedAt,
    copied: copied.length,
    rendered: rendered.saved,
    copyFailures: countReasons(copyFailures),
    seconds: Number(seconds),
  };
}

export {
  ROOT,
  DIST_DIR,
  SNAPSHOT_DIR,
  dedupeDefaultTitle,
  generateRacerSnapshots,
};
