#!/usr/bin/env node
/**
 * 生の HTML の head の材料の関数（/api/page-head/v1/venue/{code}、api/_lib/pageHeadApi.js）が、ボット向け HTML と同じ head を JSON で返し、失敗を CDN に残さないこと。
 *
 * /api/races/today と同じ形の小さな材料（一般戦・SG・開催なし）で、関数を直に呼ぶ（ネットに出ない）。
 * 1. 1〜24 の全会場で 200。title・description・canonical・BreadcrumbList が、同じ材料のボット向け HTML（respondBotPage）の head と同じ。
 *    v=1・kind=venue。訳は関数の束に入る ja の common.json から読む（既定の getT で組む）
 * 2. 正常時の Cache-Control は s-maxage=300・swr 60・stale-if-error 3600
 * 3. パスの形の外（0埋め・範囲外・版なし・余分な段）は 404・no-store、GET・HEAD の外は 405、host が変なら 400
 * 4. 材料（/api/races/today・訳）が取れない・形が違うと 503・no-store・Retry-After（「開催なし」の head を返さない）。
 *    節の行の失敗も同じ venueModelOf を通る（verify-bot-page-function が見る）
 * 5. 節の行の取得は anon キーだけを送り、service role の値は環境にあっても送らない
 */
import assert from "node:assert/strict";
import { createSeriesSource, getLocaleT, respondBotPage } from "../../api/_lib/botPage.js";
import { createVenueHeadHandler, respondVenueHead } from "../../api/_lib/pageHeadApi.js";

// /api/races/today と同じ形の小さな材料。桐生は一般戦、平和島は SG（節の名前が title に入る）、ほかの会場は開催なし
const race = (placeCd, raceNo, raceGrade, raceTitle) => ({
  raceNo, startTime: `${10 + raceNo}:00`, date: "2026-12-15", placeCd, raceGrade, cancellationStatus: null,
  seriesDay: 1, isFinalDay: false, raceTitle, raceStage: "予選",
});
const TODAY = {
  success: true,
  scrapedAt: "2026-12-15T01:00:00.000Z",
  data: [
    { place_cd: 1, place_name: "桐生", races: [1, 2, 3].map((n) => race(1, n, "ippan", "日本一しょうゆ杯")) },
    { place_cd: 4, place_name: "平和島", races: [1, 2].map((n) => race(4, n, "SG", "グランプリ")) },
  ],
};
const fresh = () => structuredClone(TODAY);
const NOW = Date.UTC(2026, 11, 15, 3, 0); // JST 2026-12-15 12:00
const HOST = { host: "www.boat-ai.jp" };
const deps = (over = {}) => ({
  getTodayJson: async () => fresh(),
  getSeriesRows: async () => [],
  getT: () => getLocaleT("ja"),
  now: () => NOW,
  ...over,
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
};

// Node の handler を呼ぶ（res の口だけ持つ物で受ける）
async function callHandler(handler, url, { method = "GET", headers = HOST } = {}) {
  const res = { statusCode: 0, headers: {}, body: undefined };
  await handler(
    { method, url, headers },
    {
      set statusCode(v) { res.statusCode = v; },
      setHeader(k, v) { res.headers[k] = v; },
      end(body) { res.body = body; },
    },
  );
  return res;
}

const decode = (s) =>
  s.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

function headOfBotHtml(html) {
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  return {
    title: decode(html.match(/<title>([^<]*)<\/title>/)[1]),
    description: decode(html.match(/<meta name="description" content="([^"]*)"/)[1]),
    canonical: decode(html.match(/<link rel="canonical" href="([^"]*)"/)[1]),
    jsonLd: lds.filter((x) => x["@type"] === "BreadcrumbList"),
  };
}

await check("1. 全会場でボット向け HTML と同じ head（既定の getT は束の ja を読む）", async () => {
  const handler = createVenueHeadHandler({
    getTodayJson: async () => fresh(),
    getSeriesRows: async () => [],
    now: () => NOW,
  });
  for (let code = 1; code <= 24; code += 1) {
    const res = await callHandler(handler, `/api/page-head/v1/venue/${code}`);
    assert.equal(res.statusCode, 200, `会場 ${code}`);
    const json = JSON.parse(res.body);
    const bot = await respondBotPage(
      { page: "venue", method: "GET", url: `/venue/${code}`, headers: HOST },
      { ...deps(), getT: getLocaleT, getSiteJsonLd: async () => [] },
    );
    assert.equal(bot.status, 200);
    const { v, kind, ...head } = json;
    assert.equal(v, 1);
    assert.equal(kind, "venue");
    assert.deepEqual(head, headOfBotHtml(bot.body), `会場 ${code}`);
    assert.equal(head.canonical, `https://www.boat-ai.jp/venue/${code}`);
    if (code === 4) assert.ok(head.title.includes("グランプリ"), `SG の節の名前が title に無い: ${head.title}`);
  }
});

await check("2. 正常時の Cache-Control", async () => {
  const res = await respondVenueHead({ method: "GET", url: "/api/page-head/v1/venue/12?x=1", headers: HOST }, deps());
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600");
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
});

await check("3. 形の外は 404・no-store、405、400", async () => {
  for (const url of ["/api/page-head/v1/venue/01", "/api/page-head/v1/venue/0", "/api/page-head/v1/venue/25", "/api/page-head/v1/venue/abc", "/api/page-head/venue/1", "/api/page-head/v2/venue/1", "/api/page-head/v1/venue/1/x", "/venue/1"]) {
    const res = await respondVenueHead({ method: "GET", url, headers: HOST }, deps());
    assert.equal(res.status, 404, url);
    assert.equal(res.headers["Cache-Control"], "no-store", url);
  }
  const post = await respondVenueHead({ method: "POST", url: "/api/page-head/v1/venue/1", headers: HOST }, deps());
  assert.equal(post.status, 405);
  const bad = await respondVenueHead({ method: "GET", url: "/api/page-head/v1/venue/1", headers: { host: "a b" } }, deps());
  assert.equal(bad.status, 400);
});

await check("4. 材料の失敗・形の違いは 503・no-store", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const cases = [
      { getTodayJson: async () => { throw new Error("HTTP 500"); } },
      { getTodayJson: async () => ({ broken: true }) },
      { getT: async () => { throw new Error("訳を読めない"); } },
    ];
    for (const over of cases) {
      const res = await respondVenueHead({ method: "GET", url: "/api/page-head/v1/venue/1", headers: HOST }, deps(over));
      assert.equal(res.status, 503);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.headers["Retry-After"], "300");
    }
  } finally {
    console.error = quiet;
  }
});

await check("5. 節の行の取得は anon キーだけを送る", async () => {
  const sent = [];
  const source = createSeriesSource({
    env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key-value", SUPABASE_SERVICE_ROLE_KEY: "service-role-sentinel" },
    fetchImpl: async (url, init) => {
      sent.push(JSON.stringify({ url: String(url), headers: init.headers }));
      return new Response("[]", { status: 200 });
    },
  });
  await source(1, "2026-10-11");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("anon-key-value"));
  assert.ok(!sent[0].includes("service-role-sentinel"), "service role の値を送った");
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-api-venue: すべて通った");
