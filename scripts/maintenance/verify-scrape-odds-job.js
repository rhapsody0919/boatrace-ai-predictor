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
import {
  FULL_ODDS_KEYS,
  ODDS_SOURCE_VERCEL,
  ODDS_WINDOWS,
  buildBaseRow,
  fetchOddsDetailed,
  fullOddsPatchOf,
  isOddsRowComplete,
  pickFallbackPatches,
  runForRaces,
  scrapeTrifectaOdds,
  topTrifectaByOdds,
} from "../daily/scrape-odds.js";
import * as cheerio from "cheerio";
import { computeOddsDigest } from "../lib/scrapeJobs/oddsDigest.js";
import { compareOddsShadowDigests } from "./check-odds-shadow.js";
import {
  createOddsSlotHandler,
  parseOddsRaceId,
  shouldProbeWinFirst,
} from "../lib/scrapeJobs/oddsHandlers.js";
import { isOddsSkippedOnGha } from "../lib/predictionRefresh.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

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

// ---------------------------------------------------------------------------
// (a) 解析・構造のダイジェスト
// ---------------------------------------------------------------------------
{
  const r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher(),
  });
  const d = r.data;
  check(
    "解析: 桐生1Rの単勝6・複勝6（下限・上限）が取れる",
    r.status === "ok" &&
      d.winOdds.length === 6 &&
      d.winOdds.every((o) => o > 0) &&
      d.placeOdds.length === 6 &&
      d.placeOdds.every((p) => p && p.low > 0 && p.high >= p.low),
    show({ status: r.status, win: d?.winOdds }),
  );
  check(
    "解析: 全通り5券種が取れる（3連単120・3連複20・2連単30・2連複15・拡連複15通り）、missing は空",
    Object.keys(d.trifectaAll).length === 120 &&
      Object.keys(d.trioAll).length === 20 &&
      Object.keys(d.exactaAll).length === 30 &&
      Object.keys(d.quinellaAll).length === 15 &&
      Object.keys(d.wideAll).length === 15 &&
      r.missing.length === 0,
  );
  check(
    "解析: 全通り系の列名は5つ固定（FULL_ODDS_KEYS）で、取得結果と1対1に対応する",
    same(FULL_ODDS_KEYS, [
      "trifecta_all",
      "trio_all",
      "exacta_all",
      "quinella_all",
      "wide_all",
    ]) && same(Object.keys(fullOddsPatchOf(d)), FULL_ODDS_KEYS),
  );

  // 3連単の人気上位3件: 桐生1Rのフィクスチャで、120通りのグリッドを独立に並べ替えた結果と一致する。
  // 期待値は、フィクスチャのHTMLに書かれている値（1-2-6=7.6・1-2-3=10.0・1-6-2=14.8。第1セクション=1着1号艇の表で確認）
  check(
    "3連単人気: 桐生1Rの人気1〜3位が、オッズの低い順（1-2-6:7.6・1-2-3:10.0・1-6-2:14.8）で取れる",
    same(d.trifecta, [
      { combination: "1-2-6", odds: 7.6 },
      { combination: "1-2-3", odds: 10 },
      { combination: "1-6-2", odds: 14.8 },
    ]),
    show(d.trifecta),
  );
  check(
    "3連単人気: 上位3件は trifecta_all（120通り）のオッズ昇順の先頭3件と同じで、順序は非減少",
    (() => {
      const sorted = Object.entries(d.trifectaAll).sort((a, b) => a[1] - b[1]);
      return (
        d.trifecta.length === 3 &&
        d.trifecta.every(
          (t, i) =>
            t.odds === sorted[i][1] && d.trifectaAll[t.combination] === t.odds,
        ) &&
        d.trifecta[0].odds <= d.trifecta[1].odds &&
        d.trifecta[1].odds <= d.trifecta[2].odds
      );
    })(),
    show(d.trifecta),
  );
  {
    // 旧セレクタが0件だったことの再現（.is-p3-0 は <tbody> 自身のクラスで、内側に <tbody> は無い）
    const $t = cheerio.load(PAGES.odds3t);
    check(
      "3連単人気: 旧セレクタ（.is-p3-0 tbody tr）は実ページで0件（不具合の再現）。新しい解析は3件返す",
      $t(".is-p3-0 tbody tr").length === 0 &&
        $t("tbody.is-p3-0 tr").length > 0 &&
        scrapeTrifectaOdds($t).length === 3,
    );
  }
  check(
    "3連単人気: 同じオッズは組番の昇順で決定的に並べる。グリッドが空・不完全でも例外にしない（n件未満で返す）",
    same(
      topTrifectaByOdds(
        new Map([
          ["2-1-3", 5],
          ["1-3-2", 5],
          ["1-2-3", 5],
          ["4-5-6", 3],
          ["6-5-4", 9],
        ]),
      ),
      [
        { combination: "4-5-6", odds: 3 },
        { combination: "1-2-3", odds: 5 },
        { combination: "1-3-2", odds: 5 },
      ],
    ) &&
      same(topTrifectaByOdds(new Map()), []) &&
      same(topTrifectaByOdds(new Map([["1-2-3", 2]])), [
        { combination: "1-2-3", odds: 2 },
      ]),
  );
  {
    // wantFull=false（全通り系を取らない呼び出し）でも、人気上位は取れる。trifectaAll は取らない
    const r0 = await fetchOddsDetailed(DATE, 5, 1, {
      wantFull: false,
      fetchFn: createFetcher(),
    });
    check(
      "3連単人気: wantFull=false でも人気上位3件は取れ、trifectaAll は null のまま（取得ページ数・保存列は変わらない）",
      r0.status === "ok" &&
        same(r0.data.trifecta, d.trifecta) &&
        r0.data.trifectaAll === null,
      show(r0.data?.trifecta),
    );
  }

  const row = {
    ...buildBaseRow(RACE_A, NOW.toISOString(), d),
    ...fullOddsPatchOf(d),
  };
  const digest = computeOddsDigest(row);
  check(
    "ダイジェスト: 16桁の16進数で、同じ行なら同じ値",
    /^[0-9a-f]{16}$/.test(digest) && digest === computeOddsDigest(clone(row)),
    digest,
  );
  check(
    "ダイジェスト: trifecta_popular_*・trifecta_odds_* の有無・値に依存しない（修正前のNULLの行と、修正後の行で同じ値。並走中の shadow との比較を壊さない）",
    computeOddsDigest({
      ...row,
      trifecta_popular_1: null,
      trifecta_odds_1: null,
      trifecta_popular_2: null,
      trifecta_odds_2: null,
      trifecta_popular_3: null,
      trifecta_odds_3: null,
    }) === digest &&
      computeOddsDigest({ ...row, trifecta_popular_1: "9-9-9" }) === digest,
  );
  check(
    "ダイジェスト: オッズの値・captured_at が変わっても変わらない（時刻がずれた既存基盤の行と比べられる）",
    computeOddsDigest({
      ...row,
      odds_win_1: 99,
      trifecta_odds_1: 1,
      captured_at: "2030-01-01T00:00:00Z",
      trifecta_all: Object.fromEntries(
        Object.keys(row.trifecta_all).map((k) => [k, 1]),
      ),
    }) === digest,
  );
  const dropKey = (obj) => {
    const c = { ...obj };
    delete c[Object.keys(c)[0]];
    return c;
  };
  check(
    "ダイジェスト: 全通り系の組み合わせが1つ欠ける・券種が丸ごと欠ける・単勝が欠けると変わる",
    computeOddsDigest({ ...row, trio_all: dropKey(row.trio_all) }) !== digest &&
      computeOddsDigest({ ...row, wide_all: null }) !== digest &&
      computeOddsDigest({ ...row, odds_win_3: null }) !== digest &&
      computeOddsDigest({ ...row, odds_place_2_high: null }) !== digest,
  );
  check(
    "ダイジェスト: 組み合わせのキー集合が違えば（個数が同じでも）変わる",
    computeOddsDigest({
      ...row,
      quinella_all: Object.fromEntries(
        Object.keys(row.quinella_all).map((k) => [`x${k}`, 1]),
      ),
    }) !== digest,
  );
}
{
  const r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "解析: 未公開ページ（.oddsPoint なし）は no_values（例外にしない）",
    r.status === "no_values" && r.data === null,
  );
}
{
  const r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher({ odds3f: 404, oddsk: new Error("ECONNRESET") }),
  });
  check(
    "解析: 3連複が404・拡連複が通信エラーなら partial（単勝は取れる。missing に列名）",
    r.status === "partial" &&
      r.data.winOdds.length === 6 &&
      same(r.missing, ["trio_all", "wide_all"]),
    show(r.missing),
  );
}
{
  const r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher({ oddstf: 500 }),
  });
  check(
    "解析: 単勝ページが500なら error（HTTP ステータスをメッセージに含む）",
    r.status === "error" && /HTTP 500/.test(r.error),
    r.error,
  );
  const b = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher({
      oddstf: new BreakerOpenError("host:boatrace.jp", Date.now() + 60000),
    }),
  });
  check(
    "解析: ブレーカーが開いていれば breaker_open（retryAt は Date）",
    b.status === "breaker_open" && b.retryAt instanceof Date,
    show(b),
  );
  const w = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: false,
    fetchFn: createFetcher(),
  });
  check(
    "解析: wantFull=false（従来の run の基本オッズのみ）は2ページだけ取り、全通り系は取らない・partial にならない",
    w.status === "ok" &&
      w.missing.length === 0 &&
      w.data.trioAll === null &&
      w.data.trifectaAll === null,
  );
}

