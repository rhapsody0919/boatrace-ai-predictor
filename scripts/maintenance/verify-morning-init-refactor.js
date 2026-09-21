/**
 * verify-morning-init-refactor.js - 朝の初期化・公式予想の「取得・生成・書き込み」を、ファイル・execSync・process.exit に
 * 依存しない関数に分けた変更（WS4b T4b-07-1〜3・T4b-08-1）の検証。
 * DBにも取得先にも接続しない（インメモリのSupabaseクライアント・保存済みの実ページ・fetch の差し替え）。
 *
 * 確認すること:
 *   (a) scrape-to-json.js: 分けた後の scrapeVenue・getTodayVenues が、分ける前の実装（旧 main() の取得部分）の出力と
 *       完全に一致する（実ページ4件のfixtureから、旧実装で作った golden との比較）。既定（非 strict）は、取得の失敗を従来どおり
 *       null・空に化かし、strict は例外にする。並列度の上限が効く
 *   (b) generate-predictions.js: generateAndWriteFromRacesData が、races・race_entries・predictions・race_conditions を書き、
 *       2回目は変更の無い行を書かない。throwOnError のとき、書き込みの失敗を例外にする（既定は従来どおり握りつぶす）
 *   (c) generate-unified-predictions.js: import しても main() が走らない。generateUnifiedPredictions が unified を upsert し、
 *       失敗は例外。findRacesMissingUnified が、欠けたレースだけを返す。strict のとき、DBの読み取り失敗を「対象なし」にしない
 *   (d) scrape-pcexpect.js: import しても main() が走らない。実ページの解析結果が、本番DBの payload と同じダイジェストになる。
 *       runForRaces: shadow は書かない・live は race_start_at つきで upsert・未公開は no_values・失敗・ブレーカーの扱い
 *   (e) morning-init.js: SKIP_MORNING_INIT_ON_GHA=true で何もせず終了する（既定は従来どおり。Supabase 未設定なら異常終了）
 *
 * 実行: node scripts/maintenance/verify-morning-init-refactor.js
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  getTodayVenues,
  scrapeRacesData,
  scrapeVenue,
} from "../scrape-to-json.js";
import { generateAndWriteFromRacesData } from "../daily/generate-predictions.js";
import {
  findRacesMissingUnified,
  generateUnifiedPredictions,
} from "../daily/generate-unified-predictions.js";
import {
  buildUrl,
  computePcexpectDigest,
  parsePcexpect,
  runForRaces as runPcexpect,
} from "../daily/scrape-pcexpect.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

// 検証の対象コードが、途中で process.exit(0) して、最後まで実行されないまま「成功」に見えるのを防ぐ
// （import 時に main() が走る不具合の検出。scrape-pcexpect.js の main() は、空のスケジュールで exit(0) する）
let completed = false;
process.on("exit", (code) => {
  if (!completed && code === 0) {
    out.error("❌ 検証が最後まで実行されませんでした（途中で process.exit された）");
    process.exitCode = 1;
  }
});

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) out.log(`✅ ${label}`);
  else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

const FX = new URL("../lib/racesInit/__fixtures__/", import.meta.url);
const fixture = (name) => fs.readFileSync(new URL(name, FX), "utf8");
const readJson = (name) => JSON.parse(fixture(name));
const GOLDEN_VENUE = readJson("golden-venue-01.json");
const GOLDEN_VENUES = readJson("golden-venues-2026-09-21.json");
const DATE = "2026-09-21";

/** URL に応じて、保存済みの実ページを返す fetchHtml（呼び出しの記録と、同時実行数の最大値つき） */
function createFixtureFetch({ fail = () => false, latencyMs = 2 } = {}) {
  const log = [];
  let active = 0;
  let maxActive = 0;
  const pages = [
    ["/race/raceindex", fixture("raceindex-01.html")],
    ["/race/racelist", fixture("racelist-01-05.html")],
    ["/race/beforeinfo", fixture("beforeinfo-01-05.html")],
    ["/race/index", fixture("index-2026-09-21.html")],
  ];
  async function fetchHtml(url) {
    log.push(String(url));
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await sleep(latencyMs);
      const failure = fail(String(url));
      if (failure) throw new Error(failure === true ? "HTTP 503" : failure);
      const page = pages.find(([p]) => String(url).includes(p));
      if (!page) throw new Error(`未対応のURL: ${url}`);
      return page[1];
    } finally {
      active--;
    }
  }
  fetchHtml.log = log;
  Object.defineProperty(fetchHtml, "maxActive", { get: () => maxActive });
  return fetchHtml;
}

