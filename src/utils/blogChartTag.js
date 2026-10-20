/**
 * ブログの図のタグ <ryujin-chart src="/blog-charts/<name>.json" rows="N"></ryujin-chart> の形の正本。
 * 依存なし・純粋。使う側: src/utils/blogMarkdownSanitize.js（描画の許可リスト）、
 * scripts/lib/contentPrGate.js（記事の PR の関門）、図の部品と verify-blog-charts.js（PR #1703）。
 */
export const BLOG_CHART_TAG = "ryujin-chart";
export const BLOG_CHART_SRC_RE = /^\/blog-charts\/[a-z0-9-]+\.json$/;
export const BLOG_CHART_ROWS_RE = /^\d{1,2}$/;
export const BLOG_CHART_ROWS_MAX = 12;

const LINE_RE = new RegExp(
  `^<${BLOG_CHART_TAG}((?:\\s+[a-z]+="[^"]*")+)\\s*></${BLOG_CHART_TAG}>$`,
);
const ATTR_RE = /\s+([a-z]+)="([^"]*)"/g;

/**
 * 図のタグだけの1行を読む。形に合えば { src, rows }、違えば null。
 * 属性は src と rows がちょうど1つずつ（順不同、二重引用符）。閉じタグ必須（/> は不可）。rows は 1〜12。
 */
export function parseBlogChartLine(line) {
  const m = typeof line === "string" ? line.match(LINE_RE) : null;
  if (!m) return null;
  const attrs = [...m[1].matchAll(ATTR_RE)].map(([, k, v]) => [k, v]);
  const keys = attrs.map(([k]) => k).sort();
  if (keys.length !== 2 || keys[0] !== "rows" || keys[1] !== "src") return null;
  const { src, rows } = Object.fromEntries(attrs);
  if (!BLOG_CHART_SRC_RE.test(src) || !BLOG_CHART_ROWS_RE.test(rows)) return null;
  const n = Number(rows);
  if (n < 1 || n > BLOG_CHART_ROWS_MAX) return null;
  return { src, rows: n };
}
