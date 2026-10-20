/**
 * 記事の Markdown にある図（<ryujin-chart src>）の JSON を、本文を描く前にまとめて取る。
 *
 * 本文を描いた後に図が JSON を取りに行くと、読み込みの前後で図の高さが変わり、下の段落が動く（CLS）。
 * 高さを文字数から見積もる方法は、見積もる項目（題・答え・札・注記・出典・選択肢の名前）が多く、
 * 2回のレビューで2回とも漏れが見つかった（docs/design/blog-charts/contract.md 6節）。
 * そこで本文と図を同じ描画で出す。図ごとの失敗は握りつぶさず { error } として返し、部品が失敗を表示する。
 */
import { validateBlogChart } from "./blogChartContract";

const SRC_RE = /<ryujin-chart\s[^>]*\bsrc="(\/blog-charts\/[a-z0-9-]+\.json)"/g;

async function loadOne(src) {
  try {
    const res = await fetch(src);
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
  const srcs = [...new Set([...markdown.matchAll(SRC_RE)].map((m) => m[1]))];
  const results = await Promise.all(srcs.map(loadOne));
  return new Map(srcs.map((src, i) => [src, results[i]]));
}
