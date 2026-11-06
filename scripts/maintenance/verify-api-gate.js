/**
 * /api の関門の判定（api/_lib/apiGate.js の decideApiGate、BOA-1110・ADR-0103）を固定する。
 * 判定の順は docs/design/public-api-lockdown/plan.md §2.2 の図どおり。
 *
 * 1. デコードできない・デコード後に「.」「..」のセグメント・「//」・「\」を含むパスは、段階に依らず 400
 *    （%2F..%2F・..%2f で /api/bot-page・/api/cron の除外に入れて関門を外す形。二重のエンコードも）
 * 2. /api/cron・/api/admin・/api/bot-page は除外（関門を通さない）。/api/cronx 等の似た名前は除外しない。
 *    /%61pi/… は /api/… として判定する
 * 3. 合言葉は current・next のどちらでも通り（key_slot を返す）、偽の鍵は bad_key（観測は通す・強制は 403）。
 *    鍵が未設定・空のとき、空のヘッダや任意の値で通さない（fail-closed）
 * 4. Sec-Fetch-Site: same-origin（Origin が無いか自分の host）は browser。Preview の host でも同じ判定で通る
 * 5. Sec-Fetch-Site が無く Referer が自分の host なら browser_legacy。Sec-Fetch-Site があるときは Referer を見ない
 * 6. Googlebot・Google-InspectionTool の UA で、IP が範囲の表（固定の IPv4・IPv6）に入れば search_bot。
 *    IP が範囲の外・UA だけ・bingbot・Googlebot-Image は通さない。bot_verified は Google の UA のときだけ true/false
 * 7. それ以外は観測で would_deny（通す）、強制で deny（403 no-store）。API_GATE_MODE は "enforce" のときだけ強制
 * 8. 結果（ログの1行）に鍵・IP・UA の全文・クエリ文字列を入れない
 * 10. 段階3のログ: env の鍵・API_GATE_MODE の前後の空白・改行を落とす（Vercel の値の末尾の改行で bad_key・観測に戻らない）。
 *    群（bingbot・AI のクローラー・hq・龍神のスクリプト・Google・ブラウザ）を分けて数えられる。browser は抜き取り、除外は書かない
 * 11. CORS（段階3、plan §2.1 ①）: api/ の関数と vercel.json に Access-Control-Allow-Origin を置かない
 *    （画面は同じ origin なので要らない。別サイトの JS から応答を読ませない）
 * 12. ログの数え方（count-api-gate-log.js）: Vercel の行の形（テキスト・message に入った JSON）から拾い、
 *    browser の抜き取りを掛け戻し、群ごと・自分の呼び出し元の群ごと・bot_verified を数えて、段階4の条件を出す
 * 13. ブラウザの UA で Sec-Fetch-Site が無い要求（オーナー 2026-11-06 決定）: Origin が無いか自分の host なら
 *    観測でも強制でも browser_no_sfs で通し、抜き取らずに全件ログに書く。curl・python・node・UA 無し・
 *    bingbot・AI のクローラー・Origin が別の host・Sec-Fetch-Site が same-origin 以外は、強制で 403 のまま
 */
import { readFileSync } from "node:fs";
import { readSourceFile, walkSourceFiles } from "../lib/sourceFileWalk.js";
import { countApiGateLines, extractGateRecord } from "./count-api-gate-log.js";
import {
  classifyUserAgent,
  compileIpRanges,
  decideApiGate,
  BROWSER_LOG_SAMPLE,
  gateGroup,
  gateKeysFromEnv,
  gateLogRecord,
  gateRejectResponse,
  inspectApiPath,
  ipInRanges,
  normalizeGateMode,
  parseIp,
} from "../../api/_lib/apiGate.js";

const { default: table } = await import("../../api/_lib/searchBotIpRanges.js");
const ipRanges = compileIpRanges(table);

const CURRENT = "verify-current-key-0123456789";
const NEXT = "verify-next-key-9876543210";
const HOST = "https://www.boat-ai.jp";
const PREVIEW = "https://boatrace-ai-predictor-git-x-rhapsody0919.vercel.app";
const CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const GOOGLEBOT_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GOOGLEBOT_DESKTOP_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0 Safari/537.36";
const INSPECTION_UA = "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)";
const INSPECTION_MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0)";
const BINGBOT_UA =
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
const GOOGLEBOT_IMAGE_UA = "Googlebot-Image/1.0";
// 範囲の表（Google の common-crawlers.json）に入る固定の IP（2026-10-27 の表）
const GOOGLE_IPV4 = "66.249.66.1";
const GOOGLE_IPV6 = "2001:4860:4801:10::1";
const OTHER_IP = "8.8.8.8";

const failures = [];
function check(label, ok, detail = "") {
  if (ok) console.log(`  OK  ${label}`);
  else {
    console.log(`  NG  ${label}${detail ? ` (${detail})` : ""}`);
    failures.push(label);
  }
}

async function gate(
  path,
  {
    headers = {},
    ip = null,
    mode = "observe",
    keys = { current: CURRENT, next: NEXT },
    base = HOST,
  } = {},
) {
  return decideApiGate({
    url: `${base}${path}`,
    headers: new Headers(headers),
    ip,
    mode,
    keys,
    ipRanges,
  });
}
const show = (d) =>
  `outcome=${d.outcome} status=${d.status} reason=${d.reason} slot=${d.key_slot} bot=${d.bot_verified}`;

