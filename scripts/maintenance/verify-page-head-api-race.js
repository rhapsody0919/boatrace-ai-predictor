#!/usr/bin/env node
/**
 * 生の HTML の head の材料の関数（/api/page-head/v1/race/{id}、api/_lib/pageHeadApi.js）が、レース詳細の本日・過去日の head を人の画面と同じ条件で返し、失敗を CDN に残さないこと。
 *
 * /api/predictions/{date}?light=true と同じ形の小さな材料（pickHeadingFields 済み）で、関数を直に呼ぶ（ネットに出ない）。
 * 1. 本日の id は、同じ材料のボット向け HTML（respondRacePage）と title・description・canonical・BreadcrumbList が同じ。s-maxage=60
 * 2. title は結果が出たら「結果・払戻」、中止なら「中止」の文（人の getRaceDetailMeta の条件）
 * 3. 過去日の id は 200・s-maxage=86400 で、パンくずは「ホーム › 過去の予想 › 日付 › 会場 › NR」（本日の形にしない）
 * 4. 材料にその id が無い・id の形の外・版なし・余分な段は 404・no-store、GET・HEAD の外は 405、host が変なら 400
 * 5. 材料が取れないと 503・no-store・Retry-After（「無いレース」にしない）
 * 6. 既定の getT（関数の束に入る ja の common.json）で組める
 */
import assert from "node:assert/strict";
import { getLocaleT } from "../../api/_lib/botPage.js";
import { pickHeadingFields, respondRacePage } from "../../api/_lib/botRace.js";
import { createRaceHeadHandler, respondRaceHead } from "../../api/_lib/pageHeadApi.js";

const NOW = Date.UTC(2026, 11, 15, 3, 0); // JST 2026-12-15 12:00
const HOST = { host: "www.boat-ai.jp" };
const raw = (date, venue, no, extra = {}) => ({
  raceId: `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`,
  venueCode: venue,
  raceNumber: no,
  startTime: `${10 + no}:00`,
  cancellationStatus: null,
  raceGrade: "SG",
  raceTitle: "グランプリ",
  seriesDay: 1,
  isFinalDay: false,
  raceStage: "予選",
  result: null,
  ...extra,
});
const DAYS = {
  "2026-12-15": [
    raw("2026-12-15", 4, 1),
    raw("2026-12-15", 4, 2, { result: { rank1: 3 } }),
    raw("2026-12-15", 4, 3, { cancellationStatus: "confirmed" }),
  ],
  "2026-12-01": [raw("2026-12-01", 1, 5, { raceGrade: "ippan", raceTitle: "一般戦", result: { rank1: 1 } })],
};
const getRaces = async (_origin, date) => {
  const day = DAYS[date];
  if (!day) throw new Error(`材料が無い日 ${date}`);
  return day.map(pickHeadingFields);
};
const deps = (over = {}) => ({ getRaces, getT: () => getLocaleT("ja"), now: () => NOW, ...over });
const call = (id, over, req = {}) =>
  respondRaceHead({ method: "GET", url: `/api/page-head/v1/race/${id}`, headers: HOST, ...req }, deps(over));

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
const bodyOf = (res) => {
  const { v, kind, ...head } = JSON.parse(res.body);
  assert.equal(v, 1);
  assert.equal(kind, "race");
  return head;
};

await check("1. 本日の id はボット向け HTML と同じ head", async () => {
  for (const id of ["2026-12-15-04-01", "2026-12-15-04-02", "2026-12-15-04-03"]) {
    const res = await call(id);
    assert.equal(res.status, 200, id);
    assert.equal(res.headers["Cache-Control"], "public, max-age=0, s-maxage=60, stale-while-revalidate=30, stale-if-error=3600");
    const bot = await respondRacePage(
      { method: "GET", url: `/race/${id}`, headers: HOST },
      { getRaces, now: () => NOW, getT: getLocaleT, getSiteJsonLd: async () => [], getSeries: async () => null },
    );
    assert.equal(bot.status, 200, id);
    assert.deepEqual(bodyOf(res), headOfBotHtml(bot.body), id);
  }
});

