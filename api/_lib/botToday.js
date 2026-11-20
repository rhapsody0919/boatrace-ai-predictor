/**
 * ボット向け HTML（ADR 0089 第2段、BOA-848）: /today（本日のデータ一覧）の日替わりの中身。api/bot-page/today.js が使う。
 *
 * - 材料は人の画面（MorningDataDigest.jsx → supabaseDataService.getMorningDigest）と同じ2表
 *   morning_digest_days・morning_digest_rows を、同じ anon キーで PostgREST から読む（RLS の範囲。新しい公開 API は作らない）
 *   - rows は section・rank・race_id・venue_code・race_number・start_time と detail の reason だけを select する。
 *     選手の登録番号・名前・級・枠・モーター2連率は取りにも行かない（ADR 0089 決定7）
 *   - モジュールスコープで日付ごとに60秒使い回し、取得中の呼び出しは同じ Promise を待たせる（決定4）
 * - 出すのは人の画面の部分集合（決定3）。見出し・日付と開催数・期間・注目レース（会場・レース番号・締切・理由の文）・
 *   逃げ／まくり／逃がしの各セクション（名前・件数・説明・注意書き・初期表示の6枚のカードの会場とレース番号・締切・レース詳細へのリンク）・
 *   フライング／帰郷のセクション（名前・件数・説明・0件の文言だけ。選手の一覧は出さない）・用語・免責・ホームへのリンク
 * - 文言は人の画面と同じ src/data/morningDigestCopy.js と、カードの組み立て（DigestRaceCard・FeaturedRaceCard・DigestSection）と同じ形
 * - 材料が取れない・形が違う: 503。正しく読めて行が無い・generated_at が NULL のときだけ「まだ公開されていません」（ADR 0069）。
 *   人の画面は読み取りのエラーを「未生成」と同じに扱うが、ボット向けは取得の失敗を「未生成」に化けさせない
 * - 日付は実行時の JST の今日。クエリ文字列（?date=）は読まない（middleware も ?date= 付きは振り分けない）
 *
 * 検証: scripts/maintenance/verify-bot-today-function.js
 */
import {
  CLIENT_ERROR_HEADERS,
  SUCCESS_HEADERS,
  UNAVAILABLE_HEADERS,
  MATERIAL_TTL_MS,
  documentHtml,
  escapeHtml,
  getJaT,
  getSiteJsonLd,
} from "./botPage.js";
import { getJSTNow } from "../../src/utils/dateUtils.js";
import { toBreadcrumbListLd } from "../../src/utils/breadcrumbLd.js";
import {
  MORNING_DIGEST_DISCLAIMER,
  MORNING_DIGEST_GLOSSARY_TITLE,
} from "../../src/data/morningDigestCopy.js";
import { buildTodayModel } from "../../scripts/lib/sns/todayModel.js";

const FETCH_TIMEOUT_MS = 8_000;

// 人の画面の Breadcrumb（MorningDataDigest.jsx）と同じ
export const TODAY_BREADCRUMB = [
  { name: "ホーム", url: "/" },
  { name: "本日のデータ一覧", url: "/today" },
];

const DAY_SELECT =
  "generated_at,venue_count,race_count,window_start,window_end,window_days,notes";
// 選手の値（racer_id・racer_name・grade・boat_number・motor_2rate 等）は select しない。
// course は逃がしの行を2号艇（一覧）と3号艇（人の画面の折りたたみの中だけ）に分けるために取る（2026-10-15）
export const ROW_SELECT =
  "section,rank,race_id,venue_code,race_number,start_time,course,reason:detail->>reason";

const RACE_SECTIONS = ["featured", "nige", "makuri", "nigashi"];

/** 材料（morning_digest_*）が取れない・形が違う */
export class DigestFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "DigestFetchError";
  }
}

/** JST の今日（YYYY-MM-DD） */
export const jstToday = (nowMs) =>
  getJSTNow(new Date(nowMs)).toISOString().slice(0, 10);

const isObject = (v) => v !== null && typeof v === "object";

