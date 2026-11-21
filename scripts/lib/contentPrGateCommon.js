/**
 * 記事の PR の関門（contentPrGate.js）と、manifest の関門（contentPrGateManifest.js）が共有する下の部品（純粋関数）。
 * 定数・パスの型・ハッシュ・時刻の形・JPEG の寸法・mdast・内部リンクの数え方。他の contentPrGate の部品を import しない（循環させない）。
 * contentPrGate.js が公開の名前を再 export する
 */
import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

export const MANIFEST_SCHEMA = "content-pr-manifest/v1";
export const REVIEW_ROLES = [
  "content-qa",
  "wording-editor",
  "fan",
  "seo-marketer",
];
export const TRANSLATION_SUFFIX_RE = /-(en|ko|zh-tw)$/;
export const MANIFEST_RE = /^docs\/content-manifests\/([^/]+)\.json$/;
export const JA_JSON_RE = /^src\/data\/blog-posts\/([^/]+)\.json$/;
export const TR_JSON_RE =
  /^src\/data\/blog-posts\/(?:en|ko|zh-TW)\/([^/]+)\.json$/;
// 図の JSON（docs/design/blog-charts/contract.md）。名前は {記事id}-{図id}.json。形は verify-blog-charts.js（CI）が見る
export const CHART_JSON_RE = /^public\/blog-charts\/([^/]+)\.json$/;
export const MD_RE = /^public\/blog\/([^/]+)\.md$/;
// 末尾が Z か ±hh:mm の ISO 8601 だけ受ける
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export const sha256Hex = (data) =>
  createHash("sha256").update(data).digest("hex");

export const toText = (data) =>
  typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);

export const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
export const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * JPEG のヘッダー（SOF）から幅と高さを読む。読めなければ null。
 * PR #1699 の scripts/lib/blogImageDimensions.js の readJpegSize と同じ考え方。
 * #1699 が master に入ったら、そちらに共通化する。
 */
// 長さを持たない単独のマーカー
const isStandaloneMarker = (marker) =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
const isSofMarker = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

// SOF マーカー（位置 i）から幅と高さを読む。0 や足りない長さは null
function readSofSize(b, i) {
  if (i + 8 >= b.length) return null;
  const height = (b[i + 5] << 8) | b[i + 6];
  const width = (b[i + 7] << 8) | b[i + 8];
  return width > 0 && height > 0 ? { width, height } : null;
}

export function readJpegSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // 詰め物の 0xFF
      continue;
    }
    if (isStandaloneMarker(marker)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (isSofMarker(marker)) return readSofSize(b, i);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** files（path→sha256）から content_sha256 を作る。path の昇順、各行 "path\tsha\n" をつないだ UTF-8 の sha256 */
export function computeContentSha256(files) {
  const body = Object.keys(files)
    .sort()
    .map((p) => `${p}\t${files[p]}\n`)
    .join("");
  return sha256Hex(Buffer.from(body, "utf8"));
}

/** 記事の描画（react-markdown + remark-gfm）と同じ GFM で mdast にする */
export const parseMarkdown = (text) =>
  fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

export const walk = (node, fn) => {
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
};

// `//` と `/\`（ブラウザが // と同じに扱う）はプロトコル相対で、外へ出るので数えない
const isInternalUrl = (url) =>
  typeof url === "string" &&
  url.startsWith("/") &&
  !url.startsWith("//") &&
  !url.startsWith("/\\");

/** 内部リンクの本数。link と、定義が内部の linkReference を数える。画像・プロトコル相対（//）は数えない */
export function countInternalLinks(text) {
  const tree = parseMarkdown(text);
  const defs = new Map();
  walk(tree, (n) => {
    if (n.type === "definition") defs.set(n.identifier, n.url);
  });
  let count = 0;
  walk(tree, (n) => {
    if (n.type === "link" && isInternalUrl(n.url)) count += 1;
    if (n.type === "linkReference" && isInternalUrl(defs.get(n.identifier)))
      count += 1;
  });
  return count;
}

/**
 * ISO 8601（末尾が Z か ±hh:mm）で、実在する日時か。Date に直して書いた時差の壁時計の時刻に戻し、
 * 元の文字列と一致することで、2026-02-30 や T24:00 のような繰り上がりを弾く（小数秒は3桁まで）
 */
export const isIso = (v) => {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  const zone = v.match(/(Z|([+-])(\d{2}):(\d{2}))$/);
  const offsetMin =
    zone[1] === "Z"
      ? 0
      : (zone[2] === "-" ? -1 : 1) * (Number(zone[3]) * 60 + Number(zone[4]));
  const wall = new Date(t + offsetMin * 60000).toISOString();
  return wall.startsWith(v.slice(0, v.length - zone[1].length));
};
export const isCount = (v) => Number.isInteger(v) && v >= 0;

/** パスが属する記事の id（.md は翻訳の接尾辞を外す、JSON はファイル名）。記事のファイルでなければ null */
export function articleIdOf(path) {
  const md = path.match(MD_RE);
  if (md) return md[1].replace(TRANSLATION_SUFFIX_RE, "");
  const ja = path.match(JA_JSON_RE);
  if (ja) return ja[1];
  const tr = path.match(TR_JSON_RE);
  return tr ? tr[1] : null;
}