await check("2. 結果・中止で title の文が変わる", async () => {
  assert.equal(bodyOf(await call("2026-12-15-04-01")).title, "平和島競艇 1R 直前情報・展示・AI予想（2026年12月15日(火)）- 龍神レーダー");
  assert.match(bodyOf(await call("2026-12-15-04-02")).title, /^平和島競艇 2R 結果・払戻（/);
  assert.match(bodyOf(await call("2026-12-15-04-03")).title, /^平和島競艇 3R 中止（/);
});

await check("3. 過去日は長く残し、パンくずは過去の形", async () => {
  const res = await call("2026-12-01-01-05");
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=3600");
  const head = bodyOf(res);
  assert.match(head.title, /^桐生競艇 5R 結果・払戻（2026年12月1日/);
  assert.equal(head.canonical, "https://www.boat-ai.jp/race/2026-12-01-01-05");
  assert.equal(head.jsonLd.length, 1);
  assert.deepEqual(
    head.jsonLd[0].itemListElement.map((x) => [x.name, x.item]),
    [
      ["ホーム", "https://www.boat-ai.jp/"],
      ["過去の予想", "https://www.boat-ai.jp/races"],
      ["2026年12月1日(火)", "https://www.boat-ai.jp/races/2026-12-01"],
      ["桐生", "https://www.boat-ai.jp/races/2026-12-01/1"],
      ["5R", "https://www.boat-ai.jp/race/2026-12-01-01-05"],
    ],
  );
  const today = bodyOf(await call("2026-12-15-04-01"));
  assert.ok(!today.jsonLd[0].itemListElement.some((x) => x.name === "過去の予想"), "本日に過去のパンくず");
});

await check("4. 無い id・形の外は 404・no-store、405、400", async () => {
  for (const id of ["2026-12-15-04-09", "2026-12-15-25-01", "2026-12-15-04-13", "202612150401", "2026-12-15-04-01/x"]) {
    const res = await call(id);
    assert.equal(res.status, 404, id);
    assert.equal(res.headers["Cache-Control"], "no-store", id);
  }
  for (const url of ["/api/page-head/race/2026-12-15-04-01", "/api/page-head/v2/race/2026-12-15-04-01", "/race/2026-12-15-04-01"]) {
    const res = await respondRaceHead({ method: "GET", url, headers: HOST }, deps());
    assert.equal(res.status, 404, url);
  }
  assert.equal((await call("2026-12-15-04-01", {}, { method: "POST" })).status, 405);
  assert.equal((await call("2026-12-15-04-01", {}, { headers: { host: "a b" } })).status, 400);
});

await check("5. 材料が取れないと 503・no-store", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const over of [{ getRaces: async () => { throw new Error("HTTP 500"); } }, { getT: async () => { throw new Error("訳"); } }]) {
      const res = await call("2026-12-15-04-01", over);
      assert.equal(res.status, 503);
      assert.equal(res.headers["Cache-Control"], "no-store");
      assert.equal(res.headers["Retry-After"], "300");
    }
    // 材料の無い日（取り込み前）も 503（404 の「無いレース」にしない）
    assert.equal((await call("2026-11-30-01-01")).status, 503);
  } finally {
    console.error = quiet;
  }
});

await check("6. 既定の getT（束の ja）で組める", async () => {
  const handler = createRaceHeadHandler({ getRaces, now: () => NOW });
  const res = { statusCode: 0, body: undefined };
  await handler(
    { method: "GET", url: "/api/page-head/v1/race/2026-12-01-01-05", headers: HOST },
    { set statusCode(v) { res.statusCode = v; }, setHeader() {}, end(b) { res.body = b; } },
  );
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).title, /^桐生競艇 5R 結果・払戻/);
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-api-race: すべて通った");
