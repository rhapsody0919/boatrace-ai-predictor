/**
 * ボット向け HTML（ADR 0089）の関数の中身。api/bot-page/top.js と api/bot-page/venue/[code].js が使う。
 *
 * - 材料は同じデプロイの /api/races/today だけ（origin はリクエストの host から組む。利用者の入力から外部の URL を組まない）。
 *   モジュールスコープで60秒だけ使い回し、取得中の呼び出しは同じ Promise を待たせる（ADR 0089 決定4、ADR 0059 §2 の多重リクエストの抑制）
 * - 中身は botPageModel.js のモデル（人の画面の部分集合）だけ。値はテキスト・属性とも HTML エスケープする
 *   （ja の t は escapeValue: false なので、エスケープはここで必ず行う）
 * - 材料が取れない・形が違う: 503・Retry-After: 300・no-store。正しく取れて0件のときだけ「開催なし」の HTML（ADR 0069）
 * - 会場コードはパスの末尾の 1〜24（0埋めなし）だけ。それ以外は 404。クエリ文字列は見ない
 *   middleware の rewrite から呼ばれると req.url は元の /venue/{code} のまま届く（Preview で確認）ので、
 *   /api/bot-page/venue/{code} と /venue/{code} の両方を受ける
 *
 * 検証: scripts/maintenance/verify-bot-page-function.js
 */
import { readFileSync } from "node:fs";
import i18next from "i18next";
import {
  assertTodayRacesJson,
  buildTopModel,
  buildVenueModel,
  TodayRacesShapeError,
} from "../../src/utils/botPageModel.js";
import { getJSTNow } from "../../src/utils/dateUtils.js";

// 成功時のヘッダー。scripts/verification/verify-cache-config.js がこのファイルの最初の "Cache-Control" を読むので、
// 失敗時のヘッダーより前に置く（docs/reference/cache-strategy.md パターン B）
const SUCCESS_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control":
    "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600",
};

const UNAVAILABLE_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "Retry-After": "300",
};

// 404・405・400 は CDN に残さない（任意のパスでキャッシュのキーを増やさない）
const CLIENT_ERROR_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
};

/** 人のページ（index.html）と同じ robots。verify で index.html と一致することを確かめる */
export const ROBOTS =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

export const MATERIAL_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

const VENUE_PATH = /^(?:\/api\/bot-page)?\/venue\/([^/]+)$/;
const VENUE_CODE = /^(?:[1-9]|1\d|2[0-4])$/;

/** 材料（/api/races/today）が取れない */
export class MaterialFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "MaterialFetchError";
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- ja の t（人の画面と同じ common.json・同じ補間の設定） ----
let jaTPromise = null;
export function getJaT() {
  if (!jaTPromise) {
    jaTPromise = (async () => {
      const ja = JSON.parse(
        readFileSync(
          new URL("../../src/locales/ja/common.json", import.meta.url),
          "utf8",
        ),
      );
      const i18n = i18next.createInstance();
      await i18n.init({
        lng: "ja",
        resources: { ja: { common: ja } },
        defaultNS: "common",
        ns: ["common"],
        interpolation: { escapeValue: false },
      });
      return i18n.t.bind(i18n);
    })().catch((e) => {
      jaTPromise = null;
      throw e;
    });
  }
  return jaTPromise;
}

// ---- 材料の取得 ----

/**
 * /api/races/today を取って形を確かめ、ttlMs だけ使い回す
 *
 * @param {{fetchImpl?: typeof fetch, now?: () => number, ttlMs?: number, timeoutMs?: number}} [options]
 * @returns {(origin: string) => Promise<unknown>}
 */
export function createTodayRacesSource({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  ttlMs = MATERIAL_TTL_MS,
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  let cache = null; // { origin, at, json }
  let inflight = null; // { origin, promise }

  async function load(origin) {
    const url = `${origin}/api/races/today`;
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new MaterialFetchError(`${url} を取れない: ${e?.message ?? e}`);
    }
    if (!res.ok) {
      throw new MaterialFetchError(`${url} が HTTP ${res.status}`);
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new MaterialFetchError(`${url} が JSON でない: ${e?.message ?? e}`);
    }
    assertTodayRacesJson(json);
    cache = { origin, at: now(), json };
    return json;
  }

  return async function getTodayJson(origin) {
    if (cache && cache.origin === origin && now() - cache.at < ttlMs) {
      return cache.json;
    }
    if (inflight && inflight.origin === origin) return inflight.promise;
    const promise = load(origin);
    inflight = { origin, promise };
    try {
      return await promise;
    } finally {
      if (inflight?.promise === promise) inflight = null;
    }
  };
}

