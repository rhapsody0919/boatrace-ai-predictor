#!/usr/bin/env node
/**
 * ボット向け HTML の関数（ADR 0089。api/bot-page/top.js・api/bot-page/venue/[code].js、中身は api/_lib/botPage.js）を検証する。
 * 材料の取得（/api/races/today）と時計を差し替えてハンドラを呼ぶ。材料は本番の実物を1回保存したフィクスチャ。
 *
 * 守るもの:
 * 1. トップ・会場の 200・Content-Type・Cache-Control（ADR 0089 決定4）。HEAD は本文なし
 * 2. HTML の title・meta description・canonical・robots が人のページと同じ値（pageMeta.js・index.html）、lang="ja"
 * 3. 選手名・オッズ等が入らない（同 決定7）
 * 4. 材料が取れない・壊れたら 503・Retry-After: 300・no-store（「開催なし」にしない）。正しく取れて0件なら「開催なし」の 200（ADR 0069）
 * 5. 会場コードは 1〜24（0埋めなし）だけ。/venue/0・25・01・abc は 404（no-store）。クエリ文字列は見ない。GET・HEAD 以外は 405
 * 6. 節の名前などの値がテキスト・属性とも HTML エスケープされる
 * 7. 材料は60秒だけ使い回し、61秒後に取り直す。取得中の呼び出しは1回の取得を待つ
 * 8. 関数のファイルが Node から import でき、vercel.json で syd1 に置かれ、edge になっていない
 * 9. head の hreflang（4言語と x-default）が人のページと同じ URL、JSON-LD が JSON として読めて型・中身が人のページと同じ
 *    （トップは index.html の共通の3つ、会場はそれに BreadcrumbList）。値に </script> があっても要素が閉じない（BOA-848）
 * 10. 言語版（BOA-848 第2段、api/bot-page/[lang]/*）: en・zh-TW・ko のトップと会場が、その言語の文言・title・description・
 *    canonical・html の lang・リンク先（/{lang}/venue/N・/{lang}/race/{id}）・パンくずで出る。hreflang・共通の JSON-LD は ja と同じ。
 *    言語はパスから読み、対応外の言語・接頭辞なし・0埋め・範囲外は 404。選手名が入らない
 * 11. トップ（ja と言語版）に、人のトップと同じ並びで説明の本文（HomeAiIntro）・龍神ソナーと思考アシスト（ja だけ）の案内・
 *    成績ページと的中レースへのリンク・よくある質問5問（FAQPage の JSON-LD と一致）・ブログ欄（注目3・新着3、人と同じ関数）・
 *    言語版の案内の帯がある。イン崩れ注意度のハイライト・選手名・操作の部品が無い。値はエスケープされる
 *
 * 実行環境のタイムゾーンを UTC にして走らせる（関数は UTC で動く）。
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBotPageFunctionScenes1 } from "./verifyData/bot-page-function-scenes-1.js";
import { runBotPageFunctionScenes2 } from "./verifyData/bot-page-function-scenes-2.js";
import { runBotPageFunctionScenes3 } from "./verifyData/bot-page-function-scenes-3.js";
import { runBotPageFunctionScenes4 } from "./verifyData/bot-page-function-scenes-4.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const {
  createBotPageHandler,
  createTodayRacesSource,
  getJaT,
  getLocaleT,
  BOT_PAGE_PREFIXED_LANGS,
  escapeHtml,
  ROBOTS,
  jsonLdScriptText,
  parseJsonLdScripts,
  renderVenueHtml,
} = await import("../../api/_lib/botPage.js");
const { getTopPageMeta, getTodayVenuePageMeta, getTodayVenueBreadcrumbItems } =
  await import("../../src/utils/pageMeta.js");
const { buildFaqItems, isAssistShown, toFaqPageLd } =
  await import("../../src/utils/homeAiIntroFaq.js");
const { getHomeBlogPosts } = await import("../../src/data/blogPosts.js");
// 関数のファイルそのものが Node から読める（import の時点で取得しない）
const topModule = await import("../../api/bot-page/top.js");
const venueModule = await import("../../api/bot-page/venue/[code].js");
const langTopModule = await import("../../api/bot-page/[lang]/top.js");
const langVenueModule =
  await import("../../api/bot-page/[lang]/venue/[code].js");
check(
  "[lang]/top.js の default がハンドラ",
  typeof langTopModule.default,
  "function",
);
check(
  "[lang]/venue/[code].js の default がハンドラ",
  typeof langVenueModule.default,
  "function",
);
check("top.js の default がハンドラ", typeof topModule.default, "function");
check(
  "venue/[code].js の default がハンドラ",
  typeof venueModule.default,
  "function",
);

const FIXTURE =
  "scripts/lib/__fixtures__/races-today/races-today-2026-10-11.json";
const fixtureText = read(FIXTURE);
const fresh = () => JSON.parse(fixtureText);
// フィクスチャの scrapedAt（2026-10-11 21:26 JST）の少し後
const NOW = Date.parse("2026-10-11T12:30:00Z");
const HOST = "boatrace-ai-predictor-test.vercel.app";

const t = await getJaT();

/** 応答を記録する res */
function fakeRes() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: undefined,
    setHeader(k, v) {
      headers[k.toLowerCase()] = String(v);
    },
    end(body) {
      this.body = body;
    },
  };
}

