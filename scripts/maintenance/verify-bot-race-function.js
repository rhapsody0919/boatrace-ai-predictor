#!/usr/bin/env node
/**
 * ボット向け HTML のレース詳細の関数（ADR 0089 第2段、BOA-848。api/bot-page/race/[id].js・api/bot-page/[lang]/race/[id].js、
 * 中身は api/_lib/botRace.js）を検証する。材料（/api/predictions/{date}?light=true）と時計を差し替えてハンドラを呼ぶ。
 * 材料は本番の 2026-10-12 から3会場を残したフィクスチャ（選手・結果は除外の検査のために残している）。
 *
 * 守るもの:
 * 1. 200・Cache-Control（第1段と同じ）。head の title・description・canonical・robots・lang が人のレース詳細と同じ関数の値
 *    （src/utils/raceDetailHeading.js）。hreflang は4言語と x-default、JSON-LD は共通の3つとパンくず
 * 2. 本文: パンくず・グレードと節タイトル・h1（会場名と NR・種別・日目。日目は同じ会場の他レースで補う）・「← レース一覧に戻る」・
 *    「データ分析結果 - 会場 NR（締切 HH:MM）」。締切は結果が出たら消す（人と同じ）
 * 3. 決定7の除外: 出走表の選手（名前・登録番号・級・勝率・モーター）、オッズ、払戻、着順・タイム・決まり手が本文に入らない
 * 4. 本日（JST）の id だけ。過去・未来・形の違う id・範囲外の会場とレース番号は 404。言語は en・zh-TW・ko だけ、
 *    ja の関数は接頭辞なし・言語版の関数は接頭辞ありだけを受ける
 * 5. 材料が取れない・壊れた・0件 → 503・no-store。材料は取れたがその id が無い → 404。60秒の使い回し
 * 6. 人のレース詳細（RaceDetailPage.jsx）が同じ関数を使い続けていること、vercel.json で syd1・edge でないこと
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

const { createRaceBotHandler, createPredictionsSource, parseBotRaceUrl } =
  await import("../../api/_lib/botRace.js");
const { ROBOTS, parseJsonLdScripts, getLocaleT, escapeHtml } =
  await import("../../api/_lib/botPage.js");
const { getRaceDetailMeta } =
  await import("../../src/utils/raceDetailHeading.js");
const jaModule = await import("../../api/bot-page/race/[id].js");
const langModule = await import("../../api/bot-page/[lang]/race/[id].js");
check(
  "race/[id].js の default がハンドラ",
  typeof jaModule.default,
  "function",
);
check(
  "[lang]/race/[id].js の default がハンドラ",
  typeof langModule.default,
  "function",
);

const FIXTURE_TEXT = read(
  "scripts/lib/__fixtures__/predictions-light/predictions-light-2026-10-12.json",
);
const fresh = () => JSON.parse(FIXTURE_TEXT);
// 2026-10-12 08:00 JST（UTC では 10/11 23:00。UTC の日付を使うと前日になる時刻）
const NOW = Date.parse("2026-10-11T23:00:00Z");
const HOST = "boatrace-ai-predictor-test.vercel.app";
const SITE = "https://www.boat-ai.jp";

const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function stubFetch(makeResponse) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return makeResponse(url);
  };
  fn.calls = calls;
  return fn;
}
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
async function call(
  url,
  {
    langMode = "ja",
    json = fresh(),
    fetchImpl,
    method = "GET",
    now = () => NOW,
  } = {},
) {
  const f = fetchImpl ?? stubFetch(() => jsonResponse(json));
  const handler = createRaceBotHandler({
    langMode,
    getRaces: createPredictionsSource({ fetchImpl: f, now }),
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
const bodyOf = (html) => html.split("<body>")[1] ?? "";
const links = (html) =>
  [...bodyOf(html).matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
const alternatesOf = (html) =>
  [
    ...html.matchAll(
      /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g,
    ),
  ].map((m) => [m[1], decode(m[2])]);

const tJa = await getLocaleT("ja");

// ---- 1・2. 優勝戦（桐生12R、節タイトルあり・日目なし） ----
{
  const id = "2026-10-12-01-12";
  const { res, fetchCalls } = await call(`/api/bot-page/race/${id}`);
  const html = res.body;
  check("桐生12R: 200", res.statusCode, 200);
  check("Cache-Control", res.headers["cache-control"], SUCCESS_CC);
  check("材料は同じ host の light の /api/predictions", fetchCalls, [
    `https://${HOST}/api/predictions/2026-10-12?light=true`,
  ]);
  const meta = getRaceDetailMeta(
    tJa,
    { raceId: id, venueCode: 1, raceNo: 12, date: "2026-10-12" },
    "ja",
  );
  check(
    "head",
    {
      lang: attr(html, /<html lang="([^"]*)"/),
      title: decode(attr(html, /<title>([^<]*)<\/title>/)),
      description: decode(
        attr(html, /<meta name="description" content="([^"]*)"/),
      ),
      robots: attr(html, /<meta name="robots" content="([^"]*)"/),
      canonical: attr(html, /<link rel="canonical" href="([^"]*)"/),
    },
    {
      lang: "ja",
      title: meta.title,
      description: meta.description,
      robots: ROBOTS,
      canonical: meta.canonical,
    },
  );
  check("canonical", meta.canonical, `${SITE}/race/${id}`);
  check("hreflang（4言語と x-default）", alternatesOf(html), [
    ["ja", `${SITE}/race/${id}`],
    ["en", `${SITE}/en/race/${id}`],
    ["zh-Hant", `${SITE}/zh-TW/race/${id}`],
    ["ko", `${SITE}/ko/race/${id}`],
    ["x-default", `${SITE}/race/${id}`],
  ]);
  const ld = parseJsonLdScripts(html);
  check(
    "JSON-LD の型",
    ld.map((l) => l["@type"]),
    ["WebSite", "SoftwareApplication", "Organization", "BreadcrumbList"],
  );
  check(
    "パンくず（ホーム › 桐生 › 12R）",
    ld[3].itemListElement.map((i) => [i.name, i.item]),
    [
      ["ホーム", `${SITE}/`],
      ["桐生", `${SITE}/venue/1`],
      ["12R", `${SITE}/race/${id}`],
    ],
  );
  const b = bodyOf(html);
  check(
    "節タイトル（NFKC）",
    b.includes("<p><span>第8回日本一しょうゆ杯</span></p>"),
    true,
  );
  check(
    "h1（種別は優勝戦の分類名と絵文字）",
    b.includes("<h1>🚤 桐生 12R <span>🏆 優勝戦</span></h1>"),
    true,
  );
  check("リンク先: パンくずとレース一覧（本日は /venue/1）", links(html), [
    "/",
    "/venue/1",
    "/venue/1",
  ]);
  check(
    "データ分析結果の見出しと締切",
    b.includes(
      "<h2>📊 データ分析結果 - 桐生 12R<span>（締切 20:45）</span></h2>",
    ),
    true,
  );
}

// 日目（浜名湖: 自レースに無ければ同じ会場の他レースで補う）・結果が出たレースは締切を消す
{
  const json = fresh();
  const hama = json.races.filter((r) => r.venueCode === 6);
  check(
    "フィクスチャ: 浜名湖に日目の無いレースと結果のあるレースがある（検査が空振りしない）",
    [hama.some((r) => r.seriesDay == null), hama.some((r) => r.result?.rank1)],
    [true, true],
  );
  const noDay = hama.find((r) => r.seriesDay == null);
  const { res } = await call(`/api/bot-page/race/${noDay.raceId}`);
  check(
    "日目は同じ会場の他レースの値で補う（3日目）",
    bodyOf(res.body).includes("<span>3日目</span></h1>"),
    true,
  );
  const done = hama.find((r) => r.result?.rank1);
  const finished = await call(`/api/bot-page/race/${done.raceId}`);
  check(
    "結果が出たレースは締切を出さない（人の PredictionSection と同じ）",
    bodyOf(finished.res.body).includes("締切"),
    false,
  );
  // 丸一日中止の会場は日目を出さない
  const allCancelled = fresh();
  for (const r of allCancelled.races.filter((x) => x.venueCode === 6)) {
    r.cancellationStatus = "confirmed";
    r.result = null;
  }
  const cancelled = await call(`/api/bot-page/race/${noDay.raceId}`, {
    json: allCancelled,
  });
  check(
    "丸一日中止の会場は日目を出さない",
    bodyOf(cancelled.res.body).includes("日目"),
    false,
  );
}

// ---- 3. 決定7の除外 ----
{
  const json = fresh();
  const names = json.races.flatMap((r) => (r.entries || []).map((e) => e.name));
  check("フィクスチャに選手名がある", names.length > 0, true);
  const bodies = [];
  for (const r of json.races) {
    bodies.push(
      bodyOf((await call(`/api/bot-page/race/${r.raceId}`)).res.body),
    );
  }
  const all = bodies.join("\n");
  check(
    "選手名が本文に無い",
    names.filter((n) => all.includes(n)).slice(0, 3),
    [],
  );
  const raceTimes = json.races
    .filter((r) => r.result?.raceTime1)
    .map((r) => r.result.raceTime1);
  check(
    "結果のタイム・払戻の値が本文に無い",
    raceTimes.filter((x) => all.includes(escapeHtml(x))).slice(0, 3),
    [],
  );
  check(
    "選手・オッズ・払戻・着順・決まり手の文言が本文に無い",
    [
      "オッズ",
      "払戻",
      "着順",
      "決まり手",
      "勝率",
      "モーター",
      "まくり",
      "<script",
    ].filter((w) => all.includes(w)),
    [],
  );
}

// ---- 4. id・言語 ----
{
  check(
    "parseBotRaceUrl: ja",
    parseBotRaceUrl("/race/2026-10-12-01-01")?.lang,
    "ja",
  );
  for (const [url, mode] of [
    ["/api/bot-page/race/2026-10-11-01-01", "ja"], // 過去
    ["/api/bot-page/race/2026-10-13-01-01", "ja"], // 未来
    ["/api/bot-page/race/2026-10-12-25-01", "ja"],
    ["/api/bot-page/race/2026-10-12-01-13", "ja"],
    ["/api/bot-page/race/2026-10-12-1-1", "ja"],
    ["/api/bot-page/race/abc", "ja"],
    ["/race/2026-10-12-01-01/assist", "ja"],
    ["/en/race/2026-10-12-01-01", "ja"], // ja の関数は接頭辞付きを受けない
    ["/race/2026-10-12-01-01", "prefixed"], // 言語版の関数は接頭辞なしを受けない
    ["/fr/race/2026-10-12-01-01", "prefixed"],
    ["/api/bot-page/fr/race/2026-10-12-01-01", "prefixed"],
  ]) {
    const { res, fetchCalls } = await call(url, { langMode: mode });
    check(`${mode} ${url}: 404`, res.statusCode, 404);
    check(`${mode} ${url}: no-store`, res.headers["cache-control"], "no-store");
    check(`${mode} ${url}: 材料を取りに行かない`, fetchCalls.length, 0);
  }
  // rewrite 経由（元のパス・クエリ付き）と直接呼んだ HTML が同じ
  const direct = await call("/api/bot-page/race/2026-10-12-06-05");
  const via = await call("/race/2026-10-12-06-05?tab=odds");
  check(
    "rewrite 経由と直接で同じ HTML",
    via.res.body === direct.res.body,
    true,
  );
  // 言語版
  for (const lang of ["en", "zh-TW", "ko"]) {
    const tl = await getLocaleT(lang);
    const id = "2026-10-12-06-05";
    const d = await call(`/api/bot-page/${lang}/race/${id}`, {
      langMode: "prefixed",
    });
    const v = await call(`/${lang}/race/${id}`, { langMode: "prefixed" });
    check(
      `${lang}: 200 で rewrite 経由と同じ`,
      [d.res.statusCode, v.res.body === d.res.body],
      [200, true],
    );
    const meta = getRaceDetailMeta(
      tl,
      { raceId: id, venueCode: 6, raceNo: 5, date: "2026-10-12" },
      lang,
    );
    check(
      `${lang}: lang・title・canonical`,
      [
        attr(d.res.body, /<html lang="([^"]*)"/),
        decode(attr(d.res.body, /<title>([^<]*)<\/title>/)),
        attr(d.res.body, /<link rel="canonical" href="([^"]*)"/),
      ],
      [lang, meta.title, `${SITE}/${lang}/race/${id}`],
    );
    check(`${lang}: リンク先は言語の接頭辞付き`, links(d.res.body), [
      `/${lang}/`,
      `/${lang}/venue/6`,
      `/${lang}/venue/6`,
    ]);
  }
}

// ---- 5. 失敗・無いレース・使い回し ----
{
  const origError = console.error;
  console.error = () => {};
  try {
    for (const [label, fetchImpl] of [
      ["HTTP 500", stubFetch(() => jsonResponse({}, 500))],
      ["JSON でない", stubFetch(() => jsonResponse("<html>"))],
      ["races が無い", stubFetch(() => jsonResponse({ date: "x" }))],
      ["races が0件", stubFetch(() => jsonResponse({ races: [] }))],
      ["形が違う", stubFetch(() => jsonResponse({ races: [{ raceId: 1 }] }))],
      [
        "取得で例外",
        stubFetch(() => {
          throw new TypeError("fetch failed");
        }),
      ],
    ]) {
      const { res } = await call("/api/bot-page/race/2026-10-12-01-01", {
        fetchImpl,
      });
      check(
        `${label}: 503・no-store`,
        [res.statusCode, res.headers["cache-control"]],
        [503, "no-store"],
      );
    }
  } finally {
    console.error = origError;
  }
  // 材料は取れたがその id が無い（取り込みの無い会場）
  const missing = await call("/api/bot-page/race/2026-10-12-02-01");
  check(
    "その id のレースが無い: 404・no-store",
    [missing.res.statusCode, missing.res.headers["cache-control"]],
    [404, "no-store"],
  );

  let clock = NOW;
  const now = () => clock;
  const f = stubFetch(() => jsonResponse(fresh()));
  const getRaces = createPredictionsSource({ fetchImpl: f, now });
  const h = createRaceBotHandler({ getRaces, now });
  const hit = async (id) => {
    const res = fakeRes();
    await h(
      { method: "GET", url: `/race/${id}`, headers: { host: HOST } },
      res,
    );
    return res.statusCode;
  };
  await hit("2026-10-12-01-01");
  clock = NOW + 30_000;
  await hit("2026-10-12-06-03");
  check("使い回し: 60秒以内は別のレースでも1回", f.calls.length, 1);
  clock = NOW + 61_000;
  await hit("2026-10-12-01-01");
  check("使い回し: 61秒後に取り直す", f.calls.length, 2);
  const post = await call("/race/2026-10-12-01-01", { method: "POST" });
  check("POST: 405", post.res.statusCode, 405);
}

// ---- 6. 人の画面と同じ関数・配置 ----
{
  const page = read("src/pages/RaceDetailPage.jsx");
  for (const fn of [
    "getRaceDetailHeading",
    "getRaceDetailMeta",
    "getRaceDetailBreadcrumbItems",
    "getRaceListLink",
  ]) {
    check(
      `RaceDetailPage.jsx が ${fn} を使う`,
      new RegExp(`\\b${fn}\\(`).test(page),
      true,
    );
  }
  check(
    "RaceDetailPage.jsx に見出しの組み立ての別実装が残っていない",
    /function getStageChip|function getSeriesDayLabel/.test(page),
    false,
  );
  const vercel = JSON.parse(read("vercel.json"));
  check(
    "vercel.json: syd1",
    vercel.functions?.["api/bot-page/**/*.js"]?.regions,
    ["syd1"],
  );
  for (const rel of [
    "api/bot-page/race/[id].js",
    "api/bot-page/[lang]/race/[id].js",
  ]) {
    check(
      `${rel}: edge でない`,
      /runtime\s*:\s*["']edge["']/.test(read(rel)),
      false,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-race-function: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-race-function: ${checked}件すべて通過`);
