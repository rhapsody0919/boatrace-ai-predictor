/**
 * ボット向け HTML（ADR 0089）と人の画面の照合に使う純粋な関数。
 *
 * - 本番に向けて動かすのは scripts/maintenance/verify-bot-html-parity.js（tier manual、日中の照合のワークフロー）
 * - 関数そのものの検証は scripts/maintenance/verify-bot-html-parity-logic.js（tier ci、フィクスチャだけで動く）
 *
 * 照合は「ボット側の文字列が人の側にあるか」の一方向だけを見る。人の画面には時刻で変わるもの
 * （カウントダウン・受付中など）や、ボットに出さない表（選手・オッズ）があるので、逆向きは見ない。
 */
import * as cheerio from "cheerio";

/** 本文の比較では空白（改行・タブ・全角でない空白）を全部除く。人の DOM は要素の境目に改行が入るため */
export const normalizeText = (s) => String(s ?? "").replace(/\s+/g, "");

/**
 * ボット向け HTML から、照合する文字列を取り出す
 *
 * @param {string} html
 * @returns {{texts: string[], hrefs: string[], head: {title: string, description: string, canonical: string,
 *   alternates: {hreflang: string, href: string}[], jsonLd: string[]}}}
 *   texts: <main> の中のテキストノード（見出し・会場名・節の名前・グレード・レース番号・締切時刻・最終更新など）を重複なしで
 *   hrefs: <main> の中の <a href>
 *   head.alternates: <link rel="alternate" hreflang>、head.jsonLd: <script type="application/ld+json"> の中身（文字列のまま）
 */
export function extractBotItems(html) {
  const $ = cheerio.load(html);
  const texts = new Set();
  $("main")
    .find("*")
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type !== "text") return;
      const t = String(node.data ?? "").trim();
      if (t) texts.add(t);
    });
  const hrefs = new Set();
  $("main a[href]").each((_, a) => {
    hrefs.add($(a).attr("href"));
  });
  return {
    texts: [...texts],
    hrefs: [...hrefs],
    head: {
      title: $("head > title").first().text().trim(),
      description:
        $('head > meta[name="description"]').first().attr("content") ?? "",
      canonical: $('head > link[rel="canonical"]').first().attr("href") ?? "",
      alternates: alternatesOf($),
      jsonLd: $('script[type="application/ld+json"]')
        .map((_, s) => $(s).text())
        .get(),
    },
  };
}

function alternatesOf($) {
  return $('link[rel="alternate"][hreflang]')
    .map((_, l) => ({
      hreflang: $(l).attr("hreflang") ?? "",
      href: $(l).attr("href") ?? "",
    }))
    .get();
}