// ---------------------------------------------------------------------------
// (a2) 未公開の間の再試行の確認（winFirst）
// ---------------------------------------------------------------------------
{
  const pages = (f) => f.calls.map((u) => pageOfUrl(u));
  // 未公開: 単勝ページだけを取って no_values（他のページは取らない）
  let f = createFetcher({ oddstf: HTML_UNPUBLISHED });
  let r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 未公開なら、単勝ページ（oddstf）の1リクエストだけで no_values にする（他の4ページは取らない）",
    r.status === "no_values" && r.data === null && same(pages(f), ["oddstf"]),
    show(pages(f)),
  );
  // 従来（winFirst=false）は、未公開でも全ページを取る（変えていない）
  f = createFetcher({ oddstf: HTML_UNPUBLISHED });
  r = await fetchOddsDetailed(DATE, 5, 1, { wantFull: true, fetchFn: f });
  check(
    "winFirst=false（既定）: 従来どおり、未公開でも5ページを並列に取る（通常の取得を変えていない）",
    r.status === "no_values" && f.calls.length === 5,
    show(pages(f)),
  );
  // 公開済み: 単勝を1回だけ取り、残りの4ページを取って、通常の取得と同じ結果になる
  f = createFetcher();
  const first = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  const normal = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher(),
  });
  check(
    "winFirst: 公開済みなら、単勝は1回だけ取り（重複して取らない）、計5ページを取って ok。結果（単勝・複勝・全通り系）は通常の取得と同じ",
    first.status === "ok" &&
      f.calls.length === 5 &&
      pages(f).filter((p) => p === "oddstf").length === 1 &&
      same(first.data, normal.data) &&
      same(first.missing, normal.missing),
    show(pages(f)),
  );
  // 一部の券種ページが落ちていれば partial（通常と同じ）
  f = createFetcher({ odds3f: 404 });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 公開済みで3連複が404なら partial（通常と同じ。列名つき）",
    r.status === "partial" && same(r.missing, ["trio_all"]),
    show(r.missing),
  );
  // 単勝の失敗・ブレーカー: 他のページを取らない
  f = createFetcher({ oddstf: 500 });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 単勝ページが500なら、他のページを取らずに error（HTTPステータスをメッセージに含む）",
    r.status === "error" && /HTTP 500/.test(r.error) && f.calls.length === 1,
    show([r, pages(f)]),
  );
  f = createFetcher({
    oddstf: new BreakerOpenError("host:boatrace.jp", Date.now() + 60000),
  });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: ブレーカーが開いていれば、他のページを取らずに breaker_open（retryAt は Date）",
    r.status === "breaker_open" &&
      r.retryAt instanceof Date &&
      f.calls.length === 1,
    show([r, pages(f)]),
  );
  // 通信エラー（reject）: 他のページを取らずに error
  f = createFetcher({ oddstf: new Error("ECONNRESET") });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 単勝が通信エラーなら、他のページを取らずに error",
    r.status === "error" && f.calls.length === 1,
    show([r, pages(f)]),
  );
}

