/**
 * verify-scrape-odds-job.js - オッズ取得（A3）の Vercel Cron 実装（WS4b、tasks.md T4b-04）の検証。
 * DBにも取得先にも接続しない（Supabaseクライアント・fetch・時計・ストアを差し替える）。
 *
 * 確認すること:
 *   (a) 解析・構造のダイジェスト: 実際のオッズページ（フィクスチャ。桐生1R）から、単勝6・複勝6・全通り5券種
 *       （120/20/30/15/15通り）が取れる。ダイジェストは値の変化に依存せず、キー集合・欠落で変わる。未公開は no_values、
 *       3連単の人気上位3件（trifecta_popular_*・trifecta_odds_*）は、odds3t の120通りのグリッドからオッズの低い順に求める
 *       （公式ページに「人気順」の表は無い。旧実装のセレクタ .is-p3-0 tbody tr は常に0件で、本番の全行が NULL だった）。
 *       券種ページの欠落は partial（列名つき）、単勝ページの失敗は error、ブレーカーは breaker_open
 *   (b) runForRaces（レース×窓の入口）: live は基本オッズと全通り系を1行にまとめ、race_id,window_min で upsert する
 *       （source='vercel'・window_min つき・行のキーは一様）、二重に呼んでも行が増えない（冪等）、窓ごとに別の行、
 *       shadow は一切書かず既存行も読まない、再試行（attempts>1）は既存の値を null で上書きしない・完了済みなら取得せず
 *       skipped_have_data、attempts=1 では既存行を読まない、未公開は no_values・書き込み失敗は error・ブレーカーは
 *       breaker_open、1件の失敗で他のレースを止めない、並列度の上限、0分窓は直近のスナップショット（自分の窓を除く・
 *       75分以内）から全通り系を補完（他の窓は補完しない）
 *   (a2) 未公開の間の再試行の確認（winFirst）: 単勝ページだけを先に取り、未公開なら他のページを取らない（追加リクエストを1ページに絞る）。
 *       公開されていれば、単勝は1回だけ取り、残りを取って、通常の取得と同じ結果になる。単勝の失敗・ブレーカーでも他のページを取らない
 *   (c) 共通ラッパ経由の odds: off・行なし・075未適用は何も取得せず何も書かない、shadow は race_odds へ書かず予定表に
 *       digest を記録する、live は書き込む、partial は再試行に戻す、全スロット error は500、スロットの窓・試行回数が
 *       runForRaces に渡る、不正な race_id は error
 *   (d) 既存の入口 run() との共有部品: buildBaseRow・fullOddsPatchOf・pickFallbackPatches（純粋関数）の出力が従来と同じ
 *   (e) 切り替えの仕組み: SKIP_ODDS_ON_GHA は文字列 "true" のときだけ有効（未設定・空・falseは従来どおり）、
 *       scrape-scheduled.js・ワークフローのリポジトリ変数
 *   (f) 設定の整合: レジストリ（窓・許容幅・再試行・リース）・maxDuration・vercel.json の cron（UTC→JST換算）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ODDS_WINDOWS } from "../daily/scrape-odds.js";
import * as cheerio from "cheerio";


import { parseOddsRaceId } from "../lib/scrapeJobs/oddsHandlers.js";
import { isOddsSkippedOnGha } from "../lib/predictionRefresh.js";

import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { checkOddsEntry } from "./verifyData/cron-entry-checks.js";
import { checkScheduledOdds } from "./verifyData/scrape-scheduled-scenes.js";


import { runScrapeOddsJobScenes1 } from "./verifyData/scrape-odds-job-scenes-1.js";
import { runScrapeOddsJobScenes2 } from "./verifyData/scrape-odds-job-scenes-2.js";
import { runScrapeOddsJobScenes3 } from "./verifyData/scrape-odds-job-scenes-3.js";
import { runScrapeOddsJobScenes4 } from "./verifyData/scrape-odds-job-scenes-4.js";
import {
  runScrapeOddsJobScenes5,
  runScrapeOddsJobScenes6,
  runScrapeOddsJobScenes7,
} from "./verifyData/scrape-odds-job-scenes-5.js";

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
const same = (a, b) => show(a) === show(b);

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIX = (name) =>
  fs.readFileSync(
    new URL(`../lib/__fixtures__/odds/${name}`, import.meta.url),
    "utf8",
  );
const PAGES = {
  oddstf: FIX("oddstf-2026-09-19-05-01.html"),
  odds3t: FIX("odds3t-2026-09-19-05-01.html"),
  odds3f: FIX("odds3f-2026-09-19-05-01.html"),
  odds2tf: FIX("odds2tf-2026-09-19-05-01.html"),
  oddsk: FIX("oddsk-2026-09-19-05-01.html"),
};
const HTML_UNPUBLISHED = FIX("oddstf-unpublished-2026-09-25-05-01.html");
// 発売済みだが票がまだ0の艇がある実ページ（江戸川8R、2026-09-28 13:55取得）。
// 単勝は ["1.0","14.2","14.2","0.0","14.2","14.2"]、複勝は4艇が "0.0-0.0"。
// HTML_UNPUBLISHED（.oddsPoint が0件）と並べて、2つが別の結果になることを固定する（BOA-486）
const HTML_ZERO_VOTES = FIX("oddstf-zero-votes-2026-09-28-03-08.html");
// 上のページの単勝6艇を全て 0.0 にしたもの（朝の1R〜4Rで実際に起きる「全艇0.0」。BOA-486の再現）
const HTML_ALL_ZERO_VOTES = (() => {
  const $ = cheerio.load(HTML_ZERO_VOTES);
  $(".oddsPoint").each((i, el) => {
    if (i < 6) $(el).text("0.0");
  });
  return $.html();
})();

const DATE = "2026-09-19";
const RACE_A = "2026-09-19-05-01"; // 桐生1R
const RACE_B = "2026-09-19-05-02";
const RACE_C = "2026-09-19-05-03";
const raceOf = (raceId, window_min, attempts = 1) => {
  const { venue_code, race_number } = parseOddsRaceId(raceId);
  return { race_id: raceId, venue_code, race_number, window_min, attempts };
};
const NOW = new Date("2026-09-19T05:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// テスト用の道具: 取得関数・インメモリのSupabaseクライアント
// ---------------------------------------------------------------------------
const pageOfUrl = (url) => /\/race\/(\w+)\?/.exec(url)?.[1];

/**
 * 取得関数（politeFetch の代わり）。overrides に { ページ名: "html" | number（HTTPステータス）| Error } を渡すと、
 * そのページだけ差し替える。呼び出したURLを calls に、同時に実行中の数の最大を maxActive に残す
 */
