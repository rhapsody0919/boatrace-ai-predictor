/**
 * verify-scrape-result-job.js - 結果取得（A6）・Kファイル同期・結果のcatch-upの Vercel Cron 実装（WS4b、
 * tasks.md T4b-02・T4b-05）の検証。DBにも取得先にも接続しない（Supabaseクライアント・fetch・時計・ストアを差し替える）。
 *
 * 確認すること:
 *   (a) 解析・行の組み立て・result_digest: 実際の結果ページ（フィクスチャ）から、期待どおりの行・ダイジェストができる。
 *       result_at・DBの余分な列・スタート情報の並び順に依存しない。値が1つ違えばダイジェストも違う。未公開は null
 *   (b) runForRaces（レース単位の入口）: live は書き込む・完了済みは取得しない、shadow は取得・解析のみで一切書かない、
 *       決まり手が未公開なら partial、未公開・解析不能は no_values、取得・書き込みの失敗は error、ブレーカーは breaker_open、
 *       1件の失敗で他のレースを止めない、並列度の上限
 *   (c) 共通ラッパ経由の result: off・行なし・075未適用は何も取得せず何も書かない、shadow はデータテーブルへ書かず
 *       予定表に digest を記録する、live は書き込む、onTick は live のときだけ・claim の前、リースを失っても壊れない
 *   (d) 中止・順延の確定: 発走+90分（レジストリの窓と一致）・日付またぎの窓・結果のあるレースは確定しない・
 *       読み取り失敗は書かない・onTick の失敗は500だがスロットの処理は続ける
 *   (e) Kファイル同期: 同じ日のKファイルを1回だけダウンロード（D4）・未同期が無ければダウンロードしない・
 *       shadow（dryRun）は書かない・未公開は incomplete・失敗・0件はエラー
 *   (f) catch-up: expired（確定中止を除く）のみ再取得・live のみ確定と的中フラグの補完・未完了のスロットがあれば
 *       対象日を処理済みにしない（補足の起動がもう一度処理する）・0件エラー
 *   (g) 切り替えの仕組み: run() の skipResults・skipKFile（既定は従来どおり全て実行）、scrape-scheduled.js・
 *       ワークフローのリポジトリ変数（既定はfalse相当）
 *   (h) 設定の整合: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。最終レースの結果の許容幅が及ぶ 00:15 まで）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRaceResultRow,
  confirmCancellationsForRaceIds,
  fetchRaceResultHtml,
  isResultComplete,
  parseRaceResultHtml,
  ResultHttpError,
  run as runResultsLegacy,
  runForRaces,
  syncKFileForDate,
} from "../daily/scrape-results.js";
import { fetchKFileText, parseKFileRankings } from "../lib/kfileParser.js";
import {
  RESULT_DIGEST_COLUMNS,
  computeResultDigest,
} from "../lib/scrapeJobs/resultDigest.js";
import {
  CANCELLATION_CONFIRM_AFTER_MIN,
  addDays,
  createKFileSyncRun,
  createResultCatchupRun,
  createResultOnTick,
  createResultSlotHandler,
  overdueWindows,
  parseRaceId,
} from "../lib/scrapeJobs/resultHandlers.js";
import { compareShadowDigests } from "./check-result-shadow.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { supabase as moduleSupabase } from "../lib/supabaseClient.js";

// 検証対象のコードが出す警告・エラー・進捗のログで出力が埋まらないよう、検証中は無効にし、結果の表示だけ元の関数で行う
const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.log = () => {};
console.warn = () => {};
console.error = () => {};
// scrapeAndSaveResults 系の進捗表示（process.stdout.write）は、この検証では呼ばない

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
    new URL(`../lib/__fixtures__/raceresult/${name}`, import.meta.url),
    "utf8",
  );
const HTML_A = FIX("raceresult-2026-09-19-05-01.html"); // 桐生1R（決まり手・ST・払戻あり）
const HTML_B = FIX("raceresult-2026-09-19-17-12.html"); // 宮島12R
const HTML_NONE = FIX("raceresult-unpublished-2026-09-25-05-01.html"); // 未公開（着順テーブルなし）
const HTML_PARTIAL = HTML_A.replaceAll("決まり手", "決まりX"); // 決まり手が未公開の状態を模す

const RACE_A = "2026-09-19-05-01";
const RACE_B = "2026-09-19-17-12";
const RACE_NONE = "2026-09-19-01-01";
const URL_TO_HTML = (url) =>
  url.includes("rno=1&jcd=05&hd=20260919")
    ? HTML_A
    : url.includes("rno=12&jcd=17&hd=20260919")
      ? HTML_B
      : HTML_NONE;

// ---------------------------------------------------------------------------
// テスト用の道具: インメモリのSupabaseクライアント・fetch・時計
// ---------------------------------------------------------------------------
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * PostgRESTの、この検証に必要な部分だけを模した、インメモリのクライアント。
 * writes に、書き込みの呼び出し（upsert・update）を全て記録する。failOn に {table, op} を入れると、その書き込みが失敗する。
 */
function createFakeDb(initial = {}, { failOn = [], readError = {} } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial))
    tables[name] = clone(rows);
  const writes = [];
  const reads = [];
  const failing = (table, op) =>
    failOn.some((f) => f.table === table && f.op === op);

  const orPredicate = (expression) => {
    const parts = expression.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const value = rest.join(".");
      return (r) =>
        op === "is"
          ? value === "null"
            ? r[col] === null || r[col] === undefined
            : r[col] === value
          : op === "neq"
            ? r[col] !== value
            : op === "eq"
              ? r[col] === value
              : false;
    });
    return (r) => parts.some((f) => f(r));
  };

  function builder(table) {
    const s = {
      op: "select",
      cols: "*",
      filters: [],
      patch: null,
      rows: null,
      onConflict: null,
      limit: null,
    };
    const q = {
      select(cols) {
        s.cols = cols ?? "*";
        return q;
      },
      in(col, vals) {
        s.filters.push((r) => vals.includes(r[col]));
        return q;
      },
      eq(col, val) {
        s.filters.push((r) => r[col] === val);
        return q;
      },
      gte(col, val) {
        s.filters.push((r) => r[col] >= val);
        return q;
      },
      lt(col, val) {
        s.filters.push((r) => r[col] < val);
        return q;
      },
      is(col, val) {
        s.filters.push((r) =>
          val === null
            ? r[col] === null || r[col] === undefined
            : r[col] === val,
        );
        return q;
      },
      not(col, op, val) {
        s.filters.push((r) =>
          op === "is" && val === null
            ? r[col] !== null && r[col] !== undefined
            : true,
        );
        return q;
      },
      or(expression) {
        s.filters.push(orPredicate(expression));
        return q;
      },
      limit(n) {
        s.limit = n;
        return q;
      },
      range() {
        return q;
      },
      order() {
        return q;
      },
      upsert(rows, opts = {}) {
        s.op = "upsert";
        s.rows = rows;
        s.onConflict = opts.onConflict;
        return q;
      },
      update(patch) {
        s.op = "update";
        s.patch = patch;
        return q;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      const rows = (tables[table] ??= []);
      if (s.op === "select") {
        reads.push({ table });
        if (readError[table]) {
          return { data: null, error: { message: readError[table] } };
        }
        let out = rows.filter((r) => s.filters.every((f) => f(r)));
        if (s.limit !== null) out = out.slice(0, s.limit);
        const wanted =
          s.cols === "*" || s.cols.includes("(")
            ? null
            : s.cols.split(",").map((c) => c.trim());
        return {
          data: clone(out).map((r) =>
            wanted
              ? Object.fromEntries(
                  wanted.filter((c) => c in r).map((c) => [c, r[c]]),
                )
              : r,
          ),
          error: null,
        };
      }
      if (failing(table, s.op)) {
        writes.push({ table, op: s.op, failed: true });
        return {
          error: { message: `${table} の${s.op}が失敗しました（テスト）` },
        };
      }
      if (s.op === "upsert") {
        const keys = (s.onConflict ?? "").split(",").filter(Boolean);
        for (const row of s.rows) {
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) Object.assign(existing, clone(row));
          else rows.push(clone(row));
        }
        writes.push({ table, op: "upsert", count: s.rows.length });
        return { error: null };
      }
      if (s.op === "update") {
        const targets = rows.filter((r) => s.filters.every((f) => f(r)));
        for (const r of targets) Object.assign(r, clone(s.patch));
        writes.push({
          table,
          op: "update",
          count: targets.length,
          patch: s.patch,
        });
        return { error: null };
      }
      return { error: { message: `未対応: ${s.op}` } };
    }
    return q;
  }
  return { tables, writes, reads, from: (table) => builder(table) };
}

