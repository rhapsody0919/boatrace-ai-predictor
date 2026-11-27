/**
 * ブログ一覧の絞り込み（分類と、記事を探す欄の語）。画面に依らない純関数。
 * 語は空白で区切り、全ての語が題・説明・分類・タグのどれかに入る記事を残す（大文字と小文字は区別しない）。
 */
export function filterBlogPosts(posts, { category = "all", query = "" } = {}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return posts.filter((post) => {
    if (category !== "all" && post.category !== category) return false;
    if (words.length === 0) return true;
    const haystack = [
      post.title,
      post.description,
      post.category,
      ...(post.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
