/**
 * ブログ記事の HTML の許可リスト（src/utils/blogMarkdownSanitize.js）の再現テスト。
 *
 * 1. 記事に紛れた script・iframe・form・base・meta・embed・object・style 属性が、描いた HTML に残らない
 *    （許可リストの無い rehype-raw だけでは残ることも確かめ、テストが空振りしていないことを示す）。
 *    on* 属性・javascript: の URL も残らないこと（修正前から React と react-markdown が落としていた）
 * 2. ブログの図のタグ <ryujin-chart src rows> は残る
 * 3. 既存の全記事（public/blog/*.md）の描画が、許可リストを入れる前と同じ（見た目を変えない）
 *
 * 使い方: node scripts/maintenance/verify-blog-markdown-sanitize.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { blogRehypePlugins } from "../../src/utils/blogMarkdownSanitize.js";

const render = (markdown, rehypePlugins) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], rehypePlugins },
      markdown,
    ),
  );

// leaks: 許可リストの無い rehype-raw だけで描くと残るか（修正前の状態）。
// on* 属性と javascript: の URL は、React（文字列のイベント属性を描かない）と react-markdown の
// urlTransform が修正前から落としていたので false。ここでは二重の守りとして残らないことだけを見る
const ATTACKS = [
  {
    name: "script（スナップショットの HTML に文字で残る）",
    md: "本文\n\n<script>window.__x = 1</script>\n",
    danger: /<script/i,
    leaks: true,
  },
  {
    name: "iframe",
    md: '<iframe src="https://example.com"></iframe>\n',
    danger: /<iframe/i,
    leaks: true,
  },
  {
    name: "form（同じ origin で入力を集める）",
    md: '<form action="https://example.com"><input type="password" name="p"></form>\n',
    danger: /<form|type="password"/i,
    leaks: true,
  },
  {
    name: "base（以降の相対 URL の行き先を変える）",
    md: '<base href="https://example.com/">\n',
    danger: /<base/i,
    leaks: true,
  },
  {
    name: "meta refresh（別のサイトへ飛ばす）",
    md: '<meta http-equiv="refresh" content="0;url=https://example.com">\n',
    danger: /<meta/i,
    leaks: true,
  },
  {
    name: "embed",
    md: '<embed src="x.swf">\n',
    danger: /<embed/i,
    leaks: true,
  },
  {
    name: "object",
    md: '<object data="x.swf"></object>\n',
    danger: /<object/i,
    leaks: true,
  },
  {
    name: "style 属性（画面を覆う）",
    md: '<p style="position:fixed;inset:0">x</p>\n',
    danger: /style=/i,
    leaks: true,
  },
  {
    name: "img の onerror",
    md: '<img src="x" onerror="alert(1)">\n',
    danger: /onerror/i,
    leaks: false,
  },
  {
    name: "javascript: の href（HTML）",
    md: '<a href="javascript:alert(1)">x</a>\n',
    danger: /javascript:/i,
    leaks: false,
  },
  {
    name: "javascript: の href（Markdown）",
    md: "[x](javascript:alert(1))\n",
    danger: /javascript:/i,
    leaks: false,
  },
];

for (const { name, md, danger, leaks } of ATTACKS) {
  test(`${name} は描いた HTML に残らない`, () => {
    // 修正前に残るものは、許可リストが無いと残ることも確かめる（検査の空振りを防ぐ）
    if (leaks) assert.match(render(md, [rehypeRaw]), danger);
    assert.doesNotMatch(render(md, blogRehypePlugins), danger);
  });
}

test("ブログの図のタグは src・rows とともに残り、ほかの属性は落ちる", () => {
  const html = render(
    '本文\n\n<ryujin-chart src="/blog-charts/a.json" rows="6" onclick="x()"></ryujin-chart>\n\n次\n',
    blogRehypePlugins,
  );
  assert.match(html, /<ryujin-chart[^>]*src="\/blog-charts\/a.json"/);
  assert.match(html, /<ryujin-chart[^>]*rows="6"/);
  assert.doesNotMatch(html, /onclick/);
});

test("既存の全記事の描画は、許可リストを入れる前と同じ", async () => {
  const dir = new URL("../../public/blog/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  assert.ok(files.length > 100, `記事が見つからない（${files.length}件）`);
  const changed = [];
  for (const f of files) {
    const md = await readFile(new URL(f, dir), "utf8");
    if (render(md, [rehypeRaw]) !== render(md, blogRehypePlugins))
      changed.push(f);
  }
  assert.deepEqual(changed, [], `描画が変わった記事: ${changed.join(", ")}`);
});
