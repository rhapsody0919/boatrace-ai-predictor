/**
 * verify-scrape-pre-race-job.js - レース情報（A1）・展示（A2）の Vercel Cron 実装（WS4b、tasks.md T4b-09・T4b-06）の検証。
 * DBにも取得先にも接続しない（Supabaseクライアント・fetch・時計・ストアを差し替える。実ページのフィクスチャを使う）。
 *
 * 確認すること:
 *   (a) レース情報 runForRaces: live は race_entries・race_conditions（気象を含めない）・races（締切予定時刻による start_time の追従）を
 *       書き、二重に呼んでも書き込み0件（冪等）、**出走表（racelist）だけを取り、直前情報（beforeinfo）を取らない（D2の解消）**。
 *       shadow は一切書かず（読み取りのみ）、ダイジェストを返す。選手0人は no_values で、中止・順延の暫定検知の連続回数を進める
 *       （3回で暫定）。通信・HTTPエラーは error で、連続回数を進めない。ブレーカーは breaker_open、書き込みの失敗は error、
 *       1件の失敗で他のレースを止めない
 *   (b) 展示 runForRaces: live は展示データと気象を書き、展示タイム取得済みなら取得しない（skipped_have_data。取得0回）。shadow は書かず、
 *       取得済みでも取得・解析する。未公開は no_values、展示STのみは partial、通信エラーは error、ブレーカーは breaker_open、
 *       書き込みの失敗は error
 *   (c) ダイジェスト: 並び順・追加の列・null と undefined の差に依らず、対象の列の値の変化で変わる。shadow のダイジェストは、
 *       live が書いた行から計算したダイジェストと一致する（check-pre-race-shadow.js の比較の前提）
 *   (d) 共通ラッパ経由: off・行なしは何もしない、shadow はデータへ書かず予定表に digest を記録する、live は書く、
 *       選手0人・展示未公開は再試行に戻す、1回の起動でスケジュールを1回だけ読む
 *   (e) 予測の再計算（案1）: live で変更を書いたレースについてのみ、全スロットの完了後に日付ごとに1回、mainRefresh（upsert方式）を呼ぶ。
 *       REFRESH_ON_VERCEL が有効でなければ呼ばない。変更なし・shadow は呼ばない。再計算の失敗は応答に残り、HTTPは失敗にしない
 *   (f) 展示のモード切り替え: off・行なし・テーブル未適用・読み取り失敗は何もしない（どちらの起点でも 200。どこからも取らない）、
 *       shadow・live はスロットのみ、認証
 *   (g) 従来の経路（runLegacyExhibition。素の fetch・ブレーカーなし）が消えていて、どの起点・mode でも呼ばれない
 *       （docs/design/scraping-load-budget/spec.md §0・§8 の P0）
 *   (h) 設定の整合: レジストリ（窓・許容幅・再試行・リース）・maxDuration・vercel.json の cron（UTC→JST換算）・
 *       切り替えの仕組み（SKIP_RACE_INFO_ON_GHA は "true" のときだけ有効、既定は従来どおり）
 *   (i) 変異検証: shadow が書く・気象のために beforeinfo を取る・変更なしでも再計算する・モードを無視して従来の経路を動かす・
 *       ダイジェストが選手を無視する、を仕込んだ版で、上の検証が失敗する
 *   (j) 窓の外の補完（BOA-382。展示の発走の後のスロット）: 実ページ（住之江5R。発走後に展示タイムが載ったページ）から展示タイム・展示STを
 *       解析して書く、取得済みのレースは shadow でも取得しない（公式ページへのリクエスト0）、shadow は書かない、気象を書かない、
 *       予測の再計算の対象にしない、未完了の再試行は -33 のスロットより長い、-33 のスロットの挙動は変えない。
 *       変異検証: 取得済みを再取得する・shadow で書く・気象を書く・再計算の対象にする・再試行の間隔が同じ、で失敗する
 *   (k) 体重だけの窓（BOA-500。展示の発走60分前のスロット）: 展示航走前のページから当日体重・調整重量を書いて完了（ok）する、
 *       表が無ければ no_values で300秒後に再試行、気象を書かない・スケジュールを読まない・予測の再計算の対象にしない、
 *       -33 のスロットは従来どおり（展示タイムが入るまで partial）。1レースあたりの取得は最大2回（BOA-1145。再試行900秒）。
 *       変異検証: 体重だけの窓として扱わない・再試行が120秒・気象を書く、で失敗する
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { runForRaces as realRaceInfoRun } from "../daily/update-race-info.js";
import { runForRaces as realExhibitionRun } from "../daily/scrape-exhibition-data.js";
import {
  computeExhibitionDigest,
  computeRaceInfoDigest,
} from "../lib/scrapeJobs/preRaceDigest.js";
import {
  createExhibitionSlotHandler,
  createRaceInfoSlotHandler,
  createScheduleLoader,
  parsePreRaceId,
} from "../lib/scrapeJobs/preRaceHandlers.js";
import * as preRaceHandlersModule from "../lib/scrapeJobs/preRaceHandlers.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";

import {
  SCRAPE_JOBS,
  isCatchupOffset,
  isWeightOnlyOffset,
  slotDefsFor,
  validateRegistry,
} from "../lib/scrapeJobs/registry.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { CONFIRM_STREAK_THRESHOLD } from "../lib/cancellationStatus.js";

import {
  compareExhibitionShadowDigests,
  compareRaceInfoShadowDigests,
} from "./check-pre-race-shadow.js";
import { createDb } from "./verifyData/scrape-pre-race-job-db.js";
import {
  checkNoLegacyExhibition,
  checkPreRaceEntries,
  checkShadowReadOnly,
} from "./verifyData/cron-entry-checks.js";
import { checkScheduledPreRace } from "./verifyData/scrape-scheduled-scenes.js";
import { runScrapePreRaceJobScenes1 } from "./verifyData/scrape-pre-race-job-scenes-1.js";
import { runScrapePreRaceJobScenes2, runScrapePreRaceJobScenes3 } from "./verifyData/scrape-pre-race-job-scenes-2.js";
import { runScrapePreRaceJobScenes4 } from "./verifyData/scrape-pre-race-job-scenes-3.js";
import { runScrapePreRaceJobScenes5 } from "./verifyData/scrape-pre-race-job-scenes-4.js";
import { runScrapePreRaceJobScenes6 } from "./verifyData/scrape-pre-race-job-scenes-5.js";
import { runScrapePreRaceJobScenes7, runScrapePreRaceJobScenes8 } from "./verifyData/scrape-pre-race-job-scenes-6.js";

// 検証対象のコードが出す警告・エラー・進捗のログで出力が埋まらないよう、検証中は無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__");
const fixture = (dir, name) =>
  fs.readFileSync(path.join(FIXTURES, dir, name), "utf8");

// 2026-09-16 唐津（23）12R の実ページ（1号艇が欠場）。出走表の締切予定時刻の行（同日12レース分）を含む
const LIST_HTML = fixture("raceInfo", "racelist-2026-09-16-23-12-absent.html");
const BEFORE_HTML = fixture(
  "beforeinfo",
  "beforeinfo-2026-09-16-23-12-absent.html",
);
// 展示航走前（展示タイム・展示STが空）の直前情報
const BEFORE_UNPUBLISHED_HTML = fixture(
  "beforeinfo",
  "beforeinfo-2026-09-21-10-08-before-exhibition.html",
);
// 発走の後（2026-09-22の取得）の住之江5R（発走17:02）の直前情報。この5Rは、発走の33〜7分前の13回の取得が全て「展示未公開」で、
// 公開が窓の終わりより後だった。展示タイム（1号艇 6.89）・展示ST（1号艇 0.10）が載っている
const BEFORE_AFTER_START_HTML = fixture(
  "beforeinfo",
  "beforeinfo-2026-09-21-12-05-after-start.html",
);
// 展示タイムの欄を空にして、展示STだけが公開されている状態を作る（一部の会場で、STが先に出る）
const BEFORE_ST_ONLY_HTML = (() => {
  const $ = cheerio.load(
    fixture("beforeinfo", "beforeinfo-2026-09-19-02-09-f-exhibition.html"),
  );
  $("tbody.is-fs12").each((_, tbody) => {
    $(tbody).find("tr").first().find("td").eq(4).text("-");
  });
  return $.html();
})();

const DATE = "2026-09-16";
const SUMI_DATE = "2026-09-21";
const SUMI_RACE = "2026-09-21-12-05";
const RACE = "2026-09-16-23-12";
const RACE_11 = "2026-09-16-23-11";
const NOW = new Date("2026-09-16T13:30:00+09:00");
const FIXTURE_TIMES =
  "08:44,09:10,09:36,10:02,10:28,10:59,11:35,12:05,12:33,13:05,13:39,14:21".split(
    ",",
  );

// ---------------------------------------------------------------------------
// テスト用の部品
// ---------------------------------------------------------------------------

/** races の朝の値。8Rだけ、公式の締切予定時刻（12:05）と1分違う（12:04） */
const seedRaces = () =>
  FIXTURE_TIMES.map((t, i) => ({
    race_id: `${DATE}-23-${String(i + 1).padStart(2, "0")}`,
    start_time: `${i === 7 ? "12:04" : t}:00`,
    cancellation_status: null,
    cancellation_check_streak: 0,
    race_grade: "ippan",
  }));
