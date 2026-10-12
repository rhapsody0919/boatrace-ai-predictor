/**
 * ボット向け HTML（ADR 0089 第2段、BOA-848）: レース詳細（/race/{id}・/{lang}/race/{id}）の部分集合。
 * api/bot-page/race/[id].js と api/bot-page/[lang]/race/[id].js が使う。
 *
 * - 出すのは本日（JST）の日付の id だけ。過去・未来の日付は 404（middleware も本日の id しか振り分けない）
 * - 材料は人の画面と同じ /api/predictions/{date}?light=true（同じデプロイ、origin はリクエストの host から組む）。
 *   日付ごとに60秒使い回す（決定4）
 * - 出すのは人の初期表示の部分集合（決定3）。見出しの帯（グレード・節タイトル）・h1（会場名と NR・種別・日目）・
 *   「← レース一覧に戻る」・パンくず・「データ分析結果 - 会場 NR（締切 HH:MM）」の見出し。
 *   見出しの値・title・description・canonical・パンくずは人の画面と同じ src/utils/raceDetailHeading.js で組む
 * - 出さない（決定7）: 出走表の選手一覧、オッズ、払戻、着順と結果、AI 予想、直前情報、「AI用にコピー」。
 *   材料の entries・result・predictions は、結果があるか（rank1）以外は読まない
 * - 時刻で変わる状態は出さない。締切の表示だけは人と同じく「結果が出たら消す」（getRaceStatus の FINISHED は result だけで決まる）
 * - 材料が取れない・形が違う・その日のレースが0件: 503（取得の失敗・取り込み前を「無いレース」にしない）。
 *   材料は取れたがその id のレースが無い: 404・no-store
 *
 * 検証: scripts/maintenance/verify-bot-race-function.js
 */
import {
  CLIENT_ERROR_HEADERS,
  SUCCESS_HEADERS,
  UNAVAILABLE_HEADERS,
  MATERIAL_TTL_MS,
  BOT_PAGE_PREFIXED_LANGS,
  documentHtml,
  escapeHtml,
  getLocaleT,
  getSiteJsonLd,
  originOf,
} from "./botPage.js";
import { DEFAULT_LANGUAGE } from "../../src/config/languages.js";
import { getJSTNow } from "../../src/utils/dateUtils.js";
import { parseRaceId } from "../../src/utils/raceId.js";
import {
  getRaceDetailHeading,
  getRaceDetailMeta,
  getRaceDetailBreadcrumbItems,
  getRaceListLink,
} from "../../src/utils/raceDetailHeading.js";
import {
  isValidCrumbs,
  toBreadcrumbListLd,
} from "../../src/utils/breadcrumbLd.js";

const FETCH_TIMEOUT_MS = 8_000;

const LANG_ALT = BOT_PAGE_PREFIXED_LANGS.join("|");
// 関数を直接呼ぶ形（/api/bot-page/race/{id}・/api/bot-page/{lang}/race/{id}）と、
// middleware の rewrite 経由で元のパスのまま届く形（/race/{id}・/{lang}/race/{id}）
const RACE_PATH = new RegExp(
  `^(?:/api/bot-page)?(?:/(${LANG_ALT}))?/race/([^/]+)$`,
);

/** 材料（/api/predictions）が取れない・形が違う・0件 */
export class PredictionsFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "PredictionsFetchError";
  }
}

export const jstToday = (nowMs) =>
  getJSTNow(new Date(nowMs)).toISOString().slice(0, 10);

/**
 * パスから言語と race id を読む。langMode が "ja" なら接頭辞なしだけ、"prefixed" なら en・zh-TW・ko の接頭辞付きだけを受ける
 *
 * @returns {{lang: string, raceId: string, venueCode: number, raceNo: number, date: string}|null}
 */
export function parseBotRaceUrl(url, langMode = "ja") {
  let pathname;
  try {
    pathname = new URL(url ?? "", "http://localhost").pathname;
  } catch {
    return null;
  }
  const m = RACE_PATH.exec(pathname);
  if (!m) return null;
  const lang = m[1] ?? DEFAULT_LANGUAGE;
  if ((langMode === "prefixed") !== (lang !== DEFAULT_LANGUAGE)) return null;
  const parsed = parseRaceId(m[2]);
  if (!parsed) return null;
  return {
    lang,
    raceId: m[2],
    venueCode: parsed.venueCode,
    raceNo: parsed.raceNo,
    date: parsed.date,
  };
}

