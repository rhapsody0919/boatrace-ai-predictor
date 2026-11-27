/**
 * ブログ一覧の絞り込み（src/pure/blogListFilter.js）が、分類と「記事を探す」欄の語で正しく記事を残すことを守る。
 *
 * 1. 分類「all」と空の語は全件を残す
 * 2. 分類で絞る
 * 3. 語は題・説明・分類・タグのどれかに入れば残り、空白（全角も）で区切った全ての語を満たす記事だけ残す
 * 4. 英字は大文字と小文字を区別しない
 * 5. 分類の件数を数え、件数の多い順に並べる
 * 6. 今の ja の記事で「多摩川」を探すと、題に多摩川を含む記事が全て残る（一覧の欄の実用の確かめ）
 *
 * 使い方: node scripts/maintenance/verify-blog-list-filter.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { countCategories, filterBlogPosts } from "../../src/pure/blogListFilter.js";
import { getPostsForLang } from "../../src/data/blogPosts.js";

const POSTS = [
  {
    id: "a",
    title: "多摩川の水面と風",
    description: "追い風の逃げ",
    category: "場別攻略",
    tags: ["多摩川", "風"],
  },
  {
    id: "b",
    title: "決まり手データの見方",
    description: "江戸川の1号艇",
    category: "データ分析",
    tags: ["決まり手"],
  },
  {
    id: "c",
    title: "AI予想は当たるのか",
    description: "15,000レース",
    category: "データ分析",
    tags: ["AI予想"],
  },
];
const ids = (posts) => posts.map((p) => p.id);

test("分類 all と空の語は全件を残す", () => {
  assert.deepEqual(ids(filterBlogPosts(POSTS, { category: "all", query: "  " })), ["a", "b", "c"]);
  assert.deepEqual(ids(filterBlogPosts(POSTS)), ["a", "b", "c"]);
});

test("分類で絞る", () => {
  assert.deepEqual(ids(filterBlogPosts(POSTS, { category: "データ分析" })), ["b", "c"]);
});

test("語は題・説明・分類・タグを見て、全ての語を満たす記事だけ残す", () => {
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "江戸川" })), ["b"]);
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "場別攻略" })), ["a"]);
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "風" })), ["a"]);
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "多摩川　逃げ" })), ["a"]);
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "多摩川 決まり手" })), []);
  assert.deepEqual(ids(filterBlogPosts(POSTS, { category: "データ分析", query: "多摩川" })), []);
});

test("英字は大文字と小文字を区別しない", () => {
  assert.deepEqual(ids(filterBlogPosts(POSTS, { query: "ai予想" })), ["c"]);
});

test("今の ja の記事で「多摩川」を探すと、題に多摩川を含む記事が全て残る", () => {
  const posts = getPostsForLang("ja");
  const expected = posts.filter((p) => p.title.includes("多摩川")).map((p) => p.id);
  assert.ok(expected.length > 0, "題に多摩川を含む記事が無い。記事の置き場が変わったか");
  const found = ids(filterBlogPosts(posts, { query: "多摩川" }));
  for (const id of expected) assert.ok(found.includes(id), `${id} が残らない`);
});

test("分類の件数を数え、件数の多い順に並べる", () => {
  const { categoryCounts, categories } = countCategories(POSTS);
  assert.deepEqual(categoryCounts, { 場別攻略: 1, データ分析: 2 });
  assert.deepEqual(categories, ["データ分析", "場別攻略"]);
});
