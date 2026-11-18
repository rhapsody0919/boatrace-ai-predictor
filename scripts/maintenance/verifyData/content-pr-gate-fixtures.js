/**
 * verify-content-pr-gate.js の入力（記事の PR の写しの部品）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const config = JSON.parse(
  readFileSync(join(ROOT, "scripts/content/content-pr-gate.json"), "utf8"),
);

// 幅200・高さ100 の最小の JPEG ヘッダー（APP0 → SOF0）
export const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x00, 0x64, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01,
]);
export const enc = (s) => new TextEncoder().encode(s);

export const ID = "sample-guide";
export const MD = `public/blog/${ID}.md`;
export const MD_EN = `public/blog/${ID}-en.md`;
export const JSON_JA = `src/data/blog-posts/${ID}.json`;
export const IMG = "public/images/blog/sample-guide-ja.jpg";
export const MANIFEST = `docs/content-manifests/${ID}.json`;

export const baseMd = `# サンプル\n\n本文。[会場ガイド](/venues) を見る。\n\n![図](/images/blog/sample-guide-ja.jpg)\n`;
export const baseMdEn = `# Sample\n\nSee [venues](/en/venues).\n`;
export const baseJson = {
  id: ID,
  title: "サンプルの記事",
  description: "説明",
  date: "2026-10-20",
  featured: false,
  image: "/images/blog/sample-guide-ja.jpg",
};