// runForRaces の fetchHtml（本文の文字列を返す）。呼び出したURLを calls に残す
const htmlFetcher = (map = URL_TO_HTML) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const body = map(url);
    if (body instanceof Error) throw body;
    return body;
  };
  fn.calls = calls;
  return fn;
};

// ---------------------------------------------------------------------------
// (a) 解析・行の組み立て・result_digest
// ---------------------------------------------------------------------------
const parsedA = parseRaceResultHtml(HTML_A);
const parsedB = parseRaceResultHtml(HTML_B);
const rowA = buildRaceResultRow(RACE_A, parsedA, {
  resultAt: "2026-09-19T06:00:00Z",
});
const timingsA = parsedA.startTimings.map((st) => ({ race_id: RACE_A, ...st }));

check(
  "解析: 桐生1Rの着順・決まり手・払戻・進入・STが、公式ページの表示と一致（1-6-2-3-5-4・逃げ・単勝160円）",
  rowA.rank1 === 1 &&
    rowA.rank2 === 6 &&
    rowA.rank3 === 2 &&
    rowA.rank6 === 4 &&
    rowA.winning_technique === "逃げ" &&
    rowA.payout_win === 160 &&
    rowA.payout_trio === 1480 &&
    parsedA.startTimings.length === 6 &&
    isResultComplete(rowA),
  show(rowA),
);
check(
  "解析: 未公開ページ（着順テーブルなし）は null（例外にしない）",
  parseRaceResultHtml(HTML_NONE) === null,
);
check(
  "解析: 決まり手が未公開なら、行は組み立てられるが完了ではない（payout_winはあるが winning_technique が null）",
  (() => {
    const p = parseRaceResultHtml(HTML_PARTIAL);
    const r = p && buildRaceResultRow(RACE_A, p);
    return (
      r &&
      r.payout_win === 160 &&
      r.winning_technique === null &&
      !isResultComplete(r)
    );
  })(),
);
check(
  "行の列は、ダイジェスト対象の列＋result_at と一致（列を足しても、ダイジェストから漏れない）",
  same(
    Object.keys(rowA).sort(),
    [...RESULT_DIGEST_COLUMNS, "result_at"].sort(),
  ),
  show(Object.keys(rowA).filter((c) => !RESULT_DIGEST_COLUMNS.includes(c))),
);

const digestA = computeResultDigest(rowA, timingsA);
check(
  "digest: 同じ入力で同じ値。result_at（取得時刻）が違っても同じ",
  digestA === computeResultDigest(rowA, timingsA) &&
    digestA ===
      computeResultDigest(
        { ...rowA, result_at: "2030-01-01T00:00:00Z" },
        timingsA,
      ),
  digestA,
);
{
  // DBから読んだ行（列の順序が違う・実進入コースや的中などの余分な列がある・数値がnumeric由来）でも、解析した行と同じダイジェスト
  const dbRow = {
    id: 1,
    actual_course_1: 1,
    is_cancelled: false,
    ...Object.fromEntries(
      Object.entries(rowA)
        .filter(([k]) => k !== "result_at")
        .reverse(),
    ),
    result_at: "2026-09-19T06:10:00+00:00",
  };
  const dbTimings = [...timingsA]
    .reverse()
    .map((t) => ({ ...t, updated_at: "2026-09-19T06:10:00+00:00" }));
  check(
    "digest: DBの行（列順・余分な列・スタート情報の並び順が違う）でも、解析した行と同じ値（既存基盤の書いた値と比べられる）",
    computeResultDigest(dbRow, dbTimings) === digestA,
  );
}
check(
  "digest: 払戻が1円違えば別の値",
  computeResultDigest({ ...rowA, payout_win: 161 }, timingsA) !== digestA,
);
check(
  "digest: 決まり手が違えば別の値",
  computeResultDigest({ ...rowA, winning_technique: "まくり" }, timingsA) !==
    digestA,
);
check(
  "digest: スタートタイミングが違えば別の値",
  computeResultDigest(
    rowA,
    timingsA.map((t, i) =>
      i === 0 ? { ...t, start_timing: t.start_timing + 0.01 } : t,
    ),
  ) !== digestA,
);
check(
  "digest: スタート情報が無い場合は、ある場合と別の値。艇番の重複は例外",
  computeResultDigest(rowA, []) !== digestA &&
    (() => {
      try {
        computeResultDigest(rowA, [timingsA[0], timingsA[0]]);
        return false;
      } catch {
        return true;
      }
    })(),
);
check(
  "digest: 別のレースは別の値",
  computeResultDigest(
    buildRaceResultRow(RACE_B, parsedB),
    parsedB.startTimings.map((st) => ({ race_id: RACE_B, ...st })),
  ) !== digestA,
);

// fetchRaceResultHtml: 200以外は ResultHttpError（未公開の解析失敗と区別する）
{
  let err = null;
  try {
    await fetchRaceResultHtml(
      "https://example.invalid/x",
      async () => new Response("x", { status: 503 }),
    );
  } catch (e) {
    err = e;
  }
  check(
    "fetchRaceResultHtml: 503 は ResultHttpError（status付き）。200は本文を返す",
    err instanceof ResultHttpError &&
      err.status === 503 &&
      (await fetchRaceResultHtml(
        "https://example.invalid/x",
        async () => new Response("本文", { status: 200 }),
      )) === "本文",
  );
}

{
  // shadow の集計スクリプト（check-result-shadow.js）の比較: DBの行から同じ関数で計算したダイジェストと比べる
  const dbRow = { ...rowA, id: 99, actual_course_1: 1 };
  const dbTimings = timingsA.map((t) => ({ ...t, updated_at: "2026-09-19T06:10:00+00:00" }));
  const cmp = compareShadowDigests(
    [
      { race_id: RACE_A, result_digest: digestA },
      { race_id: RACE_B, result_digest: "0000000000000000" },
      { race_id: "2026-09-19-01-01", result_digest: digestA },
      { race_id: "2026-09-19-01-02", result_digest: null },
    ],
    [dbRow, { ...buildRaceResultRow(RACE_B, parsedB) }],
    [...dbTimings, ...parsedB.startTimings.map((st) => ({ race_id: RACE_B, ...st }))],
  );
  check(
    "check-result-shadow: 一致（桐生1R）・不一致（宮島12Rは別のdigest）・DBに行なし・digest未記録を、別々に数える",
    cmp.matched === 1 &&
      cmp.mismatched.length === 1 &&
      cmp.mismatched[0].race_id === RACE_B &&
      same(cmp.missing, ["2026-09-19-01-01"]) &&
      same(cmp.noDigest, ["2026-09-19-01-02"]),
    show(cmp),
  );
  const t = JSON.parse(JSON.stringify(dbTimings));
  t[0].start_timing = 0.99;
  check(
    "check-result-shadow: DBのスタート情報が1つ違えば不一致になる（結果の行だけでなくSTも比べている）",
    compareShadowDigests([{ race_id: RACE_A, result_digest: digestA }], [dbRow], t).mismatched.length === 1,
  );
}

// ---------------------------------------------------------------------------
// (b) runForRaces
// ---------------------------------------------------------------------------
const racesA = { race_id: RACE_A, venue_code: 5, race_number: 1 };
const racesB = { race_id: RACE_B, venue_code: 17, race_number: 12 };
const racesNone = { race_id: RACE_NONE, venue_code: 1, race_number: 1 };
const DATE = "2026-09-19";
const NOW_FN = () => new Date("2026-09-19T06:00:00Z");
const baseDb = () =>
  createFakeDb({
    race_results: [],
    race_start_timings: [],
    race_conditions: [],
    races: [
      { race_id: RACE_A, start_time: "14:30:00" },
      { race_id: RACE_B, start_time: "15:00:00" },
    ],
    predictions: [
      {
        prediction_id: 1,
        race_id: RACE_A,
        model_id: "unified",
        top_pick: 1,
        top_2nd: 6,
        top_3rd: 2,
        feature_contributions: null,
        is_hit_win: null,
      },
    ],
  });

