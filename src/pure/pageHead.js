/**
 * 生の HTML の head（JS の前の HTML にページごとの title・description・canonical・JSON-LD を全ての UA に同じに入れる。
 * 設計は docs/adr の「生の HTML にページごとの head」の ADR）。ページのパスから head の種類を読み、外枠（その配備の index.html）へ差し込む。
 * 人の画面・middleware が同じ関数を使う。副作用なし（src/pure なので src/pure の外と ES の組み込みの外を使わない）。
 */
import { formatDate } from "./jstDate.js";

const SITE_ORIGIN = "https://www.boat-ai.jp";

/** 差し込んだ要素の印。title の値は外枠の既定の title（起動の後に戻す文） */
export const PAGE_HEAD_ATTR = "data-page-head";

const VENUE_CODE = "(?:[1-9]|1\\d|2[0-4])";
const PAST_VENUE_PATH = new RegExp(`^/races/(\\d{4}-\\d{2}-\\d{2})/(${VENUE_CODE})$`);

const isText = (v) => typeof v === "string" && v.trim() !== "";

/** 実在する暦日か（2026-02-30 等は外す） */
function isCalendarDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * head を差し込むページか。対象の外（0埋めの会場・実在しない日・言語の接頭辞つき等）は null
 * @param {string} pathname - デコード前のパス（クエリは含めない）
 * @returns {{kind: "pastVenue", date: string, venueCode: number} | null}
 */
export function pageHeadRoute(pathname) {
  const m = PAST_VENUE_PATH.exec(pathname);
  if (m && isCalendarDate(m[1])) {
    return { kind: "pastVenue", date: m[1], venueCode: Number(m[2]) };
  }
  return null;
}

/**
 * 会場ページ（過去日付、/races/:date/:code。ja 専用）。画面には終わったレースの結果の行（着順・決まり手・3連単の配当）が出るので、
 * 「{会場}＋結果」の検索の語で拾われるよう title の頭に「結果・配当」を置く（BOA-1723）。尾は e2e/venue-seo-meta.spec.js が固定
 *
 * @param {string} venueName - 会場名
 * @param {string} date - YYYY-MM-DD
 * @param {number|string} venueCode - 1〜24
 * @returns {{title: string, description: string, canonical: string}}
 */
export function getPastVenuePageMeta(venueName, date, venueCode) {
  const day = formatDate(date);
  return {
    title: `${venueName}競艇の結果・配当 ${day}のレース一覧・AIデータ分析 - 龍神レーダー`,
    description: `${venueName}競艇（ボートレース${venueName}）の${day}の全レースの結果。着順・決まり手・3連単の配当と、各レースの出走表・AIデータ分析を無料で確認できます。`,
    canonical: `${SITE_ORIGIN}/races/${date}/${venueCode}`,
  };
}

/**
 * 会場ページ（過去日付）のパンくず（ホーム › 過去の予想 › 日付 › 会場名）。JSON-LD がこれを使う。
 * 画面の Breadcrumb は今 src/pages/VenueRaceListPageModel.js の pastBreadcrumbItems（同じ並び）。次の PR でこちらへ寄せて1つにする
 */
export function getPastVenueBreadcrumbItems(homeName, date, venueCode, venueName) {
  return [
    { name: homeName, url: "/" },
    { name: "過去の予想", url: "/races" },
    { name: formatDate(date), url: `/races/${date}` },
    { name: venueName, url: `/races/${date}/${venueCode}` },
  ];
}

// サイトの中のパスで、URL の解決と字のつなぎが同じ結果になる字だけの物（英数字と - . _ ~ /）
const PLAIN_PATH = /^\/[A-Za-z0-9\-._~/]*$/;
const DOT_SEGMENT = /\/\.\.?(?:\/|$)/; // /./・/../ は URL の解決で縮むので受けない

/**
 * BreadcrumbList。src/utils/breadcrumbLd.js の toBreadcrumbListLd と同じ値（src/pure では URL を使えないので、
 * 解決の要らないパスだけを受ける。一致は verify で見る）。受けられない項目があれば null
 * @param {{name: string, url: string}[]} items
 */
export function breadcrumbListLd(items) {
  const ok = items.every((x) => isText(x?.name) && PLAIN_PATH.test(x?.url ?? "") && !DOT_SEGMENT.test(x.url));
  if (items.length === 0 || !ok) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_ORIGIN}${item.url}`,
    })),
  };
}

/**
 * 過去日付の会場ページの head 一式。JSON-LD は画面の Breadcrumb が出す BreadcrumbList と同じ
 * @param {{date: string, venueCode: number, venueName: string, homeName: string}} input
 */
export function pastVenuePageHead({ date, venueCode, venueName, homeName }) {
  const ld = breadcrumbListLd(getPastVenueBreadcrumbItems(homeName, date, venueCode, venueName));
  return {
    ...getPastVenuePageMeta(venueName, date, venueCode),
    jsonLd: ld ? [ld] : [],
  };
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// <script> の中の JSON。</script> や <!-- で抜けないよう < を、JS の行末として読まれうる U+2028・U+2029 を逃がす
const jsonForScript = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");

/** 差し込める head か。欠けた値・サイトの外の canonical は差し込まない（素通りにする） */
function isValidHead(head) {
  return (
    isText(head?.title) &&
    isText(head?.description) &&
    isText(head?.canonical) &&
    head.canonical.startsWith(`${SITE_ORIGIN}/`) &&
    Array.isArray(head.jsonLd) &&
    head.jsonLd.every((x) => x !== null && typeof x === "object")
  );
}

/**
 * 外枠の HTML に head を差し込む。title は外枠の1つを置き換え（値に既定の title を持たせる）、description・canonical・
 * JSON-LD は </head> の前に足す。外枠の head に title がちょうど1つでない・description か canonical が既にある・
 * head の値が欠ける、のどれかなら null（呼び手は素通りして今の外枠を返す）
 *
 * @param {string} shellHtml - 配備の index.html
 * @param {{title: string, description: string, canonical: string, jsonLd: object[]}} head
 * @returns {string | null}
 */
export function injectPageHead(shellHtml, head) {
  if (typeof shellHtml !== "string" || !isValidHead(head)) return null;
  const headEnd = shellHtml.indexOf("</head>");
  if (headEnd < 0) return null;
  const headPart = shellHtml.slice(0, headEnd);
  const titles = [...headPart.matchAll(/<title>([^<]*)<\/title>/g)];
  if (titles.length !== 1 || /<title[\s>]/g.exec(headPart.replace(titles[0][0], ""))) return null;
  if (/<link[^>]+rel=["']canonical["']/i.test(headPart)) return null;
  if (/<meta[^>]+name=["']description["']/i.test(headPart)) return null;

  const [titleTag, defaultTitle] = titles[0];
  const attr = (value = "") => `${PAGE_HEAD_ATTR}="${escapeHtml(value)}"`;
  const tags = [
    `<meta name="description" content="${escapeHtml(head.description)}" ${attr()} />`,
    `<link rel="canonical" href="${escapeHtml(head.canonical)}" ${attr()} />`,
    ...head.jsonLd.map(
      (ld) => `<script type="application/ld+json" ${attr()}>${jsonForScript(ld)}</script>`,
    ),
  ];
  const newHead =
    headPart.replace(titleTag, () => `<title ${attr(defaultTitle)}>${escapeHtml(head.title)}</title>`) +
    `${tags.join("\n")}\n`;
  return newHead + shellHtml.slice(headEnd);
}