function createFetcher(overrides = {}, { delayMs = 0 } = {}) {
  const calls = [];
  let active = 0;
  const fn = async (url) => {
    calls.push(url);
    active++;
    fn.maxActive = Math.max(fn.maxActive, active);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const page = pageOfUrl(url);
      // レースごとの上書き: "oddstf@2" のように、rno を付ける
      const rno = /rno=(\d+)/.exec(url)?.[1];
      const o = overrides[`${page}@${rno}`] ?? overrides[page];
      if (o instanceof Error) throw o;
      if (typeof o === "number") return new Response("", { status: o });
      return new Response(o ?? PAGES[page] ?? "", { status: 200 });
    } finally {
      active--;
    }
  };
  fn.calls = calls;
  fn.maxActive = 0;
  return fn;
}

/**
 * PostgRESTの、この検証に必要な部分だけを模した、インメモリのクライアント（race_odds のみ）。
 * upsert は onConflict の列がすべて非nullで一致する行を更新し、無ければ追加する（NULLは互いに重複とみなさない。
 * PostgreSQLの既定の NULLS DISTINCT と同じ）。writes に書き込みの呼び出しを、reads に読み取りを全て記録する
 */
function createFakeDb(initial = [], { failUpsert = false } = {}) {
  const rows = clone(initial);
  const writes = [];
  const reads = [];
  function builder() {
    const s = { op: "select", filters: [], rows: null, onConflict: null };
    const q = {
      select() {
        return q;
      },
      in(col, vals) {
        s.filters.push((r) => vals.includes(r[col]));
        return q;
      },
      gte(col, val) {
        s.filters.push((r) => r[col] >= val);
        return q;
      },
      order() {
        s.desc = true;
        return q;
      },
      upsert(data, opts = {}) {
        s.op = "upsert";
        s.rows = data;
        s.onConflict = opts.onConflict;
        return q;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      if (s.op === "select") {
        reads.push({});
        let out = rows.filter((r) => s.filters.every((f) => f(r)));
        if (s.desc)
          out = [...out].sort((a, b) =>
            a.captured_at < b.captured_at ? 1 : -1,
          );
        return { data: clone(out), error: null };
      }
      if (failUpsert) {
        writes.push({ op: "upsert", failed: true });
        return { error: { message: "race_odds の upsert が失敗しました" } };
      }
      const keys = (s.onConflict ?? "").split(",").filter(Boolean);
      const keySets = new Set(s.rows.map((r) => Object.keys(r).sort().join()));
      for (const row of s.rows) {
        const existing = rows.find((r) =>
          keys.every(
            (k) => r[k] !== null && r[k] !== undefined && r[k] === row[k],
          ),
        );
        if (existing) Object.assign(existing, clone(row));
        else rows.push(clone(row));
      }
      writes.push({
        op: "upsert",
        onConflict: s.onConflict,
        count: s.rows.length,
        uniformKeys: keySets.size === 1,
      });
      return { error: null };
    }
    return q;
  }
  return { rows, writes, reads, from: () => builder() };
}

const findRow = (db, raceId, windowMin) =>
  db.rows.filter((r) => r.race_id === raceId && r.window_min === windowMin);

const fullRow = (patch = {}) => ({
  race_id: RACE_A,
  captured_at: "2026-09-19T04:50:00.000Z",
  window_min: -5,
  source: "vercel",
  odds_win_1: 1.5,
  trifecta_popular_1: "1-2-3",
  trifecta_odds_1: 5,
  trifecta_all: { "1-2-3": 5, "1-3-2": 9 },
  trio_all: { "1-2-3": 2 },
  exacta_all: { "1-2": 2 },
  quinella_all: { "1-2": 1.5 },
  wide_all: { "1-2": 1.1 },
  ...patch,
});

// ---- 後半の場面（verifyData/scrape-odds-job-scenes-1.js・scrape-odds-job-scenes-2.js・scrape-odds-job-scenes-3.js・scrape-odds-job-scenes-4.js・scrape-odds-job-scenes-5.js） ----
await runScrapeOddsJobScenes1({ check, show, same, PAGES, HTML_UNPUBLISHED, HTML_ZERO_VOTES, HTML_ALL_ZERO_VOTES, DATE, RACE_A, NOW, clone, createFetcher });
await runScrapeOddsJobScenes2({ check, show, same, HTML_UNPUBLISHED, DATE, RACE_A, RACE_B, raceOf, NOW, clone, pageOfUrl, createFetcher, createFakeDb, findRow, fullRow });
await runScrapeOddsJobScenes3({ check, show, same, HTML_UNPUBLISHED, HTML_ALL_ZERO_VOTES, RACE_A, RACE_B, RACE_C, raceOf, NOW, createFetcher, createFakeDb, findRow, fullRow });
await runScrapeOddsJobScenes4({ check, show, same, HTML_UNPUBLISHED, RACE_A, RACE_B, RACE_C, NOW, pageOfUrl, createFetcher });
runScrapeOddsJobScenes5({ printOut, check, show, same, DATE, RACE_A, fullRow });

// ---------------------------------------------------------------------------
// (e) 切り替えの仕組み（SKIP_ODDS_ON_GHA）
// ---------------------------------------------------------------------------
{
  check(
    "SKIP_ODDS_ON_GHA: 文字列 true（大文字小文字・前後の空白は無視）のときだけ有効。未設定・空・false・1・yes は従来どおり実行",
    isOddsSkippedOnGha({}) === false &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: "" }) === false &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: "false" }) === false &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: "1" }) === false &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: "yes" }) === false &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: "true" }) === true &&
      isOddsSkippedOnGha({ SKIP_ODDS_ON_GHA: " True " }) === true,
  );
  // scrape-scheduled.js の切り替えは、偽の取得のもとで main を回して見る（verifyData/scrape-scheduled-scenes.js）
  await checkScheduledOdds({ check, show });
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-scheduled.yml"),
    "utf8",
  );
  check(
    "scrape-scheduled.yml: リポジトリ変数 SKIP_ODDS_ON_GHA を、オーケストレーターのステップに渡す（設定していなければ空＝従来どおり）",
    /SKIP_ODDS_ON_GHA: \$\{\{ vars\.SKIP_ODDS_ON_GHA \}\}/.test(workflow) &&
      /SKIP_ODDS_REFRESH_ON_GHA: \$\{\{ vars\.SKIP_ODDS_REFRESH_ON_GHA \}\}/.test(
        workflow,
      ),
  );
  check(
    "ODDS_WINDOWS（GitHub側の窓）は従来どおり60/30/15/10/5/0分前で、Vercel のレジストリの窓（-60〜0）と対応する",
    same(ODDS_WINDOWS, [60, 30, 15, 10, 5, 0]) &&
      same(
        SCRAPE_JOBS.odds.offsets,
        ODDS_WINDOWS.map((m) => -m).map((m) => (m === 0 ? 0 : m)),
      ),
    show(SCRAPE_JOBS.odds.offsets),
  );
}