{
  // live: 書き込む
  const db = baseDb();
  const fetchHtml = htmlFetcher();
  const res = await runForRaces([racesA, racesB], {
    date: DATE,
    mode: "live",
    fetchHtml,
    client: db,
    concurrency: 2,
    now: NOW_FN,
  });
  const byId = Object.fromEntries(res.map((r) => [r.race_id, r]));
  check(
    "live: 2レースとも ok・digest付き・書き込み行数>0（結果1行＋スタート情報6行）",
    res.length === 2 &&
      byId[RACE_A].outcome === "ok" &&
      byId[RACE_B].outcome === "ok" &&
      byId[RACE_A].resultDigest === digestA &&
      byId[RACE_A].rowsWritten === 7 &&
      byId[RACE_A].rowsParsed === 1,
    show(res),
  );
  check(
    "live: race_results・race_start_timings・race_conditions（気象）へ書き込み、result_at は取得時刻",
    db.tables.race_results.length === 2 &&
      db.tables.race_start_timings.length === 12 &&
      db.tables.race_conditions.length === 2 &&
      db.tables.race_results.find((r) => r.race_id === RACE_A).result_at ===
        "2026-09-19T06:00:00.000Z",
    show(db.writes.map((w) => `${w.table}:${w.op}`)),
  );
  check(
    "live: 気象の観測時刻に、racesの発走予定時刻（14:30 JST＝05:30Z）が入る",
    db.tables.race_conditions.find((r) => r.race_id === RACE_A)
      ?.weather_observed_at === "2026-09-19T05:30:00.000Z",
    show(db.tables.race_conditions),
  );
  check(
    "live: 今回書いた結果の的中判定を更新する（予測1-6-2は単勝・3連単が的中）",
    db.tables.predictions[0].is_hit_win === true &&
      db.tables.predictions[0].is_hit_trio === true &&
      db.tables.predictions[0].payout_win === 160,
    show(db.tables.predictions[0]),
  );

  // 2回目: 完了済みは取得しない
  const fetchAgain = htmlFetcher();
  const res2 = await runForRaces([racesA, racesB], {
    date: DATE,
    mode: "live",
    fetchHtml: fetchAgain,
    client: db,
    now: NOW_FN,
  });
  check(
    "live: 完了済み（payout_win・winning_technique が揃う）は取得せず skipped_have_data",
    res2.every((r) => r.outcome === "skipped_have_data") &&
      fetchAgain.calls.length === 0,
    show(res2),
  );
  // 書き込んだ後に、同じ内容を再取得しても、書き込みは0件（変更なしは書かない）
  const writesBefore = db.writes.length;
  db.tables.race_results.find((r) => r.race_id === RACE_A).winning_technique =
    null;
  const res3 = await runForRaces([racesA], {
    date: DATE,
    mode: "live",
    fetchHtml: htmlFetcher(),
    client: db,
    now: NOW_FN,
  });
  check(
    "live: 未完了（決まり手が空）の行は再取得して、決まり手を書き込む",
    res3[0].outcome === "ok" &&
      db.tables.race_results.find((r) => r.race_id === RACE_A)
        .winning_technique === "逃げ" &&
      db.writes.length > writesBefore,
    show(res3),
  );
}

{
  // shadow: 一切書かない。完了済みでも取得してダイジェストを出す
  const db = baseDb();
  // 既存基盤が既に書いた状態にする（live で書いた行）
  await runForRaces([racesA, racesB], {
    date: DATE,
    mode: "live",
    fetchHtml: htmlFetcher(),
    client: db,
    now: NOW_FN,
  });
  const before = clone(db.tables);
  const writesBefore = db.writes.length;
  const fetcher = htmlFetcher();
  const res = await runForRaces([racesA, racesB], {
    date: DATE,
    mode: "shadow",
    fetchHtml: fetcher,
    client: db,
    concurrency: 2,
    now: NOW_FN,
  });
  check(
    "shadow: データテーブルへ一切書かない（writes 0件・全テーブルの内容が不変）",
    db.writes.length === writesBefore && same(db.tables, before),
  );
  check(
    "shadow: 完了済みのレースも取得し（2回）、digest を返す。既存基盤の行から計算した値と一致（一致率の計測ができる）",
    fetcher.calls.length === 2 &&
      res.every((r) => r.outcome === "ok" && r.rowsWritten === 0) &&
      res[0].resultDigest ===
        computeResultDigest(
          db.tables.race_results.find((r) => r.race_id === RACE_A),
          db.tables.race_start_timings.filter((r) => r.race_id === RACE_A),
        ),
    show(res),
  );
  // shadow は既存の行を読まない（完了済みの判定をしない）
  const dbShadow = baseDb();
  await runForRaces([racesA], {
    date: DATE,
    mode: "shadow",
    fetchHtml: htmlFetcher(),
    client: dbShadow,
    now: NOW_FN,
  });
  check(
    "shadow: DBを読みもしない（完了済みの判定も、発走時刻の取得もしない）",
    dbShadow.reads.length === 0 && dbShadow.writes.length === 0,
    show(dbShadow.reads),
  );
}

{
  // partial / no_values / error / breaker / 1件の失敗で他を止めない
  const db = baseDb();
  const res = await runForRaces([racesA, racesNone, racesB], {
    date: DATE,
    mode: "live",
    fetchHtml: async (url) =>
      url.includes("jcd=05")
        ? HTML_PARTIAL
        : url.includes("jcd=17")
          ? (() => {
              throw new ResultHttpError(url, 503);
            })()
          : HTML_NONE,
    client: db,
    now: NOW_FN,
  });
  const byId = Object.fromEntries(res.map((r) => [r.race_id, r]));
  check(
    "決まり手が未公開 → partial（書き込み済み・digestなし・再試行の理由付き）。未公開 → no_values（書かない）。HTTP失敗 → error。3件とも処理される",
    byId[RACE_A].outcome === "partial" &&
      byId[RACE_A].resultDigest === undefined &&
      byId[RACE_A].rowsWritten > 0 &&
      /決まり手/.test(byId[RACE_A].error) &&
      byId[RACE_NONE].outcome === "no_values" &&
      byId[RACE_NONE].rowsWritten === 0 &&
      byId[RACE_B].outcome === "error" &&
      /503/.test(byId[RACE_B].error) &&
      !db.tables.race_results.some((r) => r.race_id === RACE_NONE),
    show(res),
  );
  check(
    "partial: 着順・払戻だけでも race_results に書く（結果を早く見せる。従来と同じ）",
    db.tables.race_results.some(
      (r) =>
        r.race_id === RACE_A &&
        r.payout_win === 160 &&
        r.winning_technique === null,
    ),
  );
}
{
  const until = Date.parse("2026-09-19T06:01:00Z");
  const res = await runForRaces([racesA], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => {
      throw new BreakerOpenError("host:boatrace.jp", until);
    },
    client: baseDb(),
    now: NOW_FN,
  });
  check(
    "サーキットブレーカーが開いていれば breaker_open（retryAt＝開放期限）。「未公開」にも「失敗」にも化けさせない",
    res[0].outcome === "breaker_open" && res[0].retryAt.getTime() === until,
    show(res),
  );
}
{
  // 書き込みの失敗は error（ok にしない）
  const db = createFakeDb(
    {
      race_results: [],
      race_start_timings: [],
      race_conditions: [],
      races: [],
      predictions: [],
    },
    { failOn: [{ table: "race_results", op: "upsert" }] },
  );
  const res = await runForRaces([racesA], {
    date: DATE,
    mode: "live",
    fetchHtml: async () => HTML_A,
    client: db,
    now: NOW_FN,
  });
  check(
    "race_results の書き込みが失敗したら error（完了にしない。次の再試行で書き直す）",
    res[0].outcome === "error" &&
      /race_results/.test(res[0].error) &&
      res[0].resultDigest === undefined,
    show(res),
  );
  const dbRead = createFakeDb(
    { race_results: [] },
    { readError: { race_results: "接続断" } },
  );
  let thrown = null;
  try {
    await runForRaces([racesA], {
      date: DATE,
      mode: "live",
      fetchHtml: async () => HTML_A,
      client: dbRead,
    });
  } catch (e) {
    thrown = e;
  }
  check(
    "完了済みの確認（読み取り）が失敗したら例外（「未完了」とみなして取得・書き込みを進めない）",
    thrown && /接続断/.test(thrown.message) && dbRead.writes.length === 0,
  );
}
{
  // 並列度の上限
  let active = 0;
  let peak = 0;
  const many = Array.from({ length: 6 }, (_, i) => ({
    race_id: `2026-09-19-05-${String(i + 1).padStart(2, "0")}`,
    venue_code: 5,
    race_number: i + 1,
  }));
  await runForRaces(many, {
    date: DATE,
    mode: "shadow",
    fetchHtml: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return HTML_NONE;
    },
    concurrency: 2,
  });
  check(
    "並列度の上限: concurrency=2 で同時取得は2件まで",
    peak === 2,
    `peak=${peak}`,
  );
  let threw = false;
  try {
    await runForRaces([racesA], { date: DATE, mode: "dry" });
  } catch {
    threw = true;
  }
  check("mode が live・shadow 以外なら例外", threw);
}

