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
 * 13. ブラウザの UA で Sec-Fetch-Site が無い要求（オーナー 2026-11-06 決定）: Origin・Referer が無いか自分の host なら
 *    観測でも強制でも browser_no_sfs で通し、抜き取らずに全件ログに書く。curl・python・node・UA 無し・
 *    bingbot・AI のクローラー・Origin か Referer が別の host・Sec-Fetch-Site が same-origin 以外は、強制で 403 のまま。
 *    count-api-gate-log は browser_no_sfs を内訳に出し、自分の群を名乗るものは配り漏れに数える
 */
import { readFileSync } from "node:fs";
import { readSourceFile, walkSourceFiles } from "../lib/sourceFileWalk.js";

import { compileIpRanges, decideApiGate, inspectApiPath } from "../../api/_lib/apiGate.js";
import { runApiGateScenes1 } from "./verifyData/api-gate-scenes-1.js";
import { runApiGateScenes2 } from "./verifyData/api-gate-scenes-2.js";
import { runApiGateScenes3, runApiGateScenes4 } from "./verifyData/api-gate-scenes-3.js";
import { runApiGateScenes5 } from "./verifyData/api-gate-scenes-4.js";

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

// ---- 後半の場面（verifyData/api-gate-scenes-1.js・api-gate-scenes-2.js・api-gate-scenes-3.js） ----
await runApiGateScenes1({ ipRanges, NEXT, HOST, PREVIEW, CHROME_UA, GOOGLEBOT_UA, GOOGLEBOT_DESKTOP_UA, INSPECTION_UA, INSPECTION_MOBILE_UA, BINGBOT_UA, GOOGLEBOT_IMAGE_UA, GOOGLE_IPV4, GOOGLE_IPV6, OTHER_IP, check, gate, show });
await runApiGateScenes2({ table, CURRENT, CHROME_UA, GOOGLEBOT_UA, INSPECTION_UA, BINGBOT_UA, GOOGLE_IPV4, check, gate });
await runApiGateScenes3({ CURRENT, NEXT, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show });
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

// ---- 後半の場面（verifyData/api-gate-scenes-3.js・api-gate-scenes-4.js） ----
runApiGateScenes4({ CURRENT, NEXT, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show });
await runApiGateScenes5({ CURRENT, HOST, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show });

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: /api の関門の判定は plan §2.2 の順どおり");
