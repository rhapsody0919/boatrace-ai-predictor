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
    langMode,
  } = {},
) {
  const f = fetchImpl ?? stubFetch(() => jsonResponse(json));
  const handler = createBotPageHandler(page, {
    ...(langMode ? { langMode } : {}),
    getTodayJson: createTodayRacesSource({ fetchImpl: f, now }),
    now,
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

// ---- 4. 失敗と0件 ----
{
  const broken = [
    ["HTTP 500", stubFetch(() => jsonResponse({ success: false }, 500))],
    ["JSON でない", stubFetch(() => jsonResponse("<html>oops</html>"))],
    [
      "success が false",
      stubFetch(() => jsonResponse({ success: false, data: [] })),
    ],
    [
      "data が配列でない",
      stubFetch(() => jsonResponse({ success: true, data: null })),
    ],
    [
      "会場コードが範囲外",
      stubFetch(() =>
        jsonResponse({ success: true, data: [{ place_cd: 99, races: [] }] }),
      ),
    ],
    [
      "取得で例外",
      stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    ],
  ];
  const origError = console.error;
  console.error = () => {};
  try {
    for (const [label, fetchImpl] of broken) {
      for (const [page, url] of [
        ["top", "/api/bot-page/top"],
        ["venue", "/api/bot-page/venue/1"],
      ]) {
        const { res } = await call(page, url, { fetchImpl });
        check(`材料が壊れた（${label}・${page}）: 503`, res.statusCode, 503);
        check(
          `材料が壊れた（${label}・${page}）: no-store`,
          res.headers["cache-control"],
          "no-store",
        );
        check(
          `材料が壊れた（${label}・${page}）: Retry-After`,
          res.headers["retry-after"],
          "300",
        );
        check(
          `材料が壊れた（${label}・${page}）: 「開催なし」にならない`,
          /開催/.test(res.body ?? ""),
          false,
        );
      }
    }
  } finally {
    console.error = origError;
  }

  const empty = { success: true, scrapedAt: "2026-10-11T12:00:00Z", data: [] };
  const top = await call("top", "/api/bot-page/top", { json: empty });
  check("0件: トップは 200", top.res.statusCode, 200);
  check("0件: トップは会場へのリンクなし", venueLinks(top.res.body), []);
  check(
    "0件: トップは24会場の名前",
    (todaySection(top.res.body).match(/<li>/g) || []).length,
    24,
  );
  const venue = await call("venue", "/api/bot-page/venue/1", { json: empty });
  check("0件: 会場は 200", venue.res.statusCode, 200);
  check(
    "0件: 会場の Cache-Control",
    venue.res.headers["cache-control"],
    SUCCESS_CC,
  );
  check(
    "0件: 会場は「開催なし」",
    venue.res.body.includes(`<p>${t("home.noRacesToday")}</p>`),
    true,
  );
}

// ---- 5. 会場コード・メソッド ----
for (const url of [
  "/api/bot-page/venue/0",
  "/api/bot-page/venue/25",
  "/api/bot-page/venue/01",
  "/api/bot-page/venue/abc",
  "/api/bot-page/venue/1.5",
  "/api/bot-page/venue/-1",
  "/api/bot-page/venue/",
  "/api/bot-page/venue/1/x",
  "/api/bot-page/venue/%31",
  // middleware の rewrite 経由では req.url が元のパスのまま届く。0埋め・範囲外・接頭辞付きは 404
  "/venue/01",
  "/venue/25",
  "/en/venue/1",
  "/x/venue/1",
]) {
  const { res, fetchCalls } = await call("venue", url);
  check(`${url}: 404`, res.statusCode, 404);
  check(`${url}: no-store`, res.headers["cache-control"], "no-store");
  check(`${url}: 材料を取りに行かない`, fetchCalls.length, 0);
}
for (const code of [9, 10, 24]) {
  const { res } = await call("venue", `/api/bot-page/venue/${code}`);
  check(`/api/bot-page/venue/${code}: 200`, res.statusCode, 200);
}
// middleware の rewrite 経由（req.url が /venue/{code} のまま）でも同じ会場の HTML になる
for (const code of [1, 24]) {
  const viaRewrite = await call("venue", `/venue/${code}?x=1`);
  const direct = await call("venue", `/api/bot-page/venue/${code}`);
  check(
    `/venue/${code}?x=1（rewrite 経由）: 200`,
    viaRewrite.res.statusCode,
    200,
  );
  check(
    `/venue/${code}（rewrite 経由）: 直接呼んだときと同じ HTML`,
    viaRewrite.res.body === direct.res.body,
    true,
  );
}
{
  const { res, fetchCalls } = await call("top", "/api/bot-page/top", {
    method: "POST",
  });
  check("POST: 405", res.statusCode, 405);
  check("POST: Allow", res.headers.allow, "GET, HEAD");
  check("POST: 材料を取りに行かない", fetchCalls.length, 0);
}

// ---- 6. エスケープ ----
{
  const json = fresh();
  const evil = `<script>alert("x")</script>&'"`;
  const kiryu = json.data.find((v) => v.place_cd === 1);
  for (const r of kiryu.races) r.raceTitle = evil;
  const top = (await call("top", "/api/bot-page/top", { json })).res.body;
  const venue = (await call("venue", "/api/bot-page/venue/1", { json })).res
    .body;
  const escaped =
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;";
  check("エスケープ: トップに生の <script> が無い", hasRawScript(top), false);
  check(
    "エスケープ: トップの本文はエスケープ済み",
    top.includes(escaped),
    true,
  );
  check("エスケープ: 会場に生の <script> が無い", hasRawScript(venue), false);
  // 一般戦は title に節の名前が入らないので、SG にして title・description（属性）に入れる
  for (const r of kiryu.races) r.raceGrade = "SG";
  const sg = (await call("venue", "/api/bot-page/venue/1", { json })).res.body;
  check(
    "エスケープ: title に入る節の名前",
    sg.includes(`<title>${escaped}`) || /<title>[^<]*&lt;script&gt;/.test(sg),
    true,
  );
  check(
    'エスケープ: description（属性）に生の " や < が無い',
    /<meta name="description" content="[^"<>]*">/.test(sg),
    true,
  );
  check(
    "エスケープ: SG の会場にも生の <script> が無い",
    hasRawScript(sg),
    false,
  );
}

// ---- 7. 60秒の使い回し ----
{
  let clock = NOW;
  const now = () => clock;
  const f = stubFetch(() => jsonResponse(fresh()));
  const getTodayJson = createTodayRacesSource({ fetchImpl: f, now });
  const top = createBotPageHandler("top", { getTodayJson, now });
  const venue = createBotPageHandler("venue", { getTodayJson, now });
  const hit = async (h, url) => {
    const res = fakeRes();
    await h({ method: "GET", url, headers: { host: HOST } }, res);
    return res.statusCode;
  };
  await hit(top, "/api/bot-page/top");
  clock = NOW + 30_000;
  await hit(venue, "/api/bot-page/venue/1");
  clock = NOW + 59_999;
  await hit(top, "/api/bot-page/top");
  check("使い回し: 60秒以内は1回だけ取る", f.calls.length, 1);
  clock = NOW + 61_000;
  check("使い回し: 61秒後も 200", await hit(top, "/api/bot-page/top"), 200);
  check("使い回し: 61秒後に取り直す", f.calls.length, 2);

  // 取得中の同時呼び出しは1回の取得を待つ
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const slow = stubFetch(async () => {
    await gate;
    return jsonResponse(fresh());
  });
  const shared = createTodayRacesSource({ fetchImpl: slow, now });
  const pending = Promise.all([
    shared(`https://${HOST}`),
    shared(`https://${HOST}`),
  ]);
  release();
  await pending;
  check("使い回し: 同時の2回は取得1回", slow.calls.length, 1);

  // 失敗は使い回さない（次の呼び出しで取り直す）
  let fail = true;
  const flaky = stubFetch(() =>
    fail ? jsonResponse({}, 500) : jsonResponse(fresh()),
  );
  const src = createTodayRacesSource({ fetchImpl: flaky, now });
  await src(`https://${HOST}`).catch(() => {});
  fail = false;
  await src(`https://${HOST}`);
  check("使い回し: 失敗の直後に取り直す", flaky.calls.length, 2);
}

// ---- 8. 配置（Node・syd1） ----
{
  const vercel = JSON.parse(read("vercel.json"));
  const fn = vercel.functions?.["api/bot-page/**/*.js"];
  check("vercel.json: syd1", fn?.regions, ["syd1"]);
  check(
    "vercel.json: 4言語の文言のファイルと index.html（共通の JSON-LD）とブログ記事のメタデータ（トップのブログ欄）を同梱",
    fn?.includeFiles,
    "{src/locales/ja/common.json,src/locales/en/common.json,src/locales/zh-TW/common.json,src/locales/ko/common.json,index.html,src/data/blog-posts/*.json}",
  );
  check(
    "vercel.json: 同梱する文言のファイルが言語版の言語と ja をすべて含む",
    ["ja", ...BOT_PAGE_PREFIXED_LANGS].every((l) =>
      fn?.includeFiles?.includes(`src/locales/${l}/common.json`),
    ),
    true,
  );
  for (const rel of [
    "api/bot-page/top.js",
    "api/bot-page/venue/[code].js",
    "api/bot-page/[lang]/top.js",
    "api/bot-page/[lang]/venue/[code].js",
  ]) {
    check(
      `${rel}: edge でない`,
      /runtime\s*:\s*["']edge["']/.test(read(rel)),
      false,
    );
  }
}

// ---- 9. hreflang・JSON-LD（BOA-848） ----
{
  const SITE = "https://www.boat-ai.jp";
  // 人のページの HreflangTags が出す行（src/config/languages.js の SUPPORTED_LANGUAGES・localizePath の結果）
  const expectedAlternates = (base) => [
    { hreflang: "ja", href: `${SITE}${base}` },
    { hreflang: "en", href: `${SITE}/en${base === "/" ? "/" : base}` },
    { hreflang: "zh-Hant", href: `${SITE}/zh-TW${base === "/" ? "/" : base}` },
    { hreflang: "ko", href: `${SITE}/ko${base === "/" ? "/" : base}` },
    { hreflang: "x-default", href: `${SITE}${base}` },
  ];
  // 人のページの初期 HTML（index.html）の共通の JSON-LD
  const siteLd = parseJsonLdScripts(read("index.html"));
  check(
    "index.html の共通の JSON-LD の型",
    siteLd.map((ld) => ld["@type"]),
    ["WebSite", "SoftwareApplication", "Organization"],
  );

  const top = (await call("top", "/api/bot-page/top")).res.body;
  check("hreflang: トップ", alternatesOf(top), expectedAlternates("/"));
  const topLd = parseJsonLdScripts(top);
  check(
    "JSON-LD: トップは index.html の共通と、人の HomeAiIntro と同じ FAQPage（型・中身）",
    topLd,
    [...siteLd, toFaqPageLd(buildFaqItems(t, isAssistShown("ja")))],
  );
  check(
    "hreflang・JSON-LD は head の中",
    top.split("</head>")[1].includes("ld+json") ||
      top.split("</head>")[1].includes('rel="alternate"'),
    false,
  );

  const venue = (await call("venue", "/api/bot-page/venue/1")).res.body;
  check("hreflang: 会場", alternatesOf(venue), expectedAlternates("/venue/1"));
  const venueLd = parseJsonLdScripts(venue);
  check(
    "JSON-LD: 会場の型（共通の3つ＋パンくず）",
    venueLd.map((ld) => ld["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "BreadcrumbList"],
  );
  check(
    "JSON-LD: 会場の共通部分は index.html と同じ",
    venueLd.slice(0, 3),
    siteLd,
  );
  // 人の会場ページの Breadcrumb（ホーム › 桐生）と同じ
  check("JSON-LD: 会場のパンくず", venueLd[3], {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "ホーム", item: `${SITE}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "桐生",
        item: `${SITE}/venue/1`,
      },
    ],
  });
  check(
    "パンくずの項目は人の画面と同じ関数の値",
    getTodayVenueBreadcrumbItems(t, 1),
    [
      { name: "ホーム", url: "/" },
      { name: "桐生", url: "/venue/1" },
    ],
  );
  // 0件の日も同じ head（人の会場ページは0件でもパンくずを出す）
  const empty = { success: true, scrapedAt: "2026-10-11T12:00:00Z", data: [] };
  const emptyVenue = (
    await call("venue", "/api/bot-page/venue/1", { json: empty })
  ).res.body;
  check(
    "0件: 会場の hreflang・JSON-LD の型は同じ",
    [
      alternatesOf(emptyVenue),
      parseJsonLdScripts(emptyVenue).map((ld) => ld["@type"]),
    ],
    [alternatesOf(venue), venueLd.map((ld) => ld["@type"])],
  );

  // </script> を含む値で要素が閉じない
  const evil = `</script><script>alert("x")</script><!--&\u2028`;
  check(
    "jsonLdScriptText: < > & を \\uXXXX にする",
    /[<>&]/.test(jsonLdScriptText({ name: evil })),
    false,
  );
  check(
    "jsonLdScriptText: JSON として読むと元の値",
    JSON.parse(jsonLdScriptText({ name: evil })).name,
    evil,
  );
  const evilSite = await call("top", "/api/bot-page/top", {
    getSiteJsonLd: async () => [{ "@type": "WebSite", name: evil }],
  });
  check(
    "</script>: 共通の JSON-LD の値でも要素が閉じない（<script> は共通の1つと FAQPage だけ）",
    [
      (evilSite.res.body.match(/<script/g) || []).length,
      (evilSite.res.body.match(/<\/script>/g) || []).length,
      hasRawScript(evilSite.res.body),
    ],
    [2, 2, false],
  );
  check(
    "</script>: 読み戻すと元の値",
    parseJsonLdScripts(evilSite.res.body)[0].name,
    evil,
  );
  const venueModelHtml = renderVenueHtml(
    {
      path: "/venue/1",
      meta: { title: "t", description: "d", canonical: `${SITE}/venue/1` },
      heading: "h",
      emptyText: "e",
      races: [],
      breadcrumbItems: [
        { name: "ホーム", url: "/" },
        { name: evil, url: "/venue/1" },
      ],
    },
    "v",
  );
  check(
    "</script>: パンくずの名前でも要素が閉じない",
    [
      hasRawScript(venueModelHtml),
      parseJsonLdScripts(venueModelHtml)[0].itemListElement[1].name,
    ],
    [false, evil],
  );
  // index.html が読めない・JSON-LD が壊れていたら 503（黙って JSON-LD を落とさない）
  const origError = console.error;
  console.error = () => {};
  try {
    const broken = await call("top", "/api/bot-page/top", {
      getSiteJsonLd: async () => {
        throw new Error("index.html が無い");
      },
    });
    check("共通の JSON-LD が読めない: 503", broken.res.statusCode, 503);
  } finally {
    console.error = origError;
  }
  check(
    "parseJsonLdScripts: JSON でない JSON-LD は例外",
    (() => {
      try {
        parseJsonLdScripts('<script type="application/ld+json">{x</script>');
        return "通った";
      } catch {
        return "例外";
      }
    })(),
    "例外",
  );
}

// ---- 10. 言語版（BOA-848 第2段） ----
{
  const SITE = "https://www.boat-ai.jp";
  const { formatDateShortLocalized } =
    await import("../../src/utils/formatters.js");
  check("言語版の言語", BOT_PAGE_PREFIXED_LANGS, ["en", "zh-TW", "ko"]);
  const jaTop = (await call("top", "/api/bot-page/top")).res.body;
  const jaVenue = (await call("venue", "/api/bot-page/venue/1")).res.body;
  const json = fresh();
  const kiryuRaces = [...json.data.find((v) => v.place_cd === 1).races].sort(
    (a, b) => a.raceNo - b.raceNo,
  );
  const racerNames = json.data.flatMap((v) =>
    v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
  );
  for (const lang of BOT_PAGE_PREFIXED_LANGS) {
    const tl = await getLocaleT(lang);
    check(
      `${lang}: 文言はその言語（ja と違う）`,
      tl("home.todayRaces") !== t("home.todayRaces"),
      true,
    );

    // トップ: 直接・rewrite 経由（/{lang}/ と /{lang}）が同じ HTML
    const direct = await call("top", `/api/bot-page/${lang}/top`, {
      langMode: "prefixed",
    });
    check(`${lang} トップ: 200`, direct.res.statusCode, 200);
    check(
      `${lang} トップ: Cache-Control`,
      direct.res.headers["cache-control"],
      SUCCESS_CC,
    );
    const html = direct.res.body;
    for (const viaPath of [`/${lang}/`, `/${lang}`, `/${lang}/?x=1`]) {
      const via = await call("top", viaPath, { langMode: "prefixed" });
      check(
        `${lang} トップ: ${viaPath}（rewrite 経由）は直接と同じ HTML`,
        via.res.body === html,
        true,
      );
    }
    const meta = getTopPageMeta(tl, lang);
    check(`${lang} トップ: head`, headOf(html), {
      ...expectedHead(meta),
      lang,
    });
    check(`${lang} トップ: canonical`, meta.canonical, `${SITE}/${lang}/`);
    check(
      `${lang} トップ: 見出し`,
      html.includes(
        `<h2>${escapeHtml(`🏁 ${tl("home.todayRaces")} ${formatDateShortLocalized("2026-10-11", lang)}`)}</h2>`,
      ),
      true,
    );
    check(
      `${lang} トップ: 会場へのリンク（人と同じ /${lang}/venue/N）`,
      venueLinks(html),
      [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23].map(
        (c) => `/${lang}/venue/${c}`,
      ),
    );
    check(
      `${lang} トップ: 会場名はその言語`,
      html.includes(`<li>${tl("venues.4")}</li>`),
      true,
    );
    check(
      `${lang} トップ: hreflang は ja と同じ`,
      alternatesOf(html),
      alternatesOf(jaTop),
    );
    check(
      `${lang} トップ: JSON-LD は ja と同じ index.html の共通と、その言語の FAQPage`,
      parseJsonLdScripts(html),
      [
        ...parseJsonLdScripts(jaTop).slice(0, 3),
        toFaqPageLd(buildFaqItems(tl, isAssistShown(lang))),
      ],
    );

    // 会場
    const venue = await call("venue", `/api/bot-page/${lang}/venue/1`, {
      langMode: "prefixed",
    });
    check(`${lang} 会場: 200`, venue.res.statusCode, 200);
    const vhtml = venue.res.body;
    const viaVenue = await call("venue", `/${lang}/venue/1?x=1`, {
      langMode: "prefixed",
    });
    check(
      `${lang} 会場: /${lang}/venue/1?x=1（rewrite 経由）は直接と同じ HTML`,
      viaVenue.res.body === vhtml,
      true,
    );
    const vmeta = getTodayVenuePageMeta(tl, 1, kiryuRaces, lang);
    check(`${lang} 会場: head`, headOf(vhtml), {
      ...expectedHead(vmeta),
      lang,
    });
    check(
      `${lang} 会場: canonical`,
      vmeta.canonical,
      `${SITE}/${lang}/venue/1`,
    );
    check(
      `${lang} 会場: 見出し`,
      vhtml.includes(
        `<h1>${escapeHtml(`🏁 ${tl("venues.1")} ${tl("venueRaceList.todayTitle")}`)}</h1>`,
      ),
      true,
    );
    check(
      `${lang} 会場: レース詳細へのリンク（人と同じ /${lang}/race/{id}）`,
      links(vhtml),
      kiryuRaces.map(
        (r) =>
          `/${lang}/race/2026-10-11-01-${String(r.raceNo).padStart(2, "0")}`,
      ),
    );
    check(
      `${lang} 会場: リンクの文言・締切の文言はその言語`,
      vhtml.includes(`>${tl("raceCard.view")}</a>`) &&
        vhtml.includes(
          `<span>${tl("home.deadline")}</span> <span>${kiryuRaces[0].startTime}${tl("home.jstNote")}</span>`,
        ),
      true,
    );
    check(
      `${lang} 会場: hreflang は ja と同じ`,
      alternatesOf(vhtml),
      alternatesOf(jaVenue),
    );
    const ld = parseJsonLdScripts(vhtml);
    check(
      `${lang} 会場: 共通の JSON-LD は ja と同じ`,
      ld.slice(0, 3),
      parseJsonLdScripts(jaVenue).slice(0, 3),
    );
    check(`${lang} 会場: パンくず（人の画面と同じ関数の値）`, ld[3], {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: tl("analysisPage.breadcrumbHome"),
          item: `${SITE}/${lang}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: tl("venues.1"),
          item: `${SITE}/${lang}/venue/1`,
        },
      ],
    });
    check(
      `${lang} 会場: パンくずの項目`,
      getTodayVenueBreadcrumbItems(tl, 1, lang),
      [
        { name: tl("analysisPage.breadcrumbHome"), url: `/${lang}/` },
        { name: tl("venues.1"), url: `/${lang}/venue/1` },
      ],
    );

    // 選手名が入らない（本文）
    const pages = [html];
    for (const v of json.data) {
      pages.push(
        (
          await call("venue", `/api/bot-page/${lang}/venue/${v.place_cd}`, {
            langMode: "prefixed",
          })
        ).res.body,
      );
    }
    const body = pages.map((h) => h.split("<body>")[1]).join("\n");
    check(
      `${lang}: 選手名が HTML に無い`,
      racerNames.filter((n) => body.includes(n)).slice(0, 3),
      [],
    );
    check(`${lang}: 生の <script> が無い`, hasRawScript(body), false);

    // 0件
    const empty = {
      success: true,
      scrapedAt: "2026-10-11T12:00:00Z",
      data: [],
    };
    const ev = await call("venue", `/api/bot-page/${lang}/venue/1`, {
      json: empty,
      langMode: "prefixed",
    });
    check(
      `${lang} 0件: 会場は「開催なし」の文言（その言語）`,
      ev.res.statusCode === 200 &&
        ev.res.body.includes(`<p>${tl("home.noRacesToday")}</p>`),
      true,
    );
  }

  // 404（言語版の関数）
  for (const [page, url] of [
    ["top", "/api/bot-page/fr/top"],
    ["top", "/api/bot-page/ja/top"],
    ["top", "/api/bot-page/EN/top"],
    ["top", "/api/bot-page/top"],
    ["top", "/"],
    ["top", "/fr/"],
    ["top", "/en/x"],
    ["top", "/en/venue/1"],
    ["venue", "/api/bot-page/fr/venue/1"],
    ["venue", "/api/bot-page/en/venue/01"],
    ["venue", "/api/bot-page/en/venue/25"],
    ["venue", "/api/bot-page/en/venue/abc"],
    ["venue", "/api/bot-page/venue/1"],
    ["venue", "/venue/1"],
    ["venue", "/en/venue/0"],
    ["venue", "/en/venue/1/x"],
    ["venue", "/en/"],
  ]) {
    const { res, fetchCalls } = await call(page, url, { langMode: "prefixed" });
    check(`言語版 ${page} ${url}: 404`, res.statusCode, 404);
    check(
      `言語版 ${page} ${url}: no-store`,
      res.headers["cache-control"],
      "no-store",
    );
    check(`言語版 ${page} ${url}: 材料を取りに行かない`, fetchCalls.length, 0);
  }
  // 材料が壊れたら言語版も 503
  const origError = console.error;
  console.error = () => {};
  try {
    const { res } = await call("venue", "/api/bot-page/en/venue/1", {
      langMode: "prefixed",
      fetchImpl: stubFetch(() => jsonResponse({ success: false }, 500)),
    });
    check("言語版: 材料が壊れたら 503", res.statusCode, 503);
  } finally {
    console.error = origError;
  }
  // 対応外の言語の t は例外
  check(
    "getLocaleT: 対応外の言語は例外",
    await getLocaleT("fr").then(
      () => "通った",
      () => "例外",
    ),
    "例外",
  );
}

// ---- 11. トップの説明の本文・よくある質問・ブログ欄・案内の帯（人のトップの部分集合） ----
{
  const json = fresh();
  const racerNames = json.data.flatMap((v) =>
    v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
  );
  const textOf = (fragment) =>
    decode(fragment.replace(/<[^>]+>/g, "").trim()) ?? "";
  for (const lang of ["ja", ...BOT_PAGE_PREFIXED_LANGS]) {
    const tl = await getLocaleT(lang);
    const url =
      lang === "ja" ? "/api/bot-page/top" : `/api/bot-page/${lang}/top`;
    const html = (
      await call("top", url, lang === "ja" ? {} : { langMode: "prefixed" })
    ).res.body;
    const body = html.split("<body>")[1];
    const has = (fragment) => body.includes(fragment);
    const e = escapeHtml;
    const showAssist = isAssistShown(lang);

    // 見出し（人の画面と同じ並び: 本日開催中 → AI予想 → 2つで確かめる → よくある質問 → ブログ → 注目・新着）
    const headings = [...body.matchAll(/<h([1-4])>([\s\S]*?)<\/h\1>/g)].map(
      (m) => `h${m[1]} ${textOf(m[2])}`,
    );
    const { popularPosts, newPosts } = getHomeBlogPosts(lang);
    check(`${lang} トップ: 見出しの並び`, headings, [
      `h2 🏁 ${tl("home.todayRaces")} ${(await import("../../src/utils/formatters.js")).formatDateShortLocalized("2026-10-11", lang)}`,
      `h2 ${tl("home.aiIntro.title")}`,
      `h3 ${tl("home.aiIntro.checkTitle")}`,
      `h3 ${tl("home.aiIntro.faqTitle")}`,
      `h2 📝 ${tl("home.blogTitle")}`,
      `h3 🌟 ${tl("home.popularArticles")}`,
      ...popularPosts.map((p) => `h3 ${p.title}`),
      `h3 🆕 ${tl("home.newArticles")}`,
      ...newPosts.map((p) => `h3 ${p.title}`),
    ]);

    // 紹介文（ja 以外は龍神ソナーだけの文）
    for (const key of [
      "home.aiIntro.lead",
      "home.aiIntro.method",
      showAssist
        ? "home.aiIntro.toolsIntro"
        : "home.aiIntro.toolsIntroSonarOnly",
      "home.aiIntro.sonarWhere",
      "home.aiIntro.sonarQ1",
      "home.aiIntro.sonarQ2",
      "home.aiIntro.step1",
      showAssist ? "home.aiIntro.step3" : "home.aiIntro.step3SonarOnly",
      "home.aiIntro.disclaimer",
      "home.blogDesc",
    ]) {
      check(`${lang} トップ: ${key}`, has(`>${e(tl(key))}<`), true);
    }
    check(
      `${lang} トップ: 操作の2段目（ボタンの文言入り）`,
      has(
        `<li>${e(tl("home.aiIntro.step2", { button: tl("raceCard.view") }))}</li>`,
      ),
      true,
    );
    check(
      `${lang} トップ: 思考アシストのカードは ja だけ（人と同じ判定）`,
      [
        has(`<p>${e(tl("raceDetailPage.assistSwitch.assist"))}</p>`),
        has(`>${e(tl("home.aiIntro.assistWhere"))}<`),
      ],
      [showAssist, showAssist],
    );
    if (!showAssist) {
      check(
        `${lang} トップ: 思考アシストの文（toolsIntro・step3）が無い`,
        [
          has(`>${e(tl("home.aiIntro.toolsIntro"))}<`),
          has(`>${e(tl("home.aiIntro.step3"))}<`),
        ],
        [false, false],
      );
    }

    // リンク（人と同じ href）
    check(
      `${lang} トップ: 開催中の会場から選ぶ（ページ内リンク）と、その先の id`,
      [
        has(`<a href="#today-venues">${e(tl("home.aiIntro.venuesLink"))}</a>`),
        has(`<section id="today-venues">`),
      ],
      [true, true],
    );
    check(
      `${lang} トップ: 成績ページ・的中レースへのリンク（接頭辞なし）`,
      [
        has(`<a href="/accuracy">${e(tl("home.aiIntro.accuracyLink"))}</a>`),
        has(`<a href="/hit-races">${e(tl("home.aiIntro.hitRacesLink"))}</a>`),
      ],
      [true, true],
    );
    const prefix = lang === "ja" ? "" : `/${lang}`;
    check(
      `${lang} トップ: ブログの記事へのリンク（注目3・新着3、人と同じ順）`,
      links(body).filter((h) => /\/blog\/./.test(h)),
      [...popularPosts, ...newPosts].map((p) => `${prefix}/blog/${p.id}`),
    );
    check(
      `${lang} トップ: 注目3本・新着3本`,
      [popularPosts.length, newPosts.length],
      [3, 3],
    );
    check(
      `${lang} トップ: ブログ一覧へのリンク`,
      has(`<a href="${prefix}/blog">${e(tl("home.viewAllPosts"))}</a>`),
      true,
    );

    // 案内の帯（ja は人の画面が初回訪問の案内カードを出すので無い）
    check(
      `${lang} トップ: 案内の帯`,
      has(`<a href="${prefix}/about">${e(tl("home.introBannerText"))}</a>`),
      lang !== "ja",
    );
    check(
      `${lang} トップ: 帯の閉じるボタンなど操作の部品が無い`,
      /<button|<input|<form/i.test(body),
      false,
    );

    // よくある質問: 画面の問い・答えが人と同じ関数の値で、FAQPage の JSON-LD と一致する
    const faqItems = buildFaqItems(tl, showAssist);
    const shown = [
      ...body.matchAll(
        /<details open>\n<summary>([\s\S]*?)<\/summary>\n<p>([\s\S]*?)<\/p>\n<\/details>/g,
      ),
    ].map((m) => ({ question: decode(m[1]), answer: decode(m[2]) }));
    check(
      `${lang} トップ: よくある質問5問（人と同じ関数の値）`,
      shown,
      faqItems,
    );
    const faqLd = parseJsonLdScripts(html).find(
      (ld) => ld["@type"] === "FAQPage",
    );
    check(
      `${lang} トップ: FAQPage の問い・答えが画面の文言と一致`,
      faqLd?.mainEntity?.map((q) => ({
        question: q.name,
        answer: q.acceptedAnswer?.text,
      })),
      shown,
    );

    // 入れないもの: イン崩れ注意度のハイライト・選手名・オッズ
    const volatilityKeys = [
      "home.volatilityHighlightsTitle",
      "home.volatilityHighlightsScaleNote",
      "home.volatilityHighlightsAccuracyLink",
    ];
    check(
      `${lang} トップ: イン崩れ注意度のハイライトが無い`,
      volatilityKeys.filter((k) => has(e(tl(k)))),
      [],
    );
    check(
      `${lang} トップ: 選手名が無い`,
      racerNames.filter((n) => body.includes(n)).slice(0, 3),
      [],
    );
  }

  // エスケープ: 文言（t）と記事以外の値が全部 < > & ' " を含んでも、生のタグにならず、FAQPage は元の値に戻る
  const evil = `<script>alert("x")</script>&'"`;
  const { buildTopModel } = await import("../../src/utils/botPageModel.js");
  const { renderTopHtml } = await import("../../api/_lib/botPage.js");
  const evilModel = buildTopModel(fresh(), {
    t: () => evil,
    today: "2026-10-11",
    lang: "en",
  });
  const evilHtml = renderTopHtml(evilModel);
  check(
    "エスケープ: トップの文言に生の <script> が無い",
    hasRawScript(evilHtml),
    false,
  );
  check(
    "エスケープ: 文言はエスケープ済みで出る",
    evilHtml.includes(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;",
    ),
    true,
  );
  check(
    "エスケープ: FAQPage は読み戻すと元の値",
    parseJsonLdScripts(evilHtml)[0].mainEntity[0].name,
    evil,
  );
  // 記事の値（タイトル・説明）もエスケープする
  const postModel = structuredClone(evilModel);
  postModel.blog.groups[0].posts[0].title = evil;
  postModel.blog.groups[0].posts[0].href = `/blog/"><script>`;
  const postHtml = renderTopHtml(postModel);
  check(
    "エスケープ: 記事のタイトル・リンク先",
    [
      hasRawScript(postHtml),
      postHtml.includes('href="/blog/&quot;&gt;&lt;script&gt;"'),
    ],
    [false, true],
  );
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-page-function:${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-page-function: ${checked}件すべて通過`);