// ---------------------------------------------------------------------------
// (c)(d) 共通ラッパ経由の result
// ---------------------------------------------------------------------------
const NOW_TICK = new Date("2026-09-19T05:40:00Z"); // 14:40 JST
const slotFor = (raceId, overrides = {}) => ({
  job: "result",
  race_id: raceId,
  offset_min: 5,
  race_date: "2026-09-19",
  status: "running",
  attempts: 1,
  last_attempt_at: NOW_TICK.toISOString(),
  lease_until: "2026-09-19T06:40:00Z",
  ...overrides,
});
const politeFor = (map = URL_TO_HTML) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return new Response(map(url), { status: 200 });
  };
  fn.calls = calls;
  return fn;
};

async function runResultJob({
  mode,
  slots = [],
  db = baseDb(),
  rows,
  polite = politeFor(),
  onTick,
  storeOverrides = {},
  available = true,
}) {
  const store = createMemoryStore({
    available,
    rows: rows ?? (mode ? { result: { job: "result", mode } } : {}),
    slots,
  });
  Object.assign(store, storeOverrides);
  const events = [];
  const origClaim = store.claimSlots.bind(store);
  store.claimSlots = async (a) => {
    events.push("claim");
    return origClaim(a);
  };
  const res = await runScrapeJob({
    job: "result",
    store,
    handleSlot: createResultSlotHandler(),
    onTick:
      onTick ??
      (async (ctx) => {
        events.push("tick");
        return createResultOnTick({
          confirm: async () => ({ checked: 0, confirmed: [] }),
        })(ctx);
      }),
    now: () => NOW_TICK,
    worker: "test-worker",
    client: db,
    politeFetch: polite,
  });
  return { res, store, db, polite, events };
}

{
  // off・行なし・075未適用: 何も取得せず何も書かない
  for (const [label, opts] of [
    ["mode=off", { mode: "off", slots: [slotFor(RACE_A)] }],
    ["scrape_job_state に行なし", { mode: null, slots: [slotFor(RACE_A)] }],
    [
      "予定表（075）が未適用",
      { mode: "live", slots: [slotFor(RACE_A)], available: false },
    ],
  ]) {
    const r = await runResultJob(opts);
    const names = r.store.calls.map((c) => c.name);
    check(
      `${label}: 取得0回・データテーブルへの書き込み0件・claimもしない・200（マージしても本番の挙動は変わらない）`,
      r.res.status === 200 &&
        r.polite.calls.length === 0 &&
        r.db.writes.length === 0 &&
        r.db.reads.length === 0 &&
        !names.includes("claimSlots") &&
        !names.includes("ensureSlots") &&
        !names.includes("completeSlot") &&
        !names.includes("touchTick") &&
        r.events.length === 0,
      show({
        body: r.res.body,
        names,
        writes: r.db.writes,
        fetched: r.polite.calls,
      }),
    );
    if (label === "scrape_job_state に行なし") {
      check(
        `${label}: 書くのは、mode=off の行を1つ作る（ensureRow）ことだけ。modeは変更しない`,
        names.filter((n) => n !== "readState").join() === "ensureRow" &&
          r.store.state.get("result").mode === "off",
        show(names),
      );
    }
  }
}
{
  // shadow: 取得・解析のみ。予定表に digest を記録。データテーブルへは書かない。onTick も呼ばない
  const r = await runResultJob({
    mode: "shadow",
    slots: [slotFor(RACE_A), slotFor(RACE_B)],
  });
  check(
    "shadow: 2スロットが ok で完了し、result_digest が記録される（既存基盤の行から計算した値と比べられる形）",
    r.res.status === 200 &&
      r.store.completed.length === 2 &&
      r.store.completed.every(
        (c) => c.outcome === "ok" && /^[0-9a-f]{16}$/.test(c.resultDigest),
      ) &&
      r.store.completed.find((c) => c.slot.race_id === RACE_A).resultDigest ===
        digestA,
    show(r.res.body),
  );
  check(
    "shadow: データテーブルへの書き込み0件（DBを読みもしない）・onTick（races への書き込み）は呼ばない",
    r.db.writes.length === 0 &&
      r.db.reads.length === 0 &&
      !r.events.includes("tick"),
    show({ writes: r.db.writes, events: r.events }),
  );
  check(
    "shadow: 取得は politeFetch 経由（2件）。run_mode は shadow で claim される",
    r.polite.calls.length === 2 &&
      r.store.calls.find((c) => c.name === "claimSlots").mode === "shadow",
  );
}
{
  // live: 書き込む。onTick は claim の前
  const r = await runResultJob({ mode: "live", slots: [slotFor(RACE_A)] });
  check(
    "live: ok で完了・データテーブルへ書き込む。書き込み行数が予定表に記録される",
    r.res.status === 200 &&
      r.store.completed.length === 1 &&
      r.store.completed[0].outcome === "ok" &&
      r.store.completed[0].rowsWritten === 7 &&
      r.db.tables.race_results.length === 1,
    show(r.res.body),
  );
  check(
    "live: onTick（中止・順延の確定）は claim（スロットの取得）より前に呼ばれる（確定が先＝中止のレースが expired にならない）",
    r.events.join() === "tick,claim",
    r.events.join(),
  );
}
{
  // partial / no_values → 完了にせず再試行（retrySlot）。error だけなら500
  const partial = await runResultJob({
    mode: "live",
    slots: [slotFor(RACE_A)],
    polite: politeFor(() => HTML_PARTIAL),
  });
  check(
    "live・決まり手が未公開: 完了にせず、再試行（pending に戻す）。理由が last_error に入る",
    partial.store.completed.length === 0 &&
      partial.store.retried.length === 1 &&
      /決まり手/.test(partial.store.retried[0].error) &&
      partial.store.retried[0].outcome === "partial",
    show(partial.store.retried),
  );
  const none = await runResultJob({
    mode: "live",
    slots: [slotFor(RACE_NONE)],
    polite: politeFor(() => HTML_NONE),
  });
  check(
    "live・未公開（no_values）: 再試行。書き込みなし。0件を成功にしない（完了にしない）",
    none.store.completed.length === 0 &&
      none.store.retried[0].outcome === "no_values" &&
      none.db.writes.length === 0 &&
      none.res.status === 200,
    show(none.res.body),
  );
  const allErr = await runResultJob({
    mode: "live",
    slots: [slotFor(RACE_A)],
    polite: async () => new Response("x", { status: 503 }),
  });
  check(
    "live・全スロットが取得失敗（HTTP 503）: 500・連続失敗を記録・スロットは再試行",
    allErr.res.status === 500 &&
      allErr.store.retried.length === 1 &&
      allErr.store.calls.some((c) => c.name === "recordFailure"),
    show(allErr.res.body),
  );
  const lost = await runResultJob({
    mode: "live",
    slots: [slotFor(RACE_A)],
    storeOverrides: { completeSlot: async () => false },
  });
  check(
    "リースを奪われていた（completeSlot が false）: 例外にも失敗にもせず、200（データ側は冪等な書き込み済みで無害。二重完了しない）",
    lost.res.status === 200 &&
      !lost.store.calls.some((c) => c.name === "recordFailure"),
    show(lost.res.body),
  );
}