/** fetch の代わり。呼ばれた URL を残す */
function stubFetch(makeResponse) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return makeResponse(url);
  };
  fn.calls = calls;
  return fn;
}
const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function call(
  page,
  url,
  {
    json = fresh(),
    method = "GET",
    fetchImpl,
    now = () => NOW,
    getSiteJsonLd,
    getSeriesRows = async () => [],
    langMode,
  } = {},
) {
  const f = fetchImpl ?? stubFetch(() => jsonResponse(json));
  const handler = createBotPageHandler(page, {
    ...(langMode ? { langMode } : {}),
    getTodayJson: createTodayRacesSource({ fetchImpl: f, now }),
    now,
    getSeriesRows,
    ...(getSiteJsonLd ? { getSiteJsonLd } : {}),
  });
  const res = fakeRes();
  await handler({ method, url, headers: { host: HOST } }, res);
  return { res, fetchCalls: f.calls };
}

const SUCCESS_CC =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600";
const attr = (html, re) => html.match(re)?.[1] ?? null;
const decode = (s) =>
  s
    ?.replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const headOf = (html) => ({
  lang: attr(html, /<html lang="([^"]*)"/),
  title: decode(attr(html, /<title>([^<]*)<\/title>/)),
  description: decode(attr(html, /<meta name="description" content="([^"]*)"/)),
  robots: decode(attr(html, /<meta name="robots" content="([^"]*)"/)),
  canonical: decode(attr(html, /<link rel="canonical" href="([^"]*)"/)),
});
const expectedHead = (meta) => ({
  lang: "ja",
  title: meta.title,
  description: meta.description,
  robots: ROBOTS,
  canonical: meta.canonical,
});
const links = (html) =>
  [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
// トップの「本日開催中のレース」の欄（会場の一覧）。説明の本文・ブログ欄のリンクと分けて見る
const todaySection = (html) =>
  html.match(/<section id="today-venues">[\s\S]*?<\/section>/)?.[0] ?? "";
const venueLinks = (html) => links(html).filter((h) => /\/venue\//.test(h));
// head の hreflang の行（属性の値はエスケープを戻す）
const alternatesOf = (html) =>
  [
    ...html.matchAll(
      /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g,
    ),
  ].map((m) => ({ hreflang: decode(m[1]), href: decode(m[2]) }));
// JSON-LD 以外の <script>（値のエスケープ漏れで入ったもの）があるか
const hasRawScript = (html) =>
  /<script(?! type="application\/ld\+json">)/i.test(html);

// BOA-1220: handler から会場名の隣まで、4言語・JSTの時計・境界条件を確かめる。
{
  for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) {
    const tl = await getLocaleT(lang);
    const prefix = lang === "ja" ? "" : `/${lang}`;
    const url = `/api/bot-page${prefix}/top`;
    const options = lang === "ja" ? {} : { langMode: "prefixed" };
    const rowOf = (html, code) => todaySection(html).split("\n")
      .find((row) => row.includes(`href="${prefix}/venue/${code}"`));
    const cases = [
      ["12:00", "2026-10-11T03:00:00Z", false],
      ["23:00", "2026-10-11T14:00:00Z", true],
    ];
    for (const [time, iso, finished] of cases) {
      const { res } = await call("top", url, { ...options, now: () => Date.parse(iso) });
      check(`${lang}/${time}: 日目HTML 200`, res.statusCode, 200);
      for (const [code, key, params] of [
        [1, "raceDetailPage.seriesDayNth", { day: 5 }],
        [19, "raceDetailPage.seriesDayFirst", {}],
        [23, "raceDetailPage.seriesDayNth", { day: 4 }],
      ]) {
        const adjacent = `>${escapeHtml(tl(`venues.${code}`))}</a> <span>${escapeHtml(tl(key, params))}</span>`;
        check(`${lang}/${time}: 会場${code}の日目が会場名の隣`,
          rowOf(res.body, code)?.includes(adjacent), !finished);
      }
      check(`${lang}/${time}: 非開催は名前だけ`,
        todaySection(res.body).includes(`<li>${escapeHtml(tl("venues.4"))}</li>`), true);
    }
    for (const [kind, expectedKey] of [
      ["final", "raceDetailPage.seriesDayFinal"],
      ["first", "raceDetailPage.seriesDayFirst"],
      ["cancelled", null],
    ]) {
      const json = fresh();
      const races = json.data.find((v) => v.place_cd === 1).races;
      races.forEach((r) => {
        r.seriesDay = kind === "first" ? 1 : 5;
        r.isFinalDay = false;
        if (kind === "cancelled") { r.cancellationStatus = "confirmed"; r.result = null; }
      });
      races.at(-1).isFinalDay = true;
      const { res } = await call("top", url, {
        ...options, json, now: () => Date.parse("2026-10-11T03:00:00Z"),
      });
      const nameEnd = `>${escapeHtml(tl("venues.1"))}</a>`;
      const expected = expectedKey ? `${nameEnd} <span>${escapeHtml(tl(expectedKey))}</span>` : nameEnd;
      check(`${lang}/${kind}: 日目の行`, rowOf(res.body, 1)?.includes(expected), true);
      if (!expectedKey) check(`${lang}: 中止会場に日目なし`,
        rowOf(res.body, 1)?.includes(escapeHtml(tl("raceDetailPage.seriesDayFinal"))), false);
    }
  }
}

// ---- 1・2. トップ ----
{
  const { res, fetchCalls } = await call("top", "/api/bot-page/top");
  check("トップ: 200", res.statusCode, 200);
  check(
    "トップ: Content-Type",
    res.headers["content-type"],
    "text/html; charset=utf-8",
  );
  check("トップ: Cache-Control", res.headers["cache-control"], SUCCESS_CC);
  check("トップ: 材料は同じ host の /api/races/today", fetchCalls, [
    `https://${HOST}/api/races/today`,
  ]);
  const html = res.body;
  const meta = getTopPageMeta(t, "ja");
  check("トップ: head", headOf(html), expectedHead(meta));
  check(
    "トップ: canonical は本番のトップ",
    meta.canonical,
    "https://www.boat-ai.jp/",
  );
  check(
    "トップ: 見出し",
    html.includes("<h2>🏁 本日開催中のレース 10/11(日)</h2>"),
    true,
  );
  check(
    "トップ: 最終更新",
    html.includes("<p>レースデータ更新: 10/11 21:26</p>"),
    true,
  );
  check(
    "トップ: 会場へのリンク（人と同じ /venue/N、開催中の13会場）",
    venueLinks(html),
    [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23].map((c) => `/venue/${c}`),
  );
  check(
    "トップ: 非開催の会場は名前だけ",
    html.includes("<li>平和島</li>"),
    true,
  );
  check("トップ: 節の名前", html.includes("第８回日本一しょうゆ杯"), true);
  check(
    "トップ: 会場は24行",
    (todaySection(html).match(/<li>/g) || []).length,
    24,
  );
}

// robots は index.html（人のページ）と同じ
check(
  "robots が index.html と同じ",
  attr(read("index.html"), /<meta name="robots" content="([^"]*)"/),
  ROBOTS,
);

