/**
 * verify-blog-image-dimensions.js - ブログ画像の実寸をヘッダーから読む処理（scripts/lib/blogImageDimensions.js、BOA-908）の検証。
 *
 * 確認する観点:
 *   1. JPEG のヘッダー（SOF0・SOF2）から幅と高さを読み、DHT（C4）を SOF と取り違えない。JPEG でない・壊れたものは null
 *   2. public/images/blog の JPEG が全部読める（読めない画像があればビルドを落とす作り）
 *   3. 手で書いていた表（src/data/blogImageDimensions.js、BOA-908 で削除）の値と、ヘッダーから読んだ値が一致する（抜き取り）
 *   4. 記事の本文（public/blog/*.md）と JSON の image が参照する /images/blog/ の画像が、すべて表にある
 *      （表に無いと width/height が付かず、CLS が戻る）
 *   5. vite.config.js が仮想モジュールを用意し、BlogPost.jsx がそれを読む
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildImageDimensions,
  readJpegSize,
} from "../lib/blogImageDimensions.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// 1. 合成した JPEG のヘッダー
const seg = (marker, body) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
];
const sof = (marker, width, height) =>
  seg(marker, [
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    1,
    0x11,
    0,
  ]);
const jpeg = (...segments) =>
  Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);

assert.deepEqual(
  readJpegSize(
    jpeg(seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), sof(0xc0, 1200, 630)),
  ),
  { width: 1200, height: 630 },
  "SOF0（baseline）の幅と高さ",
);
assert.deepEqual(
  readJpegSize(jpeg(seg(0xc4, [0, 1, 2, 3, 4, 5, 6, 7]), sof(0xc2, 576, 391))),
  { width: 576, height: 391 },
  "DHT（C4）を飛ばして SOF2（progressive）を読む",
);
assert.equal(
  readJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
  null,
  "PNG は null",
);
assert.equal(
  readJpegSize(Uint8Array.from([0xff, 0xd8, 0x00])),
  null,
  "壊れた JPEG は null",
);

// 2. 実際の画像が全部読める
const DIMS = buildImageDimensions(
  path.join(ROOT, "public/images/blog"),
  "/images/blog/",
);
const count = Object.keys(DIMS).length;
assert.ok(count > 0, "public/images/blog に JPEG がある");

// 3. 以前の手書きの表と同じ値（抜き取り。比率がいろいろな画像を選ぶ）
const KNOWN = {
  "/images/blog/ai-index-reading-guide.jpg": { width: 1200, height: 630 },
  "/images/blog/10000-races-hitrate-en.jpg": { width: 1000, height: 300 },
  "/images/blog/top-start-chart.jpg": { width: 968, height: 750 },
  "/images/blog/assist-axis.jpg": { width: 461, height: 203 },
  "/images/blog/venue-visit-timeline-ja.jpg": { width: 1000, height: 956 },
  "/images/blog/amagasaki-water-wind-guide.jpg": { width: 576, height: 391 },
};
for (const [url, size] of Object.entries(KNOWN)) {
  assert.deepEqual(DIMS[url], size, `${url} の寸法`);
}

// 4. 記事が参照する画像がすべて表にある
const referenced = new Set();
const mdDir = path.join(ROOT, "public/blog");
for (const name of fs.readdirSync(mdDir).filter((f) => f.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(mdDir, name), "utf8");
  for (const m of text.matchAll(/\((\/images\/blog\/[^)\s]+\.jpe?g)\)/gi)) {
    referenced.add(m[1]);
  }
}
const postsDir = path.join(ROOT, "src/data/blog-posts");
const jsonFiles = [
  ...fs.readdirSync(postsDir).filter((f) => f.endsWith(".json")),
  ...["en", "ko", "zh-TW"].flatMap((lang) =>
    fs
      .readdirSync(path.join(postsDir, lang))
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(lang, f)),
  ),
];
for (const file of jsonFiles) {
  const { image } = JSON.parse(
    fs.readFileSync(path.join(postsDir, file), "utf8"),
  );
  if (typeof image === "string" && image.startsWith("/images/blog/"))
    referenced.add(image);
}
const missing = [...referenced].filter((url) => !DIMS[url]);
assert.deepEqual(
  missing,
  [],
  "記事が参照する /images/blog/ の画像は、すべて寸法の表にある",
);

// 5. 画面への渡し方
const viteConfig = fs.readFileSync(path.join(ROOT, "vite.config.js"), "utf8");
assert.match(
  viteConfig,
  /virtual:blog-image-dimensions/,
  "vite.config.js が仮想モジュールを用意する",
);
assert.match(
  viteConfig,
  /buildImageDimensions\(/,
  "vite.config.js が画像のヘッダーから表を作る",
);
const blogPost = fs.readFileSync(
  path.join(ROOT, "src/pages/BlogPost.jsx"),
  "utf8",
);
assert.match(
  blogPost,
  /from "virtual:blog-image-dimensions"/,
  "BlogPost.jsx が仮想モジュールの表を読む",
);

console.log(
  `✅ verify-blog-image-dimensions: 画像 ${count} 枚の寸法、記事が参照する ${referenced.size} 枚、合成した JPEG の読み方を確認`,
);