// 中止・順延の確定
check(
  "確定の基準: 結果のスロットの期限+許容幅（発走+5分+85分）が、中止・順延の確定の基準（発走+90分）と一致する",
  SCRAPE_JOBS.result.offsets[0] + SCRAPE_JOBS.result.graceMin ===
    CANCELLATION_CONFIRM_AFTER_MIN,
);
{
  // overdueWindows: 発走 < now-90分（排他）、15分の範囲
  const w = overdueWindows(new Date("2026-09-19T05:40:00Z")); // 14:40 JST → 発走13:10未満・12:55以上
  check(
    "overdueWindows: 14:40 JST → 発走 12:55:00〜13:10:00（未満）の1範囲",
    same(w, [{ date: "2026-09-19", from: "12:55:00", to: "13:10:00" }]),
    show(w),
  );
  const w2 = overdueWindows(new Date("2026-09-19T15:16:00Z")); // 00:16 JST（翌日）→ 前日22:31〜22:46
  check(
    "overdueWindows: 翌 00:16 JST → 前日（2026-09-19）の発走 22:31:00〜22:46:00（未満）。最終レース22:45発走が入る（日付をまたいでも拾う）",
    same(w2, [{ date: "2026-09-19", from: "22:31:00", to: "22:46:00" }]) &&
      "22:45:00" >= w2[0].from &&
      "22:45:00" < w2[0].to,
    show(w2),
  );
  const wExact = overdueWindows(new Date("2026-09-19T15:15:00Z")); // 00:15:00 ちょうど: 22:45発走は「90分ちょうど」で、まだ超えていない
  check(
    "overdueWindows: 22:45発走のレースは、翌 00:15:00 ちょうどでは対象外（発走+90分を「超えた」後＝排他）",
    !("22:45:00" < wExact[0].to),
    show(wExact),
  );
  const wCross = overdueWindows(new Date("2026-09-19T16:40:00Z")); // 01:40 JST → 前日23:55〜（終日）と当日 00:00〜00:10
  check(
    "overdueWindows: 日付をまたぐ範囲は、前日の終わりまでと当日の 00:00 からの2つに分ける",
    same(wCross, [
      { date: "2026-09-19", from: "23:55:00", to: null },
      { date: "2026-09-20", from: "00:00:00", to: "00:10:00" },
    ]),
    show(wCross),
  );
}
{
  // onTick: 発走時刻の範囲のレースを問い合わせ、確定の処理へ渡す
  const db = createFakeDb({
    races: [
      {
        race_id: "A",
        race_date: "2026-09-19",
        start_time: "12:56:00",
        cancellation_status: null,
      },
      {
        race_id: "B",
        race_date: "2026-09-19",
        start_time: "13:09:00",
        cancellation_status: null,
      },
      {
        race_id: "C",
        race_date: "2026-09-19",
        start_time: "13:10:00",
        cancellation_status: null,
      }, // 上限（排他）
      {
        race_id: "D",
        race_date: "2026-09-19",
        start_time: "12:50:00",
        cancellation_status: null,
      }, // 範囲外（古い）
      {
        race_id: "E",
        race_date: "2026-09-19",
        start_time: "13:00:00",
        cancellation_status: "confirmed",
      }, // 確定済み
      {
        race_id: "F",
        race_date: "2026-09-18",
        start_time: "13:00:00",
        cancellation_status: null,
      }, // 別の日
    ],
  });
  const seen = [];
  const tick = await createResultOnTick({
    confirm: async (client, ids) => {
      seen.push(ids);
      return { checked: ids.length, confirmed: ["A"] };
    },
  })({ client: db, now: () => NOW_TICK });
  check(
    "onTick: 発走 12:55〜13:10（未満）・未確定・当日のレースだけを、確定の処理に渡す",
    same(seen, [["A", "B"]]) && same(tick, { overdue: 2, confirmed: 1 }),
    show({ seen, tick }),
  );
  check(
    "onTick: 書き込みは自分ではしない（確定は confirm 経由）",
    db.writes.length === 0,
  );
}
{
  // confirmCancellationsForRaceIds: 結果のあるレースは確定しない。読み取り失敗は書かない
  const mk = (extra = {}) =>
    createFakeDb(
      {
        race_results: [{ race_id: "R1" }],
        races: [
          { race_id: "R1", cancellation_status: null },
          { race_id: "R2", cancellation_status: null },
          { race_id: "R3", cancellation_status: "confirmed" },
        ],
      },
      extra,
    );
  const db = mk();
  const r = await confirmCancellationsForRaceIds(db, ["R1", "R2", "R3"]);
  check(
    "確定: 結果のあるレース（R1）・確定済み（R3）は対象外、結果の無い R2 だけを confirmed にする",
    same(r.confirmed, ["R2"]) &&
      db.tables.races.find((x) => x.race_id === "R2").cancellation_status ===
        "confirmed" &&
      db.tables.races.find((x) => x.race_id === "R1").cancellation_status ===
        null,
    show(r),
  );
  const bad = mk({ readError: { race_results: "接続断" } });
  let err = null;
  try {
    await confirmCancellationsForRaceIds(bad, ["R1", "R2"]);
  } catch (e) {
    err = e;
  }
  check(
    "確定: race_results の読み取りに失敗したら例外・書き込みなし（結果の有無が分からないまま、結果のあるレースを中止にしない）",
    err && /race_results/.test(err.message) && bad.writes.length === 0,
  );
}
{
  // onTick の失敗: 500・失敗を記録・でもスロットの処理は続ける
  const r = await runResultJob({
    mode: "live",
    slots: [slotFor(RACE_A)],
    onTick: async () => {
      throw new Error("確定に失敗（テスト）");
    },
  });
  check(
    "onTick が失敗: 500・失敗を記録。ただしスロットの処理（取得・書き込み・完了）は続ける",
    r.res.status === 500 &&
      /確定に失敗/.test(r.res.body.tickError) &&
      r.store.completed.length === 1 &&
      r.store.calls.some((c) => c.name === "recordFailure"),
    show(r.res.body),
  );
}