// ---- 1・2. 会場ページ ----
{
  const json = fresh();
  const kiryu = json.data.find((v) => v.place_cd === 1);
  const { res } = await call("venue", "/api/bot-page/venue/1");
  check("会場: 200", res.statusCode, 200);
  check(
    "会場: Content-Type",
    res.headers["content-type"],
    "text/html; charset=utf-8",
  );
  check("会場: Cache-Control", res.headers["cache-control"], SUCCESS_CC);
  const html = res.body;
  const races = [...kiryu.races].sort((a, b) => a.raceNo - b.raceNo);
  check(
    "会場: head",
    headOf(html),
    expectedHead(getTodayVenuePageMeta(t, 1, races)),
  );
  check(
    "会場: canonical",
    headOf(html).canonical,
    "https://www.boat-ai.jp/venue/1",
  );
  check(
    "会場: 見出し",
    html.includes("<h1>🏁 桐生 本日のレース・AI予想</h1>"),
    true,
  );
  check("会場: レースの行数", (html.match(/<li>/g) || []).length, races.length);
  check(
    "会場: レース詳細へのリンク（人と同じ /race/{id}）",
    links(html),
    races.map(
      (r) => `/race/2026-10-11-01-${String(r.raceNo).padStart(2, "0")}`,
    ),
  );
  check(
    "会場: 締切予定時刻",
    html.includes(
      `<span>締切予定時刻</span> <span>${races[0].startTime}</span>`,
    ),
    true,
  );
  check("会場: レース番号", html.includes("<span>12R</span>"), true);

  // HEAD は本文なし
  const head = await call("venue", "/api/bot-page/venue/1", { method: "HEAD" });
  check("会場: HEAD は 200", head.res.statusCode, 200);
  check("会場: HEAD は本文なし", head.res.body, undefined);

  // クエリ文字列は見ない
  const q = await call("venue", "/api/bot-page/venue/1?code=5&date=2026-01-01");
  check("会場: クエリ付きでも同じ HTML", q.res.body, html);
}