// ---------------------------------------------------------------------------
// (b) runForRaces
// ---------------------------------------------------------------------------
const opts = (db, fetchFn, extra = {}) => ({
  date: DATE,
  mode: "live",
  fetchFn,
  client: db,
  concurrency: 4,
  now: () => NOW,
  ...extra,
});

{
  const db = createFakeDb();
  const f = createFetcher();
  const [r] = await runForRaces([raceOf(RACE_A, -30)], opts(db, f));
  const w = db.writes[0];
  const row = findRow(db, RACE_A, -30)[0];
  check(
    "live: 1レース×1窓で、5ページを取得し、1行だけ upsert（onConflict は race_id,window_min）、outcome ok・rowsWritten 1",
    f.calls.length === 5 &&
      db.writes.length === 1 &&
      w.onConflict === "race_id,window_min" &&
      w.count === 1 &&
      r.outcome === "ok" &&
      r.rowsWritten === 1 &&
      r.rowsParsed === 1 &&
      r.rowsExpected === 1,
    show({ calls: f.calls.length, w, r }),
  );
  check(
    "live: 行は window_min・source='vercel'・captured_at（now）つきで、基本オッズと全通り5列を1行に持つ",
    row &&
      row.window_min === -30 &&
      row.source === ODDS_SOURCE_VERCEL &&
      row.source === "vercel" &&
      row.captured_at === NOW.toISOString() &&
      row.odds_win_1 > 0 &&
      row.odds_place_1_low > 0 &&
      FULL_ODDS_KEYS.every((k) => row[k]) &&
      isOddsRowComplete(row),
  );
  check(
    "live: 結果の resultDigest は、書いた行から計算した構造のダイジェストと一致する",
    r.resultDigest === computeOddsDigest(row) && same(r.missing, []),
  );

  // 冪等: 同じ窓を、もう一度（重複配信・リース奪取後の二重実行）
  const f2 = createFetcher();
  await runForRaces([raceOf(RACE_A, -30)], opts(db, f2));
  check(
    "冪等: 同じレース×窓を二重に処理しても、行は1つのまま（一意索引の upsert で更新される）",
    findRow(db, RACE_A, -30).length === 1 && db.rows.length === 1,
    show(db.rows.length),
  );
  // 窓ごとに別の行
  await runForRaces([raceOf(RACE_A, -15), raceOf(RACE_A, 0)], opts(db, f2));
  check(
    "窓ごとに別の行（-30・-15・0の3行。旧基盤の window_min=NULL の行とも衝突しない）",
    db.rows.length === 3 &&
      [-30, -15, 0].every((wm) => findRow(db, RACE_A, wm).length === 1),
  );
  check(
    "書き込みの行のキーは、全行で一様（PostgREST の一括 upsert の要件。列の欠けで null 上書きが起きない）",
    db.writes.every((x) => x.uniformKeys),
  );
}
{
  // 旧基盤（window_min NULL）の行があっても、新しい行は衝突せず追加される
  const db = createFakeDb([
    fullRow({
      window_min: null,
      source: "gha",
      captured_at: "2026-09-19T04:00:00.000Z",
    }),
    fullRow({
      window_min: null,
      source: "gha",
      captured_at: "2026-09-19T04:30:00.000Z",
    }),
  ]);
  await runForRaces([raceOf(RACE_A, -30)], opts(db, createFetcher()));
  check(
    "旧基盤の行（window_min=NULL、同じ race_id が複数）は、更新も削除もされず、Vercel の行が別に追加される",
    db.rows.length === 3 &&
      db.rows.filter((r) => r.source === "gha").length === 2 &&
      findRow(db, RACE_A, -30).length === 1,
  );
}
{
  // shadow
  const db = createFakeDb([fullRow({ window_min: -30 })]);
  const before = clone(db.rows);
  const f = createFetcher();
  const [r] = await runForRaces(
    [raceOf(RACE_A, -30, 2)],
    opts(db, f, { mode: "shadow" }),
  );
  check(
    "shadow: 取得・解析のみ。race_odds へ書かない（書き込み0回・行は不変）、既存行も読まない（再試行でも）",
    db.writes.length === 0 &&
      db.reads.length === 0 &&
      same(db.rows, before) &&
      f.calls.length === 5 &&
      r.outcome === "ok" &&
      r.rowsWritten === 0 &&
      r.rowsParsed === 1 &&
      /^[0-9a-f]{16}$/.test(r.resultDigest),
    show({ writes: db.writes, reads: db.reads.length, r }),
  );
  const live = await runForRaces(
    [raceOf(RACE_B, -30)],
    opts(createFakeDb(), createFetcher()),
  );
  check(
    "shadow: result_digest は、同じページを live で処理した結果と同じ（shadow と live で解析が同じ）",
    live[0].resultDigest === r.resultDigest,
  );
}
{
  // 再試行: 一部のページが失敗 → 次の試行で残りが取れる。既存の値を null で上書きしない
  const db = createFakeDb();
  const [r1] = await runForRaces(
    [raceOf(RACE_A, -30, 1)],
    opts(db, createFetcher({ oddsk: 500 })),
  );
  const row1 = clone(findRow(db, RACE_A, -30)[0]);
  check(
    "partial: 拡連複だけ取れなければ partial（取れた分は書き込み済み・missing に wide_all・再試行の理由を error に）",
    r1.outcome === "partial" &&
      r1.rowsWritten === 1 &&
      same(r1.missing, ["wide_all"]) &&
      /wide_all/.test(r1.error) &&
      row1.wide_all === null &&
      row1.trifecta_all &&
      !isOddsRowComplete(row1),
    show(r1),
  );
  // 再試行（attempts=2）: 今度は3連複・3連単が取れない。拡連複は取れる
  const NOW2 = new Date(NOW.getTime() + 60000);
  const [r2] = await runForRaces(
    [raceOf(RACE_A, -30, 2)],
    opts(db, createFetcher({ odds3f: 500, odds3t: 500 }), { now: () => NOW2 }),
  );
  const row2 = findRow(db, RACE_A, -30)[0];
  check(
    "再試行: 今回取れなかった列（3連複・3連単）は、前回の値を引き継ぎ、null で上書きしない。今回取れた拡連複が加わり、ok になる",
    r2.outcome === "ok" &&
      same(row2.trio_all, row1.trio_all) &&
      same(row2.trifecta_all, row1.trifecta_all) &&
      row2.wide_all &&
      findRow(db, RACE_A, -30).length === 1,
    show(r2),
  );
  check(
    "再試行: 最新の試行の値（captured_at）に更新される",
    row2.captured_at === NOW2.toISOString(),
  );
}
{
  // 基本オッズの列も、新しい値が null なら前回の値を引き継ぐ（新しい値が非nullなら新しい値）
  const prior = () =>
    createFakeDb([
      fullRow({
        window_min: -30,
        wide_all: null,
        odds_win_1: 99,
        trifecta_popular_1: "9-9-9",
        trifecta_odds_1: 99,
      }),
    ]);
  // 3連単の人気順は odds3t の全通りから求めるため、odds3t が取れなければ null になる
  const dbNull = prior();
  await runForRaces(
    [raceOf(RACE_A, -30, 2)],
    opts(dbNull, createFetcher({ odds3t: 500 })),
  );
  const rowNull = findRow(dbNull, RACE_A, -30)[0];
  check(
    "再試行: 新しい値が null の基本列は前回の値を引き継ぎ（odds3t が取れず trifecta_popular_1 が null の場合、前回の 9-9-9）、非null の列は新しい値になる（odds_win_1 は 99 ではなく最新の単勝）",
    rowNull.trifecta_popular_1 === "9-9-9" &&
      rowNull.trifecta_odds_1 === 99 &&
      rowNull.odds_win_1 !== 99 &&
      rowNull.odds_win_1 > 0,
    show([rowNull.trifecta_popular_1, rowNull.odds_win_1]),
  );
  const dbNew = prior();
  await runForRaces([raceOf(RACE_A, -30, 2)], opts(dbNew, createFetcher()));
  const rowNew = findRow(dbNew, RACE_A, -30)[0];
  check(
    "再試行: odds3t が取れた場合、trifecta_popular_1・trifecta_odds_1 は前回の値ではなく最新の人気1位（1-2-6・7.6）になる",
    rowNew.trifecta_popular_1 === "1-2-6" && rowNew.trifecta_odds_1 === 7.6,
    show([rowNew.trifecta_popular_1, rowNew.trifecta_odds_1]),
  );
}
{
  // 完了済みの窓は、取得しない
  const db = createFakeDb([fullRow({ window_min: -30 })]);
  const f = createFetcher();
  const [r] = await runForRaces([raceOf(RACE_A, -30, 2)], opts(db, f));
  check(
    "再試行: その窓の行が既に完了していれば、取得せず skipped_have_data（完了の記録だけが失敗した場合の二重取得を避ける）",
    r.outcome === "skipped_have_data" &&
      f.calls.length === 0 &&
      db.writes.length === 0,
    show(r),
  );
  const db2 = createFakeDb([fullRow({ window_min: -30 })]);
  const f2 = createFetcher();
  const [r2] = await runForRaces([raceOf(RACE_A, -30, 1)], opts(db2, f2));
  check(
    "初回（attempts=1）は既存行を読まず、取得する（読み取りの追加なし）",
    r2.outcome === "ok" && f2.calls.length === 5 && db2.reads.length === 0,
    show({ r2, reads: db2.reads.length }),
  );
  const db3 = createFakeDb([fullRow({ window_min: -15 })]);
  const f3 = createFetcher();
  const [r3] = await runForRaces([raceOf(RACE_A, -30, 2)], opts(db3, f3));
  check(
    "再試行でも、別の窓の完了済みの行は、この窓の完了とみなさない",
    r3.outcome === "ok" && f3.calls.length === 5,
  );
}
{
  const db = createFakeDb();
  const f = createFetcher({ oddstf: HTML_UNPUBLISHED });
  const [r] = await runForRaces([raceOf(RACE_A, -60)], opts(db, f));
  check(
    "未公開: no_values（書き込みなし・再試行される outcome）",
    r.outcome === "no_values" && db.writes.length === 0 && r.rowsParsed === 0,
    show(r),
  );
}
{
  const db = createFakeDb([], { failUpsert: true });
  const [r] = await runForRaces(
    [raceOf(RACE_A, -60)],
    opts(db, createFetcher()),
  );
  check(
    "書き込み失敗: error（メッセージ付き・rowsWritten 0）。再試行される",
    r.outcome === "error" &&
      /書き込みに失敗/.test(r.error) &&
      r.rowsWritten === 0,
    show(r),
  );
}
{
  const db = createFakeDb();
  const [r] = await runForRaces(
    [raceOf(RACE_A, -60)],
    opts(
      db,
      createFetcher({
        oddstf: new BreakerOpenError("host:boatrace.jp", NOW.getTime() + 60000),
      }),
    ),
  );
  check(
    "ブレーカー: breaker_open（retryAt つき・書き込みなし）",
    r.outcome === "breaker_open" &&
      r.retryAt instanceof Date &&
      db.writes.length === 0,
  );
}
{
  // 1件の失敗が他を止めない・書き込みは1回にまとまる
  const db = createFakeDb();
  const f = createFetcher({ "oddstf@2": 500 });
  const rs = await runForRaces(
    [raceOf(RACE_A, -30), raceOf(RACE_B, -30), raceOf(RACE_C, -30)],
    opts(db, f),
  );
  check(
    "複数レース: 1レースの単勝ページが失敗しても、他のレースは ok。書き込みは1回（ok の2行のみ）",
    same(
      rs.map((x) => x.outcome),
      ["ok", "error", "ok"],
    ) &&
      db.writes.length === 1 &&
      db.writes[0].count === 2 &&
      db.rows.length === 2,
    show(rs.map((x) => x.outcome)),
  );
}
{
  const f = createFetcher({}, { delayMs: 5 });
  const races = Array.from({ length: 8 }, (_, i) =>
    raceOf(`2026-09-19-05-${String(i + 1).padStart(2, "0")}`, -30),
  );
  await runForRaces(races, opts(createFakeDb(), f, { concurrency: 2 }));
  check(
    "並列度: concurrency=2 なら、同時に取得するページは 2レース×5ページ＝10 以下（会場内12レース×5＝最大60同時だった現行より緩やか）",
    f.maxActive <= 10 && f.maxActive >= 5 && f.calls.length === 40,
    `max=${f.maxActive} calls=${f.calls.length}`,
  );
}
{
  // 0分窓のフォールバック
  const missingWide = createFetcher({ oddsk: 500 });
  const older = fullRow({
    window_min: -5,
    captured_at: "2026-09-19T04:55:00.000Z",
    wide_all: { "1-2": 3.3, "1-3": 4.4 },
  });
  const db = createFakeDb([
    older,
    // 自分の窓（0）の、部分的な前回の試行（拡連複なし。新しい）: 補完元にしない
    fullRow({
      window_min: 0,
      captured_at: "2026-09-19T04:59:00.000Z",
      wide_all: null,
    }),
  ]);
  const [r] = await runForRaces([raceOf(RACE_A, 0, 2)], opts(db, missingWide));
  const row = findRow(db, RACE_A, 0)[0];
  check(
    "0分窓: 拡連複が取れなくても、直近のスナップショット（自分の窓の行を除く）から補完して ok にする（ADR-0057）",
    r.outcome === "ok" &&
      same(row.wide_all, older.wide_all) &&
      isOddsRowComplete(row),
    show(r),
  );

  const dbOld = createFakeDb([
    fullRow({
      window_min: -5,
      captured_at: "2026-09-19T03:00:00.000Z", // 120分前: 75分を超える
      wide_all: { "1-2": 3.3 },
    }),
  ]);
  const [rOld] = await runForRaces(
    [raceOf(RACE_A, 0)],
    opts(dbOld, createFetcher({ oddsk: 500 })),
  );
  check(
    "0分窓: 75分より古いスナップショットは採用しない（partial のまま）",
    rOld.outcome === "partial" && same(rOld.missing, ["wide_all"]),
    show(rOld),
  );

  const dbOther = createFakeDb([older]);
  const [rOther] = await runForRaces(
    [raceOf(RACE_A, -5)],
    opts(dbOther, createFetcher({ oddsk: 500 })),
  );
  check(
    "0分窓以外（-5分）は、補完しない（partial のまま再試行）",
    rOther.outcome === "partial" && same(rOther.missing, ["wide_all"]),
  );
  const [rShadow] = await runForRaces(
    [raceOf(RACE_A, 0)],
    opts(createFakeDb([older]), createFetcher({ oddsk: 500 }), {
      mode: "shadow",
    }),
  );
  check(
    "0分窓の補完は shadow でも同じ判定（ダイジェストが live と同じになる）。書き込みはしない",
    rShadow.outcome === "ok" && rShadow.rowsWritten === 0,
  );
}
{
  let threw = null;
  try {
    await runForRaces(
      [{ ...raceOf(RACE_A, -30), window_min: undefined }],
      opts(createFakeDb(), createFetcher()),
    );
  } catch (e) {
    threw = e.message;
  }
  let threw2 = null;
  try {
    await runForRaces(
      [raceOf(RACE_A, -30)],
      opts(createFakeDb(), createFetcher(), { mode: "bogus" }),
    );
  } catch (e) {
    threw2 = e.message;
  }
  check(
    "入力の検査: window_min が無い・mode が不正なら、取得せずに例外（メッセージ付き）",
    /window_min/.test(threw ?? "") && /mode/.test(threw2 ?? ""),
    `${threw} / ${threw2}`,
  );
}