const freshDb = (extra = {}) =>
  createDb({ tables: { races: seedRaces() }, ...extra });

/** 取得先の差し替え。handler(url) が、HTML・HTTPステータス（数値）・例外を返す。通信の記録つき */
function createFetcher(handler) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const r = handler(String(url));
    if (r instanceof Error) throw r;
    if (typeof r === "number") {
      return { ok: r >= 200 && r < 300, status: r, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => r };
  };
  fn.calls = calls;
  return fn;
}
const pagesHandler =
  ({ list = LIST_HTML, before = BEFORE_HTML } = {}) =>
  (url) =>
    url.includes("/racelist?")
      ? list
      : url.includes("/beforeinfo?")
        ? before
        : 404;
const raceOf = (raceId) => {
  const { venue_code, race_number } = parsePreRaceId(raceId);
  return { race_id: raceId, venue_code, race_number };
};
const upsertsOf = (db, table) =>
  db.state.upserts.filter((u) => u.table === table);
const writeCount = (db) => db.state.upserts.length + db.state.updates.length;

// ---------------------------------------------------------------------------
// (a) レース情報 runForRaces
// ---------------------------------------------------------------------------
async function runRaceInfo(run, db, options = {}, fetcher = null) {
  const f = fetcher ?? createFetcher(pagesHandler());
  const results = await run([raceOf(RACE)], {
    date: DATE,
    fetchFn: f,
    client: db,
    ...options,
  });
  return { results, result: results[0], fetcher: f };
}

/** shadow が書かないことの検証（変異検証で使うため関数にする） */
async function raceInfoShadowWritesNothing(run) {
  const db = freshDb();
  const { result } = await runRaceInfo(run, db, { mode: "shadow" });
  return (
    result.outcome === "ok" &&
    typeof result.resultDigest === "string" &&
    result.rowsWritten === 0 &&
    result.changed === false &&
    writeCount(db) === 0
  );
}

/** 出走表だけを取り、直前情報を取らないことの検証 */
async function raceInfoFetchesOnlyRacelist(run) {
  const db = freshDb();
  const { fetcher } = await runRaceInfo(run, db, { mode: "live" });
  return (
    fetcher.calls.length === 1 &&
    fetcher.calls[0].includes("/racelist?") &&
    !fetcher.calls.some((u) => u.includes("/beforeinfo?"))
  );
}