/** PostgREST の応答の形を確かめる。レースのセクションの行は会場・レース番号・race_id が揃っていること */
export function assertDigestShape(dayRows, rows) {
  if (!Array.isArray(dayRows) || dayRows.length > 1) {
    throw new DigestFetchError(
      "morning_digest_days の応答が0〜1行の配列でない",
    );
  }
  if (dayRows[0] !== undefined && !isObject(dayRows[0])) {
    throw new DigestFetchError("morning_digest_days の行がオブジェクトでない");
  }
  if (!Array.isArray(rows)) {
    throw new DigestFetchError("morning_digest_rows の応答が配列でない");
  }
  rows.forEach((row, i) => {
    if (!isObject(row) || typeof row.section !== "string") {
      throw new DigestFetchError(`rows[${i}] の section が文字列でない`);
    }
    if (!RACE_SECTIONS.includes(row.section)) return;
    if (
      !Number.isInteger(row.venue_code) ||
      row.venue_code < 1 ||
      row.venue_code > 24 ||
      !Number.isInteger(row.race_number) ||
      typeof row.race_id !== "string" ||
      !/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(row.race_id)
    ) {
      throw new DigestFetchError(
        `rows[${i}]（${row.section}）の会場・レース番号・race_id が正しくない`,
      );
    }
  });
}

/**
 * morning_digest_* を読む。日付ごとに ttlMs だけ使い回す
 *
 * @param {{fetchImpl?: typeof fetch, now?: () => number, ttlMs?: number, env?: Record<string, string|undefined>, rowSelect?: string}} [options]
 *   rowSelect: 行の列。既定はボット向けの ROW_SELECT（選手の値を取らない）。/today の X 投稿（snsTodayDigest.js）だけが選手名・枠を足す
 * @returns {(date: string) => Promise<{day: object|null, rows: object[]}>}
 */
