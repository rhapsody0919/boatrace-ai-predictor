/**
 * ブログの図の PNG の書き出し（ADR 0099、docs/design/blog-charts/contract.md 8節）の固定の一覧と名前。依存なし・純粋。
 *
 * 使う側: scripts/lib/blogChartPng.js（ビルドで撮る）、scripts/content/blog-chart-png-digest.js（本番の URL を確かめる）、
 * src/components/blog/BlogChart.css（[data-chart-export] の見た目。寸法の CSS の値はここと同じにする）。
 * サイズは JSON からは変えられない（作り手が選ぶのは図の中身だけ）。
 */

/**
 * 大きさの固定の一覧。CSS の幅×高さ（BlogChart.css の [data-chart-export] で組む）を scale 倍で撮り、出来上がりの画素にする。
 * - portrait: 1080×1350（X の 4:5。既存の企画画像と同じ、docs/operation/sns-pipeline-x.md）。CSS 400 は X の画像
 *   （api/_lib/snsHeadless.js の 390 幅）と字の見え方をそろえるため
 * - landscape: 1280×720（16:9、2段組み）。スマホの X では字が小さすぎるので note・PC 向け
 * 足すときは BlogChart.css の [data-chart-export="…"] も足す。JSON からは変えられない
 */
export const BLOG_CHART_PNG_PRESETS = Object.freeze({
  portrait: Object.freeze({ cssWidth: 400, cssHeight: 500, scale: 2.7 }),
  landscape: Object.freeze({ cssWidth: 640, cssHeight: 360, scale: 2 }),
});

/** 出来上がりの画素 */
export const blogChartPngSize = ({ cssWidth, cssHeight, scale }) => ({
  width: Math.round(cssWidth * scale),
  height: Math.round(cssHeight * scale),
});

/** 画像の下端に入れる出所の1行（ロゴの絵は入れない。docs/design/blog-charts/fan-panel-png-v1.md） */
export const BLOG_CHART_PNG_CREDIT = Object.freeze({
  name: "龍神レーダー",
  site: "boat-ai.jp",
});

/** 配信の URL のパス。chartId は JSON の id（= {記事id}-{図id}） */
export const blogChartPngPath = (chartId, preset) =>
  `/blog-charts/${chartId}.${preset}.png`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 本番の URL の返事が PNG か。無い PNG は rewrite で 200 の index.html が返るので、status では判定できない。
 * content-type と先頭8バイトの両方で見る
 * @param {string|null} contentType
 * @param {Uint8Array} head 先頭のバイト（8バイト以上）
 */
export function isPngResponse(contentType, head) {
  if (!/^image\/png\b/i.test(contentType ?? "")) return false;
  if (!head || head.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => head[i] === b);
}