{
  const db = freshDb();
  const first = await runRaceInfo(realRaceInfoRun, db, { mode: "live" });
  const r = first.result;
  const entries = upsertsOf(db, "race_entries").flatMap((u) => u.rows);
  const conditions = upsertsOf(db, "race_conditions").flatMap((u) => u.rows);
  check(
    "A1 live: 出走表を取得・解析し、race_entries（6艇）・race_conditions を書く（outcome=ok・changed）",
    r.outcome === "ok" &&
      r.rowsParsed === 6 &&
      r.rowsWritten > 0 &&
      r.changed === true &&
      entries.length === 6 &&
      conditions.length === 1 &&
      conditions[0].race_id === RACE,
    show({ r, entries: entries.length, conditions: conditions.length }),
  );
  check(
    "A1 live: race_conditions に気象の列を含めない（気象は展示側。既存の気象を null で上書きしない）",
    conditions.length === 1 &&
      !("weather" in conditions[0]) &&
      !("wind_speed" in conditions[0]) &&
      !("weather_observed_at" in conditions[0]),
    show(conditions[0]),
  );
  check(
    "A1 live（D2の解消）: 出走表（racelist）だけを1回取得し、直前情報（beforeinfo）は取得しない",
    await raceInfoFetchesOnlyRacelist(realRaceInfoRun),
    show(first.fetcher.calls),
  );
  const startTimeUpdates = db.state.updates.filter(
    (u) => "start_time" in u.values,
  );
  check(
    "A1 live: 締切予定時刻が朝の値と違うレース（8R: 12:04→12:05）だけ races.start_time を更新する（日中の追従）",
    startTimeUpdates.length === 1 &&
      startTimeUpdates[0].value === `${DATE}-23-08` &&
      startTimeUpdates[0].values.start_time === "12:05:00",
    show(startTimeUpdates),
  );

  const writesBefore = writeCount(db);
  const second = await runRaceInfo(realRaceInfoRun, db, { mode: "live" });
  check(
    "A1 live: 同じ内容をもう一度処理しても、書き込み0件（変更の無い行は書かない。outcome=ok・changed=false）",
    second.result.outcome === "ok" &&
      second.result.rowsWritten === 0 &&
      second.result.changed === false &&
      writeCount(db) === writesBefore,
    show(second.result),
  );

  // shadow: 一切書かない。live が書いた行から計算したダイジェストと一致する
  const shadowDb = freshDb();
  const shadow = await runRaceInfo(realRaceInfoRun, shadowDb, {
    mode: "shadow",
  });
  check(
    "A1 shadow: 取得・解析のみで、DBへ一切書かない（upsert・update とも0件）。resultDigest を返し、rowsWritten=0・changed=false",
    (await raceInfoShadowWritesNothing(realRaceInfoRun)) &&
      shadow.result.rowsParsed === 6,
    show(shadow.result),
  );
  const dbDigest = computeRaceInfoDigest({
    entries: db.state.tables.race_entries.filter((e) => e.race_id === RACE),
    condition: db.state.tables.race_conditions.find((c) => c.race_id === RACE),
    raceGrade: db.state.tables.races.find((c) => c.race_id === RACE).race_grade,
  });
  check(
    "A1 ダイジェスト: shadow が記録するダイジェストは、live が書いた DB の行から同じ関数で計算したダイジェストと一致する（比較の前提）",
    shadow.result.resultDigest === dbDigest &&
      first.result.resultDigest === dbDigest,
    `${shadow.result.resultDigest} / ${first.result.resultDigest} / ${dbDigest}`,
  );

  // includeWeather=true は、従来の run と同じく beforeinfo も取り、気象を書く
  const weatherDb = freshDb();
  const weather = await runRaceInfo(realRaceInfoRun, weatherDb, {
    mode: "live",
    includeWeather: true,
  });
  const weatherRows = upsertsOf(weatherDb, "race_conditions").flatMap(
    (u) => u.rows,
  );
  check(
    "A1 includeWeather=true: beforeinfo も取得し、気象の列を race_conditions に含める（従来の run と同じ動作の選択肢）",
    weather.fetcher.calls.some((u) => u.includes("/beforeinfo?")) &&
      weatherRows.some((row) => "weather" in row),
    show(weather.fetcher.calls),
  );
}

// 選手0人（中止・未公開の可能性）: no_values。中止・順延の暫定検知の連続回数を進める（3回で暫定）
{
  const emptyHandler = pagesHandler({ list: "<html><body></body></html>" });
  const db = freshDb();
  const outcomes = [];
  for (let i = 0; i < CONFIRM_STREAK_THRESHOLD; i++) {
    const { result } = await runRaceInfo(
      realRaceInfoRun,
      db,
      { mode: "live" },
      createFetcher(emptyHandler),
    );
    outcomes.push(result.outcome);
  }
  const race = db.state.tables.races.find((r) => r.race_id === RACE);
  check(
    "A1 選手0人: outcome=no_values（再試行）。書き込みは無く、中止・順延の暫定検知の連続回数が進み、3回で tentative になる",
    outcomes.every((o) => o === "no_values") &&
      race.cancellation_check_streak === CONFIRM_STREAK_THRESHOLD &&
      race.cancellation_status === "tentative" &&
      upsertsOf(db, "race_entries").length === 0,
    show({ outcomes, race }),
  );
  const shadowDb = freshDb();
  await runRaceInfo(
    realRaceInfoRun,
    shadowDb,
    { mode: "shadow" },
    createFetcher(emptyHandler),
  );
  check(
    "A1 選手0人（shadow）: 中止・順延の暫定検知も書かない",
    writeCount(shadowDb) === 0 &&
      shadowDb.state.tables.races.find((r) => r.race_id === RACE)
        .cancellation_check_streak === 0,
  );
}

// 通信・HTTPエラー・ブレーカー・書き込みの失敗
{
  const db500 = freshDb();
  const http = await runRaceInfo(
    realRaceInfoRun,
    db500,
    { mode: "live" },
    createFetcher(() => 500),
  );
  check(
    "A1 HTTP 500: outcome=error（再試行）。書き込みも、中止・順延の暫定検知の連続回数の更新もしない（取得先の失敗を中止と取り違えない）",
    http.result.outcome === "error" &&
      /HTTP 500/.test(http.result.error) &&
      writeCount(db500) === 0,
    show(http.result),
  );
  const dbNet = freshDb();
  const net = await runRaceInfo(
    realRaceInfoRun,
    dbNet,
    { mode: "live" },
    createFetcher(() => new Error("ECONNRESET")),
  );
  check(
    "A1 通信エラー: outcome=error（例外にせず、原因を残す）",
    net.result.outcome === "error" &&
      /ECONNRESET/.test(net.result.error) &&
      writeCount(dbNet) === 0,
    show(net.result),
  );
  const until = NOW.getTime() + 60000;
  const dbBrk = freshDb();
  const brk = await runRaceInfo(
    realRaceInfoRun,
    dbBrk,
    { mode: "live" },
    createFetcher(() => new BreakerOpenError("host:boatrace.jp", until)),
  );
  check(
    "A1 ブレーカーが開いている: outcome=breaker_open。再試行の時刻（retryAt）を返す。書き込まない",
    brk.result.outcome === "breaker_open" &&
      brk.result.retryAt instanceof Date &&
      brk.result.retryAt.getTime() === until &&
      writeCount(dbBrk) === 0,
    show(brk.result),
  );
  const dbFail = freshDb({ failUpsert: { race_entries: true } });
  const fail = await runRaceInfo(realRaceInfoRun, dbFail, { mode: "live" });
  check(
    "A1 書き込みの失敗: outcome=error（表名つきのメッセージ）。完了にしない",
    fail.result.outcome === "error" && /race_entries/.test(fail.result.error),
    show(fail.result),
  );
  // 1件の失敗で他のレースを止めない
  const dbMix = freshDb();
  const mixFetcher = createFetcher((url) =>
    url.includes("rno=11&") ? 500 : LIST_HTML,
  );
  const mix = await realRaceInfoRun([raceOf(RACE_11), raceOf(RACE)], {
    date: DATE,
    mode: "live",
    fetchFn: mixFetcher,
    client: dbMix,
    concurrency: 2,
  });
  check(
    "A1 複数レース: 1件の失敗（11R: HTTP 500）で他のレース（12R）を止めない。結果は入力と同じ順序",
    mix.length === 2 &&
      mix[0].race_id === RACE_11 &&
      mix[0].outcome === "error" &&
      mix[1].race_id === RACE &&
      mix[1].outcome === "ok",
    show(mix),
  );
  let threw = "";
  try {
    await realRaceInfoRun([raceOf(RACE)], { date: DATE, mode: "dry" });
  } catch (error) {
    threw = error.message;
  }
  check(
    "A1 入力の検査: mode が不正なら、取得せずに例外（メッセージ付き）",
    /mode/.test(threw),
    threw,
  );
}