// ---------------------------------------------------------------------------
// (c) 共通ラッパ経由の odds
// ---------------------------------------------------------------------------
const slotOf = (raceId, offset, extra = {}) => ({
  job: "odds",
  race_id: raceId,
  offset_min: offset,
  attempts: 1,
  last_attempt_at: NOW.toISOString(),
  lease_until: new Date(NOW.getTime() + 120000).toISOString(),
  ...extra,
});
async function runOdds({ rows, slots, available, db, fetcher, run }) {
  const store = createMemoryStore({ rows, slots, available });
  const database = db ?? createFakeDb();
  const f = fetcher ?? createFetcher();
  const result = await runScrapeJob({
    job: "odds",
    store,
    handleSlot: createOddsSlotHandler(run ? { run } : {}),
    now: () => NOW,
    worker: "test:odds",
    client: database,
    politeFetch: f,
  });
  return { result, store, db: database, fetcher: f };
}

{
  const off = await runOdds({
    rows: { odds: { job: "odds", mode: "off", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30)],
  });
  check(
    "ラッパ: mode=off は、取得も書き込みも予定表の更新もしない（200・skipped）",
    off.result.status === 200 &&
      off.result.body.skipped === "mode_off" &&
      off.fetcher.calls.length === 0 &&
      off.db.writes.length === 0 &&
      off.store.completed.length === 0 &&
      off.store.retried.length === 0 &&
      !off.store.calls.some((c) => c.name === "claimSlots"),
    show(off.result.body),
  );
  const none = await runOdds({ rows: {}, slots: [slotOf(RACE_A, -30)] });
  check(
    "ラッパ: 行が無いジョブは off として扱い、行を作るだけ（取得・書き込み・claim なし）",
    none.result.body.skipped === "mode_off" &&
      none.store.state.get("odds")?.mode === "off" &&
      none.fetcher.calls.length === 0 &&
      none.db.writes.length === 0 &&
      !none.store.calls.some((c) => c.name === "claimSlots"),
  );
  const unavailable = await runOdds({
    available: false,
    slots: [slotOf(RACE_A, -30)],
  });
  check(
    "ラッパ: マイグレーション075が未適用なら、何もせず 200（skipped）",
    unavailable.result.status === 200 &&
      unavailable.result.body.skipped === "scrape_schema_not_applied" &&
      unavailable.fetcher.calls.length === 0,
  );
}
{
  const shadow = await runOdds({
    rows: { odds: { job: "odds", mode: "shadow", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -15)],
  });
  const claim = shadow.store.calls.find((c) => c.name === "claimSlots");
  check(
    "ラッパ: shadow は、race_odds へ書かず、予定表のスロットを done にして digest を記録する（run_mode は shadow で claim）",
    shadow.result.status === 200 &&
      shadow.db.writes.length === 0 &&
      shadow.db.rows.length === 0 &&
      shadow.store.completed.length === 2 &&
      shadow.store.completed.every(
        (c) => c.outcome === "ok" && /^[0-9a-f]{16}$/.test(c.resultDigest),
      ) &&
      claim.mode === "shadow",
    show({
      body: shadow.result.body,
      completed: shadow.store.completed.length,
    }),
  );
  const live = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -15)],
  });
  check(
    "ラッパ: live は race_odds へ書き込み（2レース×2窓の別の行）、スロットを done にする",
    live.result.status === 200 &&
      live.db.rows.length === 2 &&
      live.db.rows.every((r) => r.source === "vercel") &&
      live.store.completed.length === 2 &&
      live.result.body.rowsWritten === 2,
    show(live.result.body),
  );
  check(
    "ラッパ: shadow と live で、同じスロットの digest が一致する（shadow の一致率の比較が成り立つ）",
    same(
      shadow.store.completed.map((c) => c.resultDigest),
      live.store.completed.map((c) => c.resultDigest),
    ),
  );
}
{
  const partial = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30)],
    fetcher: createFetcher({ odds2tf: 500 }),
  });
  check(
    "ラッパ: partial は done にせず、pending に戻す（再試行の間隔は retrySec の60秒−ジッターで、claim した時刻が起点）。取れた分は書き込み済み",
    partial.result.status === 200 &&
      partial.store.completed.length === 0 &&
      partial.store.retried.length === 1 &&
      partial.store.retried[0].outcome === "partial" &&
      /exacta_all/.test(partial.store.retried[0].error) &&
      partial.db.rows.length === 1 &&
      Math.round(
        (partial.store.retried[0].retryAt.getTime() - NOW.getTime()) / 1000,
      ) ===
        SCRAPE_JOBS.odds.retrySec - 10,
    show(partial.store.retried.map((r) => [r.outcome, r.retryAt])),
  );
  const allError = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30), slotOf(RACE_B, -30)],
    fetcher: createFetcher({ oddstf: 500 }),
  });
  check(
    "ラッパ: 処理した全スロットが error なら、この実行は失敗（HTTP 500・連続失敗数を増やす）。書き込みなし",
    allError.result.status === 500 &&
      allError.store.state.get("odds").consecutive_failures === 1 &&
      allError.db.writes.length === 0 &&
      allError.store.retried.length === 2,
    show(allError.result.body),
  );
  const noValues = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -60)],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "ラッパ: 未公開（no_values）は再試行に戻し、200（失敗にしない。許容幅を過ぎれば expired として通知される）",
    noValues.result.status === 200 &&
      noValues.store.retried[0]?.outcome === "no_values" &&
      noValues.store.completed.length === 0,
  );
  const breaker = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_A, -30)],
    fetcher: createFetcher({
      oddstf: new BreakerOpenError("host:boatrace.jp", NOW.getTime() + 90000),
    }),
  });
  check(
    "ラッパ: ブレーカーが開いていたら、ブレーカーが閉じる頃まで再試行を遅らせる（retryAt）",
    breaker.store.retried[0]?.outcome === "breaker_open" &&
      breaker.store.retried[0].retryAt.getTime() === NOW.getTime() + 90000,
  );
}
{
  // 延長した窓（-60）の、未公開の間の再試行は、単勝1ページの確認に絞る（追加リクエストを未公開のレースだけ・1ページにする）
  check(
    "shouldProbeWinFirst: 延長した窓（-60）で、直前の試行が未公開（outcome=no_values）のときだけ true（初回・他の窓・他の結果は false）",
    shouldProbeWinFirst({ offset_min: -60, outcome: "no_values" }) === true &&
      shouldProbeWinFirst({ offset_min: -60, outcome: null }) === false &&
      shouldProbeWinFirst({ offset_min: -60 }) === false &&
      shouldProbeWinFirst({ offset_min: -60, outcome: "error" }) === false &&
      shouldProbeWinFirst({ offset_min: -60, outcome: "partial" }) === false &&
      [-30, -15, -10, -5, 0].every(
        (o) =>
          shouldProbeWinFirst({ offset_min: o, outcome: "no_values" }) ===
          false,
      ),
  );
  const liveRows = {
    odds: { job: "odds", mode: "live", consecutive_failures: 0 },
  };
  const probeUnpub = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 4, outcome: "no_values" })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "延長中の -60 の再試行（前回も未公開）で、まだ未公開: 取得先へのリクエストは単勝の1ページだけ。pending に戻り（no_values・約50秒後に再試行）、race_odds へ書かない",
    probeUnpub.fetcher.calls.length === 1 &&
      pageOfUrl(probeUnpub.fetcher.calls[0]) === "oddstf" &&
      probeUnpub.store.retried.length === 1 &&
      probeUnpub.store.retried[0].outcome === "no_values" &&
      Math.round(
        (probeUnpub.store.retried[0].retryAt.getTime() - NOW.getTime()) / 1000,
      ) ===
        SCRAPE_JOBS.odds.retrySec - 10 &&
      probeUnpub.db.writes.length === 0,
    show(probeUnpub.fetcher.calls.map(pageOfUrl)),
  );
  const probePub = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 4, outcome: "no_values" })],
  });
  check(
    "延長中の -60 の再試行で、公開されていた: 全通りを取得して書き込み（window_min=-60・source=vercel）、done（ok）にする。単勝は重複して取らない（計5リクエスト）",
    probePub.fetcher.calls.length === 5 &&
      probePub.store.completed.length === 1 &&
      probePub.store.completed[0].outcome === "ok" &&
      probePub.db.rows.length === 1 &&
      probePub.db.rows[0].window_min === -60 &&
      probePub.db.rows[0].source === "vercel",
    show(probePub.fetcher.calls.map(pageOfUrl)),
  );
  const firstTry = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -60, { attempts: 1, outcome: null })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "-60 の初回の試行（outcome なし）は、従来どおり全5ページを並列に取る（通常の取得の所要時間・リクエストを変えない）",
    firstTry.fetcher.calls.length === 5,
    show(firstTry.fetcher.calls.map(pageOfUrl)),
  );
  const otherWindow = await runOdds({
    rows: liveRows,
    slots: [slotOf(RACE_A, -30, { attempts: 2, outcome: "no_values" })],
    fetcher: createFetcher({ oddstf: HTML_UNPUBLISHED }),
  });
  check(
    "他の窓（-30）は、前回が未公開でも、従来どおり全5ページを取る（延長・1ページの確認は -60 だけ）",
    otherWindow.fetcher.calls.length === 5,
    show(otherWindow.fetcher.calls.map(pageOfUrl)),
  );
  // 追加リクエストの見積り: 未公開のレース N 件 × 最大27回（-60〜-33 の毎分。-30 の窓が始まるまで）× 1ページ
  const graceMin = SCRAPE_JOBS.odds.graceMinByOffset[-60];
  const maxProbes = Math.floor(
    (graceMin * 60 - SCRAPE_JOBS.odds.graceMin * 60) /
      (SCRAPE_JOBS.odds.retrySec - 10 + 10),
  );
  check(
    "追加リクエストの上限の見積り: 1レースあたり、延長した27分の間、毎分1ページ（最大約27件。従来の窓内は3分・5ページ）",
    maxProbes === 27 && graceMin === 30,
    show([graceMin, maxProbes]),
  );

  // ハンドラーが runForRaces に渡す引数
  const seen = [];
  const rec = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf(RACE_C, -10, { attempts: 3 })],
    run: async (races, options) => {
      seen.push({ races, options });
      return [
        {
          race_id: races[0].race_id,
          outcome: "ok",
          rowsWritten: 1,
          rowsParsed: 1,
          rowsExpected: 1,
        },
      ];
    },
  });
  const s = seen[0];
  check(
    "ハンドラー: スロットの窓（offset_min）が window_min、試行回数が attempts、race_id から日付・会場・レース番号を解いて渡す",
    s.races[0].window_min === -10 &&
      s.races[0].attempts === 3 &&
      s.races[0].venue_code === 5 &&
      s.races[0].race_number === 3 &&
      s.options.date === "2026-09-19" &&
      s.options.mode === "live" &&
      s.options.client === rec.db &&
      rec.store.completed.length === 1,
    show(s),
  );
  const bad = await runOdds({
    rows: { odds: { job: "odds", mode: "live", consecutive_failures: 0 } },
    slots: [slotOf("bad-race-id", -30)],
  });
  check(
    "ハンドラー: 不正な race_id は error として再試行に戻す（ジョブは落ちない）",
    bad.store.retried[0]?.outcome === "error" &&
      /race_id の形式が不正/.test(bad.store.retried[0].error),
    show(bad.result.body),
  );
}

