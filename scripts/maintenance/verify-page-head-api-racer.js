#!/usr/bin/env node
/**
 * 生の HTML の head の材料の関数（/api/page-head/v1/racer/{4桁}、api/_lib/pageHeadRacer.js）が、人の画面と同じ選手の head を anon キーで読んで返し、失敗を「プロフィール無し」にしないこと。
 *
 * Supabase の REST を差し替えて関数を直に呼ぶ（ネットに出ない）。
 * 1. 3つの表（racer_profiles・race_entries の最新1行・racer_period_stats）を racer_id で読み、anon キーだけを送る（service の鍵は送らない）
 * 2. title・description は期別の最新の勝率・2連率・優出・優勝を入れた人の画面と同じ文、canonical は選手の URL、
 *    JSON-LD は ProfilePage（dateModified は最新の期の calc_to）と BreadcrumbList。s-maxage=21600
 * 3. 期別の行が無ければ勝率の無い title（人の画面と同じ）
 * 4. 選手が無いと 404・no-store。読みの失敗・配列でない応答・鍵が無い・壊れた行は 503・no-store・Retry-After
 * 5. 形の外（4桁でない・版なし）は 404、GET・HEAD の外は 405
 */
import assert from "node:assert/strict";
import { createRacerHeadHandler, createRacerSource, respondRacerHead } from "../../api/_lib/pageHeadRacer.js";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key-value", SUPABASE_SERVICE_KEY: "service-sentinel" };
const PROFILE = { racer_id: 4320, name: "峰　　竜太", name_kana: "みね　　りゅうた", birth_date: "1985-03-30", branch: "佐賀", hometown: "佐賀県" };
const PERIODS = [
  { period_year: 2026, period_no: 1, calc_to: "2025-10-31", win_rate: 8.12, top2_rate: 60.5, starts: 100, finals: 6, wins: 3 },
  { period_year: 2026, period_no: 2, calc_to: "2026-04-30", win_rate: 8.3456, top2_rate: 62.04, starts: 90, finals: 5, wins: 2 },
];
const rowsFor = (overrides = {}) => ({
  racer_profiles: [PROFILE],
  race_entries: [{ grade: "A1", race_id: "2026-11-20-04-12" }],
  racer_period_stats: PERIODS,
  ...overrides,
});

function fakeRest(tables, { status = 200, raw } = {}) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.stringify({ url: String(url), headers: init.headers }));
    const table = new URL(String(url)).pathname.split("/").pop();
    if (raw) return raw(table);
    return new Response(JSON.stringify(tables[table] ?? []), { status });
  };
  return { fetchImpl, sent };
}

const call = (getRacer, url = "/api/page-head/v1/racer/4320", method = "GET") =>
  respondRacerHead({ method, url }, { getRacer });

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
const quietly = async (fn) => {
  const keep = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = keep;
  }
};

await check("1. 3つの表を racer_id で読み、anon キーだけを送る", async () => {
  const rest = fakeRest(rowsFor());
  await createRacerSource({ fetchImpl: rest.fetchImpl, env: ENV })("4320");
  assert.equal(rest.sent.length, 3);
  const tables = rest.sent.map((s) => new URL(JSON.parse(s).url).pathname.split("/").pop()).sort();
  assert.deepEqual(tables, ["race_entries", "racer_period_stats", "racer_profiles"]);
  for (const s of rest.sent) {
    assert.ok(s.includes("racer_id=eq.4320"), s);
    assert.ok(s.includes("anon-key-value"));
    assert.ok(!s.includes("service-sentinel"), "service の鍵を送った");
  }
  assert.ok(rest.sent.some((s) => s.includes("race_entries") && s.includes("order=race_id.desc") && s.includes("limit=1")));
});

