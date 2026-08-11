/**
 * ブログ記事の繁體中文版メタデータ。
 * 本文は public/blog/{id}-zh-tw.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date/image 等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使う想定のため持たない。
 * 詳細: docs/design/blog-i18n/spec.md「拡張: zh-TW版」, docs/adr/0008-blog-multilingual-partial-translation.md
 */
export const blogPostsZhTw = [];

export function getZhTwOverride(id) {
  return blogPostsZhTw.find((post) => post.id === id);
}

export function isZhTwAvailable(id) {
  return blogPostsZhTw.some((post) => post.id === id);
}