// ---------------------------------------------------------------------------
// (b) 展示 runForRaces
// ---------------------------------------------------------------------------
async function runExhibition(run, db, options = {}, fetcher = null) {
  const f = fetcher ?? createFetcher(pagesHandler());
  const results = await run([raceOf(RACE)], {
    date: DATE,
    fetchFn: f,
    client: db,
    ...options,
  });
  return { results, result: results[0], fetcher: f };
}

async function exhibitionShadowWritesNothing(run) {
  const db = freshDb();
  const { result } = await runExhibition(run, db, { mode: "shadow" });
  return (
    result.outcome === "ok" &&
    typeof result.resultDigest === "string" &&
    result.rowsWritten === 0 &&
    result.changed === false &&
    writeCount(db) === 0
  );
}

{
  const db = freshDb();
  const first = await runExhibition(realExhibitionRun, db, { mode: "live" });
  const r = first.result;
  const rows = upsertsOf(db, "exhibition_data").flatMap((u) => u.rows);
  const conditions = upsertsOf(db, "race_conditions").flatMap((u) => u.rows);
  check(
    "A2 live: beforeinfo を1回だけ取得し、展示データ（欠場艇を含む6行）と気象（race_conditions）を書く。outcome=ok・changed",
    r.outcome === "ok" &&
      r.changed === true &&
      r.rowsWritten === 6 &&
      first.fetcher.calls.length === 1 &&
      first.fetcher.calls[0].includes("/beforeinfo?") &&
      rows.length === 6 &&
      conditions.length === 1 &&
      "weather" in conditions[0],
    show({ r, calls: first.fetcher.calls, rows: rows.length }),
  );
  const order = db.state.upserts.map((u) => u.table);
  check(
    "A2 live: 気象（race_conditions）を展示データより先に書く（展示タイムを見て動く展示後の段が、同じ取得回の気象を読む。BOA-271 T4-3）",
    order.indexOf("race_conditions") >= 0 &&
      order.indexOf("race_conditions") < order.indexOf("exhibition_data"),
    show(order),
  );

  const second = await runExhibition(realExhibitionRun, db, { mode: "live" });
  check(
    "A2 live: 展示タイムが取得済みのレースは、取得しない（skipped_have_data。取得0回・書き込み0件）",
    second.result.outcome === "skipped_have_data" &&
      second.fetcher.calls.length === 0 &&
      second.result.changed === false,
    show(second.result),
  );

  // Kファイルから展示タイムだけを入れた行（展示ST は NULL）は「取得済み」にしない（BOA-271 の前提の補完）。
  // 直前情報で展示ST・チルト・体重を後から補えるようにする
  const kOnlyDb = freshDb();
  kOnlyDb.state.tables.exhibition_data = [1, 2, 3, 4, 5, 6].map((boat) => ({
    race_id: RACE,
    boat_number: boat,
    exhibition_time: 6.7,
    start_timing: null,
  }));
  const kOnly = await runExhibition(realExhibitionRun, kOnlyDb, {
    mode: "live",
  });
  check(
    "A2 live: 展示タイムだけの行（Kファイルからの補完。展示ST なし）は取得済みにせず、直前情報を取得して書く",
    kOnly.result.outcome === "ok" &&
      kOnly.fetcher.calls.length === 1 &&
      upsertsOf(kOnlyDb, "exhibition_data")
        .flatMap((u) => u.rows)
        .some((row) => row.start_timing !== null),
    show(kOnly.result),
  );

  const shadowDb = freshDb();
  const shadow = await runExhibition(realExhibitionRun, shadowDb, {
    mode: "shadow",
  });
  check(
    "A2 shadow: 取得・解析のみで、DBへ一切書かない（気象も）。resultDigest を返し、rowsWritten=0・changed=false",
    (await exhibitionShadowWritesNothing(realExhibitionRun)) &&
      shadow.result.rowsParsed === 6,
    show(shadow.result),
  );
  const dbDigest = computeExhibitionDigest(
    db.state.tables.exhibition_data.filter((row) => row.race_id === RACE),
  );
  check(
    "A2 ダイジェスト: shadow が記録するダイジェストは、live が書いた DB の行から同じ関数で計算したダイジェストと一致する",
    shadow.result.resultDigest === dbDigest &&
      first.result.resultDigest === dbDigest,
    `${shadow.result.resultDigest} / ${dbDigest}`,
  );
  // shadow は、既存の経路が書いた行があっても、取得・解析する（比べるため）
  const shadowWithData = await runExhibition(realExhibitionRun, db, {
    mode: "shadow",
  });
  check(
    "A2 shadow: 展示タイムが取得済みでも、取得・解析する（既存の経路が書いた行と比べるため。skipped_have_data にしない）",
    shadowWithData.result.outcome === "ok" &&
      shadowWithData.fetcher.calls.length === 1 &&
      shadowWithData.result.resultDigest === dbDigest,
    show(shadowWithData.result),
  );
}