// ---------------------------------------------------------------------------
// (e) Kファイル同期
// ---------------------------------------------------------------------------
const K_TEXT = fs.readFileSync(
  new URL("../lib/__fixtures__/kfile/k260911.txt", import.meta.url),
  "utf8",
);
const K_DATE = "2026-09-11";
const kRows = parseKFileRankings(K_TEXT, K_DATE).filter((r) => r.valid);
const kDb = () =>
  createFakeDb({
    race_results: kRows.map((r) => ({
      race_id: r.race_id,
      rank1: r.rank1,
      rank2: r.rank2,
      rank3: r.rank3,
      rank4: null,
      rank5: null,
      rank6: null,
      actual_course_1: null,
      actual_course_2: null,
      actual_course_3: null,
      actual_course_4: null,
      actual_course_5: null,
      actual_course_6: null,
    })),
  });
{
  const db = kDb();
  let downloads = 0;
  const fetchText = async () => {
    downloads++;
    return K_TEXT;
  };
  const r = await syncKFileForDate(K_DATE, { client: db, fetchText });
  check(
    "Kファイル: 進入コースとrank4〜6の両方が未同期でも、同じ日のKファイルのダウンロードは1回（D4の解消）",
    downloads === 1 && r.downloads === 1,
    `downloads=${downloads}`,
  );
  const filled = db.tables.race_results.filter(
    (x) => x.actual_course_1 !== null || x.actual_course_2 !== null,
  ).length;
  check(
    "Kファイル: 進入コース・rank4〜6が書き込まれる（status=synced、更新件数>0）",
    r.actualCourse.status === "synced" &&
      r.rank456.status === "synced" &&
      r.actualCourse.updated > 100 &&
      r.rank456.updated > 100 &&
      filled > 100 &&
      db.tables.race_results.some((x) => x.rank4 !== null),
    show({ a: r.actualCourse, k: r.rank456 }),
  );
  const writes = db.writes.length;
  const again = await syncKFileForDate(K_DATE, { client: db, fetchText });
  check(
    "Kファイル: 同期済みの日は、ダウンロードも書き込みもしない（nothing_pending・BOA-349の維持）",
    again.downloads === 0 &&
      downloads === 1 &&
      db.writes.length === writes &&
      again.actualCourse.status === "nothing_pending" &&
      again.rank456.status === "nothing_pending",
    show(again),
  );
}
{
  // rank4〜6だけが未同期でも、ダウンロードは1回。dryRun は書かない
  const db = kDb();
  for (const row of db.tables.race_results) {
    Object.assign(row, { actual_course_1: 1 }); // 進入コースは同期済み
  }
  let downloads = 0;
  const dry = await syncKFileForDate(K_DATE, {
    client: db,
    dryRun: true,
    fetchText: async () => {
      downloads++;
      return K_TEXT;
    },
  });
  check(
    "Kファイル: dryRun（shadow）は取得・解析して書くはずの件数を数えるが、書き込みは0件",
    downloads === 1 &&
      db.writes.length === 0 &&
      dry.actualCourse.status === "nothing_pending" &&
      dry.rank456.updated > 100 &&
      db.tables.race_results.every((x) => x.rank4 === null),
    show(dry),
  );
  const unavailable = await syncKFileForDate(K_DATE, {
    client: kDb(),
    fetchText: async () => null,
  });
  check(
    "Kファイル: 未同期のレースがあるのにKファイルが未公開（null）→ kfile_unavailable",
    unavailable.actualCourse.status === "kfile_unavailable" &&
      unavailable.rank456.status === "kfile_unavailable",
  );
  const failed = await syncKFileForDate(K_DATE, {
    client: kDb(),
    fetchText: async () => {
      throw new Error("HTTP 500");
    },
  });
  check(
    "Kファイル: ダウンロード失敗 → kfile_error（理由付き）。2つの同期で同じ失敗を共有し、ダウンロードの試行は1回",
    failed.actualCourse.status === "kfile_error" &&
      failed.rank456.status === "kfile_error" &&
      failed.downloads === 1 &&
      /HTTP 500/.test(failed.actualCourse.error),
  );
  // fetchKFileText は fetchImpl を受け取る（politeFetch を通せる）
  let calledUrl = null;
  const none = await fetchKFileText("2026-09-11", {
    fetchImpl: async (url) => {
      calledUrl = url;
      return new Response(null, { status: 404 });
    },
  });
  let err = null;
  try {
    await fetchKFileText("2026-09-11", {
      fetchImpl: async () => new Response("x", { status: 500 }),
    });
  } catch (e) {
    err = e;
  }
  check(
    "fetchKFileText: fetchImpl を差し替えられる（404 → null、500 → 例外）。URLは www1.mbrace.or.jp の k260911.lzh",
    none === null &&
      err &&
      /500/.test(err.message) &&
      /mbrace\.or\.jp\/od2\/K\/202609\/k260911\.lzh/.test(calledUrl),
    String(calledUrl),
  );
}
{
  // createKFileSyncRun
  const calls = [];
  const mk = (per) => async (date, opts) => {
    calls.push({ date, ...opts });
    const r = per(date);
    return {
      date,
      downloads: 1,
      actualCourse: { updated: 0, ...r },
      rank456: { updated: 0, pending: 0, ...r },
    };
  };
  const ctx = (mode) => ({
    targetDate: "2026-09-19",
    mode,
    client: {},
    politeFetch: () => {},
  });
  const ok = await createKFileSyncRun({
    syncDate: mk(() => ({ status: "nothing_pending" })),
  })(ctx("live"));
  check(
    "kfile-sync: 当日を除く直近4日（9/18・17・16・15）を、新しい日から処理。全て同期済みなら成功・書き込み0件・完了",
    same(
      calls.map((c) => c.date),
      ["2026-09-18", "2026-09-17", "2026-09-16", "2026-09-15"],
    ) &&
      ok.rowsWritten === 0 &&
      ok.incomplete === false &&
      !ok.outcome,
    show(calls.map((c) => c.date)),
  );
  check(
    "kfile-sync: live は dryRun=false・shadow は dryRun=true。politeFetch を fetchImpl として渡す",
    calls.every(
      (c) => c.dryRun === false && typeof c.fetchImpl === "function",
    ) &&
      ((calls.length = 0),
      await createKFileSyncRun({
        syncDate: mk(() => ({ status: "nothing_pending" })),
      })(ctx("shadow")),
      calls.every((c) => c.dryRun === true)),
  );
  const unpub = await createKFileSyncRun({
    syncDate: mk((d) => ({
      status: d === "2026-09-18" ? "kfile_unavailable" : "nothing_pending",
    })),
  })(ctx("live"));
  check(
    "kfile-sync: 未同期があるのにKファイル未公開 → 成功だが incomplete（対象日を処理済みにせず、12:00の補足が再処理）。エラーにはしない",
    unpub.incomplete === true &&
      !unpub.outcome &&
      same(unpub.report.unpublished, ["2026-09-18"]),
    show(unpub),
  );
  const bad = await createKFileSyncRun({
    syncDate: mk((d) =>
      d === "2026-09-17"
        ? { status: "kfile_error", error: "HTTP 500" }
        : { status: "nothing_pending" },
    ),
  })(ctx("live"));
  check(
    "kfile-sync: ダウンロード失敗は outcome=error（理由付き）。他の日の処理は済んでいる",
    bad.outcome === "error" &&
      /2026-09-17/.test(bad.error) &&
      /HTTP 500/.test(bad.error) &&
      bad.report.days.length === 4,
    show(bad),
  );
  const zero = await createKFileSyncRun({
    syncDate: mk(() => ({ status: "no_races_parsed" })),
  })(ctx("live"));
  check(
    "kfile-sync: Kファイルをダウンロードできたのにレースを1件も抽出できない（形式の変更）→ 0件エラー（error）",
    zero.outcome === "error" && /抽出できません/.test(zero.error),
    show(zero),
  );
  {
    // probe: 任意の日のKファイルをダウンロード・展開・解析して件数を返すだけ（書き込み・同期なし）
    const before = calls.length;
    let asked = null;
    const probeRun = createKFileSyncRun({
      syncDate: mk(() => ({ status: "nothing_pending" })),
      fetchText: async (date, opts) => {
        asked = { date, hasFetchImpl: typeof opts.fetchImpl === "function" };
        return K_TEXT;
      },
    });
    const probeDb = kDb();
    const p = await probeRun({ ...ctx("shadow"), client: probeDb, query: { probeDate: K_DATE } });
    check(
      "kfile-sync probe: ?probeDate= の日のKファイルを politeFetch でダウンロード・解析し、レース数を返す。同期は呼ばず、書き込みなし・対象日は処理済みにしない",
      asked?.date === K_DATE &&
        asked.hasFetchImpl &&
        p.body.probe.downloaded === true &&
        p.body.probe.races === parseKFileRankings(K_TEXT, K_DATE).length &&
        p.body.probe.races > 100 &&
        p.incomplete === true &&
        p.rowsWritten === 0 &&
        calls.length === before &&
        probeDb.writes.length === 0,
      show(p),
    );
    let bad = null;
    try {
      await probeRun({ ...ctx("shadow"), query: { probeDate: "2026-9-1" } });
    } catch (e) {
      bad = e;
    }
    check("kfile-sync probe: 日付の形式が不正なら例外（ダウンロードしない）", bad !== null);
  }
  // ラッパ経由: 対象日の冪等（完了したら12:00は何もしない・incompleteなら12:00がもう一度処理する）
  const run = createKFileSyncRun({
    syncDate: mk((d) => ({
      status: d === "2026-09-18" ? "kfile_unavailable" : "nothing_pending",
    })),
  });
  const store = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "live" } },
  });
  const at = (iso) => ({
    job: "kfile_sync",
    store,
    run,
    now: () => new Date(iso),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  const r1 = await runScrapeJob(at("2026-09-18T22:00:00Z")); // 07:00 JST 9/19
  const after1 = store.state.get("kfile_sync").last_target_date;
  const callsBefore = calls.length;
  const r2 = await runScrapeJob(at("2026-09-19T03:00:00Z")); // 12:00 JST
  check(
    "kfile-sync（ラッパ経由）: 未公開で incomplete だった 07:00 の実行は対象日を処理済みにせず、12:00 の実行がもう一度処理する",
    r1.status === 200 &&
      after1 === undefined &&
      r2.body.skipped !== "already_done" &&
      calls.length > callsBefore,
    show({ r1: r1.body, after1, r2: r2.body }),
  );
  const store2 = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "live" } },
  });
  const okRun = createKFileSyncRun({
    syncDate: mk(() => ({ status: "nothing_pending" })),
  });
  const cfg = (iso) => ({
    job: "kfile_sync",
    store: store2,
    run: okRun,
    now: () => new Date(iso),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  await runScrapeJob(cfg("2026-09-18T22:00:00Z"));
  const c0 = calls.length;
  const again = await runScrapeJob(cfg("2026-09-19T03:00:00Z"));
  check(
    "kfile-sync（ラッパ経由）: 07:00 で完了していれば、12:00 は already_done で何もしない（last_target_date）",
    store2.state.get("kfile_sync").last_target_date === "2026-09-19" &&
      again.body.skipped === "already_done" &&
      calls.length === c0,
    show(again.body),
  );
  const off = createMemoryStore({
    rows: { kfile_sync: { job: "kfile_sync", mode: "off" } },
  });
  const c1 = calls.length;
  const offRes = await runScrapeJob({
    job: "kfile_sync",
    store: off,
    run: okRun,
    now: () => new Date("2026-09-18T22:00:00Z"),
    client: {},
    politeFetch: () => {},
    worker: "w",
  });
  check(
    "kfile-sync（ラッパ経由）: mode=off は何もしない（同期の呼び出し0回）",
    offRes.body.skipped === "mode_off" && calls.length === c1,
  );
}

// ---------------------------------------------------------------------------
// (f) catch-up
// ---------------------------------------------------------------------------
const catchupDb = (extra = {}) =>
  createFakeDb({
    scrape_slots: [
      {
        job: "result",
        race_id: RACE_A,
        race_date: DATE,
        status: "expired",
        races: { cancellation_status: null },
      },
      {
        job: "result",
        race_id: RACE_B,
        race_date: DATE,
        status: "expired",
        races: { cancellation_status: "confirmed" },
      },
      {
        job: "result",
        race_id: "2026-09-19-05-02",
        race_date: DATE,
        status: "done",
        races: { cancellation_status: null },
      },
      {
        job: "result",
        race_id: "2026-09-18-05-01",
        race_date: "2026-09-18",
        status: "expired",
        races: { cancellation_status: null },
      },
      ...(extra.openSlots ?? []),
    ],
    race_results: [],
    race_start_timings: [],
    race_conditions: [],
    races: [
      {
        race_id: RACE_A,
        race_date: DATE,
        start_time: "14:30:00",
        cancellation_status: null,
      },
      {
        race_id: RACE_B,
        race_date: DATE,
        start_time: "15:00:00",
        cancellation_status: "confirmed",
      },
      {
        race_id: "2026-09-19-01-12",
        race_date: DATE,
        start_time: "20:00:00",
        cancellation_status: null,
      },
      {
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        start_time: "22:45:00",
        cancellation_status: null,
      },
    ],
    predictions: [],
  });
const catchupCtx = (
  db,
  { mode = "live", iso = "2026-09-19T14:50:00Z", polite = politeFor() } = {},
) => ({
  targetDate: DATE,
  mode,
  client: db,
  politeFetch: polite,
  now: () => new Date(iso),
});
{
  const spyConfirm = [];
  const spyHits = [];
  const runner = createResultCatchupRun({
    confirm: async (client, ids) => {
      spyConfirm.push(ids);
      return { checked: ids.length, confirmed: ids.slice(0, 1) };
    },
    fixHitFlags: async (from, to) => {
      spyHits.push([from, to]);
      return { missing: 0, fixed: 0 };
    },
  });
  const db = catchupDb();
  const polite = politeFor();
  const r = await runner(catchupCtx(db, { polite }));
  check(
    "catch-up: 対象日の expired のうち、確定中止・他の日を除く1件（桐生1R）だけを再取得し、live なので書き込む",
    polite.calls.length === 1 &&
      polite.calls[0].includes("jcd=05") &&
      r.rowsExpected === 1 &&
      r.rowsParsed === 1 &&
      r.rowsWritten === 7 &&
      db.tables.race_results.length === 1,
    show(r.report),
  );
  check(
    "catch-up: live は、発走+90分を超えた未確定のレース（23:50時点で 14:30・20:00 発走。22:45 は対象外）を確定の処理に渡し、的中フラグを直近10日（9/10〜9/19）で補完する",
    same(spyConfirm, [[RACE_A, "2026-09-19-01-12"]]) &&
      same(spyHits, [["2026-09-10", "2026-09-19"]]),
    show({ spyConfirm, spyHits }),
  );
  check(
    "catch-up: 対象日の結果のスロットに未完了（pending・running）が無ければ、incomplete でない",
    r.incomplete === false,
  );
  const db2 = catchupDb({
    openSlots: [
      {
        job: "result",
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        status: "pending",
        races: { cancellation_status: null },
      },
    ],
  });
  const r2 = await runner(catchupCtx(db2));
  check(
    "catch-up: 未完了のスロット（最終レース。期限は翌00:15）があれば incomplete（対象日を処理済みにしない）",
    r2.incomplete === true && r2.report.openSlots === 1,
  );
  // shadow: 取得・解析のみ。確定・的中フラグの補完・書き込みをしない
  spyConfirm.length = 0;
  spyHits.length = 0;
  const dbS = catchupDb();
  const rs = await runner(catchupCtx(dbS, { mode: "shadow" }));
  check(
    "catch-up shadow: 再取得は取得・解析のみ。データテーブルへ書かず、確定・的中フラグの補完も呼ばない",
    dbS.writes.length === 0 &&
      spyConfirm.length === 0 &&
      spyHits.length === 0 &&
      rs.rowsWritten === 0 &&
      rs.rowsParsed === 1,
    show({ writes: dbS.writes, confirm: spyConfirm }),
  );
  // 0件エラー: 再取得の対象があるのに、1件も取得・解析できない
  const dbZ = catchupDb();
  const rz = await runner(
    catchupCtx(dbZ, { polite: politeFor(() => HTML_NONE) }),
  );
  const store = createMemoryStore({
    rows: { result_catchup: { job: "result_catchup", mode: "live" } },
  });
  const wrapped = await runScrapeJob({
    job: "result_catchup",
    store,
    run: async () => rz,
    now: () => new Date("2026-09-19T14:50:00Z"),
    client: dbZ,
    politeFetch: () => {},
    worker: "w",
  });
  check(
    "catch-up: 再取得の対象があるのに1件も取得・解析できない → 0件エラー（500・連続失敗・対象日を処理済みにしない）",
    wrapped.status === 500 &&
      /0件/.test(wrapped.body.error) &&
      store.state.get("result_catchup").last_target_date === undefined &&
      store.state.get("result_catchup").consecutive_failures === 1,
    show(wrapped.body),
  );
  // 対象が0件なら、0件エラーにしない
  const dbE = createFakeDb({ scrape_slots: [], races: [], race_results: [] });
  const re = await runner(catchupCtx(dbE));
  check(
    "catch-up: 再取得の対象が0件でも、エラーにしない（正常な日）",
    re.rowsExpected === 0 && !re.outcome,
  );
  // ラッパ経由の対象日の冪等: 23:50（未完了）→ 00:30（完了）→ 以降は already_done
  const dbW = catchupDb({
    openSlots: [
      {
        job: "result",
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        status: "pending",
        races: { cancellation_status: null },
      },
    ],
  });
  const storeW = createMemoryStore({
    rows: { result_catchup: { job: "result_catchup", mode: "live" } },
  });
  const runW = (iso) =>
    runScrapeJob({
      job: "result_catchup",
      store: storeW,
      run: runner,
      now: () => new Date(iso),
      client: dbW,
      politeFetch: politeFor(),
      worker: "w",
    });
  const w1 = await runW("2026-09-19T14:50:00Z"); // 23:50 JST
  const t1 = storeW.state.get("result_catchup").last_target_date;
  // 最終レースの期限が過ぎた（スロットが expired になった）状態にして、00:30 JST に再実行
  dbW.tables.scrape_slots.find((s) => s.race_id === "2026-09-19-01-11").status =
    "expired";
  const w2 = await runW("2026-09-19T15:30:00Z"); // 00:30 JST（翌日）。対象日は前日のまま
  const t2 = storeW.state.get("result_catchup").last_target_date;
  const w3 = await runW("2026-09-19T15:50:00Z");
  check(
    "catch-up（ラッパ経由）: 23:50 は未完了のため対象日を処理済みにせず、00:30（対象日は前日のまま）に完了し、その後は already_done",
    w1.status === 200 &&
      w1.body.incomplete === true &&
      t1 === undefined &&
      w2.body.targetDate === DATE &&
      t2 === DATE &&
      w3.body.skipped === "already_done",
    show({ w1: w1.body, t1, w2: w2.body, t2, w3: w3.body }),
  );
}

// ---------------------------------------------------------------------------
// 共通ラッパの追加機能（onTick・incomplete）が、既存の動作を変えない
// ---------------------------------------------------------------------------
{
  // onTick を渡さないジョブ（pseudo）は、従来どおり
  const store = createMemoryStore({
    rows: { pseudo: { job: "pseudo", mode: "live" } },
    slots: [slotFor("2026-09-19-05-01", { job: "pseudo", offset_min: -60 })],
  });
  const res = await runScrapeJob({
    job: "pseudo",
    store,
    handleSlot: async () => ({ outcome: "ok", rowsWritten: 0 }),
    now: () => NOW_TICK,
    worker: "w",
  });
  check(
    "onTick なしのジョブは従来どおり（tick の情報が応答に出ない・200・完了）",
    res.status === 200 && !("tick" in res.body) && store.completed.length === 1,
    show(res.body),
  );
}

// ---------------------------------------------------------------------------
// (g) 切り替えの仕組み
// ---------------------------------------------------------------------------
{
  const scheduled = fs.readFileSync(
    path.join(ROOT, "scripts/daily/scrape-scheduled.js"),
    "utf8",
  );
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/scrape-scheduled.yml"),
    "utf8",
  );
  check(
    'scrape-scheduled.js: SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA は、文字列 "true" のときだけ有効（未設定・空・falseは従来どおり全て実行）',
    // 変数が true のときだけ、対象のレースがあるときに、Vercel が健全かを確認する（フェイルセーフ付きSKIP）。
    // 未設定・空・falseなら false（DBを読まない）
    /const skipResults =\s*process\.env\.SKIP_RESULTS_ON_GHA === "true" &&\s*\(!resultsDue \|\| \(await gateSkips\("SKIP_RESULTS_ON_GHA"\)\)\);/.test(
      scheduled,
    ) &&
      /const skipKFile =\s*process\.env\.SKIP_KFILE_ON_GHA === "true" &&\s*\(!resultsDue \|\| \(await gateSkips\("SKIP_KFILE_ON_GHA"\)\)\);/.test(
        scheduled,
      ),
  );
  check(
    "scrape-scheduled.js: 結果取得とKファイル同期の両方を止めた場合だけ、run() を呼ばない。片方だけならフラグを渡す",
    /finishedRaces\.length > 0 && !\(skipResults && skipKFile\)/.test(
      scheduled,
    ) &&
      /runResults\(schedule, date, \{\s*skipResults,\s*skipKFile,?\s*\}\)/.test(
        scheduled,
      ),
  );
  check(
    "scrape-scheduled.yml: リポジトリ変数 SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA を、オーケストレーターのステップに渡す（設定していなければ空＝従来どおり）",
    /SKIP_RESULTS_ON_GHA: \$\{\{ vars\.SKIP_RESULTS_ON_GHA \}\}/.test(
      workflow,
    ) &&
      /SKIP_KFILE_ON_GHA: \$\{\{ vars\.SKIP_KFILE_ON_GHA \}\}/.test(workflow) &&
      /SKIP_EXHIBITION_ON_GHA: \$\{\{ vars\.SKIP_EXHIBITION_ON_GHA \}\}/.test(
        workflow,
      ),
  );
  // run() の既定は「全て実行」。module の supabase が無い環境でだけ、呼び出しの有無で確認する
  if (moduleSupabase === null) {
    const outcome = async (opts) => {
      try {
        await runResultsLegacy([], DATE, opts);
        return "resolved";
      } catch {
        return "rejected";
      }
    };
    const both = await outcome({ skipResults: true, skipKFile: true });
    const kfileOnly = await outcome({ skipResults: true });
    const resultsOnly = await outcome({ skipKFile: true });
    const def = await outcome(undefined);
    check(
      "run(): 両方スキップは何もしない。Kファイルだけ動かす（DBが無いので失敗する＝呼んだ）。結果だけ動かす（対象0件で正常）。既定（引数なし）はKファイル同期も呼ぶ＝従来どおり",
      both === "resolved" &&
        kfileOnly === "rejected" &&
        resultsOnly === "resolved" &&
        def === "rejected",
      show({ both, kfileOnly, resultsOnly, def }),
    );
  } else {
    printOut(
      "SKIP: run() の既定の確認（この環境では Supabase が設定されているため、DBに触れる呼び出しを避ける）",
    );
  }
}