// 中止のレース（フィクスチャのレースを中止にして、人のカードと同じ「中止」が出る）
{
  const json = fresh();
  const v = json.data.find((x) => x.place_cd === 1);
  v.races[0].cancellationStatus = "confirmed";
  v.races[0].result = null;
  const { res } = await call("venue", "/api/bot-page/venue/1", { json });
  check(
    "会場: 中止の表示",
    res.body.includes(`<span>${t("raceCard.cancelled")}</span>`),
    true,
  );
}

// ---- 3. 選手名・オッズ等が入らない ----
{
  const json = fresh();
  const racerNames = json.data.flatMap((v) =>
    v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
  );
  check(
    "フィクスチャに選手名がある（検査が空振りしない）",
    racerNames.length > 0,
    true,
  );
  // トップは本日開催中のレースの欄だけを見る（説明の本文・よくある質問・ブログ欄は人の画面の文言で、
  // 「展開予測」「着順」等の語を含む。選手名は下の 11 でトップ全体を見る）
  const pages = [
    todaySection((await call("top", "/api/bot-page/top")).res.body),
  ];
  for (const v of json.data) {
    pages.push(
      (await call("venue", `/api/bot-page/venue/${v.place_cd}`)).res.body,
    );
  }
  // head の meta description は人のページと同じ文言（「展開予測」を含む）なので、本文だけを見る
  const all = pages.map((h) => h.split("<body>")[1] ?? h).join("\n");
  check(
    "選手名が HTML に無い",
    racerNames.filter((n) => all.includes(n)).slice(0, 3),
    [],
  );
  check(
    "オッズ・払戻・着順・展開予測・荒れ度の文字が HTML に無い",
    ["オッズ", "払戻", "着順", "展開予測", "荒れ", "<script"].filter((w) =>
      all.includes(w),
    ),
    [],
  );
}

// ---- 後半の場面（verifyData/bot-page-function-scenes-1.js・bot-page-function-scenes-2.js・bot-page-function-scenes-3.js・bot-page-function-scenes-4.js） ----
await runBotPageFunctionScenes1({ read, check, createTodayRacesSource, createBotPageHandler, BOT_PAGE_PREFIXED_LANGS, fresh, NOW, HOST, t, fakeRes, stubFetch, jsonResponse, call, SUCCESS_CC, todaySection, venueLinks, hasRawScript });
await runBotPageFunctionScenes2({ read, check, parseJsonLdScripts, jsonLdScriptText, renderVenueHtml, getLocaleT, escapeHtml, getTodayVenueBreadcrumbItems, getTopPageMeta, getTodayVenuePageMeta, toFaqPageLd, buildFaqItems, isAssistShown, t, call, SUCCESS_CC, headOf, expectedHead, venueLinks, alternatesOf, hasRawScript });
await runBotPageFunctionScenes3({ check, escapeHtml, BOT_PAGE_PREFIXED_LANGS, parseJsonLdScripts, getLocaleT, getTodayVenueBreadcrumbItems, isAssistShown, getHomeBlogPosts, fresh, t, stubFetch, jsonResponse, call, links, alternatesOf, hasRawScript });
await runBotPageFunctionScenes4({ read, check, parseJsonLdScripts, BOT_PAGE_PREFIXED_LANGS, getLocaleT, escapeHtml, buildFaqItems, fresh, jsonResponse, call, decode, links, hasRawScript });

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-page-function:${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-page-function: ${checked}件すべて通過`);
