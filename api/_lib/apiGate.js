/**
 * /api の関門の判定（BOA-1110、ADR-0103、docs/design/public-api-lockdown/plan.md §2.2）。
 *
 * 段階3（観測）: middleware.js が /api/:path* でこの判定を呼び、1行の JSON ログ（gateLogRecord）を出す。
 * 段階4（強制）は環境変数 API_GATE_MODE=enforce と Redeploy だけで入る（コードは変えない）。
 * 判定の順（plan §2.2 の図）:
 *   1. パスをデコードできない、またはデコード後に「.」「..」のセグメント・「//」・「\」を含む → 400
 *      （%2F..%2F で除外の前方一致に入れて関門を外すのを防ぐ。段階に依らず観測中も 400）
 *      二重のエンコード（%252F 等）も、デコードが変わらなくなるまで繰り返して同じ形を探す。
 *      エンコードした「/」（%2F）も 400（/api%2Fcron/… が1回のデコードで除外に入るのを防ぐ）
 *   1b. /API/… のように大文字にした形も /api として関門に掛ける（除外は大文字小文字を区別）
 *   2. デコード後が /api/cron・/api/admin・/api/bot-page → 関門を通さない（既存の守りのまま）
 *   3. 合言葉 x-ryujin-internal-key が INTERNAL_API_KEY（current）か INTERNAL_API_KEY_NEXT（next）と一致 → 通す
 *      付いているのに一致しない → bad_key（段階に従う）
 *   4. Sec-Fetch-Site: same-origin で、Origin が無いか自分の host → browser
 *   5. Sec-Fetch-Site が無く、Referer の host が自分の host → browser_legacy（古いブラウザ）
 *   6. UA が Googlebot・Google-InspectionTool を名乗り、接続元 IP が Google の公開の範囲 → search_bot
 *   7. それ以外 → 観測は would_deny（通す）、強制は deny（403）
 *
 * 結果はそのまま1行の JSON ログにできる形（reason・key_slot・caller・bot_verified・ua_class・path・sfs・origin_host）。
 * IP・UA の全文・鍵の値は結果に入れない。
 */
import { AI_CRAWLER_USER_AGENTS } from "../../src/config/aiCrawlerBots.js";
import { constantTimeEqual } from "./adminAuth.js";
import { CALLER_HEADER, INTERNAL_KEY_HEADER } from "./internalApiHeaders.js";

// ヘッダの名前の正本は付ける側（internalApiHeaders.js）。判定側はそれを読む
export { CALLER_HEADER, INTERNAL_KEY_HEADER };

// 関門を通さないパス（それぞれ既存の守りがある。plan §1.1）
export const API_GATE_EXCLUDED_PREFIXES = [
  "/api/cron",
  "/api/admin",
  "/api/bot-page",
];

// UA と IP の範囲の両方で確かめて通す検索ボット（plan §2.2。bingbot 等はボット HTML を受けるので入れない）
export const VERIFIED_SEARCH_BOTS = ["Googlebot", "Google-InspectionTool"];
// ua_class で「検索ボット」に丸める名前（数えるだけ。通す理由にはしない）
const SEARCH_BOT_NAMES = [
  ...VERIFIED_SEARCH_BOTS,
  "bingbot",
  "Applebot",
  "DuckDuckBot",
];
const AI_BOT_NAMES = AI_CRAWLER_USER_AGENTS.filter(
  (name) => !SEARCH_BOT_NAMES.includes(name),
);

const MAX_DECODE_ROUNDS = 4;
// 鍵が空の枠と比べる捨てる値（一致しても key が null なので通さない。比べる回数をそろえるだけ）
const UNSET_KEY_PLACEHOLDER = "\u0000unset";
const MAX_LOG_PATH = 200;

/**
 * API_GATE_MODE は "enforce" のときだけ強制。未設定・その他の値は観測（plan §2.2、既定 observe）。
 * Vercel の値の前後の空白・改行は落とす（"enforce\n" で黙って観測に戻らない）
 */
export function normalizeGateMode(value) {
  return typeof value === "string" && value.trim() === "enforce"
    ? "enforce"
    : "observe";
}

const trimmedOrUndefined = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * 環境変数から関門の鍵を読む。前後の空白・改行を落とし、空は「無い」にする。
 * 付ける側の fetch（Headers）は値の前後の空白を落とすので、Vercel に置いた値の末尾に改行が入っていても
 * そのまま比べると bad_key になる（段階1の /code-review の指摘1）。比べる前に同じ形にそろえる
 * @param {Record<string, string|undefined>} env 既定は process.env
 * @returns {{ current?: string, next?: string }}
 */
export function gateKeysFromEnv(env = process.env) {
  return {
    current: trimmedOrUndefined(env?.INTERNAL_API_KEY),
    next: trimmedOrUndefined(env?.INTERNAL_API_KEY_NEXT),
  };
}

