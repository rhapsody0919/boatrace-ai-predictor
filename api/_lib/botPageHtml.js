// botPage.js から字のまま移した、bot 向けページの HTML の小さな部品（エスケープ・リンク・一覧・AI 紹介・ブログ欄）。副作用なし
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const span = (text) => (text ? ` <span>${escapeHtml(text)}</span>` : "");

export const link = (href, text) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
const listOf = (tag, items) =>
  `<${tag}>\n${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("\n")}\n</${tag}>`;

// 人のトップの HomeAiIntro と同じ並び（見出し → 紹介文 → 2つの確かめ方 → 成績ページへのリンク → よくある質問）
export function aiIntroHtml(a) {
  const tools = a.tools.map(
    (tool) =>
      `<div>\n<p>${escapeHtml(tool.name)}</p>\n<p>${escapeHtml(tool.where)}</p>\n${listOf("ul", tool.questions)}\n</div>`,
  );
  // 人の画面と同じ <details>。人の画面は閉じている（答えは DOM にある）。ボット向けは開いた形で出す
  const faq = a.faqItems.map(
    ({ question, answer }) =>
      `<details open>\n<summary>${escapeHtml(question)}</summary>\n<p>${escapeHtml(answer)}</p>\n</details>`,
  );
  return [
    "<section>",
    `<h2>${escapeHtml(a.title)}</h2>`,
    ...a.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    "<div>",
    `<h3>${escapeHtml(a.checkTitle)}</h3>`,
    ...tools,
    listOf("ol", a.steps),
    `<p>${link(a.venuesLink.href, a.venuesLink.text)}</p>`,
    `<p>${escapeHtml(a.note)}</p>`,
    "</div>",
    `<ul>\n${a.links.map((l) => `<li>${link(l.href, l.text)}</li>`).join("\n")}\n</ul>`,
    "<div>",
    `<h3>${escapeHtml(a.faqTitle)}</h3>`,
    ...faq,
    "</div>",
    "</section>",
  ].join("\n");
}

// 人のトップのブログ欄と同じ並び（見出し → 説明 → 注目記事 → 新着記事 → 一覧へのリンク）
export function blogHtml(b) {
  const card = (post) =>
    `<li><a href="${escapeHtml(post.href)}"><span>${escapeHtml(post.category)}</span> <h3>${escapeHtml(post.title)}</h3> <p>${escapeHtml(post.description)}</p> <span>${escapeHtml(post.readTime)}</span></a></li>`;
  return [
    "<section>",
    `<h2>${escapeHtml(b.title)}</h2>`,
    `<p>${escapeHtml(b.lead)}</p>`,
    ...b.groups.flatMap((g) => [
      `<h3>${escapeHtml(g.heading)}</h3>`,
      `<ul>\n${g.posts.map(card).join("\n")}\n</ul>`,
    ]),
    `<p>${link(b.allPostsLink.href, b.allPostsLink.text)}</p>`,
    "</section>",
  ].join("\n");
}