console.log("[1] 禁じた形のパスは段階に依らず 400");
const BAD_PATHS = [
  "/api/bot-page%2F..%2Fpredictions/2026-10-26",
  "/api/bot-page%2f..%2fpredictions/2026-10-26",
  "/api/cron/..%2fanalogy/facts/2026-10-26-01-01",
  "/api/cron/..%2Fanalogy/facts/2026-10-26-01-01",
  "/api/bot-page%2F.%2F..%2Faccuracy",
  "/api/admin/sns-hub%2F..%2F..%2Faccuracy",
  "/api//accuracy",
  "/api/accuracy//",
  "/api%2F%2Faccuracy",
  "/api/bot-page%5C..%5Caccuracy",
  "/api/x%2F.%2Fy",
  // 二重のエンコード（関数の側でもう1回デコードされても抜けない）
  "/api/cron/%252e%252e/accuracy",
  "/api/bot-page%252F..%252Faccuracy",
  // エンコードした「/」（1回のデコードで除外に入る形）
  "/api%2Fcron/odds",
  "/api%2fbot-page/top",
  "/api/admin%2Fsns-hub/drafts",
  "/api/races%2Ftoday",
  // デコードできない
  "/api/accuracy%E0%A4%A",
  "/api/%",
  // %25 を重ねてデコードが止まらない
  "/api/%2525252525252e",
];
for (const path of BAD_PATHS) {
  for (const mode of ["observe", "enforce"]) {
    const d = await gate(path, {
      mode,
      headers: { "sec-fetch-site": "same-origin" },
    });
    check(
      `${mode} ${path} → 400`,
      d.outcome === "reject" && d.status === 400 && d.reason === "bad_path",
      show(d),
    );
  }
  const withKey = await gate(path, {
    headers: { "x-ryujin-internal-key": CURRENT },
  });
  check(
    `${path} は合言葉があっても 400`,
    withKey.status === 400,
    show(withKey),
  );
}
check(
  "inspectApiPath: 正規のパスは通り、1回デコードした値を返す",
  inspectApiPath("/api/analogy/facts/2026-10-26-01-01").decoded ===
    "/api/analogy/facts/2026-10-26-01-01" &&
    inspectApiPath("/%61pi/accuracy").decoded === "/api/accuracy",
);
// 2回目以降のデコードの失敗では落とさない（「%」を文字として含むパス）
for (const path of ["/api/x/50%25", "/api/x/%25E3", "/api/a%2525b"]) {
  const d = await gate(path);
  check(
    `${path} は 400 にしない → would_deny`,
    d.reason === "would_deny",
    show(d),
  );
}

console.log("[2] 除外のパスと似た名前、/%61pi/");
for (const path of [
  "/api/cron",
  "/api/cron/odds",
  "/api/admin/sns-hub/drafts",
  "/api/admin/rules/performance",
  "/api/bot-page/top",
  "/api/bot-page/en/venue/24",
  "/api/bot-page/race/2026-10-26-01-01",
  "/api/admin/sns-h%75b/drafts",
]) {
  const d = await gate(path);
  check(
    `${path} → excluded（関門を通さない）`,
    d.outcome === "pass" && d.reason === "excluded",
    show(d),
  );
}
{
  // 生のバックスラッシュは WHATWG URL が「/」に直して「..」を畳む。除外に入らず関門に掛かる
  const d = await gate("/api/bot-page\\..\\accuracy");
  check(
    "生の \\ は URL が畳み、除外に入らない → would_deny",
    d.reason === "would_deny" && d.path === "/api/accuracy",
    show(d),
  );
}
for (const path of [
  "/api/cronx",
  "/api/cron-x/a",
  "/api/bot-pages/top",
  "/api/administrator",
  "/api/Cron/odds",
  // 大文字にした /api も関門に掛ける（not_api にしない）
  "/API/accuracy",
  "/Api/predictions/2026-10-26",
  "/API/cron/odds",
]) {
  const d = await gate(path);
  check(
    `${path} は除外しない → would_deny`,
    d.reason === "would_deny",
    show(d),
  );
}
for (const path of [
  "/%61pi/predictions/2026-10-26",
  "/api/accur%61cy",
  "/%61%70%69/analogy/facts/2026-10-26-01-01",
]) {
  const d = await gate(path);
  check(
    `${path} は /api/… として判定する → would_deny`,
    d.reason === "would_deny" && d.path.startsWith("/api/"),
    show(d),
  );
}
for (const path of ["/", "/race/2026-10-26-01-01", "/apix/predictions"]) {
  const d = await gate(path);
  check(
    `${path} → not_api`,
    d.reason === "not_api" && d.outcome === "pass",
    show(d),
  );
}

