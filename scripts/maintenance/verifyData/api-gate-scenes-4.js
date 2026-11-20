/**
 * verify-api-gate.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-api-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { extractGateRecord, countApiGateLines } from "../count-api-gate-log.js";
import { BROWSER_LOG_SAMPLE, gateLogRecord } from "../../../api/_lib/apiGate.js";

let CURRENT, HOST, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
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
  return { recordOf, r };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ recordOf, r }) {
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

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const FIREFOX_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
  for (const mode of ["observe", "enforce"]) {
    for (const [label, headers] of [
      ["モバイルのブラウザの UA・Origin 無し", { "user-agent": CHROME_UA }],
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
        "ブラウザの UA・Referer が別の host（Origin 無し）",
        { "user-agent": CHROME_UA, referer: "https://evil.example/page" },
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
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4() {
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
    "count-api-gate-log: browser_no_sfs は内訳に出し、群が browser なら自分の群の拒む候補にしない",
    counted.denyDetail.some((row) => row.reason === "browser_no_sfs") &&
      counted.conditions.ownDeniedZero === true,
    JSON.stringify(counted.denyDetail),
  );
  // 自分の呼び出し元がブラウザの UA で鍵を付け忘れると browser_no_sfs で通ってしまうので、配り漏れとして数える
  const ownNoKey = await gate("/api/analogy/facts/2026-10-26-01-01", {
    headers: { "user-agent": CHROME_UA, "x-ryujin-caller": "hq-finals" },
  });
  const ownCounted = countApiGateLines([
    JSON.stringify(gateLogRecord(ownNoKey, { mode: "observe", method: "GET" })),
  ]);
  check(
    "count-api-gate-log: hq を名乗る browser_no_sfs は自分の群の拒む候補（条件は NG）",
    ownNoKey.reason === "browser_no_sfs" &&
      ownCounted.conditions.ownDeniedZero === false,
    JSON.stringify(ownCounted.denyDetail),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  console.log(
    "[13] ブラウザの UA で Sec-Fetch-Site が無い要求（browser_no_sfs、オーナー 2026-11-06）",
  );
  {
    await scene3();
    await scene4();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（CURRENT・HOST・CHROME_UA・GOOGLEBOT_UA・BINGBOT_UA・GOOGLE_IPV4・OTHER_IP・check・gate・show） */
export async function runApiGateScenes5(env) {
  ({ CURRENT, HOST, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show } = env);
  await scene5();
}