// ---------------------------------------------------------------------------
// (a) scrape-to-json.js
// ---------------------------------------------------------------------------
{
  const fetchHtml = createFixtureFetch();
  const venues = await getTodayVenues(DATE, { fetchHtml, strict: true });
  check(
    "(a) 開催会場一覧: 旧実装の出力（golden）と一致",
    same(venues, GOLDEN_VENUES),
    show(venues),
  );

  const venue = await scrapeVenue(DATE, 1, { fetchHtml, strict: true });
  check(
    "(a) 1会場の出走表・直前情報・発走時刻: 旧実装の出力（golden）と完全に一致（strict）",
    same(venue, GOLDEN_VENUE),
  );
  const venueDefault = await scrapeVenue(DATE, 1, { fetchHtml });
  check(
    "(a) 既定（非 strict）でも、同じ出力（従来の GitHub Actions・CLI と同じ）",
    same(venueDefault, GOLDEN_VENUE),
  );
  check(
    "(a) 12レース・全レースに6艇・発走時刻あり",
    venue.races.length === 12 &&
      venue.races.every((r) => r.racers.length === 6 && r.startTime),
  );

  const data = await scrapeRacesData(DATE, [1], {
    fetchHtml,
    venueDelayMs: 0,
  });
  check(
    "(a) scrapeRacesData: races.json と同じ形（success・date・data・scrapedAt）をメモリ上で返す",
    data.success === true &&
      data.date === DATE &&
      data.data.length === 1 &&
      same(data.data[0], GOLDEN_VENUE) &&
      typeof data.scrapedAt === "string",
  );

  // 非 strict: 取得の失敗は、従来どおり null・空に化ける
  const failVenues = await getTodayVenues(DATE, {
    fetchHtml: createFixtureFetch({ fail: () => true }),
  });
  check(
    "(a) 非 strict: 会場一覧の取得失敗は [] に化ける（従来どおり）",
    same(failVenues, []),
  );
  const racelist3Fails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("racelist") && u.includes("rno=3"),
    }),
  });
  check(
    "(a) 非 strict: racelist の失敗は、そのレースの選手が空になるだけ（従来どおり）",
    racelist3Fails.races.length === 12 &&
      racelist3Fails.races[2].racers.length === 0 &&
      racelist3Fails.races[3].racers.length === 6,
  );
  const beforeinfo4Fails = await scrapeVenue(DATE, 1, {
    fetchHtml: createFixtureFetch({
      fail: (u) => u.includes("beforeinfo") && u.includes("rno=4"),
    }),
  });
  check(
    "(a) 非 strict: beforeinfo の失敗は、そのレースが欠ける（従来どおり）",
    beforeinfo4Fails.races.length === 11 &&
      !beforeinfo4Fails.races.some((r) => r.raceNo === 4),
  );

  // strict: 失敗は例外
  const e1 = await rejects(
    getTodayVenues(DATE, {
      fetchHtml: createFixtureFetch({ fail: () => true }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 会場一覧の取得失敗は例外（開催なしに化けない）",
    e1 && /開催会場一覧の取得に失敗/.test(e1.message),
    e1?.message,
  );
  const e2 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("racelist") && u.includes("rno=3"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: racelist が1ページでも失敗したら、会場全体が例外（一部欠けたまま書かない）",
    e2 && /会場1/.test(e2.message),
    e2?.message,
  );
  const e3 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("beforeinfo") && u.includes("rno=4"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: beforeinfo が1ページでも失敗したら、会場全体が例外",
    e3 && /会場1/.test(e3.message),
    e3?.message,
  );
  const e4 = await rejects(
    scrapeVenue(DATE, 1, {
      fetchHtml: createFixtureFetch({
        fail: (u) => u.includes("raceindex"),
      }),
      strict: true,
    }),
  );
  check(
    "(a) strict: 発走時刻のページが失敗したら例外",
    e4 && /発走時刻の取得に失敗/.test(e4.message),
    e4?.message,
  );
  const noTimesFetch = async (url) =>
    String(url).includes("raceindex")
      ? "<html><body><table><tr><td>-</td></tr></table></body></html>"
      : createFixtureFetch()(url);
  const e5 = await rejects(
    scrapeVenue(DATE, 1, { fetchHtml: noTimesFetch, strict: true }),
  );
  check(
    "(a) strict: 発走時刻が1件も読めなければ例外（start_time が NULL のまま書かない）",
    e5 && /発走時刻を1件も取得できません/.test(e5.message),
    e5?.message,
  );

  // 並列度の上限
  const limited = createFixtureFetch({ latencyMs: 8 });
  await scrapeVenue(DATE, 1, { fetchHtml: limited, raceConcurrency: 3 });
  check(
    "(a) raceConcurrency=3: 同時リクエストは最大6（3レース×beforeinfo・racelist）",
    limited.maxActive <= 6 && limited.maxActive >= 2,
    `maxActive=${limited.maxActive}`,
  );
  const unlimited = createFixtureFetch({ latencyMs: 8 });
  await scrapeVenue(DATE, 1, { fetchHtml: unlimited });
  check(
    "(a) 既定（12レース同時）: 従来どおり、24リクエストが同時に走る",
    unlimited.maxActive === 24,
    `maxActive=${unlimited.maxActive}`,
  );
}

// ---------------------------------------------------------------------------
// (b) generate-predictions.js
// ---------------------------------------------------------------------------
{
  const racesData = () => ({
    success: true,
    data: [structuredClone(GOLDEN_VENUE)],
  });
  const newClient = (opts = {}) =>
    createFakeSupabaseClient({
      tables: {
        venues: [{ code: 1, avg_first_win_rate: 0.5 }],
        racer_aggregated_stats: [],
        ...opts.tables,
      },
      failOn: opts.failOn,
    });

  const client = newClient();
  const result = await generateAndWriteFromRacesData({
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  const raceIds = client.data.races.map((r) => r.race_id).sort();
  check(
    "(b) 12レース分の races・race_entries（72行）・predictions（36行）を書く",
    result.predictedRaceIds.length === 12 &&
      client.data.races.length === 12 &&
      client.data.race_entries.length === 72 &&
      client.data.predictions.length === 36 &&
      raceIds[0] === "2026-09-21-01-01" &&
      raceIds[11] === "2026-09-21-01-12",
    `races=${client.data.races.length} entries=${client.data.race_entries?.length} preds=${client.data.predictions?.length}`,
  );
  check(
    "(b) races.start_time は HH:MM:00・race_date は指定した対象日",
    client.data.races.every(
      (r) => /^\d{2}:\d{2}:00$/.test(r.start_time) && r.race_date === DATE,
    ),
  );
  check(
    "(b) race_conditions に、レース名・開催ステージを書く（BOA-347）",
    client.data.race_conditions.length === 12 &&
      client.data.race_conditions.every((r) => r.race_title || r.race_stage),
  );
  const racesUpserts = client.writesTo("races").length;
  const entriesUpserts = client.writesTo("race_entries").length;
  await generateAndWriteFromRacesData({
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  check(
    "(b) 2回目: 変更の無い races・race_entries は書かない（WS8(b)）。predictions は削除→挿入で36行のまま",
    client.writesTo("races").length === racesUpserts &&
      client.writesTo("race_entries").length === entriesUpserts &&
      client.data.predictions.length === 36 &&
      client.writesTo("predictions").filter((w) => w.op === "delete").length ===
        2,
  );

  // 失敗の扱い
  const failing = (failOn) => newClient({ failOn });
  for (const [label, failOn] of [
    ["race_entries の書き込み", { "race_entries:upsert": "boom-entries" }],
    ["races の書き込み", { "races:upsert": "boom-races" }],
    ["predictions の挿入", { "predictions:insert": "boom-preds" }],
    ["predictions の削除", { "predictions:delete": "boom-delete" }],
  ]) {
    const err = await rejects(
      generateAndWriteFromRacesData({
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
        throwOnError: true,
      }),
    );
    check(`(b) throwOnError: ${label}の失敗は例外`, err !== null, err?.message);
    const swallowed = await rejects(
      generateAndWriteFromRacesData({
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
      }),
    );
    check(
      `(b) 既定: ${label}の失敗は、従来どおり握りつぶして続行（GitHub Actions・CLIの挙動を変えない）`,
      swallowed === null,
      swallowed?.message,
    );
  }
  const noClient = await rejects(
    generateAndWriteFromRacesData({
      racesData: racesData(),
      date: DATE,
      client: null,
      throwOnError: true,
    }),
  );
  check(
    "(b) throwOnError: Supabase が無ければ例外",
    noClient && /Supabase/.test(noClient.message),
  );
  const badData = await rejects(
    generateAndWriteFromRacesData({
      racesData: { success: false },
      date: DATE,
      client: newClient(),
    }),
  );
  check("(b) 有効なデータが無ければ例外（従来どおり）", badData !== null);
}

// ---------------------------------------------------------------------------
// (c) generate-unified-predictions.js
// ---------------------------------------------------------------------------
{
  const entries = (raceId) =>
    Array.from({ length: 6 }, (_, i) => ({
      race_id: raceId,
      boat_number: i + 1,
      racer_id: 4000 + i,
      grade: "B1",
      win_rate: 5 - i * 0.3,
      local_win_rate: 5 - i * 0.2,
      motor_2rate: 40 - i,
    }));
  const tables = () => ({
    races: [
      { race_id: "2026-09-21-01-01", start_time: "15:26:00" },
      { race_id: "2026-09-21-01-02", start_time: "15:57:00" },
    ],
    race_entries: [
      ...entries("2026-09-21-01-01"),
      ...entries("2026-09-21-01-02"),
    ],
    race_conditions: [
      { race_id: "2026-09-21-01-01", wind_speed: 2, wave_height: 3 },
    ],
    racer_aggregated_stats: [],
    predictions: [],
  });

  const client = createFakeSupabaseClient({ tables: tables() });
  const missingBefore = await findRacesMissingUnified(DATE, client);
  check(
    "(c) findRacesMissingUnified: unified が無い2レースを返す",
    same(missingBefore, ["2026-09-21-01-01", "2026-09-21-01-02"]),
    show(missingBefore),
  );
  const r = await generateUnifiedPredictions({
    date: DATE,
    client,
    strict: true,
  });
  check(
    "(c) generateUnifiedPredictions: 2レース分の unified を書く（model_id='unified'）",
    r.generated === 2 &&
      r.written === 2 &&
      client.data.predictions.length === 2 &&
      client.data.predictions.every((p) => p.model_id === "unified"),
    show(r),
  );
  const missingAfter = await findRacesMissingUnified(DATE, client);
  check("(c) 生成後は、欠けたレースが無い", same(missingAfter, []));
  await generateUnifiedPredictions({ date: DATE, client, strict: true });
  check(
    "(c) 再実行しても行は増えない（upsert。冪等）",
    client.data.predictions.length === 2,
  );

  const failingClient = createFakeSupabaseClient({
    tables: tables(),
    failOn: { "predictions:upsert": "boom-unified" },
  });
  const err = await rejects(
    generateUnifiedPredictions({ date: DATE, client: failingClient }),
  );
  check(
    "(c) 書き込みの失敗は例外（成功したバッチの件数をメッセージに含む）",
    err &&
      /boom-unified/.test(err.message) &&
      /反映済み0\/2件/.test(err.message),
    err?.message,
  );
  const noClient = await rejects(
    generateUnifiedPredictions({ date: DATE, client: null }),
  );
  check("(c) Supabase が無ければ例外", noClient !== null);

  const dbDown = createFakeSupabaseClient({
    tables: tables(),
    failOn: { "races:select": "db-down" },
  });
  const lenient = await generateUnifiedPredictions({
    date: DATE,
    client: dbDown,
  });
  check(
    "(c) 既定（strict でない）: スケジュール取得の失敗は、従来どおり「対象レースなし」",
    lenient.targetRaces === 0,
  );
  const strictErr = await rejects(
    generateUnifiedPredictions({ date: DATE, client: dbDown, strict: true }),
  );
  check(
    "(c) strict: スケジュール取得の失敗は例外（対象なしに化けない）",
    strictErr && /db-down/.test(strictErr.message),
    strictErr?.message,
  );
}

// ---------------------------------------------------------------------------
// (d) scrape-pcexpect.js
// ---------------------------------------------------------------------------
{
  const html = fixture("pcexpect-12-12.html");
  const payload = parsePcexpect(html);
  check(
    "(d) 実ページ（2026-09-21 住之江12R）の解析: 2連単4点・3連単6点・自信度2",
    payload &&
      payload.focus_2t.length === 4 &&
      payload.focus_3t.length === 6 &&
      payload.confidence === 2 &&
      payload.focus_2t[0].pattern === "4=3",
    show(payload),
  );
  check(
    "(d) 解析結果のダイジェストが、本番DB（external_predictions.payload、朝02:25に保存）と同じ値になる",
    computePcexpectDigest(payload) === "c2ada2c442417b09",
    computePcexpectDigest(payload),
  );
  const reordered = {
    confidence: payload.confidence,
    entry_prediction_image: payload.entry_prediction_image,
    focus_3t: payload.focus_3t.map((x) => ({
      pattern: x.pattern,
      seps: x.seps,
    })),
    focus_2t: payload.focus_2t.map((x) => ({
      pattern: x.pattern,
      seps: x.seps,
    })),
  };
  check(
    "(d) ダイジェストは、JSON のキーの並びに依らない（DB の jsonb と同じ値になる）",
    computePcexpectDigest(reordered) === computePcexpectDigest(payload),
  );
  check(
    "(d) 予想の無いページ（データなし）は null",
    parsePcexpect("<html><body><p>データがありません</p></body></html>") ===
      null,
  );
  check(
    "(d) URL: hd・jcd（2桁）・rno",
    buildUrl({ date: DATE, venueCode: 1, raceNo: 12 }) ===
      "https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=20260921&jcd=01&rno=12",
  );

  const race = {
    race_id: "2026-09-21-12-12",
    venue_code: 12,
    race_number: 12,
    start_time: new Date("2026-09-21T20:30:00+09:00"),
  };
  const shadowClient = createFakeSupabaseClient();
  const [shadow] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => html,
    client: shadowClient,
  });
  check(
    "(d) shadow: 取得・解析のみ。DBへは何も書かず（接続もせず）、payload のダイジェストを返す",
    shadow.outcome === "ok" &&
      shadow.rowsWritten === 0 &&
      shadow.rowsParsed === 1 &&
      shadow.resultDigest === "c2ada2c442417b09" &&
      shadowClient.calls.length === 0,
    show({ ...shadow, payload: undefined }),
  );

  const liveClient = createFakeSupabaseClient();
  const fixedNow = new Date("2026-09-21T05:00:00Z");
  const [live] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: liveClient,
    now: () => fixedNow,
  });
  const row = liveClient.data.external_predictions?.[0];
  check(
    "(d) live: external_predictions へ1行 upsert（source・日付・会場・レース・race_start_at・scraped_at）",
    live.outcome === "ok" &&
      live.rowsWritten === 1 &&
      liveClient.data.external_predictions.length === 1 &&
      row.source === "pcexpect_official" &&
      row.race_date === DATE &&
      row.venue_code === 12 &&
      row.race_no === 12 &&
      row.race_start_at === "2026-09-21T11:30:00.000Z" &&
      row.scraped_at === fixedNow.toISOString() &&
      same(row.payload, payload),
    show(row),
  );
  await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: liveClient,
  });
  check(
    "(d) 同じレースの再取得は、同じ行を更新する（一意制約 source,race_date,venue_code,race_no。行は増えない）",
    liveClient.data.external_predictions.length === 1,
  );

  const emptyClient = createFakeSupabaseClient();
  const [empty] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => "<html><body></body></html>",
    client: emptyClient,
  });
  check(
    "(d) 予想が無いページ: no_values（再試行）。書き込まない",
    empty.outcome === "no_values" && emptyClient.writes.length === 0,
  );
  const [failed] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => {
      throw new Error("HTTP 503");
    },
  });
  check(
    "(d) 取得の失敗: error（メッセージ付き）",
    failed.outcome === "error" && /503/.test(failed.error),
  );
  const until = Date.now() + 60_000;
  const [breaker] = await runPcexpect([race], {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => {
      throw new BreakerOpenError("host:boatrace.jp", until);
    },
  });
  check(
    "(d) ブレーカーが開いている: breaker_open（ブレーカーが閉じる時刻まで再試行を遅らせる）",
    breaker.outcome === "breaker_open" && breaker.retryAt.getTime() === until,
  );
  const errWriteClient = createFakeSupabaseClient({
    failOn: { "external_predictions:upsert": "boom-ep" },
  });
  const [writeFail] = await runPcexpect([race], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => html,
    client: errWriteClient,
  });
  check(
    "(d) 書き込みの失敗: error（成功にしない）",
    writeFail.outcome === "error" && /boom-ep/.test(writeFail.error),
    writeFail.error,
  );
  const badMode = await rejects(
    runPcexpect([race], { date: DATE, mode: "dry" }),
  );
  const noClientLive = await rejects(
    runPcexpect([race], {
      date: DATE,
      mode: "live",
      client: null,
      fetchHtml: async () => html,
    }),
  );
  check(
    "(d) mode が不正・live で Supabase が無ければ例外",
    badMode !== null && noClientLive !== null,
  );

  // 複数レース: 1つの失敗で他を止めない・並列度
  const many = Array.from({ length: 6 }, (_, i) => ({
    race_id: `2026-09-21-12-${String(i + 1).padStart(2, "0")}`,
    venue_code: 12,
    race_number: i + 1,
  }));
  let active = 0;
  let maxActive = 0;
  const results = await runPcexpect(many, {
    date: DATE,
    mode: "shadow",
    concurrency: 3,
    fetchHtml: async (url) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      if (url.includes("rno=2")) throw new Error("HTTP 500");
      return html;
    },
  });
  check(
    "(d) 6レース・並列3: 1レース失敗でも他は完了。結果は入力の順。同時実行は3まで",
    results.map((x) => x.outcome).join(",") === "ok,error,ok,ok,ok,ok" &&
      maxActive === 3 &&
      results.every((x, i) => x.race_id === many[i].race_id),
    `${results.map((x) => x.outcome).join(",")} max=${maxActive}`,
  );
}