{
  // 展示が未公開・展示STのみ・エラー
  const dbUn = freshDb();
  const un = await runExhibition(
    realExhibitionRun,
    dbUn,
    { mode: "live" },
    createFetcher(pagesHandler({ before: BEFORE_UNPUBLISHED_HTML })),
  );
  const unRows = upsertsOf(dbUn, "exhibition_data").flatMap((u) => u.rows);
  check(
    // BOA-500: 展示航走前でも、当日体重・調整重量は公開されている。捨てずに書き、展示タイムが入るまで再試行する
    "A2 展示航走前（当日体重・調整重量だけ公開）: その行を書き、outcome=partial（再試行。展示タイムが入るまで完了にしない）",
    un.result.outcome === "partial" &&
      unRows.length === 6 &&
      unRows.every(
        (row) =>
          row.today_weight != null &&
          row.adjustment_weight != null &&
          row.exhibition_time === null &&
          row.start_timing === null,
      ),
    show({ outcome: un.result.outcome, rows: unRows.length, row0: unRows[0] }),
  );
  const dbNone = freshDb();
  const none = await runExhibition(
    realExhibitionRun,
    dbNone,
    { mode: "live" },
    createFetcher(pagesHandler({ before: "<html></html>" })),
  );
  check(
    "A2 直前情報の表が無い（中止・未公開）: outcome=no_values（再試行）。1行も書かない",
    none.result.outcome === "no_values" &&
      upsertsOf(dbNone, "exhibition_data").length === 0,
    show(none.result),
  );
  const dbSt = freshDb();
  const st = await runExhibition(
    realExhibitionRun,
    dbSt,
    { mode: "live" },
    createFetcher(pagesHandler({ before: BEFORE_ST_ONLY_HTML })),
  );
  const stRows = upsertsOf(dbSt, "exhibition_data").flatMap((u) => u.rows);
  check(
    "A2 展示STのみ公開（展示タイム未公開）: 書けた行は残し、outcome=partial（再試行。展示タイムが入るまで完了にしない）",
    st.result.outcome === "partial" &&
      stRows.length > 0 &&
      stRows.every((row) => row.exhibition_time === null) &&
      stRows.some((row) => row.start_timing !== null),
    show({ r: st.result, rows: stRows.length }),
  );
  const http = await runExhibition(
    realExhibitionRun,
    freshDb(),
    { mode: "live" },
    createFetcher(() => 503),
  );
  check(
    "A2 HTTP 503: outcome=error（再試行）",
    http.result.outcome === "error" && /HTTP 503/.test(http.result.error),
    show(http.result),
  );
  const until = NOW.getTime() + 60000;
  const brk = await runExhibition(
    realExhibitionRun,
    freshDb(),
    { mode: "live" },
    createFetcher(() => new BreakerOpenError("host:boatrace.jp", until)),
  );
  check(
    "A2 ブレーカーが開いている: outcome=breaker_open（retryAt つき）",
    brk.result.outcome === "breaker_open" &&
      brk.result.retryAt.getTime() === until,
    show(brk.result),
  );
  const fail = await runExhibition(
    realExhibitionRun,
    freshDb({ failUpsert: { exhibition_data: true } }),
    { mode: "live" },
  );
  check(
    "A2 書き込みの失敗: outcome=error（完了にしない）",
    fail.result.outcome === "error" &&
      /exhibition_data/.test(fail.result.error),
    show(fail.result),
  );
  const checkFail = await runExhibition(
    realExhibitionRun,
    freshDb({
      failSelect: { exhibition_data: { message: "boom", code: "XX000" } },
    }),
    { mode: "live" },
  ).then(
    () => "",
    (error) => error.message,
  );
  check(
    "A2 取得済みの確認に失敗: 例外（メッセージ付き。「未取得」に化けさせて二重に取得しない）",
    /取得済みの確認に失敗/.test(checkFail),
    checkFail,
  );
}

// ---------------------------------------------------------------------------
// (c) ダイジェスト
// ---------------------------------------------------------------------------
{
  const entry = (n, extra = {}) => ({
    race_id: RACE,
    boat_number: n,
    racer_id: 4000 + n,
    player_name: `選手${n}`,
    grade: "A1",
    age: 30,
    win_rate: 6.5,
    local_win_rate: 6.1,
    global_2rate: 50,
    local_2rate: 48.5,
    global_3rate: 70,
    local_3rate: 66,
    motor_number: 10 + n,
    motor_2rate: 40,
    motor_3rate: 60,
    boat_number_id: 20 + n,
    boat_2rate: 35,
    boat_3rate: 55,
    ...extra,
  });
  const entries = [1, 2, 3, 4, 5, 6].map((n) => entry(n));
  const condition = {
    race_id: RACE,
    series_day: 2,
    is_final_day: false,
    race_title: "杯",
    race_stage: "予選",
  };
  const base = computeRaceInfoDigest({
    entries,
    condition,
    raceGrade: "ippan",
  });
  check(
    "digest(A1): 艇の並び順に依らない。081の追加列・updated_at・null と undefined の差に依らない",
    base ===
      computeRaceInfoDigest({
        entries: [...entries].reverse().map((e) => ({
          ...e,
          weight_kg: 52,
          branch: "福岡",
          updated_at: "2026-09-16T00:00:00Z",
          hometown: undefined,
        })),
        condition: { ...condition, race_distance_m: 1800, race_labels: [] },
        raceGrade: "ippan",
      }),
  );
  const changes = [
    [
      "選手の勝率",
      (es) => es.map((e, i) => (i === 2 ? { ...e, win_rate: 6.6 } : e)),
    ],
    [
      "選手の登録番号",
      (es) => es.map((e, i) => (i === 0 ? { ...e, racer_id: 1 } : e)),
    ],
    [
      "モーター番号",
      (es) => es.map((e, i) => (i === 5 ? { ...e, motor_number: 99 } : e)),
    ],
    ["艇の数", (es) => es.slice(0, 5)],
  ];
  check(
    "digest(A1): 対象の列の値・艇の数の変化で変わる",
    changes.every(
      ([, mutate]) =>
        computeRaceInfoDigest({
          entries: mutate(entries),
          condition,
          raceGrade: "ippan",
        }) !== base,
    ) &&
      computeRaceInfoDigest({
        entries,
        condition: { ...condition, race_stage: "準優" },
        raceGrade: "ippan",
      }) !== base &&
      computeRaceInfoDigest({ entries, condition, raceGrade: "sg" }) !== base,
  );
  let threw = "";
  try {
    computeRaceInfoDigest({
      entries: [entry(1), entry(1)],
      condition,
      raceGrade: null,
    });
  } catch (error) {
    threw = error.message;
  }
  check(
    "digest(A1): 艇番の重複は例外（比較が意味を持たない）",
    /重複/.test(threw),
    threw,
  );

  const ex = (n, extra = {}) => ({
    race_id: RACE,
    boat_number: n,
    exhibition_time: 6.7 + n / 100,
    start_timing: 0.1,
    tilt: -0.5,
    propeller_change: null,
    parts_changed: ["ピストン"],
    adjustment_weight: 0,
    today_weight: 52.5,
    prev_race_no: 4,
    prev_entry_course: 2,
    prev_start_timing: 0.15,
    prev_finish_rank: 3,
    ...extra,
  });
  const exRows = [1, 2, 3, 4, 5, 6].map((n) => ex(n));
  const exBase = computeExhibitionDigest(exRows);
  check(
    "digest(A2): 並び順・082の追加列・欠場艇の行に依らない。parts_changed の配列表記に依らない",
    exBase ===
      computeExhibitionDigest([
        ...[...exRows].reverse().map((r) => ({
          ...r,
          exhibition_course: 3,
          start_flag: null,
          prev_finish_mark: "3",
          is_absent: false,
        })),
        {
          race_id: RACE,
          boat_number: 7,
          exhibition_time: null,
          start_timing: null,
          is_absent: true,
        },
      ]),
  );
  check(
    "digest(A2): 展示タイム・ST・部品交換の変化で変わる",
    computeExhibitionDigest(
      exRows.map((r, i) => (i === 0 ? { ...r, exhibition_time: 6.9 } : r)),
    ) !== exBase &&
      computeExhibitionDigest(
        exRows.map((r, i) => (i === 3 ? { ...r, start_timing: 0.2 } : r)),
      ) !== exBase &&
      computeExhibitionDigest(
        exRows.map((r, i) =>
          i === 1 ? { ...r, parts_changed: ["キャブレター"] } : r,
        ),
      ) !== exBase,
  );
}