// ---------------------------------------------------------------------------
// (h) 設定の整合
// ---------------------------------------------------------------------------
{
  check(
    "レジストリの整合性の検査（validateRegistry）が空",
    validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons ?? [];
  const expand = (field, max) => {
    const out = new Set();
    for (const part of field.split(",")) {
      const [range, step] = part.split("/");
      const [lo, hi] =
        range === "*"
          ? [0, max]
          : range.includes("-")
            ? range.split("-").map(Number)
            : [Number(range), step ? max : Number(range)];
      for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.add(v);
    }
    return out;
  };
  // cron式（UTC）→ JSTの起動時刻（0:00からの分）の集合
  const jstTimes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    const times = [];
    for (const h of expand(hour, 23))
      for (const m of expand(min, 59)) times.push(((h + 9) % 24) * 60 + m);
    return times.sort((a, b) => a - b);
  };
  const forPath = (p) =>
    crons.filter((c) => c.path === p).map((c) => c.schedule);

  const result = forPath("/api/cron/result");
  check(
    "vercel.json: /api/cron/result は1本",
    result.length === 1,
    show(result),
  );
  const rt = new Set(jstTimes(result[0]));
  const everyMinute = (from, to) => {
    for (let t = from; t <= to; t++) if (!rt.has(t % 1440)) return false;
    return true;
  };
  check(
    "result の cron: JST 07:00〜23:59 と 00:00〜00:59（翌）の毎分。最終レース（22:45発走）の結果の許容幅の終わり 00:15 を含む",
    everyMinute(7 * 60, 24 * 60 - 1) &&
      everyMinute(24 * 60, 24 * 60 + 59) &&
      !rt.has(6 * 60 + 59) &&
      !rt.has(60),
    `${rt.size}回`,
  );
  const lastRaceDeadlineEnd =
    22 * 60 +
    45 +
    SCRAPE_JOBS.result.offsets[0] +
    SCRAPE_JOBS.result.graceMin -
    24 * 60; // 翌分
  check(
    `最終レース（22:45発走）の結果スロットの期限+許容幅（翌 00:${String(lastRaceDeadlineEnd).padStart(2, "0")}）を、cron が超えて起動する（期限切れ処理・確定まで届く）`,
    lastRaceDeadlineEnd === 15 && rt.has((24 * 60 + lastRaceDeadlineEnd + 1) % 1440),
  );
  check(
    "kfile-sync の cron: JST 07:00 と 12:00 の2回（本体と補足）",
    same(
      forPath("/api/cron/kfile-sync")
        .flatMap(jstTimes)
        .sort((a, b) => a - b),
      [7 * 60, 12 * 60],
    ),
    show(forPath("/api/cron/kfile-sync")),
  );
  check(
    "result-catchup の cron: JST 23:50 と 翌 00:30 の2回（最終レースの期限が翌00:15のため、補足を置く）",
    same(
      forPath("/api/cron/result-catchup")
        .flatMap(jstTimes)
        .sort((a, b) => a - b),
      [0 * 60 + 30, 23 * 60 + 50],
    ),
    show(forPath("/api/cron/result-catchup")),
  );
  const cronRe = /^(\S+ ){4}\S+$/;
  check(
    "vercel.json: 追加した cron のパスは api/cron/*.js として実在し、cron式が5フィールド",
    crons
      .filter((c) => /result|kfile/.test(c.path))
      .every(
        (c) =>
          fs.existsSync(path.join(ROOT, `${c.path.slice(1)}.js`)) &&
          cronRe.test(c.schedule),
      ),
  );
  for (const [file, job] of [
    ["result", "result"],
    ["kfile-sync", "kfile_sync"],
    ["result-catchup", "result_catchup"],
  ]) {
    const src = fs.readFileSync(path.join(ROOT, `api/cron/${file}.js`), "utf8");
    const m = /maxDuration:\s*(\d+)/.exec(src);
    const mod = await import(`../../api/cron/${file}.js`);
    check(
      `api/cron/${file}.js: maxDuration(${m?.[1]}) がレジストリ(${job})の maxDurationSec(${SCRAPE_JOBS[job].maxDurationSec}) と一致し、config・default の関数がある。共通ラッパ経由（job='${job}'）`,
      m &&
        Number(m[1]) === SCRAPE_JOBS[job].maxDurationSec &&
        mod.config?.maxDuration === SCRAPE_JOBS[job].maxDurationSec &&
        typeof mod.default === "function" &&
        new RegExp(`job: "${job}"`).test(src) &&
        /createScrapeCronHandler/.test(src),
    );
  }
  // 認証: CRON_SECRET なし・誤りは401（取得もDBアクセスもしない）
  const mod = await import("../../api/cron/result.js");
  const respond = () => {
    const out = { status: null, body: null };
    return {
      out,
      res: {
        status(s) {
          out.status = s;
          return this;
        },
        json(b) {
          out.body = b;
          return this;
        },
      },
    };
  };
  process.env.CRON_SECRET = "secret-for-test";
  const noAuth = respond();
  await mod.default({ headers: {}, query: {} }, noAuth.res);
  const badAuth = respond();
  await mod.default(
    { headers: { authorization: "Bearer wrong-secret-x" }, query: {} },
    badAuth.res,
  );
  delete process.env.CRON_SECRET;
  check(
    "api/cron/result: Authorization なし・誤りは401",
    noAuth.out.status === 401 && badAuth.out.status === 401,
    show([noAuth.out, badAuth.out]),
  );
  check(
    "parseRaceId・addDays: race_id の形式・日付の加算（月またぎ）",
    same(parseRaceId("2026-09-19-05-01"), {
      race_id: "2026-09-19-05-01",
      date: "2026-09-19",
      venue_code: 5,
      race_number: 1,
    }) &&
      addDays("2026-09-02", -4) === "2026-08-29" &&
      (() => {
        try {
          parseRaceId("bad");
          return false;
        } catch {
          return true;
        }
      })(),
  );
}

printOut(
  failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