await check("2. 人の画面と同じ title・description・JSON-LD", async () => {
  const getRacer = createRacerSource({ fetchImpl: fakeRest(rowsFor()).fetchImpl, env: ENV });
  const res = await call(getRacer);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=0, s-maxage=21600, stale-while-revalidate=3600, stale-if-error=3600");
  const { v, kind, title, description, canonical, jsonLd } = JSON.parse(res.body);
  assert.deepEqual([v, kind], [1, "racer"]);
  assert.equal(title, "峰竜太（競艇）選手の成績・勝率8.35・決まり手 | 龍神レーダー");
  assert.equal(
    description,
    "峰竜太選手（登録番号4320・佐賀支部・A1）の競艇（ボートレース）成績データ。2026年後期の勝率 8.35・2連率 62.0%・優出 5・優勝 2。全国勝率・当地勝率の推移、平均ST、会場別・枠番別成績、決まり手、直近のレース一覧とプロフィール。",
  );
  assert.equal(canonical, "https://www.boat-ai.jp/racer/4320");
  assert.deepEqual(jsonLd.map((x) => x["@type"]), ["ProfilePage", "BreadcrumbList"]);
  assert.equal(jsonLd[0].dateModified, "2026-04-30");
  assert.equal(jsonLd[0].mainEntity.alternateName, "みね りゅうた");
  assert.deepEqual(jsonLd[1].itemListElement.map((x) => x.name), ["ホーム", "選手一覧", "峰竜太"]);
});

await check("3. 期別の行が無ければ勝率の無い title", async () => {
  const getRacer = createRacerSource({ fetchImpl: fakeRest(rowsFor({ racer_period_stats: [] })).fetchImpl, env: ENV });
  const { title, jsonLd } = JSON.parse((await call(getRacer)).body);
  assert.equal(title, "峰竜太（競艇）選手の成績・勝率・決まり手 | 龍神レーダー");
  assert.equal("dateModified" in jsonLd[0], false);
});

await check("4. 選手が無いは 404、読みの失敗は 503（プロフィール無しの head にしない）", async () => {
  const none = await call(createRacerSource({ fetchImpl: fakeRest(rowsFor({ racer_profiles: [] })).fetchImpl, env: ENV }));
  assert.equal(none.status, 404);
  assert.equal(none.headers["Cache-Control"], "no-store");
  const failing = [
    createRacerSource({ fetchImpl: fakeRest(rowsFor(), { status: 500 }).fetchImpl, env: ENV }),
    createRacerSource({ fetchImpl: fakeRest({}, { raw: () => new Response('{"message":"x"}') }).fetchImpl, env: ENV }),
    createRacerSource({ fetchImpl: async () => { throw new TypeError("fetch failed"); }, env: ENV }),
    createRacerSource({ fetchImpl: fakeRest(rowsFor()).fetchImpl, env: { SUPABASE_URL: "https://x.supabase.co" } }),
    createRacerSource({ fetchImpl: fakeRest(rowsFor({ racer_profiles: [{ racer_id: 4320 }] })).fetchImpl, env: ENV }),
  ];
  for (const getRacer of failing) {
    const res = await quietly(() => call(getRacer));
    assert.equal(res.status, 503);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers["Retry-After"], "300");
  }
});

await check("5. 形の外は 404、405、ハンドラの口", async () => {
  const getRacer = createRacerSource({ fetchImpl: fakeRest(rowsFor()).fetchImpl, env: ENV });
  for (const url of ["/api/page-head/v1/racer/432", "/api/page-head/v1/racer/43201", "/api/page-head/v1/racer/abcd", "/api/page-head/racer/4320", "/api/page-head/v1/racer/4320/x", "/racer/4320"]) {
    assert.equal((await call(getRacer, url)).status, 404, url);
  }
  assert.equal((await call(getRacer, undefined, "POST")).status, 405);
  const out = { statusCode: 0, body: undefined };
  await createRacerHeadHandler({ getRacer })(
    { method: "HEAD", url: "/api/page-head/v1/racer/4320" },
    { set statusCode(v) { out.statusCode = v; }, setHeader() {}, end(b) { out.body = b; } },
  );
  assert.deepEqual([out.statusCode, out.body], [200, undefined]);
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-api-racer: すべて通った");