const hasForbiddenForm = (path) =>
  path.includes("//") ||
  path.includes("\\") ||
  path.split("/").some((segment) => segment === "." || segment === "..");

// エンコードした「/」。/api%2Fcron/… を1回デコードすると /api/cron/… になり除外に入るが、
// 経路の振り分けがデコードしないと別の関数に届きうる。正規の呼び出し元は「/」をエンコードしない
const ENCODED_SLASH = /%2f/i;

/**
 * パスをデコードして、禁じた形を探す。
 * 返り値: { ok: false } か { ok: true, decoded }（decoded は1回デコードした値。除外の判定に使う）
 * 1回目のデコードに失敗したら 400。2回目以降のデコードの失敗は、そこで止める
 * （/api/x/50%25 の「%」は文字として扱う。二重のエンコードを探すための繰り返しで正規のパスを落とさない）
 */
export function inspectApiPath(rawPathname) {
  if (ENCODED_SLASH.test(rawPathname)) return { ok: false };
  let first;
  try {
    first = decodeURIComponent(rawPathname);
  } catch {
    return { ok: false };
  }
  let current = first;
  for (let round = 1; ; round++) {
    if (hasForbiddenForm(current) || ENCODED_SLASH.test(current)) {
      return { ok: false };
    }
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return { ok: true, decoded: first };
    }
    if (next === current) return { ok: true, decoded: first };
    // 4回デコードしても変わり続ける（%25 の重ね）は正規の呼び出し元が作らない
    if (round >= MAX_DECODE_ROUNDS) return { ok: false };
    current = next;
  }
}

const isUnder = (path, prefix) =>
  path === prefix || path.startsWith(`${prefix}/`);

const hostOf = (value) => {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
};

// Googlebot-Image のような別の名前に一致させない（名前の直後は "/" か区切り）。要求ごとに作らない
const NAME_PATTERNS = new Map(
  SEARCH_BOT_NAMES.map((name) => [
    name,
    new RegExp(
      `(?:^|[^A-Za-z0-9-])${name.replace(/[-]/g, "\\-")}(?:/|;|\\)|\\s|$)`,
    ),
  ]),
);
const nameIn = (ua, name) => NAME_PATTERNS.get(name).test(ua);