/** キーの順によらない JSON の文字列（JSON-LD の比較用） */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** JSON として読めれば canonicalJson、読めなければ null */
function parseLd(text) {
  try {
    return canonicalJson(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 人の画面のリンク先を、同じ origin ならパス（＋クエリ）にそろえる。違う origin・解釈できないものはそのまま */
export function normalizeHref(href, origin) {
  try {
    const u = new URL(href, origin);
    if (u.origin !== new URL(origin).origin) return href;
    return `${u.pathname}${u.search}`;
  } catch {
    return href;
  }
}

// 「レースデータ更新: 10/12 08:42」のような、月日と時刻で終わる文字列
const STAMP_AT_END = /(\d{1,2})\/(\d{1,2}) (\d{2}):(\d{2})$/;
const stampMinutes = (mo, d, h, mi) =>
  Date.UTC(2000, Number(mo) - 1, Number(d), Number(h), Number(mi)) / 60_000;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 月日と時刻で終わる文字列（最終更新）を、同じ前置きで時刻の差が toleranceMin 分以内なら同じとみなす。
 * 材料の /api/races/today は CDN に地域ごとに5分残るので、ボットの関数（syd1）とブラウザが別の時点の材料を
 * 読むことがある（2026-10-12 の本番で 08:42 と 08:40）。前置きの文言が違えば、差によらず一致しない
 */
function stampMatches(botText, humanTextNormalized, toleranceMin) {
  const m = STAMP_AT_END.exec(botText);
  if (!m) return false;
  const prefix = normalizeText(botText.slice(0, m.index));
  const target = stampMinutes(m[1], m[2], m[3], m[4]);
  const re = new RegExp(
    `${escapeRegExp(prefix)}(\\d{1,2})\\/(\\d{1,2})(\\d{2}):(\\d{2})`,
    "g",
  );
  for (const h of humanTextNormalized.matchAll(re)) {
    if (
      Math.abs(stampMinutes(h[1], h[2], h[3], h[4]) - target) <= toleranceMin
    ) {
      return true;
    }
  }
  return false;
}

/**
 * ボット側の文字列のうち、人の画面に無いものを返す（空配列なら合格）
 *
 * @param {ReturnType<typeof extractBotItems>} bot
 * @param {{text: string, hrefs: string[], head: {title: string, description: string, canonicals: string[],
 *   alternates?: {hreflang: string, href: string}[], jsonLd?: string[]}}} human
 *   人の画面を Playwright で描いた結果（body の innerText・a[href] の属性値・head。alternates・jsonLd は
 *   document 全体の link[rel=alternate][hreflang] と script[type="application/ld+json"] の中身）
 * @param {string} origin - 例 https://www.boat-ai.jp
 * @param {{stampToleranceMin?: number}} [options] - 最終更新の時刻の許容差（分）。既定 10（CDN の5分×2）
 * @returns {{kind: "text"|"href"|"title"|"description"|"canonical"|"hreflang"|"jsonld", value: string}[]}
 *   hreflang は「hreflang href」、jsonld はボット側の JSON-LD の中身（JSON として読めないものも無いものに出す）
 */
export function findMissing(
  bot,
  human,
  origin,
  { stampToleranceMin = 10 } = {},
) {
  const missing = [];
  const humanText = normalizeText(human.text);
  for (const t of bot.texts) {
    if (
      !humanText.includes(normalizeText(t)) &&
      !stampMatches(t, humanText, stampToleranceMin)
    ) {
      missing.push({ kind: "text", value: t });
    }
  }
  const humanHrefs = new Set(
    (human.hrefs ?? []).map((h) => normalizeHref(h, origin)),
  );
  for (const h of bot.hrefs) {
    if (!humanHrefs.has(normalizeHref(h, origin))) {
      missing.push({ kind: "href", value: h });
    }
  }
  if (bot.head.title !== (human.head?.title ?? "")) {
    missing.push({ kind: "title", value: bot.head.title });
  }
  if (bot.head.description !== (human.head?.description ?? "")) {
    missing.push({ kind: "description", value: bot.head.description });
  }
  if (!(human.head?.canonicals ?? []).includes(bot.head.canonical)) {
    missing.push({ kind: "canonical", value: bot.head.canonical });
  }
  const pair = ({ hreflang, href }) => `${hreflang} ${href}`;
  const humanAlternates = new Set((human.head?.alternates ?? []).map(pair));
  for (const a of bot.head.alternates ?? []) {
    if (!humanAlternates.has(pair(a))) {
      missing.push({ kind: "hreflang", value: pair(a) });
    }
  }
  const humanLd = new Set(
    (human.head?.jsonLd ?? []).map(parseLd).filter((v) => v !== null),
  );
  for (const text of bot.head.jsonLd ?? []) {
    const ld = parseLd(text);
    if (ld === null || !humanLd.has(ld)) {
      missing.push({ kind: "jsonld", value: text });
    }
  }
  return missing;
}

/**
 * 応答の HTML が、SPA の外枠（index.html）かボット向けかを見分ける
 *
 * - "spa": <div id="root"> があり、<main> も h1・h2 も無い
 * - "bot": <main> の中に h1 か h2 がある（api/_lib/botPage.js の形）
 * - "unknown": どちらでもない（エラーページ等）
 *
 * @param {string} html
 * @returns {"spa"|"bot"|"unknown"}
 */
export function classifyHtml(html) {
  const $ = cheerio.load(String(html ?? ""));
  if ($("main h1, main h2").length > 0) return "bot";
  if ($("#root").length > 0 && $("main, h1, h2").length === 0) return "spa";
  return "unknown";
}

/**
 * /api/races/today の JSON から、開催中（中止でないレースが1つ以上ある）の会場を place_cd の順に n 個返す
 *
 * @param {unknown} json
 * @param {number} n
 * @returns {{code: number, name: string, firstRacePath: string}[]}
 */
export function pickOpenVenues(json, n) {
  const data = Array.isArray(json?.data) ? json.data : [];
  const pad2 = (v) => String(v).padStart(2, "0");
  return data
    .map((v) => {
      const races = (Array.isArray(v?.races) ? v.races : []).filter(
        (r) => r && !r.cancellationStatus,
      );
      const first = races[0];
      return first
        ? {
            code: Number(v.place_cd),
            name: String(v.place_name ?? ""),
            firstRacePath: `/race/${first.date}-${pad2(v.place_cd)}-${pad2(first.raceNo)}`,
          }
        : null;
    })
    .filter((v) => v && Number.isInteger(v.code) && v.code >= 1 && v.code <= 24)
    .sort((a, b) => a.code - b.code)
    .slice(0, n);
}

/** 中央値（空なら null） */
export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