console.log("[3] 合言葉（current・next・偽の鍵・未設定）");
{
  const cur = await gate("/api/predictions/2026-10-26", {
    headers: {
      "x-ryujin-internal-key": CURRENT,
      "x-ryujin-caller": "hq-full-picture",
    },
  });
  check(
    "current の鍵 → internal key_slot=current",
    cur.reason === "internal" &&
      cur.key_slot === "current" &&
      cur.outcome === "pass",
    show(cur),
  );
  check(
    "caller は名前のヘッダをそのまま",
    cur.caller === "hq-full-picture",
    String(cur.caller),
  );
  const next = await gate("/api/predictions/2026-10-26", {
    headers: { "x-ryujin-internal-key": NEXT },
  });
  check(
    "next の鍵 → internal key_slot=next",
    next.reason === "internal" && next.key_slot === "next",
    show(next),
  );
  check("caller が無ければ null", next.caller === null);
  const dirty = await gate("/api/races/today", {
    headers: {
      "x-ryujin-internal-key": CURRENT,
      "x-ryujin-caller": "bot page<script>/../ " + "x".repeat(60),
    },
  });
  check(
    "caller は英数字とハイフンだけ32字まで",
    /^[A-Za-z0-9-]{1,32}$/.test(dirty.caller ?? ""),
    String(dirty.caller),
  );
  for (const mode of ["observe", "enforce"]) {
    const fake = await gate("/api/analogy/facts/2026-10-26-01-01", {
      mode,
      headers: {
        "x-ryujin-internal-key": `${CURRENT}x`,
        "sec-fetch-site": "same-origin",
        "x-ryujin-caller": "fake",
      },
    });
    check(
      `${mode} 偽の鍵 → bad_key（ブラウザのヘッダがあっても）`,
      fake.reason === "bad_key" && fake.caller === null,
      show(fake),
    );
    check(
      `${mode} 偽の鍵の結果`,
      mode === "enforce" ? fake.status === 403 : fake.outcome === "pass",
      show(fake),
    );
  }
  const prefix = await gate("/api/accuracy", {
    headers: { "x-ryujin-internal-key": CURRENT.slice(0, -1) },
  });
  check(
    "鍵の前方だけの一致 → bad_key",
    prefix.reason === "bad_key",
    show(prefix),
  );
  for (const [label, keys] of [
    ["鍵が未設定", {}],
    ["鍵が空文字", { current: "", next: "" }],
    ["keys 自体が無い", undefined],
  ]) {
    const any = await gate("/api/accuracy", {
      keys,
      headers: { "x-ryujin-internal-key": "anything" },
    });
    check(
      `${label}: 任意の値の合言葉 → bad_key`,
      any.reason === "bad_key",
      show(any),
    );
    const empty = await gate("/api/accuracy", {
      keys,
      headers: { "x-ryujin-internal-key": "" },
    });
    check(
      `${label}: 空の合言葉は合言葉の経路に入らない → would_deny`,
      empty.reason === "would_deny",
      show(empty),
    );
  }
  const onlyNext = await gate("/api/accuracy", {
    keys: { current: "", next: NEXT },
    headers: { "x-ryujin-internal-key": NEXT },
  });
  check(
    "current が空で next だけ → next で通る",
    onlyNext.key_slot === "next",
    show(onlyNext),
  );
  const emptyVsEmpty = await gate("/api/accuracy", {
    keys: { current: "" },
    headers: { "x-ryujin-internal-key": " " },
  });
  check(
    "空白だけの合言葉（Headers が空にする）と空の鍵 → 通さない（would_deny）",
    emptyVsEmpty.reason === "would_deny" && emptyVsEmpty.key_slot === null,
    show(emptyVsEmpty),
  );
}

