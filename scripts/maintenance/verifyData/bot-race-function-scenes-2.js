/**
 * verify-bot-race-function.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { call, attr, decode, navLinks, links, bodyOf, tJa } from "./bot-race-function-scenes-1.js";

let read, check, parseBotRaceUrl, createPredictionsSource, createRaceBotHandler, getLocaleT, getRaceDetailMeta, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes;

// ---- 7. 1R〜12R の帯・出走6艇・節のリンク（BOA-1189 GS01） ----
/** { の中身を割った 1/3 */
export async function botRaceLang1() {
  const { entrantRowsOf } = await import("../../../src/utils/raceEntrants.js");
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
  return { fixture, at, KOJIMA_G1, seriesStub, racerLinks, raceLinks, meetLinks, json29, id, b };
}

async function scene1() {
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
}

async function scene2() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・parseBotRaceUrl・createPredictionsSource・createRaceBotHandler・getLocaleT・getRaceDetailMeta・fresh・NOW・HOST・SITE・jsonResponse・stubFetch・fakeRes） */
export async function runBotRaceFunctionScenes2(env) {
  ({ read, check, parseBotRaceUrl, createPredictionsSource, createRaceBotHandler, getLocaleT, getRaceDetailMeta, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes } = env);
  await scene1();
  await scene2();
}