// shadow の集計（check-pre-race-shadow.js）: shadow のダイジェストと、DBの行から計算したダイジェストの比較
{
  const liveDb = freshDb();
  await runRaceInfo(realRaceInfoRun, liveDb, { mode: "live" });
  await runExhibition(realExhibitionRun, liveDb, { mode: "live" });
  const shadowRi = (
    await runRaceInfo(realRaceInfoRun, freshDb(), { mode: "shadow" })
  ).result;
  const shadowEx = (
    await runExhibition(realExhibitionRun, freshDb(), { mode: "shadow" })
  ).result;
  const dbOf = {
    entries: liveDb.state.tables.race_entries,
    conditions: liveDb.state.tables.race_conditions,
    races: liveDb.state.tables.races,
  };
  const ri = compareRaceInfoShadowDigests(
    [
      { race_id: RACE, result_digest: shadowRi.resultDigest },
      { race_id: RACE_11, result_digest: shadowRi.resultDigest },
      { race_id: "2026-09-16-23-10", result_digest: null },
    ],
    dbOf,
  );
  check(
    "check-pre-race-shadow（A1）: 一致は一致、比べる行が無いレースは『比べる行なし』、digest 未記録は別に数える（不一致に数えない）",
    ri.matched === 1 &&
      ri.mismatched.length === 0 &&
      ri.missing.length === 1 &&
      ri.noDigest.length === 1,
    show(ri),
  );
  const riBad = compareRaceInfoShadowDigests(
    [{ race_id: RACE, result_digest: "0000000000000000" }],
    dbOf,
  );
  check(
    "check-pre-race-shadow（A1）: ダイジェストが違えば不一致として数える",
    riBad.matched === 0 && riBad.mismatched.length === 1,
  );
  const ex = compareExhibitionShadowDigests(
    [
      { race_id: RACE, result_digest: shadowEx.resultDigest },
      { race_id: RACE_11, result_digest: shadowEx.resultDigest },
    ],
    liveDb.state.tables.exhibition_data,
  );
  check(
    "check-pre-race-shadow（A2）: 一致は一致、比べる行が無いレースは『比べる行なし』",
    ex.matched === 1 && ex.mismatched.length === 0 && ex.missing.length === 1,
    show(ex),
  );
  const exBad = compareExhibitionShadowDigests(
    [{ race_id: RACE, result_digest: "0000000000000000" }],
    liveDb.state.tables.exhibition_data,
  );
  check(
    "check-pre-race-shadow（A2）: ダイジェストが違えば不一致として数える",
    exBad.matched === 0 && exBad.mismatched.length === 1,
  );
  // 読み取りのみかは、偽の Supabase で集計を回し、呼んだ method で見る（verifyData/cron-entry-checks.js）
  await checkShadowReadOnly({ check, show });
}

// ---------------------------------------------------------------------------
// (d) 共通ラッパ経由
// ---------------------------------------------------------------------------
const slotOf = (job, raceId, offset, extra = {}) => ({
  job,
  race_id: raceId,
  offset_min: offset,
  attempts: 1,
  last_attempt_at: NOW.toISOString(),
  lease_until: new Date(NOW.getTime() + 90000).toISOString(),
  ...extra,
});
async function runViaWrapper({
  job,
  createHandleSlot,
  rows,
  slots,
  db,
  fetcher,
  available,
}) {
  const store = createMemoryStore({ rows, slots, available });
  const database = db ?? freshDb();
  const f = fetcher ?? createFetcher(pagesHandler());
  const result = await runScrapeJob({
    job,
    store,
    handleSlot: createHandleSlot(),
    now: () => NOW,
    worker: `test:${job}`,
    client: database,
    politeFetch: f,
  });
  return { result, store, db: database, fetcher: f };
}
const riHandler = () => createRaceInfoSlotHandler();
// 予定の時刻（pollMinBefore。BOA-1145）を外した、取得の経路そのものの検証。予定の時刻の検証は (l)
const exHandler = () => createExhibitionSlotHandler({ pollMinBefore: null });

