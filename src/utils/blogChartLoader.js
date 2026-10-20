/**
 * 記事の Markdown にある図（<ryujin-chart src>）の JSON を、本文を描く前にまとめて取る。
 *
 * 本文を描いた後に図が JSON を取りに行くと、読み込みの前後で図の高さが変わり、下の段落が動く（CLS）。
 * 高さを文字数から見積もる方法は、見積もる項目（題・答え・札・注記・出典・選択肢の名前）が多く、
 * 2回のレビューで2回とも漏れが見つかった（docs/design/blog-charts/contract.md 6節）。
 * そこで本文と図を同じ描画で出す。図ごとの失敗は握りつぶさず { error } として返し、部品が失敗を表示する。
 */
import { validateBlogChart } from "./blogChartContract";

/** 図の行（scripts/maintenance/verify-blog-charts.js と同じ形。行頭から1行で書いたものだけ） */
const LINE_RE =
  /^<ryujin-chart src="(\/blog-charts\/[a-z0-9-]+\.json)" rows="\d{1,2}"><\/ryujin-chart>$/;
/** 図の JSON を待つ上限。返らないときに記事の本文まで出なくなるのを防ぐ */
const TIMEOUT_MS = 8000;

/** コードブロック（``` ・~~~・4字下げ）の中を除いた、図の行の src */
function chartSrcs(markdown) {
  const srcs = new Set();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(LINE_RE);
    if (m) srcs.add(m[1]);
  }
  return [...srcs];
}

async function loadOne(src) {
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok)
      throw new Error(`図のデータの取得に失敗（${res.status}）: ${src}`);
    const chart = await res.json();
    const errors = validateBlogChart(chart);
    if (errors.length > 0) {
      throw new Error(
        `図のデータが契約に合わない: ${src}\n${errors.map((e) => `${e.path}: ${e.message}`).join("\n")}`,
      );
    }
    return { chart };
  } catch (error) {
    console.error(error);
    return { error };
  }
}

/**
 * @param {string} markdown 記事の本文
 * @returns {Promise<Map<string, { chart: object } | { error: Error }>>} src ごとの結果（図が無ければ空）
 */
export async function loadBlogCharts(markdown) {
  const srcs = chartSrcs(markdown);
  const results = await Promise.all(srcs.map(loadOne));
  return new Map(srcs.map((src, i) => [src, results[i]]));
}
