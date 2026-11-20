/**
 * verify-middleware-routing.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-middleware-routing.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  resolveSnapshotPath,
  BOT_PAGE_PREFIXED_LANGS,
  BOT_PAGE_USER_AGENTS,
  AI_CRAWLER_USER_AGENTS,
} from "../../../src/config/aiCrawlerBots.js";

let BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, TODAY, RACE_ROUTES;
let NOT_RACE_PATHS;

const NOT_RACER_SNAPSHOT_PATHS = [
  "/racer/325",
  "/racer/32560",
  "/racer/abc",
  "/racer/3256/",
  "/racer/3256/extra",
  "/racer",
  "/racers",
  "/en/racer/3256",
  "/ko/racer/3256",
];

async function scene1() {
  // 関数の受ける会場コード（api/_lib/botPage.js）と、振り分ける会場コードが同じ 1〜24
  {
    const { venueCodeFromUrl } = await import("../../../api/_lib/botPage.js");
    for (const code of ["0", "01", "1", "24", "25", "abc"]) {
      const routed = resolveSnapshotPath(`/venue/${code}`, BOT_UA);
      const accepted = venueCodeFromUrl(`/api/bot-page/venue/${code}`) !== null;
      check(
        `/venue/${code}: 振り分け(${Boolean(routed)})と関数の受け入れ(${accepted})が一致`,
        Boolean(routed) === accepted,
      );
    }
    // 言語版: 言語の一覧が関数と同じで、振り分け先を関数が受ける（会場コードの範囲も同じ）
    const { BOT_PAGE_PREFIXED_LANGS: FUNCTION_LANGS, prefixedLangFromUrl } =
      await import("../../../api/_lib/botPage.js");
    check(
      "言語版の言語の一覧が関数（api/_lib/botPage.js）と同じ",
      JSON.stringify(BOT_PAGE_PREFIXED_LANGS) === JSON.stringify(FUNCTION_LANGS),
      `${BOT_PAGE_PREFIXED_LANGS} / ${FUNCTION_LANGS}`,
    );
    for (const lang of [...BOT_PAGE_PREFIXED_LANGS, "fr", "ja"]) {
      for (const code of ["0", "01", "1", "24", "25", "abc"]) {
        const path = `/${lang}/venue/${code}`;
        const routed = resolveSnapshotPath(path, BOT_UA);
        const accepted =
          prefixedLangFromUrl("venue", path) === lang &&
          venueCodeFromUrl(path, lang) !== null;
        check(
          `${path}: 振り分け(${Boolean(routed)})と関数の受け入れ(${accepted})が一致`,
          Boolean(routed) === accepted,
        );
        if (routed) {
          check(
            `${path}: rewrite 先 ${routed} も関数が同じ言語・会場として受ける`,
            prefixedLangFromUrl("venue", routed) === lang &&
              venueCodeFromUrl(routed, lang) === Number(code),
          );
        }
      }
      for (const path of [`/${lang}/`, `/${lang}`]) {
        const routed = resolveSnapshotPath(path, BOT_UA);
        const accepted = prefixedLangFromUrl("top", path) === lang;
        check(
          `${path}: 振り分け(${Boolean(routed)})と関数の受け入れ(${accepted})が一致`,
          Boolean(routed) === accepted,
        );
        if (routed) {
          check(
            `${path}: rewrite 先 ${routed} も関数が同じ言語として受ける`,
            prefixedLangFromUrl("top", routed) === lang,
          );
        }
      }
    }
    // 言語ごとに rewrite 先が違う（CDN のキーで言語が混ざらない）
    const targets = ["/", "/en/", "/zh-TW/", "/ko/"].map((p) =>
      resolveSnapshotPath(p, BOT_UA),
    );
    check(
      "/・/en/・/zh-TW/・/ko/ の rewrite 先がすべて違う",
      new Set(targets).size === 4,
      targets.join(","),
    );
  }
  check(
    "ページ単位の UA 集合は AI_CRAWLER_USER_AGENTS の部分集合（Googlebot を含まない）",
    BOT_PAGE_USER_AGENTS.every((ua) => AI_CRAWLER_USER_AGENTS.includes(ua)) &&
      !BOT_PAGE_USER_AGENTS.some((ua) => /googlebot/i.test(ua)),
  );
  console.log(
    "[6b] 選手ページ（/racer/{4桁}）は配る UA のときだけスナップショットへ振り分ける（BOA-848）",
  );
  for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
    for (const id of ["3256", "5121"]) {
      const path = `/racer/${id}`;
      const target = `/ai-snapshots/racer/${id}.html`;
      check(`${name} ${path} は matcher に一致する`, matchesMatcher(path));
      const res = await call(path, { ua });
      check(
        `${name} ${path} → ${target}`,
        res?.headers.get("x-middleware-rewrite") === `${ORIGIN}${target}`,
        describe(res),
      );
    }
  }
}

async function scene2() {
  for (const [name, ua] of Object.entries(NOT_SNAPSHOT_UAS)) {
    const res = await call("/racer/3256", { ua });
    check(
      `${name} /racer/3256 → 素通り（SPA のまま）`,
      res === undefined,
      describe(res),
    );
  }
  {
    const res = await call("/racer/3256");
    check("人のUA /racer/3256 → 素通り", res === undefined, describe(res));
  }
  for (const path of NOT_RACER_SNAPSHOT_PATHS) {
    const res = await call(path, { ua: SEARCH_BOT_UAS.bingbot });
    check(
      `bingbot ${path} → 素通り（SPA のまま）`,
      res === undefined,
      describe(res),
    );
  }
  {
    const res = await call("/racer/3256?tab=x", { ua: BOT_UA });
    check(
      "GPTBot /racer/3256?tab=x → クエリを持ち込まない",
      res?.headers.get("x-middleware-rewrite") ===
        `${ORIGIN}/ai-snapshots/racer/3256.html`,
      describe(res),
    );
  }
  console.log(
    "[6c] ブログ一覧と翻訳記事は配る UA のときだけスナップショットへ振り分ける（BOA-848 第2段）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（BOT_UA・matchesMatcher・call・check・describe・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS） */