// ---------------------------------------------------------------------------
// (d) 既存の入口 run() と共有する部品
// ---------------------------------------------------------------------------
{
  const data = {
    winOdds: [1.1, 2.2, 3.3, 4.4, 5.5, 6.6],
    placeOdds: [1, 2, 3, 4, 5, 6].map((n) => ({ low: n, high: n + 0.5 })),
    trifecta: [
      { combination: "1-2-3", odds: 10 },
      { combination: "2-1-3", odds: 20 },
      { combination: "3-1-2", odds: 30 },
    ],
  };
  const base = buildBaseRow("R", "T", data);
  // 従来の run() が組み立てていた行と、列名・値の対応が同じ（26列。値は入力の並びどおり）
  const expected = {
    race_id: "R",
    captured_at: "T",
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((n) => [`odds_win_${n}`, data.winOdds[n - 1]]),
    ),
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [
        [`odds_place_${n}_low`, n],
        [`odds_place_${n}_high`, n + 0.5],
      ]),
    ),
    trifecta_popular_1: "1-2-3",
    trifecta_odds_1: 10,
    trifecta_popular_2: "2-1-3",
    trifecta_odds_2: 20,
    trifecta_popular_3: "3-1-2",
    trifecta_odds_3: 30,
  };
  check(
    "buildBaseRow: 従来の基本オッズの行と同じ26列（race_id・captured_at・単勝6・複勝12・3連単人気3位×2）で、値の対応も同じ。全通り系・window_min・source を含まない",
    Object.keys(base).length === 26 &&
      same(
        Object.fromEntries(Object.entries(base).sort()),
        Object.fromEntries(Object.entries(expected).sort()),
      ) &&
      !("window_min" in base) &&
      !("source" in base) &&
      !("trifecta_all" in base),
    show(base),
  );
  check(
    "buildBaseRow: 複勝・3連単が欠けていれば null（例外にしない）",
    (() => {
      const b = buildBaseRow("R", "T", {
        winOdds: [1],
        placeOdds: [],
        trifecta: [],
      });
      return (
        b.odds_win_2 === null &&
        b.odds_place_1_low === null &&
        b.trifecta_popular_1 === null
      );
    })(),
  );
  check(
    "fullOddsPatchOf: 取得できた券種の列だけを持つ（null は含めない）",
    same(
      fullOddsPatchOf({
        trifectaAll: { a: 1 },
        wideAll: { b: 2 },
        trioAll: null,
      }),
      {
        trifecta_all: { a: 1 },
        wide_all: { b: 2 },
      },
    ),
  );
  const snap = (raceId, at, extra) => ({
    race_id: raceId,
    captured_at: at,
    ...extra,
  });
  const picked = pickFallbackPatches(
    new Map([
      ["R1", { trifecta_all: { x: 1 } }], // 4列が欠け
      ["R2", Object.fromEntries(FULL_ODDS_KEYS.map((k) => [k, { x: 1 }]))], // 欠けなし
      ["R3", {}],
    ]),
    [
      snap("R1", "2026-09-19T04:59:00Z", {
        trio_all: { t: 1 },
        wide_all: null,
      }),
      snap("R1", "2026-09-19T04:50:00Z", { wide_all: { w: 1 } }),
      snap("R2", "2026-09-19T04:59:00Z", { trio_all: { t: 1 } }),
    ],
  );
  check(
    "pickFallbackPatches: 欠けているレースだけを対象に、最新のスナップショットが持つ列を返す（最新が null の列は、古い行から拾わない＝従来と同じ）",
    picked.size === 1 &&
      same(picked.get("R1"), { trio_all: { t: 1 } }) &&
      !picked.has("R2") &&
      !picked.has("R3"),
    show([...picked]),
  );
}