/** リクエストの host から自分の origin を組む。host の形が変なら null */
export function originOf(headers) {
  const host = String(headers?.host ?? "");
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return null;
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

// ---- HTML ----

function documentHtml(meta, bodyHtml) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}">
<meta name="robots" content="${escapeHtml(ROBOTS)}">
<link rel="canonical" href="${escapeHtml(meta.canonical)}">
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

const span = (text) => (text ? ` <span>${escapeHtml(text)}</span>` : "");

export function renderTopHtml(model) {
  const items = model.venues.map((v) =>
    v.isOpen
      ? `<li><a href="${escapeHtml(v.href)}">${escapeHtml(v.name)}</a>${span(v.gradeLabel)}${span(v.raceTitle)}</li>`
      : `<li>${escapeHtml(v.name)}</li>`,
  );
  const body = [
    `<h2>${escapeHtml(model.heading)}</h2>`,
    model.updatedText ? `<p>${escapeHtml(model.updatedText)}</p>` : "",
    `<ul>\n${items.join("\n")}\n</ul>`,
  ]
    .filter(Boolean)
    .join("\n");
  return documentHtml(model.meta, body);
}

export function renderVenueHtml(model, viewLabel) {
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
    model.emptyText ? `<p>${escapeHtml(model.emptyText)}</p>` : "",
    items.length > 0 ? `<ol>\n${items.join("\n")}\n</ol>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return documentHtml(model.meta, body);
}

// ---- 応答 ----

const plain = (status, headers, body) => ({ status, headers, body });

/** パスの末尾の会場コード（1〜24、0埋めなし）。それ以外は null */
export function venueCodeFromUrl(url) {
  let pathname;
  try {
    pathname = new URL(url ?? "", "http://localhost").pathname;
  } catch {
    return null;
  }
  const m = VENUE_PATH.exec(pathname);
  if (!m || !VENUE_CODE.test(m[1])) return null;
  return Number(m[1]);
}

/**
 * @param {{page: "top"|"venue", method?: string, url?: string, headers?: Record<string, string>}} req
 * @param {{getTodayJson: (origin: string) => Promise<unknown>, now: () => number, getT: () => Promise<Function>}} deps
 * @returns {Promise<{status: number, headers: Record<string, string>, body: string}>}
 */
export async function respondBotPage(
  { page, method, url, headers },
  { getTodayJson, now, getT },
) {
  if (method !== "GET" && method !== "HEAD") {
    return plain(
      405,
      { ...CLIENT_ERROR_HEADERS, Allow: "GET, HEAD" },
      "405 Method Not Allowed\n",
    );
  }
  const venueCode = page === "venue" ? venueCodeFromUrl(url) : null;
  if (page === "venue" && venueCode === null) {
    return plain(404, CLIENT_ERROR_HEADERS, "404 Not Found\n");
  }
  const origin = originOf(headers);
  if (!origin) return plain(400, CLIENT_ERROR_HEADERS, "400 Bad Request\n");

  try {
    const [json, t] = await Promise.all([getTodayJson(origin), getT()]);
    const html =
      page === "venue"
        ? renderVenueHtml(
            buildVenueModel(json, venueCode, { t }),
            t("raceCard.view"),
          )
        : renderTopHtml(
            buildTopModel(json, {
              t,
              today: getJSTNow(new Date(now())).toISOString().slice(0, 10),
            }),
          );
    return plain(200, SUCCESS_HEADERS, html);
  } catch (e) {
    // 材料の失敗・形の違いは想定内（メッセージだけ）。それ以外はスタックも残す。どちらも「開催なし」にしない
    const expected =
      e instanceof MaterialFetchError || e instanceof TodayRacesShapeError;
    console.error(
      `[bot-page] ${page}: 503 ${e?.name}: ${e?.message}`,
      ...(expected ? [] : [e]),
    );
    return plain(503, UNAVAILABLE_HEADERS, "503 Service Unavailable\n");
  }
}

const defaultSource = createTodayRacesSource();

/**
 * Vercel の Node 関数のハンドラ（req, res）を作る
 *
 * @param {"top"|"venue"} page
 * @param {{getTodayJson?: Function, now?: () => number, getT?: () => Promise<Function>}} [deps] - verify で差し替える
 */
export function createBotPageHandler(
  page,
  { getTodayJson = defaultSource, now = Date.now, getT = getJaT } = {},
) {
  return async function handler(req, res) {
    const { status, headers, body } = await respondBotPage(
      { page, method: req.method, url: req.url, headers: req.headers },
      { getTodayJson, now, getT },
    );
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