console.log("[4] ブラウザ（Sec-Fetch-Site・Origin）");
{
  const cases = [
    [
      "same-origin・Origin 無し",
      { "sec-fetch-site": "same-origin" },
      "browser",
    ],
    ["same-origin・大文字", { "sec-fetch-site": "Same-Origin" }, "browser"],
    [
      "same-origin・Origin が自分",
      { "sec-fetch-site": "same-origin", origin: HOST },
      "browser",
    ],
    [
      "same-origin・Origin が別",
      { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
      "would_deny",
    ],
    [
      "same-origin・Origin が null",
      { "sec-fetch-site": "same-origin", origin: "null" },
      "would_deny",
    ],
    [
      "same-site",
      { "sec-fetch-site": "same-site", referer: `${HOST}/` },
      "would_deny",
    ],
    [
      "cross-site",
      { "sec-fetch-site": "cross-site", referer: `${HOST}/` },
      "would_deny",
    ],
    ["none（アドレスバー）", { "sec-fetch-site": "none" }, "would_deny"],
    // ブラウザの UA で Sec-Fetch-Site が無い要求は browser_no_sfs（[13]、オーナー 2026-11-06）
    ["Sec-Fetch-Site 無し・ブラウザの UA", {}, "browser_no_sfs"],
    [
      "同じ host 名の別ポート",
      {
        "sec-fetch-site": "same-origin",
        origin: "https://www.boat-ai.jp:8443",
      },
      "would_deny",
    ],
  ];
  for (const [label, headers, want] of cases) {
    const d = await gate("/api/odds/live?raceId=2026-10-26-01-01", {
      headers: { "user-agent": CHROME_UA, ...headers },
    });
    check(`${label} → ${want}`, d.reason === want, show(d));
  }
  const preview = await gate("/api/races/today", {
    base: PREVIEW,
    headers: { "sec-fetch-site": "same-origin", origin: PREVIEW },
  });
  check(
    "Preview の host でも自分の host と比べて browser",
    preview.reason === "browser",
    show(preview),
  );
  const prodOriginOnPreview = await gate("/api/races/today", {
    base: PREVIEW,
    headers: { "sec-fetch-site": "same-origin", origin: HOST },
  });
  check(
    "Preview に本番の Origin → would_deny（固定の一覧にしない）",
    prodOriginOnPreview.reason === "would_deny",
    show(prodOriginOnPreview),
  );
}

console.log("[5] 古いブラウザ（Sec-Fetch-Site 無しで Referer）");
{
  const legacy = await gate("/api/predictions/2026-10-26", {
    headers: { "user-agent": CHROME_UA, referer: `${HOST}/venue/1` },
  });
  check(
    "Referer が自分の host → browser_legacy",
    legacy.reason === "browser_legacy",
    show(legacy),
  );
  const other = await gate("/api/predictions/2026-10-26", {
    headers: { referer: "https://evil.example/www.boat-ai.jp" },
  });
  check(
    "Referer が別の host → would_deny",
    other.reason === "would_deny",
    show(other),
  );
  const broken = await gate("/api/predictions/2026-10-26", {
    headers: { referer: "not a url" },
  });
  check(
    "Referer が URL でない → would_deny",
    broken.reason === "would_deny",
    show(broken),
  );
  const devServer = await gate("/api/predictions/2026-10-26", {
    headers: {
      "sec-fetch-site": "same-origin",
      referer: "http://localhost:5173/",
    },
  });
  check(
    "c4（開発サーバーの proxy）: same-origin なら Referer が localhost でも browser",
    devServer.reason === "browser",
    show(devServer),
  );
}

console.log("[6] 検索ボット（UA と IP の範囲の両方）");
{
  check(`${GOOGLE_IPV4} は範囲の表に入る`, ipInRanges(GOOGLE_IPV4, ipRanges));
  check(`${GOOGLE_IPV6} は範囲の表に入る`, ipInRanges(GOOGLE_IPV6, ipRanges));
  check(`${OTHER_IP} は範囲の表に入らない`, !ipInRanges(OTHER_IP, ipRanges));
  const cases = [
    [
      "Googlebot スマホ・範囲の IPv4",
      GOOGLEBOT_UA,
      GOOGLE_IPV4,
      "search_bot",
      true,
    ],
    [
      "Googlebot デスクトップ・範囲の IPv6",
      GOOGLEBOT_DESKTOP_UA,
      GOOGLE_IPV6,
      "search_bot",
      true,
    ],
    [
      "Googlebot・IPv4 を写した IPv6",
      GOOGLEBOT_UA,
      `::ffff:${GOOGLE_IPV4}`,
      "search_bot",
      true,
    ],
    [
      "Google-InspectionTool・範囲の IPv4",
      INSPECTION_UA,
      GOOGLE_IPV4,
      "search_bot",
      true,
    ],
    [
      "Google-InspectionTool スマホ・範囲の IPv6",
      INSPECTION_MOBILE_UA,
      GOOGLE_IPV6,
      "search_bot",
      true,
    ],
    [
      "Googlebot・範囲の外の IP（偽装）",
      GOOGLEBOT_UA,
      OTHER_IP,
      "would_deny",
      false,
    ],
    ["Googlebot・IP 無し", GOOGLEBOT_UA, null, "would_deny", false],
    [
      "Googlebot・読めない IP",
      GOOGLEBOT_UA,
      "66.249.66.999",
      "would_deny",
      false,
    ],
    [
      "bingbot・Google の IP（経路に入れない）",
      BINGBOT_UA,
      GOOGLE_IPV4,
      "would_deny",
      null,
    ],
    [
      "Googlebot-Image・範囲の IP（別の名前）",
      GOOGLEBOT_IMAGE_UA,
      GOOGLE_IPV4,
      "would_deny",
      null,
    ],
    [
      "人のブラウザ・Google の IP（UA が名乗らない。search_bot にしない）",
      CHROME_UA,
      GOOGLE_IPV4,
      "browser_no_sfs",
      null,
    ],
  ];
  for (const [label, ua, ip, want, verified] of cases) {
    const d = await gate("/api/analogy/facts/2026-10-26-01-01", {
      ip,
      headers: { "user-agent": ua },
    });
    check(
      `${label} → ${want}・bot_verified=${verified}`,
      d.reason === want && d.bot_verified === verified,
      show(d),
    );
  }
  const viaBrowser = await gate("/api/analogy/facts/2026-10-26-01-01", {
    ip: GOOGLE_IPV4,
    headers: { "user-agent": GOOGLEBOT_UA, "sec-fetch-site": "same-origin" },
  });
  check(
    "Googlebot が same-origin を送れば browser で通り、bot_verified=true は別に残る",
    viaBrowser.reason === "browser" && viaBrowser.bot_verified === true,
    show(viaBrowser),
  );
  const spoofEnforce = await gate("/api/analogy/facts/2026-10-26-01-01", {
    mode: "enforce",
    ip: OTHER_IP,
    headers: { "user-agent": GOOGLEBOT_UA },
  });
  check(
    "強制: 範囲の外の Googlebot → 403",
    spoofEnforce.status === 403 &&
      spoofEnforce.reason === "deny" &&
      spoofEnforce.bot_verified === false,
    show(spoofEnforce),
  );
  const excludedBot = await gate("/api/bot-page/top", {
    ip: OTHER_IP,
    headers: { "user-agent": GOOGLEBOT_UA },
  });
  check(
    "除外のパスでも bot_verified は数える",
    excludedBot.reason === "excluded" && excludedBot.bot_verified === false,
    show(excludedBot),
  );
}

console.log("[7] 段階（観測・強制）");
{
  check(
    "API_GATE_MODE: enforce だけ強制（前後の空白・改行は [10]）",
    normalizeGateMode("enforce") === "enforce" &&
      ["observe", undefined, "", "ENFORCE", "true"].every(
        (v) => normalizeGateMode(v) === "observe",
      ),
  );
  const observe = await gate("/api/accuracy", { mode: undefined });
  check(
    "既定（未設定）は観測 → would_deny で通す",
    observe.reason === "would_deny" &&
      observe.outcome === "pass" &&
      observe.status === null,
    show(observe),
  );
  const enforce = await gate("/api/accuracy", { mode: "enforce" });
  check(
    "強制 → deny 403",
    enforce.reason === "deny" &&
      enforce.outcome === "reject" &&
      enforce.status === 403,
    show(enforce),
  );
  const enforceBrowser = await gate("/api/accuracy", {
    mode: "enforce",
    headers: { "sec-fetch-site": "same-origin" },
  });
  check(
    "強制でもブラウザは通す",
    enforceBrowser.reason === "browser" && enforceBrowser.outcome === "pass",
    show(enforceBrowser),
  );
  const enforceKey = await gate("/api/accuracy", {
    mode: "enforce",
    headers: { "x-ryujin-internal-key": NEXT },
  });
  check(
    "強制でも next の鍵は通す",
    enforceKey.reason === "internal" && enforceKey.outcome === "pass",
    show(enforceKey),
  );
  for (const status of [400, 403]) {
    const res = gateRejectResponse(status);
    check(
      `${status} の応答は no-store`,
      res.status === status && res.headers.get("cache-control") === "no-store",
    );
  }
}

console.log("[8] 結果（ログの1行）に秘密・全文を入れない");
{
  const d = await gate("/api/predictions/2026-10-26?light=true&token=abc", {
    ip: GOOGLE_IPV4,
    headers: {
      "x-ryujin-internal-key": CURRENT,
      "user-agent": GOOGLEBOT_UA,
      "x-ryujin-caller": "bot-page",
    },
  });
  const line = JSON.stringify(d);
  check("鍵の値を含まない", !line.includes(CURRENT));
  check("IP を含まない", !line.includes(GOOGLE_IPV4));
  check("UA の全文を含まない", !line.includes("Nexus 5X"));
  check(
    "クエリ文字列を含まない",
    !line.includes("token=abc") && d.path === "/api/predictions/2026-10-26",
  );
  check(
    "ログの欄がそろう",
    [
      "outcome",
      "status",
      "reason",
      "key_slot",
      "caller",
      "caller_claimed",
      "bot_verified",
      "ua_class",
      "path",
      "sfs",
      "origin_host",
    ].every((k) => k in d),
    Object.keys(d).join(","),
  );
  const long = await gate(`/api/${"a".repeat(500)}`);
  check("path は200字まで", long.path.length === 200, String(long.path.length));
}

console.log("[9] UA の丸め・IP の読み方・範囲の表");
{
  const uaCases = [
    [null, "none"],
    ["", "none"],
    [GOOGLEBOT_UA, "search_bot:Googlebot"],
    [INSPECTION_UA, "search_bot:Google-InspectionTool"],
    [BINGBOT_UA, "search_bot:bingbot"],
    [
      "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
      "ai_bot:GPTBot",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)",
      "ai_bot:Google-GeminiNotebook",
    ],
    ["curl/8.4.0", "tool:curl"],
    ["python-requests/2.31", "tool:python"],
    ["Python-urllib/3.12", "tool:python"],
    ["node", "tool:node"],
    ["undici", "tool:node"],
    ["axios/1.6.0", "tool:node"],
    [CHROME_UA, "browser"],
    ["Wget/1.21", "other"],
  ];
  for (const [ua, want] of uaCases) {
    check(
      `ua_class ${JSON.stringify(ua)?.slice(0, 40)} → ${want}`,
      classifyUserAgent(ua) === want,
      classifyUserAgent(ua),
    );
  }
  const ipCases = [
    ["1.2.3.4", 4],
    ["::1", 6],
    ["2001:db8::", 6],
    ["2001:db8:0:0:0:0:0:1", 6],
    ["::ffff:1.2.3.4", 4],
    ["1.2.3", null],
    ["1.2.3.256", null],
    ["01.2.3.4x", null],
    ["2001:db8::1::2", null],
    ["2001:db8:0:0:0:0:0:0:1", null],
    ["fe80::1%en0", null],
    ["gggg::1", null],
    ["", null],
    [null, null],
  ];
  for (const [ip, want] of ipCases) {
    check(
      `parseIp ${JSON.stringify(ip)} → ${want}`,
      (parseIp(ip)?.version ?? null) === want,
    );
  }
  const small = compileIpRanges({
    sources: [
      { prefixes: ["192.0.2.0/24", "2001:db8:1::/48", "198.51.100.7/32"] },
    ],
  });
  check(
    "/24 の中と外",
    ipInRanges("192.0.2.255", small) && !ipInRanges("192.0.3.0", small),
  );
  check(
    "/48 の中と外",
    ipInRanges("2001:db8:1:ffff::1", small) &&
      !ipInRanges("2001:db8:2::1", small),
  );
  check(
    "/32 は1つだけ",
    ipInRanges("198.51.100.7", small) && !ipInRanges("198.51.100.8", small),
  );
  check(
    "IPv4 と IPv6 を混ぜない",
    !ipInRanges(
      "::c000:0201",
      compileIpRanges({ sources: [{ prefixes: ["192.0.2.0/24"] }] }),
    ),
  );
  let threwBad = false;
  try {
    compileIpRanges({ sources: [{ prefixes: ["192.0.2.0/33"] }] });
  } catch {
    threwBad = true;
  }
  check("読めない範囲は例外（黙って範囲を減らさない）", threwBad);
  let threwEmpty = false;
  try {
    compileIpRanges({ sources: [] });
  } catch {
    threwEmpty = true;
  }
  check("sources が空の表は例外", threwEmpty);
  check(
    "範囲の表は Google の2つの取得元を持つ",
    table.sources.length === 2 &&
      table.sources.every(
        (s) =>
          s.url.startsWith(
            "https://developers.google.com/static/crawling/ipranges/",
          ) && s.prefixes.length > 0,
      ),
  );
}

