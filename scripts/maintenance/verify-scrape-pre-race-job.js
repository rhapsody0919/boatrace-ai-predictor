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



import { parsePreRaceId } from "../lib/scrapeJobs/preRaceHandlers.js";

import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";

import {
  SCRAPE_JOBS,
  isCatchupOffset,
  isWeightOnlyOffset,
  slotDefsFor,
  validateRegistry,
} from "../lib/scrapeJobs/registry.js";

import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";



import { createDb } from "./verifyData/scrape-pre-race-job-db.js";
import { checkPreRaceEntries } from "./verifyData/cron-entry-checks.js";
import { checkScheduledPreRace } from "./verifyData/scrape-scheduled-scenes.js";






import {
  riHandler,
  exHandler,
  runScrapePreRaceJobScenesB3,
  runScrapePreRaceJobScenesB4,
} from "./verifyData/scrape-pre-race-job-scenes-b-3.js";
import { runScrapePreRaceJobScenesB1 } from "./verifyData/scrape-pre-race-job-scenes-b-1.js";
import { runScrapePreRaceJobScenesB2 } from "./verifyData/scrape-pre-race-job-scenes-b-2.js";
import {
  runScrapePreRaceJobScenesB5,
  runScrapePreRaceJobScenesB6,
  runScrapePreRaceJobScenesB7,
} from "./verifyData/scrape-pre-race-job-scenes-b-4.js";

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

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-b-1.js・scrape-pre-race-job-scenes-b-2.js・scrape-pre-race-job-scenes-b-3.js） ----
await runScrapePreRaceJobScenesB1({ check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, freshDb, createFetcher, pagesHandler, raceOf, upsertsOf, writeCount, runRaceInfo });
await runScrapePreRaceJobScenesB2({ check, show, BEFORE_UNPUBLISHED_HTML, BEFORE_ST_ONLY_HTML, RACE, NOW, freshDb, createFetcher, pagesHandler, upsertsOf });
await runScrapePreRaceJobScenesB3({ check, show, RACE, RACE_11, freshDb, runRaceInfo });

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

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-b-3.js） ----
runScrapePreRaceJobScenesB4({ check, show, RACE, RACE_11, freshDb, runRaceInfo });

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

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-b-4.js） ----
await runScrapePreRaceJobScenesB5({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper });

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

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-b-4.js） ----
await runScrapePreRaceJobScenesB6({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper });
if (failures > 0) {
  printErr(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/scrape-pre-race-job-scenes-b-4.js） ----
runScrapePreRaceJobScenesB7({ printOut, check, show, LIST_HTML, BEFORE_UNPUBLISHED_HTML, BEFORE_AFTER_START_HTML, DATE, SUMI_RACE, RACE, RACE_11, NOW, seedRaces, freshDb, createFetcher, pagesHandler, upsertsOf, writeCount, slotOf, runViaWrapper });