// ---------------------------------------------------------------------------
// (e) morning-init.js の GitHub 側を止める変数
// ---------------------------------------------------------------------------
{
  // 本番の資格情報が環境にあっても、DBに書かないよう、Supabase の変数は空にして起動する
  const spawn = (extra) =>
    spawnSync(process.execPath, ["scripts/daily/morning-init.js"], {
      cwd: new URL("../../", import.meta.url),
      env: {
        ...process.env,
        SUPABASE_URL: "",
        SUPABASE_SERVICE_KEY: "",
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
        SKIP_MORNING_INIT_ON_GHA: "",
        SKIP_PCEXPECT_ON_GHA: "",
        ...extra,
      },
      encoding: "utf8",
      timeout: 30000,
    });
  const skipped = spawn({ SKIP_MORNING_INIT_ON_GHA: "true" });
  check(
    "(e) SKIP_MORNING_INIT_ON_GHA=true: 何もせず正常終了（Supabase が無くても）",
    skipped.status === 0 && /スキップ/.test(skipped.stdout),
    `${skipped.status} ${skipped.stdout} ${skipped.stderr}`.slice(0, 200),
  );
  const normal = spawn({});
  check(
    "(e) 既定（変数なし）: 従来どおり動く（Supabase 未設定なら、そのエラーで異常終了）",
    normal.status === 1 && /Supabase環境変数が未設定/.test(normal.stderr),
    `${normal.status} ${normal.stderr}`.slice(0, 200),
  );
  const falseVar = spawn({ SKIP_MORNING_INIT_ON_GHA: "false" });
  check(
    "(e) SKIP_MORNING_INIT_ON_GHA=false: 従来どおり（止めない）",
    falseVar.status === 1 && /Supabase環境変数が未設定/.test(falseVar.stderr),
  );
}

completed = true;
if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\n✅ 全ての検証に合格しました");