// ---------------------------------------------------------------------------
// (f) 設定の整合
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.odds;
  check(
    "レジストリ: odds は窓型で、窓 -60・-30・-15・-10・-5・0、許容幅3分（-60だけ、未公開の間の延長で30分）、再試行60秒、リース120秒（許容幅3分より短い）、32件×4並列",
    def.kind === "window" &&
      same(def.offsets, [-60, -30, -15, -10, -5, 0]) &&
      def.graceMin === 3 &&
      same(def.graceMinByOffset, { "-60": 30 }) &&
      def.retrySec === 60 &&
      def.leaseSec === 120 &&
      def.leaseSec < def.graceMin * 60 &&
      def.claimLimit === 32 &&
      def.concurrency === 4 &&
      def.hosts.includes("boatrace.jp"),
    show(def),
  );
  check(
    "レジストリ: 全体の整合の検査（validateRegistry）が通る（最後のスロットの完了見込みがリースに収まる等）",
    validateRegistry().length === 0,
    show(validateRegistry()),
  );
  // api/cron/odds.js とその本体の配線は、import を偽に差し替えて見る（verifyData/cron-entry-checks.js）
  await checkOddsEntry({ check, show });
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const odds = vercel.crons.filter((c) => c.path === "/api/cron/odds");
  check(
    "vercel.json: /api/cron/odds は1本、cron式は毎分・UTC 22〜23時と 0〜14時（JST 07:00〜23:59）",
    odds.length === 1 && odds[0].schedule === "* 22-23,0-14 * * *",
    show(odds),
  );
  // UTC→JST: 起動時間帯の最初と最後
  const jstHours = [
    22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  ].map((h) => (h + 9) % 24);
  check(
    "cron 時間帯の換算: JST 07:00 に始まり、23:59 に終わる（最終レースの発走 22:41〜22:45 の0分窓＋許容幅3分＝22:48 を含む）",
    jstHours[0] === 7 && jstHours[jstHours.length - 1] === 23,
  );
  check(
    "vercel.json: 関数のリージョンは api/cron/*.js で syd1（DBと同じ）。odds も対象",
    vercel.functions?.["api/cron/*.js"]?.regions?.[0] === "syd1",
  );
  check(
    "api/cron/odds.js は実在し、vercel.json の cron のパスに対応する",
    fs.existsSync(path.join(ROOT, "api/cron/odds.js")),
  );
}

// ---- 後半の場面（verifyData/scrape-odds-job-scenes-5.js） ----
runScrapeOddsJobScenes6({ printOut, check, show, same, DATE, RACE_A, fullRow });
if (failures > 0) {
  printErr(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/scrape-odds-job-scenes-5.js） ----
runScrapeOddsJobScenes7({ printOut, check, show, same, DATE, RACE_A, fullRow });
