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

const { createBotPageHandler, createTodayRacesSource, getJaT, ROBOTS } =
  await import("../../api/_lib/botPage.js");
const { getTopPageMeta, getTodayVenuePageMeta } =
  await import("../../src/utils/pageMeta.js");
// 関数のファイルそのものが Node から読める（import の時点で取得しない）
const topModule = await import("../../api/bot-page/top.js");
const venueModule = await import("../../api/bot-page/venue/[code].js");
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
  { json = fresh(), method = "GET", fetchImpl, now = () => NOW } = {},
) {
  const f = fetchImpl ?? stubFetch(() => jsonResponse(json));
  const handler = createBotPageHandler(page, {
    getTodayJson: createTodayRacesSource({ fetchImpl: f, now }),
    now,
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
    links(html),
    [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23].map((c) => `/venue/${c}`),
  );
  check(
    "トップ: 非開催の会場は名前だけ",
    html.includes("<li>平和島</li>"),
    true,
  );
  check("トップ: 節の名前", html.includes("第８回日本一しょうゆ杯"), true);
  check("トップ: 会場は24行", (html.match(/<li>/g) || []).length, 24);
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
  const pages = [(await call("top", "/api/bot-page/top")).res.body];
  for (const v of json.data) {
    pages.push(
      (await call("venue", `/api/bot-page/venue/${v.place_cd}`)).res.body,
    );
  }
  // head の meta description は人のページと同じ文言（「展開予測」を含む）なので、本文だけを見る
  const all = pages.map((h) => h.split("<body>")[1]).join("\n");
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
  check("0件: トップは会場へのリンクなし", links(top.res.body), []);
  check(
    "0件: トップは24会場の名前",
    (top.res.body.match(/<li>/g) || []).length,
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
  check(
    "エスケープ: トップに生の <script> が無い",
    top.includes("<script"),
    false,
  );
  check(
    "エスケープ: トップの本文はエスケープ済み",
    top.includes(escaped),
    true,
  );
  check(
    "エスケープ: 会場に生の <script> が無い",
    venue.includes("<script"),
    false,
  );
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
    sg.includes("<script"),
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
    "vercel.json: ja の文言のファイルを同梱",
    fn?.includeFiles,
    "src/locales/ja/common.json",
  );
  for (const rel of ["api/bot-page/top.js", "api/bot-page/venue/[code].js"]) {
    check(
      `${rel}: edge でない`,
      /runtime\s*:\s*["']edge["']/.test(read(rel)),
      false,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-page-function: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-page-function: ${checked}件すべて通過`);