console.log("[10] 段階3のログ（鍵の trim・群・抜き取り）");
{
  const keys = gateKeysFromEnv({
    INTERNAL_API_KEY: `  ${CURRENT}\n`,
    INTERNAL_API_KEY_NEXT: "\n",
  });
  check(
    "env の鍵の前後の空白・改行を落とし、空白だけの NEXT は無いにする",
    keys.current === CURRENT && keys.next === undefined,
    JSON.stringify(keys),
  );
  const viaEnv = await gate("/api/accuracy", {
    keys: gateKeysFromEnv({ INTERNAL_API_KEY: `${CURRENT}\r\n` }),
    headers: {
      "x-ryujin-internal-key": CURRENT,
      "x-ryujin-caller": "hq-finals",
    },
  });
  check(
    "末尾に CRLF のある env の鍵でも、送った合言葉と一致する",
    viaEnv.reason === "internal" && viaEnv.key_slot === "current",
    show(viaEnv),
  );
  const rawKeys = await gate("/api/accuracy", {
    keys: { current: `${CURRENT}\n` },
    headers: { "x-ryujin-internal-key": CURRENT },
  });
  check(
    "decideApiGate に渡した鍵の末尾の改行も落として比べる",
    rawKeys.reason === "internal",
    show(rawKeys),
  );
  const spaceOnly = await gate("/api/accuracy", {
    keys: { current: "   " },
    headers: { "x-ryujin-internal-key": "   " },
  });
  check(
    "空白だけの鍵と空白だけのヘッダでは通さない（fail-closed）",
    spaceOnly.reason !== "internal",
    show(spaceOnly),
  );
  check(
    'API_GATE_MODE="enforce\\n" は強制、"Enforce" 等の別の値は観測',
    normalizeGateMode("enforce\n") === "enforce" &&
      normalizeGateMode(" enforce ") === "enforce" &&
      normalizeGateMode("Enforce") === "observe" &&
      normalizeGateMode(undefined) === "observe",
  );

  // 群: bingbot・AI のクローラー・hq・龍神のスクリプトを分けて数える
  const groupCases = [
    [{ headers: { "user-agent": BINGBOT_UA } }, "would_deny", "bingbot"],
    [
      { headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)" } },
      "would_deny",
      "ai_crawler",
    ],
    [
      { headers: { "user-agent": GOOGLEBOT_UA }, ip: OTHER_IP },
      "would_deny",
      "google",
    ],
    [
      {
        headers: { "user-agent": "node", "x-ryujin-caller": "hq-full-picture" },
      },
      "would_deny",
      "hq",
    ],
    [
      {
        headers: {
          "user-agent": "node",
          "x-ryujin-caller": "full-picture-materials",
        },
      },
      "would_deny",
      "ryujin",
    ],
    [
      {
        headers: {
          "x-ryujin-internal-key": CURRENT,
          "x-ryujin-caller": "hq-finals",
        },
      },
      "internal",
      "hq",
    ],
    [
      {
        headers: {
          "x-ryujin-internal-key": CURRENT,
          "x-ryujin-caller": "sns-claim-check",
        },
      },
      "internal",
      "ryujin",
    ],
    [
      {
        headers: {
          "x-ryujin-internal-key": "wrong",
          "x-ryujin-caller": "hq-finals",
        },
      },
      "bad_key",
      "hq",
    ],
    // /code-review: bot-html-parity はボットの UA と名前を一緒に送る。鍵が古いと bad_key が ai_crawler に紛れていた
    [
      {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
          "x-ryujin-internal-key": "stale-key",
          "x-ryujin-caller": "bot-html-parity",
        },
      },
      "bad_key",
      "ryujin",
    ],
    [
      {
        headers: {
          "user-agent": BINGBOT_UA,
          "x-ryujin-caller": "bot-html-parity",
        },
      },
      "would_deny",
      "ryujin",
    ],
    [{ headers: { "user-agent": "curl/8.4.0" } }, "would_deny", "other"],
    [{ headers: {} }, "would_deny", "other"],
    [{ headers: { "user-agent": CHROME_UA } }, "browser_no_sfs", "browser"],
  ];
  for (const [opts, reason, group] of groupCases) {
    const d = await gate("/api/analogy/facts/2026-10-26-01-01", opts);
    const record = gateLogRecord(d, { mode: "observe", method: "GET" });
    check(
      `${JSON.stringify(opts.headers)} → ${reason}・${group}`,
      d.reason === reason &&
        gateGroup(d) === group &&
        record?.tag === `apigate_${reason}_${group}` &&
        record.sample === 1,
      `${show(d)} group=${gateGroup(d)}`,
    );
  }
  const internalLog = await gate("/api/accuracy", {
    headers: {
      "x-ryujin-internal-key": CURRENT,
      "x-ryujin-caller": "bot-page",
    },
  });
  check(
    "internal は caller に名前、caller_claimed は null",
    internalLog.caller === "bot-page" && internalLog.caller_claimed === null,
    show(internalLog),
  );
  const claimed = await gate("/api/accuracy", {
    headers: { "x-ryujin-caller": "hq-finals" },
  });
  check(
    "合言葉の無い要求は caller が null、名乗った名前は caller_claimed",
    claimed.caller === null && claimed.caller_claimed === "hq-finals",
    show(claimed),
  );

  // 抜き取り: browser は 1/BROWSER_LOG_SAMPLE、ほかは全件。除外・/api でないものは書かない
  const browser = await gate("/api/odds/live", {
    headers: { "sec-fetch-site": "same-origin", "user-agent": CHROME_UA },
  });
  const kept = gateLogRecord(browser, {
    mode: "observe",
    method: "GET",
    random: () => 0,
  });
  const dropped = gateLogRecord(browser, {
    mode: "observe",
    method: "GET",
    random: () => 1 / BROWSER_LOG_SAMPLE,
  });
  check(
    `browser は抜き取り（sample=${BROWSER_LOG_SAMPLE}）`,
    kept?.api_gate === "browser" &&
      kept.sample === BROWSER_LOG_SAMPLE &&
      dropped === null,
    JSON.stringify(kept),
  );
  // keys_set: 鍵の有る無しだけを書く（値は書かない）。bad_key が「関門に鍵が無い」か「値が違う」かを見分ける
  const badKey = await gate("/api/accuracy", {
    headers: { "x-ryujin-internal-key": "wrong-secret-value" },
  });
  const labels = [
    [{ current: CURRENT, next: NEXT }, "current+next"],
    [{ current: CURRENT }, "current"],
    [{ next: `${NEXT}\n` }, "next"],
    [{ current: " \n" }, "none"],
    [{}, "none"],
  ].map(([keys, want]) => {
    const rec = gateLogRecord(badKey, { mode: "observe", method: "GET", keys });
    return [rec?.keys_set === want, JSON.stringify(rec)];
  });
  check(
    "keys_set は鍵の枠の有る無しだけ（空白だけは none）",
    labels.every(([ok]) => ok),
    labels.map(([, j]) => j).join(" | "),
  );
  const withKeys = JSON.stringify(
    gateLogRecord(badKey, {
      mode: "observe",
      method: "GET",
      keys: { current: CURRENT, next: NEXT },
    }),
  );
  check(
    "keys_set を書いても鍵の値は行に入らない",
    !withKeys.includes(CURRENT) && !withKeys.includes(NEXT),
  );
  const excluded = await gate("/api/cron/odds");
  check(
    "除外はログを書かない",
    gateLogRecord(excluded, { mode: "observe", method: "GET" }) === null,
  );
  const badPath = await gate("/api//accuracy");
  const badRecord = gateLogRecord(badPath, { mode: "observe", method: "GET" });
  check(
    "400 の禁じた形はログを書く（status=400）",
    badRecord?.api_gate === "bad_path" && badRecord.status === 400,
    JSON.stringify(badRecord),
  );
  const secretLine = JSON.stringify(
    gateLogRecord(
      await gate("/api/predictions/2026-10-26?token=abc", {
        ip: GOOGLE_IPV4,
        headers: {
          "x-ryujin-internal-key": "wrong-secret-value",
          "user-agent": GOOGLEBOT_UA,
        },
      }),
      { mode: "observe", method: "GET" },
    ),
  );
  check(
    "ログの行に鍵・IP・UA の全文・クエリを入れない",
    !secretLine.includes("wrong-secret-value") &&
      !secretLine.includes(GOOGLE_IPV4) &&
      !secretLine.includes("Nexus 5X") &&
      !secretLine.includes("token=abc"),
    secretLine,
  );
}