export function createDigestSource({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  ttlMs = MATERIAL_TTL_MS,
  env = process.env,
  rowSelect = ROW_SELECT,
} = {}) {
  let cache = null; // { date, at, value }
  let inflight = null; // { date, promise }

  async function getJson(url, key) {
    let res;
    try {
      res = await fetchImpl(url, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throw new DigestFetchError(`取得できない: ${e?.message ?? e}`);
    }
    if (!res.ok) throw new DigestFetchError(`HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (e) {
      throw new DigestFetchError(`JSON でない: ${e?.message ?? e}`);
    }
  }

  async function load(date) {
    // 人の画面（src/lib/supabaseClient）と同じ anon キー。api/predictions/[date].js と同じ環境変数を読む
    const base = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
    const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
    if (!base || !key) {
      throw new DigestFetchError("Supabase の URL か anon キーが無い");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new DigestFetchError(`日付の形が違う: ${date}`);
    }
    const rest = `${String(base).replace(/\/$/, "")}/rest/v1`;
    const [dayRows, rows] = await Promise.all([
      getJson(
        `${rest}/morning_digest_days?digest_date=eq.${date}&select=${DAY_SELECT}`,
        key,
      ),
      getJson(
        `${rest}/morning_digest_rows?digest_date=eq.${date}&select=${rowSelect}&order=section.asc,rank.asc`,
        key,
      ),
    ]);
    assertDigestShape(dayRows, rows);
    const value = { day: dayRows[0] ?? null, rows };
    cache = { date, at: now(), value };
    return value;
  }

  return async function getDigest(date) {
    if (cache && cache.date === date && now() - cache.at < ttlMs) {
      return cache.value;
    }
    if (inflight && inflight.date === date) return inflight.promise;
    const promise = load(date);
    inflight = { date, promise };
    try {
      return await promise;
    } finally {
      if (inflight?.promise === promise) inflight = null;
    }
  };
}

const p = (text) => (text ? `<p>${escapeHtml(text)}</p>` : "");
const span = (text) => (text ? `<span>${escapeHtml(text)}</span>` : "");

/**
 * @param {ReturnType<typeof buildTodayModel>} model
 * @param {{siteJsonLd?: object[]}} [options]
 */
export function renderTodayHtml(model, { siteJsonLd = [] } = {}) {
  const raceItem = (r) =>
    `<li><a href="${escapeHtml(r.href)}">${escapeHtml(r.race)}</a> ${span(r.deadline)}</li>`;
  const parts = [
    `<h1>${escapeHtml(model.h1)}</h1>`,
    p(model.dateLine),
    model.window
      ? `<p><strong>集計期間</strong> ${escapeHtml(model.window)}</p>`
      : "",
    p(model.notGeneratedText),
  ];
  if (model.featured) {
    const f = model.featured;
    parts.push(
      [
        "<section>",
        "<h2>今日の注目レース</h2>",
        `<p>${span(f.race)} ${span(f.deadline)}</p>`,
        p(f.reason),
        `<a href="${escapeHtml(f.href)}">このレースの詳細を見る</a>`,
        "</section>",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  for (const s of model.sections) {
    parts.push(
      [
        "<section>",
        `<h2>${escapeHtml(s.title)}</h2>`,
        span(s.count),
        p(s.description),
        p(s.notice),
        p(s.empty),
        s.races.length > 0
          ? `<ul>\n${s.races.map(raceItem).join("\n")}\n</ul>`
          : "",
        "</section>",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (model.generated) {
    parts.push(
      [
        "<section>",
        `<h2>${escapeHtml(MORNING_DIGEST_GLOSSARY_TITLE)}</h2>`,
        `<dl>\n${model.glossary
          .map(
            (g) =>
              `<dt>${escapeHtml(g.term)}</dt>\n<dd>${escapeHtml(g.body)}</dd>`,
          )
          .join("\n")}\n</dl>`,
        p(MORNING_DIGEST_DISCLAIMER),
        `<p><a href="/">ホームに戻る</a></p>`,
        "</section>",
      ].join("\n"),
    );
  }
  return documentHtml(model.meta, parts.filter(Boolean).join("\n"), {
    path: "/today",
    lang: "ja",
    // 人の /today は index.html の共通の JSON-LD と、Breadcrumb の BreadcrumbList
    jsonLd: [...siteJsonLd, toBreadcrumbListLd(TODAY_BREADCRUMB)],
  });
}

const plain = (status, headers, body) => ({ status, headers, body });

/**
 * @param {{method?: string}} req
 * @param {{getDigest: (date: string) => Promise<{day: object|null, rows: object[]}>, now: () => number,
 *   getT: () => Promise<Function>, getSiteJsonLd?: () => Promise<object[]>}} deps
 */
export async function respondTodayPage(
  { method },
  { getDigest, now, getT, getSiteJsonLd: loadSiteJsonLd = getSiteJsonLd },
) {
  if (method !== "GET" && method !== "HEAD") {
    return plain(
      405,
      { ...CLIENT_ERROR_HEADERS, Allow: "GET, HEAD" },
      "405 Method Not Allowed\n",
    );
  }
  const date = jstToday(now());
  try {
    const [digest, t, siteJsonLd] = await Promise.all([
      getDigest(date),
      getT(),
      loadSiteJsonLd(),
    ]);
    const html = renderTodayHtml(buildTodayModel(digest, { date, t }), {
      siteJsonLd,
    });
    return plain(200, SUCCESS_HEADERS, html);
  } catch (e) {
    const expected = e instanceof DigestFetchError;
    console.error(
      `[bot-page] today: 503 ${e?.name}: ${e?.message}`,
      ...(expected ? [] : [e]),
    );
    return plain(503, UNAVAILABLE_HEADERS, "503 Service Unavailable\n");
  }
}

const defaultSource = createDigestSource();

/**
 * Vercel の Node 関数のハンドラ
 *
 * @param {{getDigest?: Function, now?: () => number, getT?: () => Promise<Function>, getSiteJsonLd?: () => Promise<object[]>}} [deps]
 */
export function createTodayBotHandler({
  getDigest = defaultSource,
  now = Date.now,
  getT = getJaT,
  getSiteJsonLd: loadSiteJsonLd = getSiteJsonLd,
} = {}) {
  return async function handler(req, res) {
    const { status, headers, body } = await respondTodayPage(
      { method: req.method },
      { getDigest, now, getT, getSiteJsonLd: loadSiteJsonLd },
    );
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}

export {
  NOT_GENERATED_TEXT,
  CARD_PREVIEW_COUNT,
  buildTodayModel,
} from "../../scripts/lib/sns/todayModel.js";