/** UA を数えるための分類に丸める（全文はログに書かない） */
export function classifyUserAgent(ua) {
  if (!ua) return "none";
  const search = SEARCH_BOT_NAMES.find((name) => nameIn(ua, name));
  if (search) return `search_bot:${search}`;
  const ai = AI_BOT_NAMES.find((name) => ua.includes(name));
  if (ai) return `ai_bot:${ai}`;
  if (/^curl\//i.test(ua)) return "tool:curl";
  if (/python|aiohttp|httpx/i.test(ua)) return "tool:python";
  if (/^node\b|undici|node-fetch|axios/i.test(ua)) return "tool:node";
  if (/^Mozilla\//.test(ua)) return "browser";
  return "other";
}

const claimedVerifiedBot = (ua) =>
  Boolean(ua) && VERIFIED_SEARCH_BOTS.some((name) => nameIn(ua, name));

// ---- IP の範囲 ----

function parseIpv4(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(text) {
  if (text.includes("%")) return null; // ゾーン ID は受けない
  let head = text;
  let tailWords = [];
  // 末尾が IPv4 の書き方（::ffff:1.2.3.4）
  const lastColon = text.lastIndexOf(":");
  if (lastColon >= 0 && text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tailWords = [Number(v4 >> 16n), Number(v4 & 0xffffn)];
    head = text.slice(0, lastColon + 1);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const toWords = (s) => (s === "" ? [] : s.split(":"));
  const left = toWords(halves[0]);
  const right = halves.length === 2 ? toWords(halves[1]) : [];
  const words = [...left, ...right];
  if (!words.every((w) => /^[0-9a-fA-F]{1,4}$/.test(w))) return null;
  const explicit = words.length + tailWords.length;
  if (halves.length === 1 && explicit !== 8) return null;
  if (halves.length === 2 && explicit > 7) return null;
  const fill = 8 - explicit;
  const all = [
    ...left.map((w) => parseInt(w, 16)),
    ...Array(halves.length === 2 ? fill : 0).fill(0),
    ...right.map((w) => parseInt(w, 16)),
    ...tailWords,
  ];
  return all.reduce((acc, w) => (acc << 16n) | BigInt(w), 0n);
}

/** "1.2.3.4" / "2001:db8::1" を { version, value } に。読めなければ null */
export function parseIp(text) {
  if (typeof text !== "string" || text === "") return null;
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const v6 = parseIpv6(trimmed);
    if (v6 === null) return null;
    // IPv4 を写した IPv6（::ffff:a.b.c.d）は IPv4 として扱う
    if (v6 >> 32n === 0xffffn) return { version: 4, value: v6 & 0xffffffffn };
    return { version: 6, value: v6 };
  }
  const v4 = parseIpv4(trimmed);
  return v4 === null ? null : { version: 4, value: v4 };
}

function parseCidr(cidr) {
  const [addr, bitsText] = cidr.split("/");
  const ip = parseIp(addr);
  const width = ip?.version === 6 ? 128 : 32;
  const bits = Number(bitsText);
  if (!ip || !Number.isInteger(bits) || bits < 0 || bits > width) {
    throw new Error(`IP の範囲 "${cidr}" を読めない`);
  }
  const shift = BigInt(width - bits);
  return { version: ip.version, bits, shift, base: ip.value >> shift };
}

/**
 * api/_lib/searchBotIpRanges.json（scripts/maintenance/verify-search-bot-ip-ranges.js --write が書く）を
 * 照合しやすい形にする。読めない範囲があれば例外（黙って範囲を減らさない）
 */
export function compileIpRanges(table) {
  const sources = Array.isArray(table?.sources) ? table.sources : [];
  if (sources.length === 0) throw new Error("IP の範囲の表に sources が無い");
  return sources.flatMap((source) => source.prefixes.map(parseCidr));
}

export function ipInRanges(ipText, compiledRanges) {
  const ip = parseIp(ipText);
  if (!ip) return false;
  return compiledRanges.some(
    (range) =>
      range.version === ip.version && ip.value >> range.shift === range.base,
  );
}

const sanitizeCaller = (value) => {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);
  return cleaned === "" ? null : cleaned;
};

/**
 * /api の要求を判定する。
 * @param {{
 *   url: string,                 // request.url（host とパスを取る）
 *   headers: Headers,            // request.headers
 *   ip: string|null,             // 接続元 IP（Vercel の x-real-ip）
 *   mode: "observe"|"enforce",
 *   keys: { current?: string, next?: string },  // INTERNAL_API_KEY・INTERNAL_API_KEY_NEXT。空は「無い」
 *   ipRanges: ReturnType<typeof compileIpRanges>,
 * }} input
 * @returns {Promise<{
 *   outcome: "pass"|"reject", status: 400|403|null,
 *   reason: "bad_path"|"not_api"|"excluded"|"internal"|"bad_key"|"browser"|"browser_legacy"|"search_bot"|"would_deny"|"deny",
 *   key_slot: "current"|"next"|null, caller: string|null, caller_claimed: string|null, bot_verified: boolean|null,
 *   ua_class: string, path: string, sfs: string|null, origin_host: string|null,
 * }>}
 */
export async function decideApiGate({
  url,
  headers,
  ip,
  mode,
  keys,
  ipRanges,
}) {
  const parsed = new URL(url);
  const selfHost = parsed.host;
  const ua = headers.get("user-agent");
  const sfs = headers.get("sec-fetch-site")?.toLowerCase() ?? null;
  const originHeader = headers.get("origin");
  const originHost = hostOf(originHeader);
  const botVerified = claimedVerifiedBot(ua) ? ipInRanges(ip, ipRanges) : null;
  const inspected = inspectApiPath(parsed.pathname);
  const claimedCaller = sanitizeCaller(headers.get(CALLER_HEADER));

  const result = (fields) => ({
    outcome: "pass",
    status: null,
    key_slot: null,
    caller: null,
    // 合言葉で通らなかった要求が名乗った呼び出し元（偽れるので数える手がかりだけ。internal のときは null）
    caller_claimed: claimedCaller,
    bot_verified: botVerified,
    ua_class: classifyUserAgent(ua),
    path: (inspected.ok ? inspected.decoded : parsed.pathname).slice(
      0,
      MAX_LOG_PATH,
    ),
    sfs,
    origin_host: originHost,
    ...fields,
  });
  const byMode = (enforceReason, observeReason) =>
    normalizeGateMode(mode) === "enforce"
      ? result({ outcome: "reject", status: 403, reason: enforceReason })
      : result({ reason: observeReason });

  if (!inspected.ok) {
    return result({ outcome: "reject", status: 400, reason: "bad_path" });
  }
  const path = inspected.decoded;
  // /API/… のように大文字にした形も関門に掛ける（除外の判定は大文字小文字を区別したまま＝除外を広げない）
  if (!isUnder(path.toLowerCase(), "/api"))
    return result({ reason: "not_api" });
  if (API_GATE_EXCLUDED_PREFIXES.some((prefix) => isUnder(path, prefix))) {
    return result({ reason: "excluded" });
  }

  // 受け取った値も、比べる鍵も、前後の空白を落としてから比べる（gateKeysFromEnv と同じ形）
  const provided = trimmedOrUndefined(headers.get(INTERNAL_KEY_HEADER));
  if (provided) {
    const slots = [
      ["current", keys?.current],
      ["next", keys?.next],
    ].map(([slot, key]) => [slot, trimmedOrUndefined(key) ?? null]);
    // 両方の枠を必ず比べ（空の枠も捨てる値と比べる）、どちらで一致したか・NEXT があるかを時間差で漏らさない
    const matches = await Promise.all(
      slots.map(([, key]) =>
        constantTimeEqual(provided, key ?? UNSET_KEY_PLACEHOLDER),
      ),
    );
    const hit = slots.find(([, key], i) => key !== null && matches[i]);
    if (hit) {
      return result({
        reason: "internal",
        key_slot: hit[0],
        caller: claimedCaller,
        caller_claimed: null,
      });
    }
    return byMode("bad_key", "bad_key");
  }

  if (
    sfs === "same-origin" &&
    (originHeader === null || originHost === selfHost)
  ) {
    return result({ reason: "browser" });
  }
  if (sfs === null && hostOf(headers.get("referer")) === selfHost) {
    return result({ reason: "browser_legacy" });
  }
  if (botVerified === true) return result({ reason: "search_bot" });
  return byMode("deny", "would_deny");
}

/** 400・403 の応答。拒んだ結果を CDN に残さない（no-store） */
export function gateRejectResponse(status) {
  return new Response(status === 400 ? "Bad Request" : "Forbidden", {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
}

// ---- ログ（段階3の観測。plan §2.2・§6） ----

/**
 * 数える群（plan §6 の2・段階3の進む条件）。would_deny を bingbot・AI のクローラー・hq・龍神のスクリプトに分けて数える。
 * - internal: caller が "hq-" で始まれば hq、それ以外は ryujin（bot-page・sns-claim-check・full-picture-* 等）
 * - それ以外: UA の丸め（Google・bingbot・ほかの検索ボット・AI のクローラー）が先、次に名乗った呼び出し元
 *   （hq- なら hq、ほかの名前は ryujin。偽れるので手がかり）、次にブラウザ、残りは other
 */
export function gateGroup(decision) {
  const callerName =
    decision.reason === "internal" ? decision.caller : decision.caller_claimed;
  if (decision.reason === "internal") {
    return callerName?.startsWith("hq-") ? "hq" : "ryujin";
  }
  const ua = decision.ua_class ?? "";
  if (
    ua === "search_bot:Googlebot" ||
    ua === "search_bot:Google-InspectionTool"
  )
    return "google";
  if (ua === "search_bot:bingbot") return "bingbot";
  if (ua.startsWith("search_bot:")) return "search_other";
  if (ua.startsWith("ai_bot:")) return "ai_crawler";
  if (callerName) return callerName.startsWith("hq-") ? "hq" : "ryujin";
  if (ua === "browser") return "browser";
  return "other";
}

// reason=browser は件数が多い（odds/live のポーリング）ので抜き取る（plan §2.2）。
// 10件に1件は目安（根拠なし）。数えるときは sample を掛けて戻す
export const BROWSER_LOG_SAMPLE = 10;
// 書かない reason（既存の守りがある除外・/api でないもの）
const UNLOGGED_REASONS = new Set(["excluded", "not_api"]);

/**
 * 1要求1行の JSON ログにする中身。null を返したら書かない。
 * 鍵の値・IP・UA の全文・クエリ文字列は decision に入っていない（verify-api-gate.js [8]）。
 * tag は全文検索で群ごとに数えるための1語（例 "apigate_would_deny_bingbot"。Vercel の Runtime Logs の検索に使う）
 * @param {Awaited<ReturnType<typeof decideApiGate>>} decision
 * @param {{ mode: string, method: string, random?: () => number }} context
 */
export function gateLogRecord(decision, { mode, method, random = Math.random }) {
  if (UNLOGGED_REASONS.has(decision.reason)) return null;
  // 検索ボットを名乗る要求（bot_verified が true/false）は、browser で通っても抜き取らない（段階4の条件の母数）
  const sampled =
    decision.reason === "browser" && decision.bot_verified === null;
  if (sampled && random() >= 1 / BROWSER_LOG_SAMPLE) return null;
  const group = gateGroup(decision);
  return {
    api_gate: decision.reason,
    group,
    tag: `apigate_${decision.reason}_${group}`,
    mode: normalizeGateMode(mode),
    method: typeof method === "string" ? method.slice(0, 10) : null,
    status: decision.status,
    path: decision.path,
    sfs: decision.sfs,
    origin_host: decision.origin_host,
    ua_class: decision.ua_class,
    caller: decision.caller,
    caller_claimed: decision.caller_claimed,
    key_slot: decision.key_slot,
    bot_verified: decision.bot_verified,
    sample: sampled ? BROWSER_LOG_SAMPLE : 1,
  };
}
