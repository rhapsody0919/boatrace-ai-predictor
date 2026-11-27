/**
 * 生の HTML の head の差し込み（middleware の枝。設計は docs/adr の「生の HTML にページごとの head」）。
 *
 * 対象のパスなら、同じ host の /index.html（その配備の外枠）を取り、src/pure/pageHead.js の injectPageHead で
 * title・description・canonical・JSON-LD を入れた HTML を返す。どんな失敗でも undefined を返して素通りにする
 * （今の静的な index.html がそのまま出る）。全ての UA に同じ物を返す（UA を見ない）。
 *
 * 入切は環境変数 PAGE_HEAD_KINDS（差し込む種類をカンマ区切り。未設定・空は差し込まない）。kind ごとに出し・戻しができる。
 */
import { STADIUM_NAMES } from "../../src/constants/index.js";
import {
  injectPageHead,
  pageHeadRoute,
  pastVenuePageHead,
} from "../../src/pure/pageHead.js";

/** 外枠の取得の上限（目安 300ms、根拠なし。本番の分布で決め直す） */
export const PAGE_HEAD_TIMEOUT_MS = 300;

// 画面のパンくずの「ホーム」（ja の analysisPage.breadcrumbHome と同じ字。訳を変えたらここも変える）。
// middleware に ja の common.json（約280KB）を束ねないため字で持つ
const HOME_NAME = "ホーム";

// vercel.json が人の HTML のパスに付けるのと同じ字（返す応答に自分で付ける）
const RESPONSE_HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache, no-store, must-revalidate, s-maxage=0",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

/** PAGE_HEAD_KINDS の値から、差し込む種類の集合 */
export function enabledKinds(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// 種類ごとの head（材料の要らない物だけ。材料が要る種類は /api/page-head を足す PR で入れる）
function headOf(route) {
  if (route.kind === "pastVenue") {
    const venueName = STADIUM_NAMES[route.venueCode];
    if (!venueName) return null;
    return pastVenuePageHead({ ...route, venueName, homeName: HOME_NAME });
  }
  return null;
}

async function fetchShell(origin, fetchImpl, timeoutMs) {
  const res = await fetchImpl(`${origin}/index.html`, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { html: null, status: res.status };
  return { html: await res.text(), status: res.status };
}

/**
 * @param {Request} request
 * @param {{env?: Record<string, string|undefined>, fetchImpl?: typeof fetch, timeoutMs?: number,
 *   log?: (line: string) => void, now?: () => number}} [deps] 既定は process.env・fetch・console.log（試験で差し替える）
 * @returns {Promise<Response|undefined>} 差し込んだ HTML。素通りは undefined
 */
export async function respondWithPageHead(request, deps = {}) {
  const { env, fetchImpl, timeoutMs, log, now } = {
    env: process.env,
    fetchImpl: (...args) => fetch(...args),
    timeoutMs: PAGE_HEAD_TIMEOUT_MS,
    log: console.log,
    now: Date.now,
    ...definedOf(deps),
  };
  const started = now();
  let kind = null;
  const done = (outcome, extra = {}) => {
    log(JSON.stringify({ page_head: kind, outcome, ms: now() - started, ...extra }));
    return undefined;
  };
  // middleware の例外は対象の全ページの 5xx になるので、この枝の失敗は種類を問わず素通りにする
  // （AGENTS.md の「try/catch は種類で分けるときだけ」の例外）
  try {
    const target = targetOf(request, env);
    if (!target) return undefined;
    kind = target.route.kind;
    const head = headOf(target.route);
    if (!head) return done("no_head");
    // 外枠は必ず /index.html を取る（/ は matcher に入り middleware がもう一度動く。/index.html は matcher の外）
    const shell = await fetchShell(target.origin, fetchImpl, timeoutMs);
    if (shell.html === null) return done("shell_status", { status: shell.status });
    const html = injectPageHead(shell.html, head);
    if (html === null) return done("not_injectable");
    const ms = now() - started;
    done("injected");
    return new Response(html, {
      status: 200,
      headers: { ...RESPONSE_HEADERS, "server-timing": `page-head;dur=${ms}` },
    });
  } catch (error) {
    return done(...failureOf(error));
  }
}

// 差し込む対象か。GET で、パスが対象の形で、その種類が PAGE_HEAD_KINDS にあるときだけ
function targetOf(request, env) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const route = pageHeadRoute(url.pathname);
  if (!route || !enabledKinds(env.PAGE_HEAD_KINDS).has(route.kind)) return null;
  return { origin: url.origin, route };
}

// undefined の値を落とす（呼び手が渡した undefined で既定を消さない）
const definedOf = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// 例外の理由（時間切れか、それ以外か）と短い文
function failureOf(error) {
  const outcome = error?.name === "TimeoutError" ? "timeout" : "error";
  return [outcome, { message: String(error?.message ?? error).slice(0, 200) }];
}
