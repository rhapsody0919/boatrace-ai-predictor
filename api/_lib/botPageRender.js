// botPage.js から字のまま移した、bot 向けページの HTML 文書の組み立て（文書の殻・トップ・会場・JSON-LD の script の字）。副作用なし

import {
  DEFAULT_LANGUAGE,
  getHreflangAlternates,
} from "../../src/config/languages.js";
import {
  isValidCrumbs,
  toBreadcrumbListLd,
} from "../../src/utils/breadcrumbLd.js";
import {
  aiIntroHtml,
  blogHtml,
  escapeHtml,
  link,
  span,
  upcomingDeadlineHtml,
} from "./botPageHtml.js";

// 人のページの HreflangTags と同じ（hreflang の URL は本番のドメインで出す）
const SITE_ORIGIN = "https://www.boat-ai.jp";
// 人の index.html と同じ共通のカード画像。
const OGP_IMAGE_URL = "https://www.boat-ai.jp/ogp-image.png";

/** 人のページ（index.html）と同じ robots。verify で index.html と一致することを確かめる */
export const ROBOTS =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

// ---- JSON-LD ----

/**
 * JSON-LD の値を <script> の中身の文字列にする。値に "</script>" 等があっても要素が閉じないよう、
 * < > & と U+2028・U+2029 を \uXXXX にする（JSON として読んだ値は変わらない）
 */
export function jsonLdScriptText(value) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

// ---- HTML ----

/**
 * @param {{title: string, description: string, canonical: string}} meta
 * @param {string} bodyHtml
 * @param {{path: string, lang: string, jsonLd: object[]}} extras - path は hreflang を組むパス（言語プレフィックスなし）、
 *   lang は html の lang、jsonLd は人のページと同じ JSON-LD
 */
export function documentHtml(meta, bodyHtml, { path, lang, jsonLd }) {
  const headExtras = [
    ...getHreflangAlternates(path, SITE_ORIGIN).map(
      ({ hreflang, href }) =>
        `<link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}">`,
    ),
    ...jsonLd.map(
      (ld) =>
        `<script type="application/ld+json">${jsonLdScriptText(ld)}</script>`,
    ),
  ];
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
<meta name="robots" content="${escapeHtml(ROBOTS)}">
<link rel="canonical" href="${escapeHtml(meta.canonical)}">
<meta property="og:type" content="${escapeHtml("website")}">
<meta property="og:site_name" content="${escapeHtml("龍神レーダー")}">
<meta property="og:title" content="${escapeHtml(meta.title)}">
<meta property="og:description" content="${escapeHtml(meta.description)}">
<meta property="og:url" content="${escapeHtml(meta.canonical)}">
<meta property="og:image" content="${escapeHtml(OGP_IMAGE_URL)}">
<meta name="twitter:card" content="${escapeHtml("summary_large_image")}">
<meta name="twitter:title" content="${escapeHtml(meta.title)}">
<meta name="twitter:description" content="${escapeHtml(meta.description)}">
<meta name="twitter:image" content="${escapeHtml(OGP_IMAGE_URL)}">
${headExtras.join("\n")}
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

/**
 * @param {ReturnType<typeof buildTopModel>} model
 * @param {{siteJsonLd?: object[]}} [options] - index.html の共通の JSON-LD（getSiteJsonLd）
 */
export function renderTopHtml(model, { siteJsonLd = [] } = {}) {
  const items = model.venues.map((v) =>
    v.isOpen
      ? `<li><a href="${escapeHtml(v.href)}">${escapeHtml(v.name)}</a>${span(v.seriesDayLabel)}${span(v.gradeLabel)}${span(v.raceTitle)}</li>`
      : `<li>${escapeHtml(v.name)}</li>`,
  );
  // id は人の画面と同じ（HomeAiIntro の「開催中の会場から選ぶ」のページ内リンクの先）
  const today = [
    `<section id="today-venues">`,
    `<h2>${escapeHtml(model.heading)}</h2>`,
    model.updatedText ? `<p>${escapeHtml(model.updatedText)}</p>` : "",
    // 人の画面と同じく、更新表示の下・案内の帯より上（BOA-1690）
    model.upcomingDeadline ? upcomingDeadlineHtml(model.upcomingDeadline) : "",
    model.introBanner
      ? `<p>${link(model.introBanner.href, model.introBanner.text)}</p>`
      : "",
    `<ul>\n${items.join("\n")}\n</ul>`,
    "</section>",
  ]
    .filter(Boolean)
    .join("\n");
  const body = [today, aiIntroHtml(model.aiIntro), blogHtml(model.blog)].join(
    "\n",
  );
  // 人のトップは index.html の共通の JSON-LD と、HomeAiIntro の FAQPage（パンくずは無い）
  return documentHtml(model.meta, body, {
    path: model.path,
    lang: model.lang ?? DEFAULT_LANGUAGE,
    jsonLd: [...siteJsonLd, model.aiIntro.faqPageLd],
  });
}

/**
 * @param {ReturnType<typeof buildVenueModel>} model
 * @param {string} viewLabel - レースカードのリンクの文言
 * @param {{siteJsonLd?: object[]}} [options] - index.html の共通の JSON-LD（getSiteJsonLd）
 */
export function renderVenueHtml(model, viewLabel, { siteJsonLd = [] } = {}) {
  const items = model.races.map((r) => {
    const parts = [
      `<h3>${escapeHtml(r.venueName)}</h3>`,
      span(r.gradeLabel).trim(),
      span(r.cancelledLabel).trim(),
      span(r.raceLabel).trim(),
      r.deadline
        ? `<p><span>${escapeHtml(r.deadline.label)}</span> <span>${escapeHtml(r.deadline.value)}</span></p>`
        : "",
      r.href
        ? `<a href="${escapeHtml(r.href)}">${escapeHtml(viewLabel)}</a>`
        : "",
    ].filter(Boolean);
    return `<li>${parts.join(" ")}</li>`;
  });
  const body = [
    `<h1>${escapeHtml(model.heading)}</h1>`,
    // 見出しの直下の常設の要約2行（BOA-1189）
    ...(model.summaryLines ?? []).map((line) => `<p>${escapeHtml(line)}</p>`),
    model.meetBanner
      ? `<p><span translate="no">${escapeHtml(model.meetBanner.name)}</span> ${escapeHtml(model.meetBanner.inProgress)} <a href="${escapeHtml(model.meetBanner.href)}">${escapeHtml(model.meetBanner.link)}</a></p>`
      : "",
    model.emptyText ? `<p>${escapeHtml(model.emptyText)}</p>` : "",
    items.length > 0 ? `<ol>\n${items.join("\n")}\n</ol>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  // 人の会場ページは、共通の JSON-LD に加えて Breadcrumb の BreadcrumbList を出す（項目が欠けたら出さないのも同じ）
  return documentHtml(model.meta, body, {
    path: model.path,
    lang: model.lang ?? DEFAULT_LANGUAGE,
    jsonLd: [
      ...siteJsonLd,
      ...(isValidCrumbs(model.breadcrumbItems)
        ? [toBreadcrumbListLd(model.breadcrumbItems)]
        : []),
    ],
  });
}
