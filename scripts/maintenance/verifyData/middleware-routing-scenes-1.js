/**
 * verify-middleware-routing.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-middleware-routing.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { resolveSnapshotPath } from "../../../src/config/aiCrawlerBots.js";

let USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, BOT_PAGE_ROUTES, NOT_BOT_PAGE_PATHS;
let SNAPSHOT_CANDIDATES;

const UTF8_PASSWORD = "パスワード:é";

const PUBLIC_PATHS = [
  "/",
  "/race/20260929-01-01",
  "/venue/01",
  "/blog",
  "/blog/some-article",
  "/winning-technique",
  "/today",
  "/robots.txt",
  "/admin",
  "/admin/rulesx",
  "/en/admin/rules",
];

async function scene1() {
  {
    const path = "/admin/rules";
    const full = await call(path, { auth: `${USER}:${COLON_PASSWORD}` });
    check(
      "':'入りパスワードの完全一致 → 素通り",
      full === undefined,
      describe(full),
    );
    for (const partial of ["pa", "pa:ss", "pa:ss:wor", `${COLON_PASSWORD}:`]) {
      const res = await call(path, { auth: `${USER}:${partial}` });
      check(
        `':'入りパスワードの不一致(${partial}) → 401`,
        res?.status === 401,
        describe(res),
      );
    }
  }
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = UTF8_PASSWORD;
  {
    const res = await call("/admin/sns-hub", {
      auth: `${USER}:${UTF8_PASSWORD}`,
    });
    check(
      "UTF-8 のパスワード（base64 を UTF-8 として復号）→ 素通り",
      res === undefined,
      describe(res),
    );
  }
  process.env.SNS_HUB_BASIC_AUTH_USER = USER;
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = PASSWORD;
  {
    const encode = (userPass) => toBase64(userPass);
    const cases = [
      ["誤ったパスワード", `Basic ${encode(`${USER}:wrong`)}`, 401],
      ["誤ったユーザー", `Basic ${encode(`other:${PASSWORD}`)}`, 401],
      [
        "パスワードの前方一致",
        `Basic ${encode(`${USER}:${PASSWORD.slice(0, -1)}`)}`,
        401,
      ],
      ["':' が無い", `Basic ${encode(`${USER}${PASSWORD}`)}`, 401],
      ["壊れた base64", "Basic !!!", 401],
      ["Basic 以外の方式", `Bearer ${PASSWORD}`, 401],
      // requireAdminAuth と同じく方式名の大文字小文字は区別しない（RFC 7235）
      ["方式名が小文字 basic", `basic ${encode(`${USER}:${PASSWORD}`)}`, null],
      ["方式名が大文字 BASIC", `BASIC ${encode(`${USER}:${PASSWORD}`)}`, null],
    ];
    for (const [label, authorization, expected] of cases) {
      const res = await call("/admin/rules", { authorization });
      check(
        `${label} → ${expected ?? "素通り"}`,
        expected === null ? res === undefined : res?.status === expected,
        describe(res),
      );
    }
  }
  console.log("[3] 一般ページは認証の対象外");
  for (const path of PUBLIC_PATHS) {
    const res = await call(path);
    check(`${path} 人間のUA → 素通り`, res === undefined, describe(res));
  }
  console.log("[4] スナップショット配信の経路と matcher の一致");
  SNAPSHOT_CANDIDATES = [
    "/winning-technique",
    "/today",
    "/blog/some-article",
    "/racer/3256",
    ...PUBLIC_PATHS,
    ...ADMIN_PATHS,
  ];
}

async function scene2() {
  for (const path of SNAPSHOT_CANDIDATES) {
    const snapshot = resolveSnapshotPath(path, BOT_UA);
    if (!snapshot) continue;
    check(`${path} → ${snapshot} は matcher に一致する`, matchesMatcher(path));
    const res = await call(path, { ua: BOT_UA });
    check(
      `${path} ボットUA → スナップショットへ rewrite`,
      res?.headers.get("x-middleware-rewrite")?.endsWith(snapshot) ?? false,
      describe(res),
    );
  }
  for (const path of [
    "/winning-technique",
    "/today",
    "/blog/some-article",
    "/racer/3256",
  ]) {
    check(
      `${path} は配信対象のまま（resolveSnapshotPath が null を返さない）`,
      resolveSnapshotPath(path, BOT_UA) !== null,
    );
  }
  console.log("[5] 検索・ユーザー起点の取得に使う UA もスナップショットに振り分ける");
}

/** verify から呼ぶ入口。env は verify 側の束縛（USER・PASSWORD・BOT_UA・matchesMatcher・toBase64・call・check・describe・ADMIN_PATHS・COLON_PASSWORD） */
export async function runMiddlewareRoutingScenes1(env) {
  ({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD } = env);
  await scene1();
  await scene2();
}

