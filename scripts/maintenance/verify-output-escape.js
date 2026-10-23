/** BOA-920: XML と llms.txt の出力境界の再現検査。台帳登録は取り込み側で行う。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderUrlEntry } from "../lib/sitemapLastmod.js";

const options = { lastmod: null, changefreq: "monthly", priority: "0.5" };
const special = `&<>"'`;
const xml = renderUrlEntry(`https://x/?a=1&b=2`, {
  ...options,
  loc: `/blog/${special}`,
  alternates: [{ hreflang: "ja", href: `https://x/blog/${special}` }],
});
assert.ok(xml.includes("<loc>https://x/?a=1&amp;b=2/blog/&amp;&lt;&gt;&quot;&apos;</loc>"));
const document = new JSDOM(
  `<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">${xml}</urlset>`,
  { contentType: "text/xml" },
).window.document;
assert.equal(document.querySelector("loc").textContent, `https://x/?a=1&b=2/blog/${special}`);
assert.equal(document.getElementsByTagName("xhtml:link")[0].getAttribute("href"), `https://x/blog/${special}`);
assert.throws(() => new JSDOM("<urlset><loc>a&b</loc></urlset>", { contentType: "text/xml" }));
assert.equal(renderUrlEntry("https://x", { ...options, loc: "/blog/normal-slug" }),
  '  <url>\n    <loc>https://x/blog/normal-slug</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n');

// import による生成物の書き換えも禁止する。
const outputPath = new URL("../../public/llms.txt", import.meta.url);
const before = readFileSync(outputPath, "utf8");
const { buildLlmsTxt } = await import("../generate-llms-txt.js");
assert.equal(readFileSync(outputPath, "utf8"), before);
const { escapeXml, sanitizeLlmsLinkText } = await import("../lib/outputEscape.js");
assert.equal(escapeXml(special), "&amp;&lt;&gt;&quot;&apos;");
assert.equal(sanitizeLlmsLinkText("a\r\n\t\u0000\u0085\u2028\u2029b"), "a b");
const title = "題[名]\\\r\n- [別](https://evil)";
const description = "説明\n\n- [注入](https://evil) <tag> &末尾";
const id = "a&<>\"'\n[]\\)(/bad";
const result = buildLlmsTxt([{ title, description, id, date: "2026-01-01" }]);
const blogLines = result.split("## ブログ記事\n\n")[1].trimEnd().split("\n");
assert.equal(blogLines.length, 1);
assert.equal(blogLines[0],
  '- [題\\[名\\]\\\\ - \\[別\\](https://evil)](https://www.boat-ai.jp/blog/a%26%3C%3E%22%27%0A%5B%5D%5C%29%28%2Fbad): 説明 - \\[注入\\](https://evil) &lt;tag&gt; &amp;末尾');
const normal = { title: "通常の記事", description: "通常の説明", id: "normal-slug", date: "2026-01-01" };
assert.ok(buildLlmsTxt([normal]).includes(`- [${normal.title}](https://www.boat-ai.jp/blog/${normal.id}): ${normal.description}\n`));
console.log("✅ XML と llms.txt の出力エスケープを確認");