export async function runMiddlewareRoutingScenes6(env) {
  ({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS } = env);
  await scene1();
  await scene2();
}

function scene3() {
  console.log(
    "[6d] 本日（JST）のレース詳細は配る UA のときだけ関数へ振り分ける（BOA-848 第2段）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（BOT_UA・matchesMatcher・call・check・describe・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS） */
export function runMiddlewareRoutingScenes7(env) {
  ({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS } = env);
  scene3();
}

async function scene4() {
  for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
    for (const [path, target] of RACE_ROUTES) {
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
    for (const [path] of RACE_ROUTES) {
      const res = await call(path, { ua });
      check(`${name} ${path} → 素通り（SPA のまま）`, res === undefined, describe(res));
    }
  }
  NOT_RACE_PATHS = [
    "/race/2020-01-01-01-01", // 過去
    "/race/2099-01-01-01-01", // 未来
    `/race/${TODAY}-00-01`,
    `/race/${TODAY}-25-01`,
    `/race/${TODAY}-01-00`,
    `/race/${TODAY}-01-13`,
    `/race/${TODAY}-1-1`,
    `/race/${TODAY}-01-01/assist`,
    `/race/${TODAY}-01-01/`,
    "/race",
    "/race/abc",
    `/fr/race/${TODAY}-01-01`,
    `/ja/race/${TODAY}-01-01`,
    `/EN/race/${TODAY}-01-01`,
  ];
  for (const path of NOT_RACE_PATHS) {
    const res = await call(path, { ua: SEARCH_BOT_UAS.bingbot });
    check(`bingbot ${path} → 素通り（SPA のまま）`, res === undefined, describe(res));
  }
  {
    const res = await call(`/race/${TODAY}-01-01?tab=odds`, { ua: BOT_UA });
    check(
      "GPTBot /race/{本日}?tab=odds → クエリを持ち込まない",
      res?.headers.get("x-middleware-rewrite") ===
        `${ORIGIN}/api/bot-page/race/${TODAY}-01-01`,
      describe(res),
    );
  }
  // 「本日」は JST。UTC ではまだ前日の JST 0:00〜8:59 も、JST の今日を振り分ける
  {
    const at = Date.parse("2026-10-11T21:00:00Z"); // JST 10/12 06:00
    check(
      "JST 6時（UTC は前日）: JST の今日のレースを振り分ける",
      resolveSnapshotPath("/race/2026-10-12-01-01", BOT_UA, "", at) ===
        "/api/bot-page/race/2026-10-12-01-01",
    );
    check(
      "JST 6時: UTC の今日（JST では前日）のレースは振り分けない",
      resolveSnapshotPath("/race/2026-10-11-01-01", BOT_UA, "", at) === null,
    );
    const midnight = Date.parse("2026-10-12T15:00:00Z"); // JST 10/13 00:00
    check(
      "JST 0:00 で前日のレースは振り分けから外れる",
      resolveSnapshotPath("/race/2026-10-12-01-01", BOT_UA, "", midnight) === null &&
        resolveSnapshotPath("/race/2026-10-13-01-01", BOT_UA, "", midnight) ===
          "/api/bot-page/race/2026-10-13-01-01",
    );
  }
}

async function scene5() {
  // 振り分けた id を関数が同じ言語・同じレースとして受ける（関数の parseBotRaceUrl）
  {
    const { parseBotRaceUrl } = await import("../../../api/_lib/botRace.js");
    for (const [path, target] of RACE_ROUTES) {
      const lang = path.match(/^\/(en|zh-TW|ko)\//)?.[1];
      const mode = lang ? "prefixed" : "ja";
      const a = parseBotRaceUrl(path, mode);
      const b = parseBotRaceUrl(target, mode);
      check(
        `${path}: 振り分け先 ${target} を関数が同じレースとして受ける`,
        a !== null && JSON.stringify(a) === JSON.stringify(b),
      );
    }
    for (const path of NOT_RACE_PATHS.filter((p) => !/20(20|99)-/.test(p))) {
      const lang = path.match(/^\/(en|zh-TW|ko)\//)?.[1];
      check(
        `${path}: 関数も受けない（形が違う）`,
        parseBotRaceUrl(path, lang ? "prefixed" : "ja") === null,
      );
    }
  }
  console.log(
    "[7] vercel.json の no-store 規則は / と /venue/1〜24 だけ配る UA を除外する",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（BOT_UA・matchesMatcher・call・check・describe・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS・TODAY・RACE_ROUTES） */
export async function runMiddlewareRoutingScenes8(env) {
  ({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, TODAY, RACE_ROUTES } = env);
  await scene4();
  await scene5();
}

function scene6() {
  console.log(
    "[12] /api の関門（BOA-1110 段階3: matcher に /api/:path*、観測で判定とログ、禁じた形だけ 400）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（BOT_UA・matchesMatcher・call・check・describe・SEARCH_BOT_UAS・NOT_SNAPSHOT_UAS・ORIGIN・BOT_PAGE_UAS・TODAY・RACE_ROUTES） */
export function runMiddlewareRoutingScenes9(env) {
  ({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, TODAY, RACE_ROUTES } = env);
  scene6();
}
