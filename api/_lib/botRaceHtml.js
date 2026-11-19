/**
 * ボット向け HTML のレース詳細（botRace.js）の、モデルから HTML を組む部分（純関数）。
 * botRace.js から分けた（ファイルの大きさの関所）。botRace.js が同じ名前で export し直す
 */
import { documentHtml, escapeHtml } from "./botPage.js";
import {
  isValidCrumbs,
  toBreadcrumbListLd,
} from "../../src/utils/breadcrumbLd.js";

const span = (text) => (text ? `<span>${escapeHtml(text)}</span>` : "");

function renderRaceStrip(strip) {
  const items = strip.races
    .map(
      (r) =>
        `<li><a href="${escapeHtml(r.href)}"${r.current ? ' aria-current="page"' : ""}>${escapeHtml(r.label)}</a></li>`,
    )
    .join("");
  const meet = strip.meetLink
    ? `\n<a href="${escapeHtml(strip.meetLink.href)}">${escapeHtml(strip.meetLink.label)}</a>`
    : "";
  return `<nav aria-label="${escapeHtml(strip.label)}"><ul>${items}</ul>${meet}</nav>`;
}

function renderEntrants(entrants) {
  if (entrants.rows.length === 0) return "";
  const items = entrants.rows
    .map((e) => {
      const name = e.href
        ? `<a href="${escapeHtml(e.href)}" translate="no">${escapeHtml(e.name)}</a>`
        : `<span translate="no">${escapeHtml(e.name)}</span>`;
      const grade = e.grade
        ? ` <span translate="no">${escapeHtml(e.grade)}</span>`
        : "";
      return `<li><span>${escapeHtml(String(e.number))}</span> ${name}${grade}</li>`;
    })
    .join("\n");
  return `<ul aria-label="${escapeHtml(entrants.label)}">\n${items}\n</ul>`;
}

/**
 * @param {NonNullable<ReturnType<typeof import("./botRace.js").buildRaceModel>>} model
 * @param {{siteJsonLd?: object[]}} [options]
 */
export function renderRaceHtml(model, { siteJsonLd = [] } = {}) {
  const crumbs = model.breadcrumbItems
    .map((c, i) =>
      i < model.breadcrumbItems.length - 1
        ? `<li><a href="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a></li>`
        : `<li>${escapeHtml(c.name)}</li>`,
    )
    .join("\n");
  const chip = model.stageChip
    ? ` <span>${model.stageChip.emoji ? `${escapeHtml(model.stageChip.emoji)} ` : ""}${escapeHtml(model.stageChip.label)}</span>`
    : "";
  const body = [
    `<nav><ol>\n${crumbs}\n</ol></nav>`,
    model.gradeLabel || model.seriesTitle
      ? `<p>${[span(model.gradeLabel), span(model.seriesTitle)].filter(Boolean).join(" ")}</p>`
      : "",
    `<h1>${escapeHtml(model.h1)}${chip}${model.seriesDayLabel ? ` ${span(model.seriesDayLabel)}` : ""}</h1>`,
    `<a href="${escapeHtml(model.backLink.href)}">${escapeHtml(model.backLink.label)}</a>`,
    renderRaceStrip(model.raceStrip),
    renderEntrants(model.entrants),
    `<h2>${escapeHtml(model.sectionTitle)}${span(model.sectionDeadline)}</h2>`,
  ]
    .filter(Boolean)
    .join("\n");
  return documentHtml(model.meta, body, {
    path: model.path,
    lang: model.lang,
    // 人のレース詳細は index.html の共通の JSON-LD と、Breadcrumb の BreadcrumbList
    jsonLd: [
      ...siteJsonLd,
      ...(isValidCrumbs(model.breadcrumbItems)
        ? [toBreadcrumbListLd(model.breadcrumbItems)]
        : []),
    ],
  });
}
