/**
 * /api の関門の判定（BOA-1110、ADR-0103、docs/design/public-api-lockdown/plan.md §2.2）。
 *
 * 段階0: 判定の純関数だけを置く。middleware.js からはまだ呼ばない（matcher に /api を足すのは段階3）。
 * 判定の順（plan §2.2 の図）:
 *   1. パスをデコードできない、またはデコード後に「.」「..」のセグメント・「//」・「\」を含む → 400
 *      （%2F..%2F で除外の前方一致に入れて関門を外すのを防ぐ。段階に依らず観測中も 400）
 *      二重のエンコード（%252F 等）も、デコードが変わらなくなるまで繰り返して同じ形を探す
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

export const INTERNAL_KEY_HEADER = "x-ryujin-internal-key";
export const CALLER_HEADER = "x-ryujin-caller";

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
const MAX_LOG_PATH = 200;

/** API_GATE_MODE は "enforce" のときだけ強制。未設定・その他の値は観測（plan §2.2、既定 observe） */
export function normalizeGateMode(value) {
  return value === "enforce" ? "enforce" : "observe";
}

const hasForbiddenForm = (path) =>
  path.includes("//") ||
  path.includes("\\") ||
  path.split("/").some((segment) => segment === "." || segment === "..");

/**
 * パスをデコードして、禁じた形を探す。
 * 返り値: { ok: false } か { ok: true, decoded }（decoded は1回デコードした値。除外の判定に使う）
 */
export function inspectApiPath(rawPathname) {
  let current = rawPathname;
  let first = null;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return { ok: false };
    }
    if (first === null) first = next;
    if (hasForbiddenForm(next)) return { ok: false };
    if (next === current) return { ok: true, decoded: first };
    current = next;
  }
  // 4回デコードしても変わり続ける（%25 の重ね）は正規の呼び出し元が作らない
  return { ok: false };
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

const nameIn = (ua, name) =>
  // Googlebot-Image のような別の名前に一致させない（名前の直後は "/" か区切り）
  new RegExp(
    `(?:^|[^A-Za-z0-9-])${name.replace(/[-]/g, "\\-")}(?:/|;|\\)|\\s|$)`,
  ).test(ua);

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
 *   key_slot: "current"|"next"|null, caller: string|null, bot_verified: boolean|null,
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

  const result = (fields) => ({
    outcome: "pass",
    status: null,
    key_slot: null,
    caller: null,
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
  if (!isUnder(path, "/api")) return result({ reason: "not_api" });
  if (API_GATE_EXCLUDED_PREFIXES.some((prefix) => isUnder(path, prefix))) {
    return result({ reason: "excluded" });
  }

  const provided = headers.get(INTERNAL_KEY_HEADER);
  if (provided) {
    const slots = [
      ["current", keys?.current],
      ["next", keys?.next],
    ].filter(([, key]) => typeof key === "string" && key !== "");
    // 両方の枠を必ず比べ、どちらで一致したかを時間差で漏らさない
    const matches = await Promise.all(
      slots.map(([, key]) => constantTimeEqual(provided, key)),
    );
    const hit = slots.find((_, i) => matches[i]);
    if (hit) {
      return result({
        reason: "internal",
        key_slot: hit[0],
        caller: sanitizeCaller(headers.get(CALLER_HEADER)),
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
