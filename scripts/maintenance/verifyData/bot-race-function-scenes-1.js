/**
 * verify-bot-race-function.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let check, createRaceBotHandler, createPredictionsSource, getLocaleT, ROBOTS, parseJsonLdScripts, escapeHtml, getRaceDetailMeta, formatDateLocalized, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes, noSeries;
export let tJa;

export async function call(
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

export const SUCCESS_CC =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600";

export const attr = (html, re) => html.match(re)?.[1] ?? null;

export const decode = (s) =>
  s
    ?.replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

export const bodyOf = (html) => html.split("<body>")[1] ?? "";

export const links = (html) =>
  [...bodyOf(html).matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

// 帯（/race/）と選手（/racer/）を除いたリンク（パンくず・レース一覧・節）
export const navLinks = (html) =>
  links(html).filter((h) => !/\/race\/|^\/racer\//.test(h));

const alternatesOf = (html) =>
  [
    ...html.matchAll(
      /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g,
    ),
  ].map((m) => [m[1], decode(m[2])]);

async function scene1() {
  tJa = await getLocaleT("ja");
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
}

async function scene2() {
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
    // 他言語の /race は検索に出さないので alternate は0（BOA-1701・ADR 0107）
    check("hreflang（/race は alternate が0）", alternatesOf(html), []);
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
}

async function scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・createRaceBotHandler・createPredictionsSource・getLocaleT・ROBOTS・parseJsonLdScripts・escapeHtml・getRaceDetailMeta・formatDateLocalized・fresh・NOW・HOST・SITE・jsonResponse・stubFetch・fakeRes・noSeries） */
export async function runBotRaceFunctionScenes1(env) {
  ({ check, createRaceBotHandler, createPredictionsSource, getLocaleT, ROBOTS, parseJsonLdScripts, escapeHtml, getRaceDetailMeta, formatDateLocalized, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes, noSeries } = env);
  await scene1();
  await scene2();
  await scene3();
}
