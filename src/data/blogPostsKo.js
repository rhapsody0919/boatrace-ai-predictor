/**
 * ブログ記事の韓国語版メタデータ。1記事1つの JSON（src/data/blog-posts/ko/{id}.json）に置く（BOA-908）。
 * 本文は public/blog/{id}-ko.md、日本語版メタデータは src/data/blog-posts/{id}.json の同じ id と対応する。
 * 翻訳不要なフィールド（date 等）は日本語版の値を使うので持たない。image は図の文言が言語ごとに違う記事だけ持つ。
 * 新しい翻訳は JSON を1つ足すだけでよく、このファイルは触らない（記事の PR が .md・.json・画像だけで済むように）。
 * 詳細: docs/design/blog-i18n/spec.md、docs/adr/0006-blog-english-metadata-storage.md
 */
import { byId, readJsonDirInNode } from "./blogPostFiles.js";

const postFiles = import.meta.env
  ? import.meta.glob("./blog-posts/ko/*.json", {
      eager: true,
      import: "default",
    })
  : // 画面のバンドルでは通らない分岐（Vite が実行時解決の警告を出さないよう無視させる）
    readJsonDirInNode(
      new URL(/* @vite-ignore */ "./blog-posts/ko/", import.meta.url),
    );

export const blogPostsKo = Object.values(postFiles).sort(byId);

export function getKoreanOverride(id) {
  return blogPostsKo.find((post) => post.id === id);
}

export function isKoreanAvailable(id) {
  return blogPostsKo.some((post) => post.id === id);
}
