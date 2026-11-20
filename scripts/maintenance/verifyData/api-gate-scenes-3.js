/**
 * verify-api-gate.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-api-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  gateKeysFromEnv,
  normalizeGateMode,
  gateLogRecord,
  gateGroup,
  BROWSER_LOG_SAMPLE,
} from "../../../api/_lib/apiGate.js";

let CURRENT, NEXT, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show;

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene1() {
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
}

/** 元の verify の1つの塊 { } を割った 2/4 */
function scene2() {
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
  return { groupCases };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function scene3({ groupCases }) {
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
  return { badKey };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function scene4({ badKey }) {
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

async function scene5() {
  {
    await scene1();
    const s2 = scene2();
    const s3 = await scene3(s2);
    await scene4(s3);
  }
  console.log("[11] CORS を置かない（api/・vercel.json）");
}

/** verify から呼ぶ入口。env は verify 側の束縛（CURRENT・NEXT・CHROME_UA・GOOGLEBOT_UA・BINGBOT_UA・GOOGLE_IPV4・OTHER_IP・check・gate・show） */
export async function runApiGateScenes3(env) {
  ({ CURRENT, NEXT, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show } = env);
  await scene5();
}

function scene6() {
  console.log("[12] ログの数え方（count-api-gate-log.js）");
}

/** verify から呼ぶ入口。env は verify 側の束縛（CURRENT・NEXT・CHROME_UA・GOOGLEBOT_UA・BINGBOT_UA・GOOGLE_IPV4・OTHER_IP・check・gate・show） */
export function runApiGateScenes4(env) {
  ({ CURRENT, NEXT, CHROME_UA, GOOGLEBOT_UA, BINGBOT_UA, GOOGLE_IPV4, OTHER_IP, check, gate, show } = env);
  scene6();
}