/** 形を確かめる。races が1件以上あり、各レースの id・会場・レース番号が揃っていること */
export function assertPredictionsShape(json) {
  if (json === null || typeof json !== "object" || !Array.isArray(json.races)) {
    throw new PredictionsFetchError("/api/predictions の races が配列でない");
  }
  if (json.races.length === 0) {
    // 取り込み前・取得の失敗と区別できないので、「無いレース」にせず 503 にする
    throw new PredictionsFetchError("/api/predictions の races が0件");
  }
  json.races.forEach((r, i) => {
    if (
      typeof r?.raceId !== "string" ||
      !Number.isInteger(r.venueCode) ||
      !Number.isInteger(r.raceNumber)
    ) {
      throw new PredictionsFetchError(
        `races[${i}] の raceId・venueCode・raceNumber が正しくない`,
      );
    }
  });
}

/**
 * 見出しに使う項目だけを、人の画面（transformEdgeResponse）と同じ名前・同じ既定値で取り出す。
 * entries・predictions・オッズは持たない。result は rank1（結果があるか）だけ
 */
export function pickHeadingFields(race) {
  return {
    raceId: race.raceId,
    venueCode: race.venueCode,
    raceNumber: race.raceNumber,
    startTime: race.startTime || "",
    cancellationStatus: race.cancellationStatus ?? null,
    raceGrade: race.raceGrade ?? null,
    raceTitle: race.raceTitle ?? null,
    seriesDay: race.seriesDay ?? null,
    isFinalDay: race.isFinalDay ?? null,
    raceStage: race.raceStage ?? null,
    // 人の画面の buildRaceResult は rank1 が無ければ null、あれば finished: true
    result: race.result?.rank1
      ? { finished: true, rank1: race.result.rank1 }
      : null,
  };
}

/**
 * /api/predictions/{date}?light=true を読む。日付ごとに ttlMs だけ使い回す
 *
 * @returns {(origin: string, date: string) => Promise<object[]>} 見出しの項目だけにしたレース
 */
export function createPredictionsSource({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  ttlMs = MATERIAL_TTL_MS,
} = {}) {
  let cache = null; // { key, at, races }
  let inflight = null; // { key, promise }

  async function load(origin, date) {
    const url = `${origin}/api/predictions/${date}?light=true`;
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throw new PredictionsFetchError(`${url} を取れない: ${e?.message ?? e}`);
    }
    if (!res.ok)
      throw new PredictionsFetchError(`${url} が HTTP ${res.status}`);
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new PredictionsFetchError(
        `${url} が JSON でない: ${e?.message ?? e}`,
      );
    }
    assertPredictionsShape(json);
    const races = json.races.map(pickHeadingFields);
    cache = { key: `${origin}|${date}`, at: now(), races };
    return races;
  }

  return async function getRaces(origin, date) {
    const key = `${origin}|${date}`;
    if (cache && cache.key === key && now() - cache.at < ttlMs) {
      return cache.races;
    }
    if (inflight && inflight.key === key) return inflight.promise;
    const promise = load(origin, date);
    inflight = { key, promise };
    try {
      return await promise;
    } finally {
      if (inflight?.promise === promise) inflight = null;
    }
  };
}

/**
 * レース詳細のモデル（人の初期表示の部分集合）
 *
 * @param {object[]} races - その日の全レース（pickHeadingFields 済み）
 * @param {{lang: string, raceId: string, venueCode: number, raceNo: number, date: string}} key
 * @param {(key: string, params?: object) => string} t
 * @returns {object|null} その id のレースが無ければ null
 */