for (const [job, createHandleSlot, offset] of [
  ["race_info", riHandler, -60],
  ["exhibition", exHandler, -33],
]) {
  const label = job === "race_info" ? "A1" : "A2";
  const off = await runViaWrapper({
    job,
    createHandleSlot,
    rows: { [job]: { job, mode: "off", consecutive_failures: 0 } },
    slots: [slotOf(job, RACE, offset)],
  });
  check(
    `ラッパ ${label}: mode=off は、取得も書き込みも予定表の更新もしない（200・skipped）`,
    off.result.status === 200 &&
      off.result.body.skipped === "mode_off" &&
      off.fetcher.calls.length === 0 &&
      writeCount(off.db) === 0 &&
      off.store.completed.length === 0 &&
      !off.store.calls.some((c) => c.name === "claimSlots"),
    show(off.result.body),
  );
  const none = await runViaWrapper({
    job,
    createHandleSlot,
    rows: {},
    slots: [slotOf(job, RACE, offset)],
  });
  check(
    `ラッパ ${label}: 行が無いジョブは off として扱い、行を作るだけ（取得・書き込み・claim なし）`,
    none.result.body.skipped === "mode_off" &&
      none.store.state.get(job)?.mode === "off" &&
      none.fetcher.calls.length === 0 &&
      writeCount(none.db) === 0,
  );
  const shadow = await runViaWrapper({
    job,
    createHandleSlot,
    rows: { [job]: { job, mode: "shadow", consecutive_failures: 0 } },
    slots: [slotOf(job, RACE, offset)],
  });
  check(
    `ラッパ ${label}: shadow は、データへ書かず、予定表に result_digest を記録して完了する`,
    shadow.result.status === 200 &&
      writeCount(shadow.db) === 0 &&
      shadow.store.completed.length === 1 &&
      typeof shadow.store.completed[0].resultDigest === "string" &&
      shadow.store.completed[0].rowsWritten === 0,
    show(shadow.result.body),
  );
  const live = await runViaWrapper({
    job,
    createHandleSlot,
    rows: { [job]: { job, mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(job, RACE, offset)],
  });
  check(
    `ラッパ ${label}: live は、データへ書き込み、予定表で完了する`,
    live.result.status === 200 &&
      writeCount(live.db) > 0 &&
      live.store.completed.length === 1 &&
      live.store.completed[0].outcome === "ok",
    show(live.result.body),
  );
  const bad = await runViaWrapper({
    job,
    createHandleSlot,
    rows: { [job]: { job, mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(job, "bad-race-id", offset)],
  });
  check(
    `ラッパ ${label}: 不正な race_id は error として再試行に戻す（ジョブは落ちない扱いにせず、原因を残す）`,
    bad.store.retried[0]?.outcome === "error" &&
      /race_id の形式が不正/.test(bad.store.retried[0].error),
    show(bad.result.body),
  );
}
{
  // 選手0人・展示未公開は、完了にせず再試行に戻す
  const noEntries = await runViaWrapper({
    job: "race_info",
    createHandleSlot: riHandler,
    rows: {
      race_info: { job: "race_info", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("race_info", RACE, -60)],
    fetcher: createFetcher(pagesHandler({ list: "<html></html>" })),
  });
  check(
    "ラッパ A1: 選手0人（no_values）は、完了にせず、再試行に戻す",
    noEntries.store.completed.length === 0 &&
      noEntries.store.retried[0]?.outcome === "no_values",
    show(noEntries.store.retried),
  );
  const unpublished = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("exhibition", RACE, -33)],
    fetcher: createFetcher(pagesHandler({ before: BEFORE_UNPUBLISHED_HTML })),
  });
  check(
    // BOA-500 以降、展示航走前のページは当日体重・調整重量を書くため partial になる。
    // 完了にせず再試行に戻す、という予定表の扱いは変わらない
    "ラッパ A2: 展示タイムが未公開（partial）は、完了にせず、再試行に戻す",
    unpublished.store.completed.length === 0 &&
      unpublished.store.retried[0]?.outcome === "partial",
    show(unpublished.store.retried),
  );
  const already = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [slotOf("exhibition", RACE, -33)],
    db: (() => {
      const db = freshDb();
      db.state.tables.exhibition_data = [
        {
          race_id: RACE,
          boat_number: 2,
          exhibition_time: 6.9,
          start_timing: 0.15,
        },
      ];
      return db;
    })(),
  });
  check(
    "ラッパ A2: 展示タイムが取得済みなら、取得せずに完了する（skipped_have_data）",
    already.fetcher.calls.length === 0 &&
      already.store.completed[0]?.outcome === "skipped_have_data",
    show(already.store.completed),
  );
  // 1回の起動で、スケジュール（races の start_time）を1回だけ読む
  const two = await runViaWrapper({
    job: "exhibition",
    createHandleSlot: exHandler,
    rows: {
      exhibition: { job: "exhibition", mode: "live", consecutive_failures: 0 },
    },
    slots: [
      slotOf("exhibition", RACE, -33),
      slotOf("exhibition", RACE_11, -33),
    ],
  });
  const scheduleReads = two.db.state.selects.filter(
    (s) => s.table === "races" && s.columns === "race_id, start_time",
  );
  check(
    "ラッパ: 1回の起動で処理した2スロットが、スケジュール（races の start_time）を1回だけ読む",
    two.store.completed.length === 2 && scheduleReads.length === 1,
    show({
      completed: two.store.completed.length,
      scheduleReads: scheduleReads.length,
    }),
  );
  const loader = createScheduleLoader({
    load: async () => {
      throw new Error("DB down");
    },
  });
  const ctx = {};
  const failure = await loader(ctx, DATE).then(
    () => "",
    (e) => e.message,
  );
  const failureAgain = await loader(ctx, DATE).then(
    () => "",
    (e) => e.message,
  );
  check(
    "スケジュールの読み取りの失敗は、例外にして覚えない（次のスロットがもう一度試す。「対象なし」に化けさせない）",
    failure === "DB down" && failureAgain === "DB down",
  );
}

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-1.js・scrape-pre-race-job-scenes-2.js） ----
await runScrapePreRaceJobScenes1({ check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, writeCount, slotOf, runViaWrapper, riHandler });
await runScrapePreRaceJobScenes2({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler });

// ---------------------------------------------------------------------------
// (g) 従来の経路（runLegacyExhibition）が消えている（P0）
// ---------------------------------------------------------------------------
{
  check(
    "従来の経路の export（runLegacyExhibition）が preRaceHandlers.js に無い",
    !("runLegacyExhibition" in preRaceHandlersModule),
  );
  await checkNoLegacyExhibition({ check, show });
}

