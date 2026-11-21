/**
 * verify-middleware-routing.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-middleware-routing.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { config, handleApiGate } from "../../../middleware.js";
import { internalApiHeaders } from "../../../api/_lib/internalApiHeaders.js";
import { decideApiGate } from "../../../api/_lib/apiGate.js";

let GATE_TEST_RANGES, BOT_UA, HUMAN_UA, matchesMatcher, call, check, describe, ADMIN_PATHS, ORIGIN, BOT_PAGE_ROUTES, RACE_ROUTES;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const gateOf = (path) =>
    decideApiGate({
      url: `${ORIGIN}${path}`,
      headers: new Headers(),
      ip: null,
      mode: "observe",
      keys: {},
      ipRanges: GATE_TEST_RANGES,
    });
  // middleware が rewrite する先の /api/bot-page/* は、関門の除外に入る（二重に判定しない、plan §1.1）
  const rewriteTargets = [...BOT_PAGE_ROUTES, ...RACE_ROUTES]
    .map(([, target]) => target)
    .filter((target) => target.startsWith("/api/"));
  check("rewrite 先の /api/bot-page/* が1件以上ある", rewriteTargets.length > 0);
  for (const target of rewriteTargets) {
    const d = await gateOf(target);
    check(`${target} は関門の除外`, d.reason === "excluded", d.reason);
  }
  // Basic 認証の /api/admin/* は関門の除外（既存の守りのまま）
  for (const path of ADMIN_PATHS.filter((p) => p.startsWith("/api/"))) {
    const d = await gateOf(path);
    check(`${path} は関門の除外`, d.reason === "excluded", d.reason);
  }
  check(
    'matcher に "/api/:path*" がある（段階3）',
    config.matcher.includes("/api/:path*"),
  );
  // console.log を一時的に受けて、1行の JSON ログを見る
  const captureLogs = async (fn) => {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(" "));
    try {
      return { value: await fn(), lines };
    } finally {
      console.log = original;
    }
  };
  const gateLines = (lines) =>
    lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  // 観測（API_GATE_MODE 未設定）: 外からの要求も通し、would_deny のログを1行出す
  const OBSERVE_PATHS = [
    "/api/predictions/2026-10-26",
    "/api/races/today",
    "/api/accuracy",
    "/api/analogy/facts/2026-10-26-01-01",
    "/api/odds/live",
    "/api",
  ];
  for (const path of OBSERVE_PATHS) {
    check(`${path} は matcher に一致する`, matchesMatcher(path));
    const { value: res, lines } = await captureLogs(() =>
      handleApiGate(
        new Request(`${ORIGIN}${path}`, { headers: { "user-agent": "curl/8.4.0" } }),
        {},
      ),
    );
    check(`${path} は観測で通す`, res === undefined, describe(res));
    const logs = gateLines(lines);
    check(
      `${path} は would_deny の1行を出す`,
      logs.length === 1 &&
        logs[0].api_gate === "would_deny" &&
        logs[0].mode === "observe" &&
        logs[0].group === "other" &&
        logs[0].tag === "apigate_would_deny_other",
      lines.join(" | "),
    );
  }
  return { captureLogs, gateLines };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ captureLogs, gateLines }) {
  // middleware 本体から呼んでも素通り（既定の process.env に API_GATE_MODE が無い前提）
  {
    const saved = process.env.API_GATE_MODE;
    delete process.env.API_GATE_MODE;
    const { value: res, lines } = await captureLogs(() =>
      call("/api/accuracy", { ua: "python-requests/2.31" }),
    );
    check("middleware 本体: /api/accuracy は観測で素通り", res === undefined, describe(res));
    check(
      "middleware 本体: would_deny のログが1行",
      gateLines(lines).length === 1 && gateLines(lines)[0].ua_class === "tool:python",
      lines.join(" | "),
    );
    if (saved !== undefined) process.env.API_GATE_MODE = saved;
  }
  // 禁じた形のパスは観測でも 400 no-store
  for (const path of [
    "/api/bot-page%2F..%2Fpredictions/2026-10-26",
    "/api/cron/..%2fanalogy/facts/x",
    "/api//accuracy",
  ]) {
    const { value: res } = await captureLogs(() => call(path));
    check(
      `${path} は観測でも 400 no-store`,
      res?.status === 400 && res.headers.get("cache-control") === "no-store",
      describe(res),
    );
  }
  // 除外はログを出さず、既存の分岐へ進む（/api/admin は Basic 認証の 401 のまま、cron・bot-page は素通り）
  for (const [path, want] of [
    ["/api/admin/sns-hub/drafts", 401],
    ["/api/cron/odds", undefined],
    ["/api/bot-page/top", undefined],
  ]) {
    const { value: res, lines } = await captureLogs(() => call(path));
    check(
      `${path} は除外（ログ無し・既存の分岐）`,
      gateLines(lines).length === 0 && (res?.status ?? undefined) === want,
      `${describe(res)} ${lines.join(" | ")}`,
    );
  }
  // 強制（段階4。環境変数だけで入る）: 外は 403、同じ origin のブラウザと合言葉は通す
  const ENFORCE_ENV = { API_GATE_MODE: "enforce\n", INTERNAL_API_KEY: "verify-key-abc\n" };
  {
    const { value: denied } = await captureLogs(() =>
      handleApiGate(new Request(`${ORIGIN}/api/accuracy`), ENFORCE_ENV),
    );
    check(
      "強制（値の末尾に改行）: 外の要求は 403 no-store",
      denied?.status === 403 && denied.headers.get("cache-control") === "no-store",
      describe(denied),
    );
    const { value: browser } = await captureLogs(() =>
      handleApiGate(
        new Request(`${ORIGIN}/api/accuracy`, {
          headers: { "sec-fetch-site": "same-origin", "user-agent": HUMAN_UA },
        }),
        ENFORCE_ENV,
      ),
    );
    check("強制: 同じ origin のブラウザは通す", browser === undefined, describe(browser));
  }
  return { captureLogs, gateLines, ENFORCE_ENV };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ captureLogs, gateLines, ENFORCE_ENV }) {
  // 再現テスト（段階1の /code-review の指摘1）: Vercel の値の末尾に改行があっても、
  // fetch が前後の空白を落として送った合言葉と一致する（trim しないと bad_key になる）
  {
    const sent = new Headers(internalApiHeaders("bot-page", { INTERNAL_API_KEY: "verify-key-abc" }));
    const { value: res, lines } = await captureLogs(() =>
      handleApiGate(new Request(`${ORIGIN}/api/races/today`, { headers: sent }), ENFORCE_ENV),
    );
    const log = gateLines(lines)[0];
    check(
      "env の鍵の末尾の改行を落として比べる（internal・key_slot=current）",
      res === undefined &&
        log?.api_gate === "internal" &&
        log.key_slot === "current" &&
        log.caller === "bot-page" &&
        log.group === "ryujin" &&
        log.keys_set === "current",
      `${describe(res)} ${lines.join(" | ")}`,
    );
    check("ログに鍵の値が出ない", !lines.join("").includes("verify-key-abc"));
  }
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
  console.log("[13] X の短いリンクは札を保って /today へ302");
  check("/x/today は matcher に一致する", matchesMatcher("/x/today"));
  for (const ua of [HUMAN_UA, "Twitterbot/1.0", BOT_UA]) {
    for (const [query, content] of [
      ["?d=2026-10-25-a", "2026-10-25-a"],
      ["?d=2026-10-25-b", "2026-10-25-b"],
      ["", null],
      ["?d=", null],
      ["?d=2026-10-25", null],
      // 今の型 v3 の札（BOA-1314）
      ["?d=2026-10-25-c", "2026-10-25-c"],
      ["?d=2026-10-25-d", null],
      ["?d=2026-1-25-a", null],
      ["?d=2026-10-25-a%0A", null],
      ["?d=https://example.com", null],
      ["?d=2026-10-25-b&date=2000-01-01&utm_source=other", "2026-10-25-b"],
    ]) {
      const res = await call(`/x/today${query}`, { ua });
      const expected = `https://www.boat-ai.jp/today?utm_source=x&utm_medium=social&utm_campaign=today_digest${content ? `&utm_content=${content}` : ""}`;
      check(
        `${ua} ${query} → 302・UTM保持`,
        res?.status === 302 && res.headers.get("location") === expected,
        describe(res),
      );
      if (ua === "Twitterbot/1.0" && res?.status === 302) {
        const target = new URL(res.headers.get("location"));
        const bot = await call(`${target.pathname}${target.search}`, { ua });
        check(
          "転送後の Twitterbot は既存の /today 関数へ",
          bot?.headers.get("x-middleware-rewrite") ===
            "https://www.boat-ai.jp/api/bot-page/today",
        );
      }
    }
  }
  for (const path of ["/x/today/extra", "/x/other", "/en/x/today"]) {
    check(
      `${path} は短いリンクの対象外`,
      !matchesMatcher(path) && (await call(path)) === undefined,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（GATE_TEST_RANGES・BOT_UA・HUMAN_UA・matchesMatcher・call・check・describe・ADMIN_PATHS・ORIGIN・BOT_PAGE_ROUTES・RACE_ROUTES） */
export async function runMiddlewareRoutingScenes10(env) {
  ({ GATE_TEST_RANGES, BOT_UA, HUMAN_UA, matchesMatcher, call, check, describe, ADMIN_PATHS, ORIGIN, BOT_PAGE_ROUTES, RACE_ROUTES } = env);
  await scene4();
}
