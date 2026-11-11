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
 * 3. 決定7の除外: 出走表の勝率・モーター、オッズ、払戻、着順・タイム・決まり手が本文に入らない。選手名は出走6艇の一覧の中だけ
 * 7. タブの外の 1R〜12R の帯と出走6艇（BOA-1189 GS01、人の RaceNumberStrip・RaceEntrantsSummary と同じ関数）:
 *    児島12R（2026-09-29、G1）で /racer/ のリンクが6件（ja 専用で言語の接頭辞なし）・同じ会場の /race/ のリンクが12件・
 *    節のページ（/venue/16/meet/2026-09-28）へのリンクが1件。一般戦（戸田5R、2026-09-22）・G3 は節を引かずリンクも無い。
 *    節が引けない・節の範囲外・グランプリ等の対象外の節はリンクを出さずに 200。中止のレースは出走6艇を出さない
 * 4. 本日（JST）の id だけ。過去・未来・形の違う id・範囲外の会場とレース番号は 404。言語は en・zh-TW・ko だけ、
 *    ja の関数は接頭辞なし・言語版の関数は接頭辞ありだけを受ける
 * 5. 材料が取れない・壊れた・0件 → 503・no-store。材料は取れたがその id が無い → 404。60秒の使い回し
 * 6. vercel.json で syd1・edge でないこと（設定の値なので本文を読む）
 * 9. 人のレース詳細がボットと同じ関数で同じ物を出すこと（BOA-1407。本文の正規表現から描画の試験へ置き換え）:
 *    RaceDetailPage を jsdom に描き（scripts/lib/renderJsx.js の module hooks、supabase は偽のクライアント、
 *    /api/predictions は差し替えた fetch）、同じ材料・同じ時計のボットの HTML と、見出し・title・description・canonical・
 *    パンくず・一覧へのリンク・帯の /race/ と節のリンク・出走6艇の /racer/ を比べる。さらに共有の関数
 *    （raceDetailHeading.js の4つ・meetPageModel.js の needsMeetSeries・meetLinkStartDateOf・seriesCoveringDate・
 *    raceEntrants.js の entrantRowsOf）の戻り値を hook で差し替え、画面とサービス層（getSeriesOfDate）の出力が
 *    差し替えた値に従うことを見る（同じ値を出す写しを持っても落ちる）
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// §9 の描画のため、src/ の .jsx・.js を renderJsx の module hooks で読む。その上に2つの差し替えを重ねる
// （後に登録した hook が先に呼ばれ、nextResolve で renderJsx の拡張子の補いを通った後の URL を見る）:
// - src/services/supabaseClient.js → 偽のクライアント（globalThis[FAKE_KEY]）
// - 共有の関数のファイル → 本物を ?real で読み、名前の関数だけを globalThis[SPY_KEY] を通す包みにした物
//   （ボットも画面も同じ包みを通る。既定は本物をそのまま呼ぶ）
const FAKE_KEY = "__verifyBotRaceSupabase";
const SPY_KEY = "__verifyBotRaceSpy";
const SPIED = {
  "/src/utils/raceDetailHeading.js": [
    "getRaceDetailHeading",
    "getRaceDetailMeta",
    "getRaceDetailBreadcrumbItems",
    "getRaceListLink",
  ],
  "/src/utils/meetPageModel.js": [
    "needsMeetSeries",
    "meetLinkStartDateOf",
    "seriesCoveringDate",
  ],
  "/src/utils/raceEntrants.js": ["entrantRowsOf"],
};
const HOOKS = `
const SPIED = ${JSON.stringify(SPIED)};
const dataUrl = (src) => "data:text/javascript," + encodeURIComponent(src);
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const url = resolved.url;
  if (!url.startsWith("file:")) return resolved;
  if (url.endsWith("/src/services/supabaseClient.js")) {
    return { url: dataUrl("export const supabase = globalThis.${FAKE_KEY};"), shortCircuit: true };
  }
  for (const [suffix, names] of Object.entries(SPIED)) {
    if (!url.endsWith(suffix)) continue;
    const real = JSON.stringify(url + "?real");
    const wrappers = names.map(
      (n) => "export function " + n + "(...a) { const s = globalThis.${SPY_KEY}; return s ? s.call(" +
        JSON.stringify(n) + ", real." + n + ", a) : real." + n + "(...a); }",
    );
    return {
      url: dataUrl(["import * as real from " + real + ";", "export * from " + real + ";", ...wrappers].join("\\n")),
      shortCircuit: true,
    };
  }
  return resolved;
}
// src/data/blogPosts*.js 等の import.meta.glob を使うファイルは、import.meta.env が無いときの Node の分岐（fs で読む）を持つ。
// renderJsx は import.meta.env を定めて変換するので Vite の分岐へ入って落ちる。こうしたファイルだけ変換せずに読む
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.includes("/src/") && url.endsWith(".js")) {
    const raw = await nextLoad(url + "?raw", { ...context, format: "module" });
    if (String(raw.source).includes("import.meta.glob(")) {
      return { format: "module", source: raw.source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

/** 共有の関数の呼び出しを数え、overrides[name] があれば (本物, ...引数) で代わりに呼ぶ */
const spy = {
  overrides: {},
  calls: {},
  call(name, real, args) {
    (this.calls[name] ??= []).push(args);
    const override = this.overrides[name];
    return override ? override(real, ...args) : real(...args);
  },
  reset() {
    this.overrides = {};
    this.calls = {};
  },
};
globalThis[SPY_KEY] = spy;

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
const { formatDateLocalized } = await import("../../src/utils/formatters.js");
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
// 節（race_series）は既定で引かれたら失敗にする（一般戦の検査で節を引きに行かないことを見る）
const noSeries = async (venueCode, date) => {
  throw new Error(`節を引いた: ${venueCode} ${date}`);
};
async function call(
  url,
  {
    langMode = "ja",
    json = fresh(),
    fetchImpl,
    method = "GET",
    now = () => NOW,
    getSeries = noSeries,
  } = {},
) {
  const f = fetchImpl ?? stubFetch(() => jsonResponse(json));
  const handler = createRaceBotHandler({
    langMode,
    getRaces: createPredictionsSource({ fetchImpl: f, now }),
    now,
    getSeries,
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
// 帯（/race/）と選手（/racer/）を除いたリンク（パンくず・レース一覧・節）
const navLinks = (html) =>
  links(html).filter((h) => !/\/race\/|^\/racer\//.test(h));
const alternatesOf = (html) =>
  [
    ...html.matchAll(
      /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g,
    ),
  ].map((m) => [m[1], decode(m[2])]);

const tJa = await getLocaleT("ja");

// BOA-1200: 同じレースの状態だけを変えて4言語のメタを確認する。
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const t = await getLocaleT(lang);
  const key = { raceId: "2026-10-12-01-12", venueCode: 1, raceNo: 12, date: "2026-10-12" };
  const titles = [];
  for (const [state, suffix] of [
    [{}, ""],
    [{ finished: true }, "Result"],
    [{ cancelled: true }, "Cancelled"],
    [{ finished: true, cancelled: true }, "Result"],
  ]) {
    const meta = getRaceDetailMeta(t, key, lang, state);
    const baseline = getRaceDetailMeta(t, key, lang);
    const params = { venue: t("venues.1"), race: 12, date: formatDateLocalized(key.date, lang) };
    check(`${lang} title ${suffix}`, meta.title, t(`raceDetailPage.metaTitle${suffix}`, params));
    check(`${lang} description ${suffix}`, meta.description, t(`raceDetailPage.metaDescription${suffix}`, params));
    check(`${lang} canonical ${suffix}`, meta.canonical, baseline.canonical);
    const json = fresh();
    const race = json.races.find((r) => r.raceId === key.raceId);
    race.result = state.finished ? { finished: true, rank1: 1 } : null;
    race.cancellationStatus = state.cancelled ? "confirmed" : null;
    const { res } = await call(`/api/bot-page/${lang === "ja" ? "" : lang + "/"}race/${key.raceId}`, {
      json, langMode: lang === "ja" ? "ja" : "prefixed",
    });
    check(`${lang} bot title ${suffix}`, decode(attr(res.body, /<title>([^<]*)<\/title>/)), meta.title);
    check(`${lang} bot description ${suffix}`, decode(attr(res.body, /<meta name="description" content="([^"]*)"/)), meta.description);
    titles.push(meta.title);
  }
  check(`${lang} 3状態のtitle`, new Set(titles).size, 3);
}

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
  check("リンク先: パンくずとレース一覧（本日は /venue/1）", navLinks(html), [
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
  // 選手名は出走6艇の一覧（aria-label="出走6艇" の ul）の中だけに出る
  const outside = bodies
    .map((b) => b.replace(/<ul aria-label="出走6艇">[\s\S]*?<\/ul>/, ""))
    .join("\n");
  const all = bodies.join("\n");
  check(
    "選手名が出走6艇の一覧の外に無い",
    names
      .map((n) => n.replace(/\s+/g, ""))
      .filter((n) => outside.includes(n))
      .slice(0, 3),
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
    check(`${lang}: リンク先は言語の接頭辞付き`, navLinks(d.res.body), [
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

// ---- 6. 配置（vercel.json の値。設定なので本文を読む） ----
{
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

// ---- 7. 1R〜12R の帯・出走6艇・節のリンク（BOA-1189 GS01） ----
{
  const { entrantRowsOf } = await import("../../src/utils/raceEntrants.js");
  const fixture = (d) =>
    JSON.parse(
      read(
        `scripts/lib/__fixtures__/predictions-light/predictions-light-${d}.json`,
      ),
    );
  const at = (d) => () => Date.parse(`${d}T00:00:00+09:00`) + 8 * 3600_000;
  // 本番の race_series（2026-11-02 に読み取り専用で確かめた行）。児島の G1 の節
  const KOJIMA_G1 = {
    start_date: "2026-09-28",
    end_date: "2026-10-03",
    title: "児島キングカップ開設７４周年記念競走",
    grade: "G1",
  };
  const seriesStub = (row) => {
    const calls = [];
    const fn = async (venueCode, date) => {
      calls.push([venueCode, date]);
      return row;
    };
    fn.calls = calls;
    return fn;
  };
  const racerLinks = (html) => links(html).filter((h) => /^\/racer\//.test(h));
  const raceLinks = (html) => links(html).filter((h) => /\/race\//.test(h));
  const meetLinks = (html) => links(html).filter((h) => /\/meet\//.test(h));

  // G1（児島12R）
  const json29 = fixture("2026-09-29");
  const id = "2026-09-29-16-12";
  const race = json29.races.find((r) => r.raceId === id);
  check(
    "フィクスチャ: 児島12R は G1 で6艇",
    [race?.raceGrade, race?.entries?.length],
    ["G1", 6],
  );
  const getSeries = seriesStub(KOJIMA_G1);
  const { res } = await call(`/api/bot-page/race/${id}`, {
    json: json29,
    now: at("2026-09-29"),
    getSeries,
  });
  const html = res.body;
  check("児島12R: 200", res.statusCode, 200);
  check("児島12R: 節は会場・日で1回引く", getSeries.calls, [
    [16, "2026-09-29"],
  ]);
  const rows = entrantRowsOf(race.entries);
  check(
    "児島12R: /racer/ のリンクが6件（艇番順・ja 専用で接頭辞なし）",
    racerLinks(html),
    rows.map((r) => `/racer/${r.racerId}`),
  );
  const b = bodyOf(html);
  check(
    "児島12R: 選手名（空白を詰める）と級別が艇番と並ぶ",
    rows.every((r) =>
      b.includes(
        `<li><span>${r.number}</span> <a href="/racer/${r.racerId}" translate="no">${r.name}</a> <span translate="no">${r.grade}</span></li>`,
      ),
    ),
    true,
  );
  check(
    "児島12R: 同じ会場の /race/ のリンクが 1R〜12R の12件（2件以上）",
    raceLinks(html),
    Array.from(
      { length: 12 },
      (_, i) => `/race/2026-09-29-16-${String(i + 1).padStart(2, "0")}`,
    ),
  );
  check(
    "児島12R: 今のレースに aria-current",
    b.includes(`<a href="/race/${id}" aria-current="page">12R</a>`),
    true,
  );
  check("児島12R: 節のページへのリンクが1件", meetLinks(html), [
    "/venue/16/meet/2026-09-28",
  ]);
  check(
    "児島12R: 節のリンクの文字は人の帯と同じ",
    b.includes(`>${tJa("raceStrip.meetLink")}</a>`),
    true,
  );
  check(
    "児島12R: 帯と出走6艇はデータ分析結果の見出しの前（人の並び）",
    b.indexOf("<nav aria-label=") < b.indexOf('<ul aria-label="出走6艇">') &&
      b.indexOf('<ul aria-label="出走6艇">') < b.indexOf("<h2>"),
    true,
  );

  // 言語版: 帯と節は接頭辞付き、選手ページは ja 専用なので接頭辞なし
  const en = await call(`/api/bot-page/en/race/${id}`, {
    langMode: "prefixed",
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub(KOJIMA_G1),
  });
  check(
    "en: 選手は /racer/N（接頭辞なし）・帯と節は /en/ 付き",
    [
      racerLinks(en.res.body).length,
      raceLinks(en.res.body).every((h) => h.startsWith("/en/race/")),
      meetLinks(en.res.body),
    ],
    [6, true, ["/en/venue/16/meet/2026-09-28"]],
  );

  // 節が引けない: リンクだけ外して 200
  const origError = console.error;
  console.error = () => {};
  try {
    const failed = await call(`/api/bot-page/race/${id}`, {
      json: json29,
      now: at("2026-09-29"),
      getSeries: async () => {
        throw new Error("boom");
      },
    });
    check(
      "節が引けない: 200 で節のリンクだけ無い（帯と選手は出る）・CDN に残さない",
      [
        failed.res.statusCode,
        meetLinks(failed.res.body).length,
        racerLinks(failed.res.body).length,
        failed.res.headers["cache-control"],
      ],
      [200, 0, 6, "no-store"],
    );
  } finally {
    console.error = origError;
  }
  // 範囲外の節（前の節）・対象外のタイトル
  const none = await call(`/api/bot-page/race/${id}`, {
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub(null),
  });
  check(
    "節が無い: 節のリンクが無い（引けたので通常のキャッシュ）",
    [meetLinks(none.res.body), none.res.headers["cache-control"]],
    [[], SUCCESS_CC],
  );
  // 形の違う entries の1レースで、その日の全レースを 503 にしない
  const broken = fixture("2026-09-29");
  broken.races.find((r) => r.raceId !== id).entries = { bad: true };
  broken.races
    .find((r) => r.raceId === id)
    .entries.push(null, {
      name: "艇番なし",
    });
  const brokenRes = await call(`/api/bot-page/race/${id}`, {
    json: broken,
    now: at("2026-09-29"),
    getSeries: seriesStub(KOJIMA_G1),
  });
  check(
    "形の違う entries: 200 で、艇番の無い行は出さない",
    [
      brokenRes.res.statusCode,
      racerLinks(brokenRes.res.body).length,
      bodyOf(brokenRes.res.body).includes("艇番なし"),
    ],
    [200, 6, false],
  );
  const gp = await call(`/api/bot-page/race/${id}`, {
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub({ ...KOJIMA_G1, title: "グランプリ" }),
  });
  check(
    "グランプリ等の対象外の節: 節のリンクが無い",
    meetLinks(gp.res.body),
    [],
  );

  // G3（江戸川）は節を引かない
  const g3 = json29.races.find((r) => r.venueCode === 4);
  check("フィクスチャ: 江戸川は G3", g3?.raceGrade, "G3");
  const g3Res = await call(`/api/bot-page/race/${g3.raceId}`, {
    json: json29,
    now: at("2026-09-29"),
  });
  check(
    "G3: 200・節を引かない・節のリンクが無い",
    [g3Res.res.statusCode, meetLinks(g3Res.res.body)],
    [200, []],
  );

  // 一般戦（戸田5R、2026-09-22）
  const json22 = fixture("2026-09-22");
  const ippan = "2026-09-22-02-05";
  check(
    "フィクスチャ: 戸田5R は一般戦",
    json22.races.find((r) => r.raceId === ippan)?.raceGrade,
    "ippan",
  );
  const ip = await call(`/api/bot-page/race/${ippan}`, {
    json: json22,
    now: at("2026-09-22"),
  });
  check(
    "一般戦: 200・/racer/ 6件・/race/ 2件以上・節のリンクが無い（節も引かない）",
    [
      ip.res.statusCode,
      racerLinks(ip.res.body).length,
      raceLinks(ip.res.body).length >= 2,
      meetLinks(ip.res.body),
    ],
    [200, 6, true, []],
  );

  // グレードが分からないときだけ節を引く（人の needsSeries と同じ）
  const unknown = fixture("2026-09-22");
  for (const r of unknown.races) r.raceGrade = null;
  const unknownSeries = seriesStub(null);
  await call(`/api/bot-page/race/${ippan}`, {
    json: unknown,
    now: at("2026-09-22"),
    getSeries: unknownSeries,
  });
  check("グレード不明: 節を1回引く", unknownSeries.calls.length, 1);

  // 中止のレースは出走6艇を出さない（帯は出す）
  const cancelled = fixture("2026-09-22");
  const c = cancelled.races.find((r) => r.raceId === ippan);
  c.cancellationStatus = "confirmed";
  c.result = null;
  const cRes = await call(`/api/bot-page/race/${ippan}`, {
    json: cancelled,
    now: at("2026-09-22"),
  });
  check(
    "中止: 出走6艇を出さず帯は出す",
    [racerLinks(cRes.res.body).length, raceLinks(cRes.res.body).length],
    [0, 12],
  );
}

// ---- 8. 節（race_series）の取得 ----
{
  const { createSeriesSource } = await import("../../api/_lib/botRace.js");
  const env = {
    SUPABASE_URL: "https://x.supabase.co/",
    SUPABASE_ANON_KEY: "anon",
  };
  let clock = NOW;
  const f = stubFetch(() =>
    jsonResponse([
      {
        start_date: "2026-09-28",
        end_date: "2026-10-03",
        title: "t",
        grade: "G1",
      },
    ]),
  );
  const getSeries = createSeriesSource({ fetchImpl: f, now: () => clock, env });
  const got = await getSeries(16, "2026-09-29");
  check("節: 人と同じ条件の1行", f.calls, [
    "https://x.supabase.co/rest/v1/race_series?venue_code=eq.16&start_date=lte.2026-09-29&select=start_date,end_date,title,grade&order=start_date.desc&limit=1",
  ]);
  check("節: その日を含む節を返す", got?.start_date, "2026-09-28");
  await getSeries(16, "2026-09-29");
  check("節: 60秒以内は使い回す", f.calls.length, 1);
  clock = NOW + 61_000;
  await getSeries(16, "2026-09-29");
  check("節: 61秒後に引き直す", f.calls.length, 2);
  // 予定の最終日から4日以上後は同じ節としない（順延の許容は3日）
  check("節: 最終日から4日後は null", await getSeries(16, "2026-10-07"), null);
  for (const [label, impl] of [
    ["HTTP 500", stubFetch(() => jsonResponse({}, 500))],
    ["配列でない", stubFetch(() => jsonResponse({ a: 1 }))],
    ["日付が無い", stubFetch(() => jsonResponse([{ title: "x" }]))],
  ]) {
    const src = createSeriesSource({ fetchImpl: impl, env });
    const err = await src(16, "2026-09-29").then(
      () => null,
      (e) => e.name,
    );
    check(`節: ${label} は SeriesFetchError`, err, "SeriesFetchError");
  }
  const noEnv = await createSeriesSource({ fetchImpl: f, env: {} })(
    16,
    "2026-09-29",
  ).then(
    () => null,
    (e) => e.name,
  );
  check("節: 環境変数が無いと SeriesFetchError", noEnv, "SeriesFetchError");
}

// ---- 9. 人のレース詳細がボットと同じ関数で同じ物を出す（BOA-1407。描画の試験） ----
{
  // サービス層のキャッシュ・取得の console.log は検査の出力に混ぜない（§9 の終わりで戻す）
  const sectionLog = console.log;
  console.log = () => {};
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    // requestAnimationFrame を持たせる（タブの部品が使う）
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  const { window } = dom;
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Event",
    "MouseEvent",
    "getComputedStyle",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    const value = key === "window" ? window : window[key];
    if (value !== undefined)
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
  }
  window.scrollTo = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // 時計: 画面は Date で「本日（JST）」を決める。ボットの now と同じ時刻に止める
  const RealDate = Date;
  let clock = NOW;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };

  // 偽の supabase（メモリ上の表）。絞り（eq・lte・gte・lt・gt・in）・order・limit・range を表に当て、
  // 問い合わせを calls に残す（race_series 以外の表は空）。知らない鎖の関数は素通しせず例外にし、unknown に残して
  // §9 の終わりに 0件を見る（部品が握りつぶしても、絞りを当てない関数で材料しだいの偽の緑にしない）
  const KNOWN_OPS = new Set([
    "select",
    "eq",
    "lte",
    "gte",
    "lt",
    "gt",
    "in",
    "order",
    "limit",
    "range",
  ]);
  const fake = { tables: {}, calls: [], unknown: [] };
  const unknownOp = (where) => {
    fake.unknown.push(where);
    throw new Error(`偽の supabase に無い関数: ${where}`);
  };
  const runQuery = (q, single) => {
    let rows = (fake.tables[q.table] ?? []).map((r) => ({ ...r }));
    for (const [op, col, val] of q.ops) {
      if (op === "eq") rows = rows.filter((r) => r[col] === val);
      else if (op === "lte") rows = rows.filter((r) => r[col] <= val);
      else if (op === "gte") rows = rows.filter((r) => r[col] >= val);
      else if (op === "lt") rows = rows.filter((r) => r[col] < val);
      else if (op === "gt") rows = rows.filter((r) => r[col] > val);
      else if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
      else if (op === "order") {
        const dir = val?.ascending === false ? -1 : 1;
        rows.sort((a, b) =>
          a[col] < b[col] ? -dir : a[col] > b[col] ? dir : 0,
        );
      } else if (op === "limit") rows = rows.slice(0, col);
      else if (op === "range") rows = rows.slice(col, val + 1);
    }
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const chainOf = (q) => {
    const chain = new Proxy(
      {},
      {
        get(_, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "then")
            return (res, rej) =>
              Promise.resolve()
                .then(() => runQuery(q, false))
                .then(res, rej);
          if (prop === "single" || prop === "maybeSingle")
            return () => Promise.resolve().then(() => runQuery(q, true));
          if (!KNOWN_OPS.has(prop))
            return unknownOp(`${q.table}.${String(prop)}`);
          return (...args) => {
            q.ops.push([prop, ...args]);
            return chain;
          };
        },
      },
    );
    return chain;
  };
  globalThis[FAKE_KEY] = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "from")
          return (table) => {
            const q = { table, ops: [] };
            fake.calls.push(q);
            return chainOf(q);
          };
        if (prop === "rpc") return async () => ({ data: null, error: null });
        if (prop === "then") return undefined;
        return unknownOp(`supabase.${String(prop)}`);
      },
    },
  );

  // 画面の /api/predictions は差し替えた fetch で、ボットと同じフィクスチャを返す。他の URL は 404（通信しない）
  const pagePredictions = {};
  let predictionFetches = 0;
  globalThis.fetch = async (url) => {
    const m = String(url).match(
      /\/api\/predictions\/(\d{4}-\d{2}-\d{2})(\?|$)/,
    );
    const body = m && pagePredictions[m[1]];
    if (body) predictionFetches += 1;
    return body
      ? jsonResponse(body)
      : new Response("not found", { status: 404 });
  };

  // i18n: 画面の src/i18n.js は import.meta.glob で locales を読む（Node では動かない）ので、同じ locales で i18next を初めから組む。
  // そのため言語の切り替えの仕組み（URL の接頭辞→言語、localStorage の検出）そのものは見ていない。ここでは changeLanguage で決め打つ
  const i18next = (await import("i18next")).default;
  const { initReactI18next } = await import("react-i18next");
  const LANGS = ["ja", "en", "zh-TW", "ko"];
  await i18next.use(initReactI18next).init({
    resources: Object.fromEntries(
      LANGS.map((l) => [
        l,
        { common: JSON.parse(read(`src/locales/${l}/common.json`)) },
      ]),
    ),
    lng: "ja",
    fallbackLng: "ja",
    supportedLngs: LANGS,
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter, Routes, Route } = await import("react-router-dom");
  const { default: RaceDetailRoute } =
    await import("../../src/pages/RaceDetailPage.jsx");
  const { supabaseDataService, clearCache } =
    await import("../../src/services/supabaseDataService.js");
  // 帯が節を引いたかは、公開の入口 getSeriesOfDate の呼び出しで見る（race_series は他の部品も引くので表では見分けない）
  const seriesOfDateCalls = [];
  let seriesOfDateSettled = 0;
  const realSeriesOfDate = supabaseDataService.getSeriesOfDate;
  supabaseDataService.getSeriesOfDate = function (...args) {
    seriesOfDateCalls.push(args);
    const settle = () => {
      seriesOfDateSettled += 1;
    };
    const p = realSeriesOfDate.apply(this, args);
    p.then(settle, settle);
    return p;
  };
  const h = React.createElement;
  const act = (fn) =>
    React.act(async () => {
      await fn();
    });
  const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));

  const KOJIMA_G1 = {
    venue_code: 16,
    start_date: "2026-09-28",
    end_date: "2026-10-03",
    title: "児島キングカップ開設７４周年記念競走",
    grade: "G1",
  };
  const fixtureOf = (d) =>
    JSON.parse(
      read(
        `scripts/lib/__fixtures__/predictions-light/predictions-light-${d}.json`,
      ),
    );

  // 描いた後の待ちの上限（5ms の回数）。目安（根拠なし）。手元では10回前後で揃う
  const MAX_TICKS = 400;
  /**
   * 人のレース詳細を描き、比べる値を取り出す。描いた後は外す。
   * 待ちは「予想の取得が2回（軽量版とフル版）・帯と出走6艇が出た・getSeriesOfDate が seriesCalls 回終わった」まで。
   * 上限に届いたら、その時の様子を失敗として残して、その時点の描画で比べを続ける。
   * 描く間の console.error はためておき、errors で返す（比べて落ちたときに出す）
   */
  async function renderPage({
    id,
    lang = "ja",
    json,
    series = [],
    seriesCalls,
  }) {
    if (!Number.isInteger(seriesCalls))
      throw new Error(
        `renderPage(${id}): 節の呼び出しの期待の数 seriesCalls が無い`,
      );
    const date = id.slice(0, 10);
    clock = Date.parse(`${date}T08:00:00+09:00`);
    pagePredictions[date] = json;
    fake.tables = { race_series: series };
    fake.calls.length = 0;
    seriesOfDateCalls.length = 0;
    seriesOfDateSettled = 0;
    predictionFetches = 0;
    clearCache();
    window.localStorage.clear();
    await i18next.changeLanguage(lang);
    window.document.head.innerHTML = "";
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const prefix = lang === "ja" ? "" : `/${lang}`;
    const origError = console.error;
    const origLog = console.log;
    const errors = [];
    console.error = (...args) => {
      errors.push(
        args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "),
      );
    };
    console.log = () => {};
    try {
      await act(() =>
        root.render(
          h(
            MemoryRouter,
            { initialEntries: [`${prefix}/race/${id}`] },
            h(
              Routes,
              null,
              h(Route, {
                path: `${prefix}/race/:raceId`,
                element: h(RaceDetailRoute),
              }),
            ),
          ),
        ),
      );
      const state = () => ({
        predictionFetches,
        strip: !!container.querySelector('[data-testid="race-number-strip"]'),
        entrants: !!container.querySelector('[data-testid="race-entrants"] li'),
        seriesSettled: seriesOfDateSettled,
      });
      const ready = (st) =>
        st.predictionFetches >= 2 &&
        st.strip &&
        st.entrants &&
        st.seriesSettled >= seriesCalls;
      let ticks = 0;
      while (!ready(state()) && ticks < MAX_TICKS) {
        await tick();
        ticks += 1;
      }
      const reached = ready(state());
      check(
        `人 ${lang} ${id}: ${MAX_TICKS} 回の待ちの内に描画が揃う（予想2回・帯・出走6艇・節 ${seriesCalls} 回）`,
        reached ? null : state(),
        null,
      );
      // 揃った後の状態の更新（節のリンク等）を描き切る
      await tick();
      return {
        view: extractPage(container),
        seriesCalls: seriesOfDateCalls.map((a) => [...a]),
        errors: reached
          ? errors
          : [...errors, `待ちの上限: ${JSON.stringify(state())}`],
      };
    } finally {
      await act(() => root.unmount());
      container.remove();
      console.error = origError;
      console.log = origLog;
    }
  }

  const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? null;
  const hrefOf = (el) => el?.getAttribute("href") ?? null;
  function extractPage(container) {
    const doc = window.document;
    const h1 = container.querySelector(".page-header h1")?.cloneNode(true);
    h1?.querySelector('[data-testid="race-detail-deadline"]')?.remove();
    const strip = container.querySelector('[data-testid="race-number-strip"]');
    return {
      title: doc.head.querySelector("title")?.textContent ?? null,
      description:
        doc.head
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? null,
      canonical: hrefOf(doc.head.querySelector('link[rel="canonical"]')),
      crumbs: [...container.querySelectorAll(".breadcrumb-list li")].map(
        (li) => [
          text(li.querySelector("a, .breadcrumb-current")),
          hrefOf(li.querySelector("a")),
        ],
      ),
      kicker: [...container.querySelectorAll(".race-detail-kicker > span")].map(
        text,
      ),
      h1: text(h1),
      backLink: hrefOf(container.querySelector(".page-header a.back-link")),
      strip: strip
        ? [...strip.querySelectorAll("ul a")].map((a) => [
            hrefOf(a),
            text(a),
            a.getAttribute("aria-current"),
          ])
        : null,
      meet: strip
        ? [
            ...strip.querySelectorAll('[data-testid="race-number-strip-meet"]'),
          ].map((a) => [hrefOf(a), text(a)])
        : null,
      entrants: [
        ...container.querySelectorAll('[data-testid="race-entrants"] li'),
      ].map((li) => [
        text(li.querySelector(".rol-boat-badge")),
        text(li.querySelector(".race-entrants__name")),
        hrefOf(li.querySelector("a")),
        text(li.querySelector(".race-entrants__grade")),
      ]),
    };
  }

  /** ボットの HTML から同じ形の値を取り出す */
  function extractBot(html) {
    const doc = new JSDOM(html).window.document;
    const body = doc.body;
    const nav = [...body.querySelectorAll("nav")];
    const crumbNav = nav.find((n) => n.querySelector("ol"));
    const stripNav = nav.find((n) => n.hasAttribute("aria-label"));
    const h1 = body.querySelector("h1");
    const entrants = body.querySelector("ul[aria-label]");
    const kicker = body.querySelector("p");
    return {
      title: doc.querySelector("title")?.textContent ?? null,
      description:
        doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? null,
      canonical: hrefOf(doc.querySelector('link[rel="canonical"]')),
      crumbs: [...crumbNav.querySelectorAll("li")].map((li) => [
        text(li),
        hrefOf(li.querySelector("a")),
      ]),
      kicker:
        kicker && kicker.compareDocumentPosition(h1) & 4
          ? [...kicker.querySelectorAll("span")].map(text)
          : [],
      h1: text(h1),
      backLink: hrefOf(h1.nextElementSibling),
      strip: [...stripNav.querySelectorAll("ul a")].map((a) => [
        hrefOf(a),
        text(a),
        a.getAttribute("aria-current"),
      ]),
      meet: [...stripNav.querySelectorAll(":scope > a")].map((a) => [
        hrefOf(a),
        text(a),
      ]),
      entrants: entrants
        ? [...entrants.querySelectorAll("li")].map((li) => [
            text(li.querySelector(":scope > span")),
            text(li.querySelector("a, span[translate]")),
            hrefOf(li.querySelector("a")),
            text(li.querySelector(":scope > span[translate]")),
          ])
        : [],
    };
  }

  /** 同じ材料・時計・節でボットの HTML を作る */
  async function renderBot({ id, lang = "ja", json, seriesRow = null }) {
    const date = id.slice(0, 10);
    const { res } = await call(
      `/api/bot-page/${lang === "ja" ? "" : `${lang}/`}race/${id}`,
      {
        langMode: lang === "ja" ? "ja" : "prefixed",
        json,
        now: () => Date.parse(`${date}T08:00:00+09:00`),
        getSeries: async () => seriesRow,
      },
    );
    check(`ボット ${lang} ${id}: 200`, res.statusCode, 200);
    return extractBot(res.body);
  }

  // 9a. 同じ入力で人とボットが同じ物を出す
  const json29 = fixtureOf("2026-09-29");
  const json22 = fixtureOf("2026-09-22");
  const json12 = fixtureOf("2026-10-12");
  const hamaNoDay = json12.races.find(
    (r) => r.venueCode === 6 && r.seriesDay == null,
  );
  const cases = [
    {
      label: "児島12R（G1・節のリンクあり）",
      id: "2026-09-29-16-12",
      json: json29,
      series: [
        { ...KOJIMA_G1, start_date: "2026-09-14", end_date: "2026-09-19" },
        KOJIMA_G1,
        { ...KOJIMA_G1, start_date: "2026-10-08", end_date: "2026-10-13" },
      ],
      seriesRow: KOJIMA_G1,
      seriesCalls: 1,
    },
    {
      label: "児島12R en",
      id: "2026-09-29-16-12",
      lang: "en",
      json: json29,
      series: [KOJIMA_G1],
      seriesRow: KOJIMA_G1,
      seriesCalls: 1,
    },
    {
      label: "戸田5R（一般戦・節を引かない）",
      id: "2026-09-22-02-05",
      json: json22,
      seriesCalls: 0,
    },
    {
      label: "桐生12R（優勝戦・節タイトル）",
      id: "2026-10-12-01-12",
      json: json12,
      seriesCalls: 0,
    },
    {
      label: "浜名湖（日目を他レースで補う）",
      id: hamaNoDay.raceId,
      json: json12,
      seriesCalls: 0,
    },
  ];
  // 比べて落ちたら、描く間にためた console.error を出す（原因の手がかり）
  const reportErrors = (label, page, before) => {
    if (failures.length === before || page.errors.length === 0) return;
    console.error(
      `[${label}] 描く間の console.error（${page.errors.length}件、先頭10件）:`,
    );
    for (const e of page.errors.slice(0, 10)) console.error(`  ${e}`);
  };
  // check して、落ちたら描く間の console.error を出す
  const checkPage = (page, label, actual, expected) => {
    const before = failures.length;
    check(label, actual, expected);
    reportErrors(label, page, before);
  };
  for (const c of cases) {
    const before = failures.length;
    const page = await renderPage(c);
    const bot = await renderBot(c);
    check(
      `人とボット ${c.label}: 帯と出走6艇が描かれた`,
      [(page.view.strip ?? []).length > 1, page.view.entrants.length],
      [true, 6],
    );
    for (const key of Object.keys(bot))
      check(`人とボット ${c.label}: ${key}`, page.view[key], bot[key]);
    check(
      `人 ${c.label}: 節を引くのは G1 だけ（会場・日で）`,
      page.seriesCalls,
      c.seriesCalls ? [[16, c.id.slice(0, 10)]] : [],
    );
    reportErrors(c.label, page, before);
  }
  // 比べた値が空振りしていない（節のリンク・節タイトル・種別・日目）
  const kojima = await renderPage(cases[0]);
  checkPage(
    kojima,
    "人 児島12R: 節のリンクは /venue/16/meet/2026-09-28",
    kojima.view.meet,
    [["/venue/16/meet/2026-09-28", tJa("raceStrip.meetLink")]],
  );
  const kiryu = await renderPage(cases[3]);
  checkPage(
    kiryu,
    "人 桐生12R: 節タイトルと優勝戦",
    [kiryu.view.kicker.includes("第8回日本一しょうゆ杯"), kiryu.view.h1],
    [true, "🚤 桐生 12R 🏆 優勝戦"],
  );
  const hama = await renderPage(cases[4]);
  checkPage(
    hama,
    "人 浜名湖: 日目を補う",
    hama.view.h1?.endsWith("3日目"),
    true,
  );

  // 9b. 共有の関数の戻り値を差し替えると、人の画面とサービス層がそれに従う（同じ値の写しでは通らない）
  const withOverride = async (overrides, fn) => {
    spy.overrides = overrides;
    try {
      return await fn();
    } finally {
      spy.reset();
    }
  };
  const SPY_HEADING = {
    gradeConfig: { label: "SPY-G", color: "#000" },
    seriesTitle: "SPY-節",
    stageChip: { variant: "plain", label: "SPY-種別", isOfficial: false },
    seriesDayLabel: "SPY-日目",
  };
  const heading = await withOverride(
    { getRaceDetailHeading: () => SPY_HEADING },
    () => renderPage(cases[0]),
  );
  checkPage(
    heading,
    "人: 見出しは getRaceDetailHeading の値",
    [heading.view.kicker, heading.view.h1],
    [["SPY-G", "SPY-節"], "🚤 児島 12R SPY-種別 SPY-日目"],
  );
  const meta = await withOverride(
    {
      getRaceDetailMeta: () => ({
        title: "SPY-title",
        description: "SPY-description",
        canonical: "https://example.invalid/spy",
      }),
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    meta,
    "人: title・description・canonical は getRaceDetailMeta の値",
    [meta.view.title, meta.view.description, meta.view.canonical],
    ["SPY-title", "SPY-description", "https://example.invalid/spy"],
  );
  const crumbs = await withOverride(
    {
      getRaceDetailBreadcrumbItems: () => [
        { name: "SPY-1", url: "/spy-1" },
        { name: "SPY-2", url: "/spy-2" },
      ],
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    crumbs,
    "人: パンくずは getRaceDetailBreadcrumbItems の値",
    crumbs.view.crumbs,
    [
      ["SPY-1", "/spy-1"],
      ["SPY-2", null],
    ],
  );
  const listLink = await withOverride(
    { getRaceListLink: () => "/spy-list" },
    () => renderPage(cases[0]),
  );
  checkPage(
    listLink,
    "人: レース一覧へのリンクは getRaceListLink の値",
    listLink.view.backLink,
    "/spy-list",
  );
  const noNeed = await withOverride({ needsMeetSeries: () => false }, () =>
    renderPage({ ...cases[0], seriesCalls: 0 }),
  );
  checkPage(
    noNeed,
    "人: needsMeetSeries が false なら G1 でも節を引かずリンクも無い",
    [noNeed.seriesCalls.length, noNeed.view.meet],
    [0, []],
  );
  const need = await withOverride({ needsMeetSeries: () => true }, () =>
    renderPage({ ...cases[2], seriesCalls: 1 }),
  );
  checkPage(
    need,
    "人: needsMeetSeries が true なら一般戦でも節を引く",
    need.seriesCalls.length > 0,
    true,
  );
  const meetStart = await withOverride(
    { meetLinkStartDateOf: () => "2099-01-01" },
    () => renderPage(cases[0]),
  );
  checkPage(
    meetStart,
    "人: 節のリンクの初日は meetLinkStartDateOf の値",
    meetStart.view.meet.map(([href]) => href),
    ["/venue/16/meet/2099-01-01"],
  );
  const rows = await withOverride(
    {
      entrantRowsOf: (real, players) =>
        real(players)
          .slice(0, 2)
          .map((r) => ({ ...r, name: `SPY${r.number}`, grade: "Z9" })),
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    rows,
    "人: 出走6艇の行は entrantRowsOf の値",
    rows.view.entrants.map(([n, name, , grade]) => [n, name, grade]),
    [
      ["1", "SPY1", "Z9"],
      ["2", "SPY2", "Z9"],
    ],
  );

  // サービス層の節の取得（公開の入口 supabaseDataService.getSeriesOfDate を偽の supabase の上で呼ぶ）
  const seriesOf = async (date) => {
    clearCache();
    return supabaseDataService.getSeriesOfDate(16, date);
  };
  fake.tables = {
    race_series: [
      { ...KOJIMA_G1, start_date: "2026-09-14", end_date: "2026-09-19" },
      KOJIMA_G1,
      { ...KOJIMA_G1, venue_code: 4, start_date: "2026-10-01" },
    ],
  };
  check(
    "サービス層: その日を含む節・順延の3日以内は同じ節・4日後は null・前の節の範囲外は null",
    [
      (await seriesOf("2026-09-29"))?.start_date,
      (await seriesOf("2026-10-06"))?.start_date,
      await seriesOf("2026-10-07"),
      await seriesOf("2026-09-24"),
    ],
    ["2026-09-28", "2026-09-28", null, null],
  );
  const SENTINEL = { start_date: "2099-01-01", end_date: "2099-01-01" };
  const covered = await withOverride(
    {
      seriesCoveringDate: (real, latest, date) =>
        latest?.start_date === "2026-09-28" && date === "2026-10-07"
          ? SENTINEL
          : real(latest, date),
    },
    () => seriesOf("2026-10-07"),
  );
  check(
    "サービス層: 節の範囲の判定は seriesCoveringDate（その日以前のいちばん新しい節とその日を渡す）",
    covered,
    SENTINEL,
  );
  check(
    "偽の supabase に無い関数を呼んでいない",
    [...new Set(fake.unknown)],
    [],
  );
  delete globalThis[FAKE_KEY];
  globalThis.Date = RealDate;
  console.log = sectionLog;
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-race-function: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-race-function: ${checked}件すべて通過`);
// 描いた画面のタイマー（締切の時計等）を待たずに終える。後で非同期の check を足すときは、この行より前で await し終えること
// （ここより後に残った約束は、結果を出さずに黙って切られる）
process.exit(0);