// shadow の一致率の比較（check-odds-shadow.js）
{
  const digestRow = fullRow({ window_min: null, source: "gha" });
  const slotDigest = computeOddsDigest(digestRow);
  // 桐生1R 発走 12:00 JST（03:00Z）、窓 -30 → 期限 11:30 JST（02:30Z）
  const slot = (extra = {}) => ({
    race_id: RACE_A,
    race_date: DATE,
    offset_min: -30,
    result_digest: slotDigest,
    races: { start_time: "12:00:00" },
    ...extra,
  });
  const row = (captured_at, extra = {}) => ({
    ...digestRow,
    captured_at,
    ...extra,
  });
  const near = "2026-09-19T02:31:00.000Z";
  const c1 = compareOddsShadowDigests([slot()], [row(near)]);
  check(
    "shadow比較: 期限の近く（±5分以内）の既存基盤の行と構造が同じなら一致（値・時刻が違っても）",
    c1.matched === 1 && c1.mismatched.length === 0 && c1.missing.length === 0,
  );
  const c2 = compareOddsShadowDigests(
    [slot()],
    [row(near, { wide_all: null })],
  );
  check(
    "shadow比較: 既存基盤の行が拡連複を持たなければ不一致（Vercel が取れて既存基盤が取れていない差を検出）",
    c2.matched === 0 && c2.mismatched.length === 1,
  );
  const c3 = compareOddsShadowDigests(
    [slot()],
    [row("2026-09-19T02:40:00.000Z")],
  );
  check(
    "shadow比較: 期限から5分より離れた行しか無ければ「比べる行なし」（不一致に数えない）",
    c3.matched === 0 && c3.mismatched.length === 0 && c3.missing.length === 1,
  );
  const c4 = compareOddsShadowDigests(
    [slot()],
    [row("2026-09-19T02:35:00.000Z", { wide_all: null }), row(near)],
  );
  check(
    "shadow比較: 期限に最も近い行と比べる（遠い行が構造違いでも、近い行が同じなら一致）",
    c4.matched === 1 && c4.mismatched.length === 0,
  );
  const c5 = compareOddsShadowDigests(
    [slot({ result_digest: null })],
    [row(near)],
  );
  check(
    "shadow比較: digest 未記録のスロットは数えない",
    c5.noDigest.length === 1 && c5.matched === 0,
  );
}

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
  const scheduled = fs.readFileSync(
    path.join(ROOT, "scripts/daily/scrape-scheduled.js"),
    "utf8",
  );
  check(
    "scrape-scheduled.js: SKIP_ODDS_ON_GHA が true の間は、オッズの事前評価（hasOddsRaces）が false になり、runOdds を呼ばない。既存の入口 run は残す",
    // 変数が true のときだけ、対象のレースがあるときに、Vercel が健全かを確認する（フェイルセーフ付きSKIP）。
    // 未設定・falseなら skipOdds は false（DBを読まない）
    /const skipOdds =\s*isOddsSkippedOnGha\(\) && \(!oddsDue \|\| \(await gateSkips\("SKIP_ODDS_ON_GHA"\)\)\);/.test(
      scheduled,
    ) &&
      /const hasOddsRaces = !skipOdds && oddsDue;/.test(scheduled) &&
      /if \(hasOddsRaces\) \{\s*const \{ updated, count \} = await runOdds\(schedule, date\)/.test(
        scheduled,
      ),
  );
  check(
    "scrape-scheduled.js: 買い目オッズ（A4）は、SKIP_ODDS_ON_GHA の影響を受けない（別に動く。T4b-10 で扱う）",
    /runPredictionOdds\(/.test(scheduled) &&
      !/skipOdds[^\n]*runPredictionOdds/.test(scheduled) &&
      /if \(upcomingRaces\.length > 0\) \{/.test(scheduled),
  );
  check(
    "scrape-scheduled.js: 案1が有効でないままオッズを止めた場合は警告（SKIP_ODDS_REFRESH_ON_GHA が true でないとき）",
    /if \(skipOdds && !skipOddsRefresh\)/.test(scheduled),
  );
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
  const apiSource = fs.readFileSync(
    path.join(ROOT, "api/cron/odds.js"),
    "utf8",
  );
  const md = /maxDuration:\s*(\d+)/.exec(apiSource);
  check(
    "api/cron/odds.js: maxDuration がレジストリ（odds.maxDurationSec）と同じ値のリテラル",
    md && Number(md[1]) === def.maxDurationSec,
    `${md?.[1]} / ${def.maxDurationSec}`,
  );
  check(
    // BOA-404（T4b-10-3）: prediction_odds の導出フックを足すため、createScrapeCronHandler の直接呼び出しから
    // createOddsCronHandlerWithPredictionOdds（内部で runScrapeJob に job="odds"・
    // createOddsSlotHandler を渡す。waitUntilは使わない）に変わった
    "api/cron/odds.js: prediction_odds の導出フック込みのハンドラー経由で job='odds'・handleSlot（waitUntil は使わない）",
    /createOddsCronHandlerWithPredictionOdds\(\)/.test(apiSource) &&
      !/waitUntil/.test(apiSource.replace(/\/\*[\s\S]*?\*\//g, "")),
  );
  const predictionOddsHandlersSource = fs.readFileSync(
    path.join(ROOT, "scripts/lib/scrapeJobs/predictionOddsHandlers.js"),
    "utf8",
  );
  check(
    "predictionOddsHandlers.js: createOddsCronHandlerWithPredictionOdds は job='odds'・createOddsSlotHandler を runScrapeJob に渡す",
    /job:\s*"odds"/.test(predictionOddsHandlersSource) &&
      /createOddsSlotHandler\(/.test(predictionOddsHandlersSource),
  );
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

printOut("");
if (failures > 0) {
  printErr(`❌ ${failures} 件の検証に失敗しました`);
  process.exit(1);
}
printOut("✅ すべての検証に成功しました");