console.log("[11] CORS を置かない（api/・vercel.json）");
{
  const CORS_PATTERN = /Access-Control-Allow-/i;
  const files = walkSourceFiles(
    new URL("../../api/", import.meta.url).pathname,
    {
      extensions: [".js", ".mjs"],
    },
  );
  check("api/ の関数を1件以上読んだ", files.length > 0, String(files.length));
  const offenders = files.filter((file) =>
    CORS_PATTERN.test(readSourceFile(file) ?? ""),
  );
  check(
    "api/ に Access-Control-Allow-* が無い",
    offenders.length === 0,
    offenders.join(", "),
  );
  const vercelJson = readFileSync(
    new URL("../../vercel.json", import.meta.url),
    "utf8",
  );
  check(
    "vercel.json に Access-Control-Allow-* が無い",
    !CORS_PATTERN.test(vercelJson),
  );
}

console.log("[12] ログの数え方（count-api-gate-log.js）");
{
  const recordOf = async (path, opts) =>
    gateLogRecord(await gate(path, opts), {
      mode: "observe",
      method: "GET",
      random: () => 0,
    });
  const records = [
    await recordOf("/api/odds/live", {
      headers: { "sec-fetch-site": "same-origin", "user-agent": CHROME_UA },
    }),
    await recordOf("/api/analogy/facts/x", {
      headers: { "user-agent": BINGBOT_UA },
    }),
    await recordOf("/api/analogy/facts/x", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" },
    }),
    await recordOf("/api/predictions/2026-11-04", {
      headers: {
        "x-ryujin-internal-key": CURRENT,
        "x-ryujin-caller": "hq-finals",
      },
    }),
    await recordOf("/api/races/today", {
      headers: {
        "x-ryujin-internal-key": CURRENT,
        "x-ryujin-caller": "bot-page",
      },
    }),
    await recordOf("/api/predictions/2026-11-04", {
      headers: { "user-agent": "node", "x-ryujin-caller": "hq-full-picture" },
    }),
    await recordOf("/api/analogy/facts/x", {
      ip: GOOGLE_IPV4,
      headers: { "user-agent": GOOGLEBOT_UA, "sec-fetch-site": "same-origin" },
    }),
  ];
  const lines = [
    // そのままの行・時刻の付いた行・Vercel の JSON（message に元の行）・関係の無い行
    JSON.stringify(records[0]),
    `2026-11-05T01:00:00Z info ${JSON.stringify(records[1])}`,
    JSON.stringify({ level: "info", message: JSON.stringify(records[2]) }),
    JSON.stringify(records[3]),
    JSON.stringify(records[4]),
    JSON.stringify(records[5]),
    JSON.stringify(records[6]),
    "GET /api/accuracy 200",
    '{"level":"info","message":"other"}',
  ];
  check(
    "テキストの行と message の JSON から拾う",
    extractGateRecord(lines[1])?.group === "bingbot" &&
      extractGateRecord(lines[2])?.group === "ai_crawler" &&
      extractGateRecord(lines[7]) === null,
  );
  const r = countApiGateLines(lines);
  const count = (reason, group) =>
    r.byReasonGroup.find((x) => x.reason === reason && x.group === group)
      ?.count ?? 0;
  check(
    "拾えた行7・ほかの行2",
    r.parsed === 7 && r.skipped === 2,
    `${r.parsed}/${r.skipped}`,
  );
  check(
    `browser は抜き取りを掛け戻す（1行で ${BROWSER_LOG_SAMPLE}件）`,
    count("browser", "browser") === BROWSER_LOG_SAMPLE,
    JSON.stringify(r.byReasonGroup),
  );
  check(
    "bingbot・AI のクローラー・hq・龍神を分けて数える",
    count("would_deny", "bingbot") === 1 &&
      count("would_deny", "ai_crawler") === 1 &&
      count("internal", "hq") === 1 &&
      count("would_deny", "hq") === 1 &&
      count("internal", "ryujin") === 1,
    JSON.stringify(r.byReasonGroup),
  );
  check(
    "自分の群の would_deny があれば条件は NG",
    r.conditions.ownDeniedZero === false && r.conditions.ownDenied === 1,
  );
  check(
    "群ごとの internal: b1・c2c3 は1件、ほかは0件として挙がる",
    r.groups.find((g) => g.id === "b1").internal === 1 &&
      r.groups.find((g) => g.id === "c2c3").internal === 1 &&
      r.conditions.missingGroups.join(",") === "b2,c1,c3b",
    JSON.stringify(r.groups),
  );
  check(
    "内訳の path は先頭2段（/api/analogy/facts/x → /api/analogy）",
    r.denyDetail.length > 0 &&
      r.denyDetail.every((row) => row.path.split("/").length === 3) &&
      r.denyDetail.some((row) => row.path === "/api/analogy"),
    JSON.stringify(r.denyDetail.map((row) => row.path)),
  );
  const parity = countApiGateLines([
    JSON.stringify(
      await recordOf("/api/races/today", {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)",
          "x-ryujin-internal-key": "stale-key",
          "x-ryujin-caller": "bot-html-parity",
        },
      }),
    ),
  ]);
  check(
    "ボットの UA で鍵が古い bot-html-parity は自分の群の拒む候補（条件は NG）",
    parity.conditions.ownDeniedZero === false,
    JSON.stringify(parity.byReasonGroup),
  );
  check(
    "bot_verified=true を数え、拒む候補が0なら OK",
    r.botVerified === 1 && r.conditions.botVerifiedNeverDenied === true,
    `${r.botVerified}/${r.botVerifiedDenied}`,
  );
}