// ---------------------------------------------------------------------------
// (h) 設定の整合
// ---------------------------------------------------------------------------
{
  check(
    "レジストリ: 全体の整合の検査（validateRegistry）が通る",
    validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const ri = SCRAPE_JOBS.race_info;
  const ex = SCRAPE_JOBS.exhibition;
  check(
    "レジストリ race_info: 窓 -60・許容幅3分・再試行60秒・リース90秒・並列4（claim上限24）",
    ri.kind === "window" &&
      ri.offsets.length === 1 &&
      ri.offsets[0] === -60 &&
      ri.graceMin === 3 &&
      ri.retrySec === 60 &&
      ri.leaseSec === 90 &&
      ri.concurrency === 4 &&
      ri.claimLimit === 24,
    show(ri),
  );
  check(
    "レジストリ exhibition: 窓 -33（〜-7分。許容幅26分）・再試行120秒・リース110秒（BOA-1145。-33 のスロットは、承認済みの判断(e)のまま）",
    ex.kind === "window" &&
      ex.offsets.includes(-33) &&
      ex.graceMin === 26 &&
      -33 + ex.graceMin === -7 &&
      ex.retrySec === 120 &&
      ex.leaseSec === 110,
    show(ex),
  );
  check(
    "レジストリ exhibition: 窓の外の補完（BOA-382）は、offsets の 10（発走の10分後〜36分後。許容幅は -33 と同じ26分）。補完の再試行は600秒（-33 の120秒より長く、許容幅より短い）。catchupOffsets は offsets に含まれる",
    ex.offsets.includes(10) &&
      ex.catchupOffsets.length === 1 &&
      ex.catchupOffsets[0] === 10 &&
      ex.offsets.includes(ex.catchupOffsets[0]) &&
      10 + ex.graceMin === 36 &&
      ex.catchupRetrySec === 600 &&
      ex.catchupRetrySec > ex.retrySec &&
      ex.catchupRetrySec < ex.graceMin * 60,
    show(ex),
  );
  check(
    "レジストリ: 予定表の定義（slotDefsFor）は、exhibition に -60・-33・10 の3本（許容幅は同じ26分）。補完の判定（isCatchupOffset）は 10 だけ。他のジョブは補完を持たない",
    show(slotDefsFor(["exhibition"])) ===
      show([
        { job: "exhibition", offset_min: -60, grace_min: 26 },
        { job: "exhibition", offset_min: -33, grace_min: 26 },
        { job: "exhibition", offset_min: 10, grace_min: 26 },
      ]) &&
      isCatchupOffset(ex, 10) &&
      !isCatchupOffset(ex, -33) &&
      !isCatchupOffset(SCRAPE_JOBS.race_info, -60) &&
      !isCatchupOffset(SCRAPE_JOBS.result, 5),
  );
  {
    const bad = (patch) =>
      validateRegistry({ exhibition: { ...ex, ...patch } }).length > 0;
    check(
      "レジストリの検査: 補完の再試行が許容幅以上・0・小数、補完の offset が発走前・0・空・整数でない、は不正（validateRegistry）",
      bad({ catchupRetrySec: 26 * 60 }) &&
        bad({ catchupRetrySec: 0 }) &&
        bad({ catchupRetrySec: 1.5 }) &&
        bad({ catchupOffsets: [-5] }) &&
        bad({ catchupOffsets: [0] }) &&
        bad({ catchupOffsets: [] }) &&
        bad({ catchupOffsets: [10.5] }) &&
        !bad({}),
    );
  }
  check(
    "レジストリ exhibition: 体重だけの窓（BOA-500）は offsets の -60（発走60分前〜34分前。-33 の窓と重ならない）。再試行は900秒（BOA-1145。-33 の120秒より長く、許容幅より短い）。判定（isWeightOnlyOffset）は -60 だけ",
    ex.offsets.includes(-60) &&
      show(ex.weightOnlyOffsets) === show([-60]) &&
      -60 + ex.graceMin < -33 &&
      ex.weightOnlyRetrySec === 900 &&
      ex.weightOnlyRetrySec > ex.retrySec &&
      ex.weightOnlyRetrySec < ex.graceMin * 60 &&
      isWeightOnlyOffset(ex, -60) &&
      !isWeightOnlyOffset(ex, -33) &&
      !isWeightOnlyOffset(ex, 10) &&
      !isCatchupOffset(ex, -60) &&
      !isWeightOnlyOffset(SCRAPE_JOBS.race_info, -60) &&
      !isWeightOnlyOffset(SCRAPE_JOBS.odds, -60),
    show(ex),
  );
  {
    // 1レースあたりの取得の上限: 体重が窓の最後まで未公開でも、claim の時刻（-60）から許容幅（26分）の間に、
    // 再試行の間隔（300秒 − ゆらぎ10秒）おきに試す回数。-33 と同じ120秒のままだと13回（BOA-500 の見積りの13倍の原因）
    const attemptsIn = (retrySec) =>
      Math.floor((ex.graceMin * 60) / (retrySec - 10)) + 1;
    check(
      "レジストリ exhibition: 体重だけの窓の取得は、1レースあたり最大2回（BOA-1145。300秒なら6回、-33 と同じ再試行120秒なら15回）",
      attemptsIn(ex.weightOnlyRetrySec) === 2 && attemptsIn(ex.retrySec) === 15,
      show({
        weightOnly: attemptsIn(ex.weightOnlyRetrySec),
        primary: attemptsIn(ex.retrySec),
      }),
    );
  }
  {
    const bad = (patch) =>
      validateRegistry({ exhibition: { ...ex, ...patch } }).length > 0;
    check(
      "レジストリの検査: 体重だけの窓が offsets に無い・発走後・補完と同じ・次の窓と重なる（許容幅が長い）、再試行が許容幅以上・0、は不正（validateRegistry）",
      bad({ weightOnlyOffsets: [-45] }) &&
        bad({ weightOnlyOffsets: [10] }) &&
        bad({ weightOnlyOffsets: [] }) &&
        bad({ offsets: [-50, -33, 10], weightOnlyOffsets: [-50] }) &&
        bad({ weightOnlyRetrySec: 26 * 60 }) &&
        bad({ weightOnlyRetrySec: 0 }) &&
        bad({ weightOnlyRetrySec: undefined }) &&
        !bad({}),
    );
  }
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  for (const file of ["race-info", "exhibition"]) {
    const crons = vercel.crons.filter((c) => c.path === `/api/cron/${file}`);
    check(
      `vercel.json: /api/cron/${file} は1本、cron式は毎分・UTC 22〜23時と 0〜14時（JST 07:00〜23:59）`,
      crons.length === 1 && crons[0].schedule === "* 22-23,0-14 * * *",
      show(crons),
    );
  }
  // api/cron の maxDuration・ハンドラーの配線は、import を偽に差し替えて見る（verifyData/cron-entry-checks.js）
  await checkPreRaceEntries({ check, show });
  check(
    "vercel.json: 関数のリージョンは api/cron/*.js で syd1（DBと同じ）",
    vercel.functions?.["api/cron/*.js"]?.regions?.[0] === "syd1",
  );
  // 切り替えの仕組み（SKIP_RACE_INFO_ON_GHA・SKIP_EXHIBITION_ON_GHA は "true" のときだけ有効）は、偽の取得のもとで
  // scrape-scheduled.js の main を回して見る（verifyData/scrape-scheduled-scenes.js）
  await checkScheduledPreRace({ check, show });
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-scheduled.yml"),
    "utf8",
  );
  check(
    "切り替え: ワークフローは、リポジトリ変数 SKIP_RACE_INFO_ON_GHA を環境変数として渡す（設定は、この検証の範囲外）",
    /SKIP_RACE_INFO_ON_GHA: \$\{\{ vars\.SKIP_RACE_INFO_ON_GHA \}\}/.test(
      workflow,
    ),
  );

}

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-2.js・scrape-pre-race-job-scenes-3.js・scrape-pre-race-job-scenes-4.js・scrape-pre-race-job-scenes-5.js・scrape-pre-race-job-scenes-6.js） ----
runScrapePreRaceJobScenes3({ check, show, BEFORE_AFTER_START_HTML, SUMI_RACE, NOW, freshDb, createFetcher, pagesHandler });
runScrapePreRaceJobScenes4({ BEFORE_UNPUBLISHED_HTML, SUMI_RACE, NOW, freshDb, writeCount, slotOf, runViaWrapper });
await runScrapePreRaceJobScenes5({ check, show, BEFORE_UNPUBLISHED_HTML, DATE, SUMI_RACE, RACE, NOW, freshDb, createFetcher, pagesHandler, upsertsOf, raceInfoShadowWritesNothing, raceInfoFetchesOnlyRacelist, exhibitionShadowWritesNothing, slotOf });
await runScrapePreRaceJobScenes6({ check, show, NOW, upsertsOf });
await runScrapePreRaceJobScenes7({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf });
if (failures > 0) {
  printErr(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-6.js） ----
runScrapePreRaceJobScenes8({ printOut, check, show, DATE, RACE, freshDb, createFetcher, pagesHandler, slotOf });
