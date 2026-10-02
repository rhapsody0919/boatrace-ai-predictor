#!/usr/bin/env node
/**
 * ブログ記事メタデータ（src/data/blog-posts/{id}.json、BOA-247）の形を検証する。DB接続は不要。
 *
 * 1記事1ファイルにしたことで、記事を足すPRは JSON を1つ足すだけになった。その代わり、
 * 配列リテラルなら構文エラーで気づけた崩れ（必須項目の欠落・id とファイル名の食い違い・
 * featured の並び順の重複）が黙って通るので、ここで止める。
 *
 *   1. ファイル名が「{id}.json」と一致する
 *   2. 必須項目（id・title・description・date・category・tags・readTime・featured）が揃い、型が合う
 *   3. public/blog/{id}.md が存在する（URL だけあって本文が無い記事を作らない）
 *   4. featured の記事は featuredRank（正の整数）を持ち、重複しない。featured でない記事は持たない
 *   5. blogPosts.js（Node 側の読み込み）が全ファイルを読み、日付の新しい順・同日は id 順で返す
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const POSTS_DIR = path.join(ROOT, "src/data/blog-posts");
const MD_DIR = path.join(ROOT, "public/blog");

const errors = [];
const fail = (msg) => errors.push(msg);

const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".json"));
const posts = [];
for (const file of files) {
  let post;
  try {
    post = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, file), "utf8"));
  } catch (err) {
    fail(`${file}: JSON として読めない（${err.message}）`);
    continue;
  }
  posts.push(post);
  if (`${post.id}.json` !== file)
    fail(`${file}: id（${post.id}）とファイル名が違う`);
  for (const key of [
    "id",
    "title",
    "description",
    "date",
    "category",
    "readTime",
  ]) {
    if (typeof post[key] !== "string" || post[key] === "")
      fail(`${file}: ${key} が空か文字列でない`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date ?? ""))
    fail(`${file}: date が YYYY-MM-DD でない（${post.date}）`);
  if (!Array.isArray(post.tags)) fail(`${file}: tags が配列でない`);
  if (typeof post.featured !== "boolean")
    fail(`${file}: featured が真偽値でない`);
  if (!fs.existsSync(path.join(MD_DIR, `${post.id}.md`)))
    fail(`${file}: public/blog/${post.id}.md が無い`);
  if (post.featured) {
    if (!Number.isInteger(post.featuredRank) || post.featuredRank < 1)
      fail(`${file}: featured なのに featuredRank（正の整数）が無い`);
  } else if (post.featuredRank !== undefined) {
    fail(`${file}: featured でないのに featuredRank がある`);
  }
}

const rankOwners = new Map();
for (const post of posts.filter((p) => p.featured)) {
  const owner = rankOwners.get(post.featuredRank);
  if (owner)
    fail(`featuredRank ${post.featuredRank} が ${owner} と ${post.id} で重複`);
  rankOwners.set(post.featuredRank, post.id);
}

const { blogPosts } = await import("../../src/data/blogPosts.js");
if (blogPosts.length !== files.length)
  fail(
    `blogPosts.js が ${blogPosts.length} 件しか返さない（ファイルは ${files.length} 件）`,
  );
for (let i = 1; i < blogPosts.length; i++) {
  const [a, b] = [blogPosts[i - 1], blogPosts[i]];
  if (a.date < b.date || (a.date === b.date && a.id > b.id)) {
    fail(
      `blogPosts の並びが崩れている: ${a.id}（${a.date}）→ ${b.id}（${b.date}）`,
    );
    break;
  }
}

if (errors.length > 0) {
  console.error(`❌ ブログ記事メタデータの検証に失敗（${errors.length}件）`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `✅ ブログ記事メタデータ ${files.length} 件（featured ${rankOwners.size} 件）を検証した`,
);