console.log(
  "[13] ブラウザの UA で Sec-Fetch-Site が無い要求（browser_no_sfs、オーナー 2026-11-06）",
);
{
  const FIREFOX_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  for (const mode of ["observe", "enforce"]) {
    for (const [label, headers] of [
      ["iPhone Safari・Origin 無し", { "user-agent": CHROME_UA }],
      ["Firefox・Origin が自分", { "user-agent": FIREFOX_UA, origin: HOST }],
    ]) {
      const d = await gate("/api/odds/live?raceId=2026-10-26-01-01", {
        mode,
        headers,
      });
      check(
        `${mode}: ${label} → browser_no_sfs で通す`,
        d.reason === "browser_no_sfs" &&
          d.outcome === "pass" &&
          d.status === null &&
          d.sfs === null,
        show(d),
      );
    }
    // 拒むまま（強制で 403）。ブラウザの UA でない・Origin が別・Sec-Fetch-Site が same-origin 以外
    const denied = [
      ["UA 無し", {}],
      ["curl", { "user-agent": "curl/8.4.0" }],
      ["python-requests", { "user-agent": "python-requests/2.32.3" }],
      ["node（undici）", { "user-agent": "undici" }],
      [
        "bingbot（Mozilla/ で始まるが検索ボット）",
        { "user-agent": BINGBOT_UA },
      ],
      [
        "GPTBot（Mozilla/ で始まるが AI のクローラー）",
        {
          "user-agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
        },
      ],
      [
        "ブラウザの UA・Origin が別の host",
        { "user-agent": CHROME_UA, origin: "https://evil.example" },
      ],
      [
        "ブラウザの UA・Origin が null",
        { "user-agent": CHROME_UA, origin: "null" },
      ],
      [
        "ブラウザの UA・cross-site",
        { "user-agent": CHROME_UA, "sec-fetch-site": "cross-site" },
      ],
      [
        "ブラウザの UA・none（アドレスバー）",
        { "user-agent": CHROME_UA, "sec-fetch-site": "none" },
      ],
    ];
    const want = mode === "enforce" ? "deny" : "would_deny";
    for (const [label, headers] of denied) {
      const d = await gate("/api/analogy/facts/2026-10-26-01-01", {
        mode,
        headers,
      });
      check(
        `${mode}: ${label} → ${want}`,
        d.reason === want &&
          (mode === "enforce" ? d.status === 403 : d.outcome === "pass"),
        show(d),
      );
    }
  }
  // Google の UA で IP が範囲の外（偽の Googlebot）は Mozilla/ で始まっても browser_no_sfs にしない
  const fakeGoogle = await gate("/api/analogy/facts/2026-10-26-01-01", {
    mode: "enforce",
    ip: OTHER_IP,
    headers: { "user-agent": GOOGLEBOT_UA },
  });
  check(
    "enforce: 偽の Googlebot（IP が範囲の外）→ deny",
    fakeGoogle.reason === "deny" && fakeGoogle.bot_verified === false,
    show(fakeGoogle),
  );
  // 鍵が付いていて違えば bad_key（ブラウザの UA でも browser_no_sfs に落とさない）
  const badKey = await gate("/api/accuracy", {
    mode: "enforce",
    headers: { "user-agent": CHROME_UA, "x-ryujin-internal-key": "wrong" },
  });
  check(
    "enforce: ブラウザの UA でも鍵が違えば bad_key 403",
    badKey.reason === "bad_key" && badKey.status === 403,
    show(badKey),
  );
  // ログは抜き取らない（後で絞るための件数）。群は browser
  const d = await gate("/api/odds/live?raceId=2026-10-26-01-01", {
    headers: { "user-agent": CHROME_UA },
  });
  const record = gateLogRecord(d, {
    mode: "observe",
    method: "GET",
    random: () => 0.99,
  });
  check(
    "browser_no_sfs は抜き取らず全件書く（tag apigate_browser_no_sfs_browser）",
    record?.sample === 1 &&
      record.tag === "apigate_browser_no_sfs_browser" &&
      record.group === "browser",
    JSON.stringify(record),
  );
  const counted = countApiGateLines([JSON.stringify(record)]);
  check(
    "count-api-gate-log: browser_no_sfs は拒む候補に数えない",
    counted.denyDetail.length === 0 &&
      counted.conditions.ownDeniedZero === true,
    JSON.stringify(counted.byReasonGroup),
  );
}

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: /api の関門の判定は plan §2.2 の順どおり");