export function buildRaceModel(races, key, t) {
  const race = races.find((r) => r.raceId === key.raceId) ?? null;
  if (!race) return null;
  const venueRaws = races
    .filter((r) => r.venueCode === key.venueCode)
    .sort((a, b) => a.raceNumber - b.raceNumber);
  const heading = getRaceDetailHeading(race, venueRaws, t);
  const venueName = t(`venues.${key.venueCode}`);
  // ボット向けは本日の id だけ
  const isToday = true;
  return {
    lang: key.lang,
    path: `/race/${key.raceId}`,
    meta: getRaceDetailMeta(t, key, key.lang),
    breadcrumbItems: getRaceDetailBreadcrumbItems(t, key, isToday, key.lang),
    gradeLabel: heading.gradeConfig?.label ?? null,
    seriesTitle: heading.seriesTitle,
    h1: `🚤 ${venueName} ${key.raceNo}R`,
    stageChip: heading.stageChip
      ? {
          emoji: heading.stageChip.emoji ?? null,
          label: heading.stageChip.label,
        }
      : null,
    seriesDayLabel: heading.seriesDayLabel,
    backLink: {
      href: getRaceListLink(key, isToday, key.lang),
      label: t("raceDetailPage.backToList"),
    },
    // PredictionSection の見出し。締切は結果が出たら消す（人と同じ）
    sectionTitle: `📊 ${t("section.resultTitle")} - ${venueName} ${race.raceNumber}R`,
    sectionDeadline:
      race.startTime && !race.result?.finished
        ? t("section.resultTitleDeadline", { time: race.startTime })
        : null,
  };
}

const span = (text) => (text ? `<span>${escapeHtml(text)}</span>` : "");

/**
 * @param {NonNullable<ReturnType<typeof buildRaceModel>>} model
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

const plain = (status, headers, body) => ({ status, headers, body });

/**
 * @param {{langMode?: "ja"|"prefixed", method?: string, url?: string, headers?: Record<string, string>}} req
 * @param {{getRaces: (origin: string, date: string) => Promise<object[]>, now: () => number,
 *   getT: (lang: string) => Promise<Function>, getSiteJsonLd?: () => Promise<object[]>}} deps
 */
export async function respondRacePage(
  { langMode = "ja", method, url, headers },
  { getRaces, now, getT, getSiteJsonLd: loadSiteJsonLd = getSiteJsonLd },
) {
  if (method !== "GET" && method !== "HEAD") {
    return plain(
      405,
      { ...CLIENT_ERROR_HEADERS, Allow: "GET, HEAD" },
      "405 Method Not Allowed\n",
    );
  }
  const key = parseBotRaceUrl(url, langMode);
  // 本日（JST）の id だけ。過去・未来は人と同じ SPA に任せる（CDN のキーも本日分に限る）
  if (!key || key.date !== jstToday(now())) {
    return plain(404, CLIENT_ERROR_HEADERS, "404 Not Found\n");
  }
  const origin = originOf(headers);
  if (!origin) return plain(400, CLIENT_ERROR_HEADERS, "400 Bad Request\n");
  try {
    const [races, t, siteJsonLd] = await Promise.all([
      getRaces(origin, key.date),
      getT(key.lang),
      loadSiteJsonLd(),
    ]);
    const model = buildRaceModel(races, key, t);
    if (!model) return plain(404, CLIENT_ERROR_HEADERS, "404 Not Found\n");
    return plain(200, SUCCESS_HEADERS, renderRaceHtml(model, { siteJsonLd }));
  } catch (e) {
    const expected = e instanceof PredictionsFetchError;
    console.error(
      `[bot-page] race ${key.raceId}: 503 ${e?.name}: ${e?.message}`,
      ...(expected ? [] : [e]),
    );
    return plain(503, UNAVAILABLE_HEADERS, "503 Service Unavailable\n");
  }
}

const defaultSource = createPredictionsSource();

/**
 * Vercel の Node 関数のハンドラ
 *
 * @param {{langMode?: "ja"|"prefixed", getRaces?: Function, now?: () => number,
 *   getT?: (lang: string) => Promise<Function>, getSiteJsonLd?: () => Promise<object[]>}} [deps]
 */
export function createRaceBotHandler({
  langMode = "ja",
  getRaces = defaultSource,
  now = Date.now,
  getT = getLocaleT,
  getSiteJsonLd: loadSiteJsonLd = getSiteJsonLd,
} = {}) {
  return async function handler(req, res) {
    const { status, headers, body } = await respondRacePage(
      { langMode, method: req.method, url: req.url, headers: req.headers },
      { getRaces, now, getT, getSiteJsonLd: loadSiteJsonLd },
    );
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}