async function scene3() {
  for (const [name, ua] of Object.entries(SEARCH_BOT_UAS)) {
    for (const path of ["/blog/some-article", "/today"]) {
      const res = await call(path, { ua });
      check(
        `${name} ${path} → スナップショットへ rewrite`,
        res?.headers.get("x-middleware-rewrite")?.endsWith(
          resolveSnapshotPath(path, BOT_UA),
        ) ?? false,
        describe(res),
      );
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（USER・PASSWORD・BOT_UA・matchesMatcher・toBase64・call・check・describe・ADMIN_PATHS・COLON_PASSWORD・SEARCH_BOT_UAS） */
export async function runMiddlewareRoutingScenes2(env) {
  ({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS } = env);
  await scene3();
}

function scene4() {
  for (const [name, ua] of Object.entries(NOT_SNAPSHOT_UAS)) {
    check(
      `${name} はスナップショットに振り分けない`,
      resolveSnapshotPath("/blog/some-article", ua) === null,
    );
  }
  console.log(
    "[6] 日替わりページ（/ と /venue/1〜24）は配る UA のときだけ関数へ振り分ける（ADR 0089）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（USER・PASSWORD・BOT_UA・matchesMatcher・toBase64・call・check・describe・ADMIN_PATHS・COLON_PASSWORD・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS） */
export function runMiddlewareRoutingScenes3(env) {
  ({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS } = env);
  scene4();
}

async function scene5() {
  for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
    for (const [path, target] of BOT_PAGE_ROUTES) {
      check(`${name} ${path} は matcher に一致する`, matchesMatcher(path));
      const res = await call(path, { ua });
      check(
        `${name} ${path} → ${target}`,
        res?.headers.get("x-middleware-rewrite") === `${ORIGIN}${target}`,
        describe(res),
      );
    }
  }
  for (const [name, ua] of Object.entries(NOT_SNAPSHOT_UAS)) {
    for (const [path] of BOT_PAGE_ROUTES) {
      const res = await call(path, { ua });
      check(
        `${name} ${path} → 素通り（SPA のまま）`,
        res === undefined,
        describe(res),
      );
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（USER・PASSWORD・BOT_UA・matchesMatcher・toBase64・call・check・describe・ADMIN_PATHS・COLON_PASSWORD・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS・BOT_PAGE_ROUTES） */
export async function runMiddlewareRoutingScenes4(env) {
  ({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, BOT_PAGE_ROUTES } = env);
  await scene5();
}

async function scene6() {
  for (const path of NOT_BOT_PAGE_PATHS) {
    for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
      const res = await call(path, { ua });
      check(
        `${name} ${path} → 素通り（SPA のまま）`,
        res === undefined,
        describe(res),
      );
    }
  }
  // rewrite 先に元のクエリを持ち込まない。/?x=1 と /?x=2 が同じ rewrite 先になる。
  // ?date= も同じ扱い: 人の /venue/:code は日付をパスからしか取らず、?date= 付きでも本日を出すので、
  // ボットにも本日の HTML を返すのが人と同じ中身になる（ADR 0089 決定2、SEO 再点検 N1）
  for (const [path, target] of [
    ["/?x=1", "/api/bot-page/top"],
    ["/?x=2", "/api/bot-page/top"],
    ["/venue/1?x=1", "/api/bot-page/venue/1"],
    ["/venue/1?x=2", "/api/bot-page/venue/1"],
    ["/venue/1?date=2026-10-01", "/api/bot-page/venue/1"],
    ["/en/?x=1", "/api/bot-page/en/top"],
    ["/ko/venue/3?date=2026-10-01", "/api/bot-page/ko/venue/3"],
  ]) {
    const res = await call(path, { ua: SEARCH_BOT_UAS.bingbot });
    check(
      `bingbot ${path} → ${target}（クエリを持ち込まない）`,
      res?.headers.get("x-middleware-rewrite") === `${ORIGIN}${target}`,
      describe(res),
    );
  }
  // /today の ?date= 付きは振り分けない（人の /today は ?date= の日を出す。BOA-848 第2段）。ほかのクエリは落として関数へ
  for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
    for (const path of ["/today?date=2026-10-01", "/today?x=1&date=", "/today?date"]) {
      const res = await call(path, { ua });
      check(`${name} ${path} → 素通り（SPA のまま）`, res === undefined, describe(res));
    }
  }
  {
    const res = await call("/today?x=1", { ua: SEARCH_BOT_UAS.bingbot });
    check(
      "bingbot /today?x=1 → /api/bot-page/today（クエリを持ち込まない）",
      res?.headers.get("x-middleware-rewrite") === `${ORIGIN}/api/bot-page/today`,
      describe(res),
    );
    check(
      "resolveSnapshotPath は search を渡さなければ /today を関数へ",
      resolveSnapshotPath("/today", BOT_UA) === "/api/bot-page/today",
    );
  }
}

function scene7() {
  // 既存のスナップショット（ブログ・/winning-technique）の振り分けは変わらない
  for (const path of ["/winning-technique", "/blog/some-article"]) {
    check(
      `${path} は静的スナップショットのまま`,
      resolveSnapshotPath(path, SEARCH_BOT_UAS.bingbot)?.startsWith(
        "/ai-snapshots/",
      ) ?? false,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（USER・PASSWORD・BOT_UA・matchesMatcher・toBase64・call・check・describe・ADMIN_PATHS・COLON_PASSWORD・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS・BOT_PAGE_ROUTES・NOT_BOT_PAGE_PATHS） */
export async function runMiddlewareRoutingScenes5(env) {
  ({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, BOT_PAGE_ROUTES, NOT_BOT_PAGE_PATHS } = env);
  await scene6();
  scene7();
}
