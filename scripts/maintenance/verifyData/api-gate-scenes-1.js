/**
 * verify-api-gate.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-api-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { ipInRanges, normalizeGateMode, gateRejectResponse } from "../../../api/_lib/apiGate.js";

let ipRanges, NEXT, HOST, PREVIEW, CHROME_UA, GOOGLEBOT_UA, GOOGLEBOT_DESKTOP_UA, INSPECTION_UA, INSPECTION_MOBILE_UA, BINGBOT_UA, GOOGLEBOT_IMAGE_UA, GOOGLE_IPV4, GOOGLE_IPV6, OTHER_IP, check, gate, show;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
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
  return { cases };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ cases }) {
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

async function scene3() {
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
}

async function scene4() {
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
    const s1 = scene1();
    await scene2(s1);
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
}

function scene5() {
  console.log("[8] 結果（ログの1行）に秘密・全文を入れない");
}

/** verify から呼ぶ入口。env は verify 側の束縛（ipRanges・NEXT・HOST・PREVIEW・CHROME_UA・GOOGLEBOT_UA・GOOGLEBOT_DESKTOP_UA・INSPECTION_UA・INSPECTION_MOBILE_UA・BINGBOT_UA・GOOGLEBOT_IMAGE_UA・GOOGLE_IPV4・GOOGLE_IPV6・OTHER_IP・check・gate・show） */
export async function runApiGateScenes1(env) {
  ({ ipRanges, NEXT, HOST, PREVIEW, CHROME_UA, GOOGLEBOT_UA, GOOGLEBOT_DESKTOP_UA, INSPECTION_UA, INSPECTION_MOBILE_UA, BINGBOT_UA, GOOGLEBOT_IMAGE_UA, GOOGLE_IPV4, GOOGLE_IPV6, OTHER_IP, check, gate, show } = env);
  await scene3();
  await scene4();
  scene5();
}
