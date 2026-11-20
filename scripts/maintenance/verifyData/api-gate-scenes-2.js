/**
 * verify-api-gate.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-api-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { classifyUserAgent, parseIp, compileIpRanges, ipInRanges } from "../../../api/_lib/apiGate.js";

let table, CURRENT, CHROME_UA, GOOGLEBOT_UA, INSPECTION_UA, BINGBOT_UA, GOOGLE_IPV4, check, gate;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
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
  return { threwBad };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ threwBad }) {
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

async function scene3() {
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
    const s1 = scene1();
    scene2(s1);
  }
  console.log("[10] 段階3のログ（鍵の trim・群・抜き取り）");
}

/** verify から呼ぶ入口。env は verify 側の束縛（table・CURRENT・CHROME_UA・GOOGLEBOT_UA・INSPECTION_UA・BINGBOT_UA・GOOGLE_IPV4・check・gate） */
export async function runApiGateScenes2(env) {
  ({ table, CURRENT, CHROME_UA, GOOGLEBOT_UA, INSPECTION_UA, BINGBOT_UA, GOOGLE_IPV4, check, gate } = env);
  await scene3();
}
