/** BOA-919: 本文の先頭 h1 だけを除き、目次・FAQ・残りの本文を保持する。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripBlogLeadingH1 } from "../../src/utils/blogLeadingH1.js";
import { extractFaqItems } from "../../src/utils/blogFaqSchema.js";
import { blogRehypePlugins } from "../../src/utils/blogMarkdownSanitize.js";

const render = (markdown) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], rehypePlugins: blogRehypePlugins },
      markdown,
    ),
  );

test("先頭の h1 と空行だけを除く（BOM・CRLF・末尾改行なしも含む）", () => {
  for (const [input, expected] of [
    ["# 題\n\n本文", "本文"],
    ["\n \t\n# 題\n\n本文", "本文"],
    ["\uFEFF\n# 題\n\n本文", "本文"],
    ["\uFEFF# 題\r\n\r\n本文\r\n", "本文\r\n"],
    ["# 題", ""],
    ["# 題\n本文\n\n# 2つ目\n", "本文\n\n# 2つ目\n"],
    ["# 題\n\n    コードの字下げ", "    コードの字下げ"],
  ]) assert.equal(stripBlogLeadingH1(input), expected);
});

test("先頭が h1 でなければ文字列を変えない", () => {
  for (const input of [
    "",
    "本文\n\n# 後の見出し",
    "## 題\n\n本文",
    "### 題\n",
    "\uFEFF\n## 題\n",
    "\n本文\n",
    "#題\n",
    "```md\n# コード\n```",
  ]) assert.equal(stripBlogLeadingH1(input), input);
});

test("全記事で先頭 h1 以外の描画・h2/h3 の順序・FAQ が同じ", () => {
  const dir = new URL("../../public/blog/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const original = readFileSync(new URL(name, dir), "utf8");
    const stripped = stripBlogLeadingH1(original);
    assert.notEqual(stripped, original, `${name}: 先頭 h1 が除かれる`);
    const before = render(original);
    const after = render(stripped);
    assert.match(before, /^(?:<link[^>]*\/>)*<h1[ >]/, name);
    // 2つ目以降の h1・図のタグ・本文も含め、先頭見出し以外の描画を保つ。
    assert.equal(
      after,
      before.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>\n?/, ""),
      name,
    );
    assert.deepEqual(
      after.match(/<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/g),
      before.match(/<h[23]\b[^>]*>[\s\S]*?<\/h[23]>/g),
      `${name}: toc-heading の対象と順序`,
    );
    assert.deepEqual(extractFaqItems(stripped), extractFaqItems(original), name);
  }
  console.log(`全 ${files.length} 記事を照合`);
});

test("BlogPost は ReactMarkdown の入力だけを処理し、FAQ は元の content を読む", () => {
  const source = readFileSync(
    new URL("../../src/pages/BlogPost.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /\{stripBlogLeadingH1\(content\)\}\s*<\/ReactMarkdown>/);
  assert.match(source, /extractFaqItems\(content\)/);
  assert.equal((source.match(/stripBlogLeadingH1\(content\)/g) || []).length, 1);
});
