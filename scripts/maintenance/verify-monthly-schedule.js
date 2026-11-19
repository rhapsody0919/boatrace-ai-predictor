/**
 * verify-monthly-schedule.js - 月間スケジュール（節メタ N16）のパーサー・節の確定・行変換・DDL案・CLIの検証
 *
 * DB・公式サイトに接続しない（fetch・DBクライアントは差し替える）。
 * 設計: docs/design/racer-period-stats/plan.md
 *
 * フィクスチャ: scripts/lib/__fixtures__/monthlyschedule/
 *   公式の月間スケジュール（202608・202609・202610・201904）から、会場の行だけを抜粋（見出しの日付行はそのまま）。
 *
 * 検証観点:
 *   1. 構造: 見出しの日付と列の対応（全列の日の数字が一致）、色分け、端に接する節の扱い
 *   2. 独立した情報源との一致:
 *      a. 公式の raceindex（住之江 2026-09-01: 初日9/1〜最終日9/6）
 *      b. Kファイル（2019-04-15 の蒲郡 第4日・多摩川 第3日）から導出した日目
 *      c. 本番DB（races）の連続開催日（2026-08-20〜09-19、9会場）: 節の終了日は一致し、開始日は、DBに初日の
 *         races が無い場合に限って1日ずれる（DBの初日欠落。plan.md に記録）
 *   3. 節の確定: 3か月分の突き合わせで、端の断片が解消し、範囲の外の端だけが unresolved に残る
 *   4. 行変換・DDL案（084）: 列の一致、CHECK、RLS
 *   5. CLI: 取得・解析・投入（既定は検証のみ）、前後1か月が無ければ停止、構造の変更の検知
 *   6. 変異検証: 列と日付の対応・端の扱い・日数・グレードの対応を壊すと、検証が失敗する
 *   7. 定期取得（raceSeriesJob.js）: 前月・当月・翌月を取り、当月・翌月に始まる節を書く。節名が未掲載の節は節名NULLで書き、
 *      それ以外の要確認・会場数の違い・取得の失敗は何も書かない。shadow は書かない。配線（maxDuration・cron）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import * as parserMod from "../lib/monthlyScheduleParser.js";
import * as rowsMod from "../lib/raceSeriesRows.js";
import { parseKText } from "../lib/kbFileParser.js";
import * as cli from "./monthly-schedule-backfill.js";
import { fakeClient } from "../lib/fakeSupabaseClient.js";
import { runRaceSeriesJob } from "../lib/raceSeriesJob.js";
import { SCRAPE_JOBS, isScheduledDate } from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";
import { evaluate as evaluateWith } from "./verifyData/monthly-schedule-evaluate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = path.join(ROOT, "scripts/lib");
const FIX = path.join(LIB, "__fixtures__/monthlyschedule");
const html = (ym) => fs.readFileSync(path.join(FIX, `${ym}.html`), "utf8");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** パーサー（P）に対する評価（期待値と中身は verifyData/monthly-schedule-evaluate.js）。変異検証で、壊した版にも同じ評価をかける */
const K190415 = path.join(LIB, "__fixtures__/kbfile/k190415.txt");
const readK = () => parseKText(fs.readFileSync(K190415, "utf8"));
const evaluate = (P) => evaluateWith(P, { html, readK });

{
  for (const r of evaluate(parserMod)) check(r.label, r.pass, r.detail);
  // 想定外の入力
  let threw = false;
  try {
    parserMod.parseMonthlySchedule(
      "<html><body>メンテナンス中</body></html>",
      "202609",
    );
  } catch {
    threw = true;
  }
  check(
    "表が無いHTML（構造の変更・メンテナンス画面）は握りつぶさず例外",
    threw,
  );
  const wrongYm = parserMod.parseMonthlySchedule(html("202609"), "202608");
  check(
    "要求した年月とページの年月が違えば anomalies に残る",
    wrongYm.anomalies.some((a) => /一致しません/.test(a.problem)),
  );
  check(
    "URL: race/monthlyschedule?ym=YYYYMM、年月の一覧",
    parserMod.buildMonthlyScheduleUrl("202609") ===
      "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym=202609" &&
      same(parserMod.listYms("202611", "202702"), [
        "202611",
        "202612",
        "202701",
        "202702",
      ]),
  );
}

// ---------------------------------------------------------------------------
// 4. 行変換・DDL案（084）
// ---------------------------------------------------------------------------
{
  const pages = ["202608", "202609", "202610"].map((ym) =>
    parserMod.parseMonthlySchedule(html(ym), ym),
  );
  const merged = parserMod.mergeMonthlySchedules(pages);
  const rows = rowsMod.buildSeriesRows(merged.series, {
    from: "2026-09-01",
    to: "2026-09-30",
  });
  check(
    "行: 開始日が範囲内の節だけ、列は SERIES_COLUMNS と一致",
    rows.length > 0 &&
      rows.every(
        (r) =>
          r.start_date.startsWith("2026-09") &&
          same(Object.keys(r), rowsMod.SERIES_COLUMNS),
      ),
  );
  check(
    "行: 主キー (venue_code, start_date) が一意",
    new Set(rows.map((r) => `${r.venue_code}|${r.start_date}`)).size ===
      rows.length,
  );

  const sql = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/084_race_series.sql"),
    "utf8",
  );
  const body = /CREATE TABLE IF NOT EXISTS race_series \(([\s\S]*?)\n\);/.exec(
    sql,
  )[1];
  const cols = [
    ...body.matchAll(/^\s{2}([a-z_]+)\s+(smallint|date|text|timestamptz)/gm),
  ].map((m) => m[1]);
  check(
    "DDL 084: 列が SERIES_COLUMNS + created_at・updated_at と一致（順序も）",
    same(cols, [...rowsMod.SERIES_COLUMNS, "created_at", "updated_at"]),
    JSON.stringify(cols),
  );
  const classList = /class_code IN \(([^)]*)\)/
    .exec(sql)[1]
    .match(/'(\w+)'/g)
    .map((x) => x.slice(1, -1))
    .sort();
  check(
    "DDL 084: class_code のCHECKが CLASS_CODES と一致",
    same(classList, Object.keys(parserMod.CLASS_CODES).sort()),
    JSON.stringify(classList),
  );
  const kindList = /kind\s*\n?\s*CHECK \(kind IN \(([^)]*)\)/
    .exec(sql)[1]
    .match(/'(\w+)'/g)
    .map((x) => x.slice(1, -1))
    .sort();
  check(
    "DDL 084: kind のCHECKが CLASS_CODES の kind と一致",
    same(
      kindList,
      Object.values(parserMod.CLASS_CODES)
        .map((c) => c.kind)
        .sort(),
    ),
    JSON.stringify(kindList),
  );
  const gradeList = /grade IS NULL OR grade IN \(([^)]*)\)/
    .exec(sql)[1]
    .match(/'(\w+)'/g)
    .map((x) => x.slice(1, -1))
    .sort();
  check(
    "DDL 084: grade のCHECKが races.race_grade と同じ語彙（SG・G1・G2・G3・ippan）",
    same(gradeList, ["G1", "G2", "G3", "SG", "ippan"]),
    JSON.stringify(gradeList),
  );
  check(
    "DDL 084: 主キー (venue_code, start_date)・RLS有効・anon/authenticated の権限剥奪・外部キーなし・未適用の明記",
    /PRIMARY KEY \(venue_code, start_date\)/.test(sql) &&
      /ENABLE ROW LEVEL SECURITY/.test(sql) &&
      /REVOKE ALL ON race_series FROM anon, authenticated/.test(sql) &&
      !/REFERENCES/i.test(sql.replace(/--[^\n]*/g, "")) &&
      /本番へ未適用/.test(sql),
  );
  check(
    "DDL 084: total_days のCHECKが 終了日−開始日+1",
    /total_days = end_date - start_date \+ 1/.test(sql),
  );
}

// ---------------------------------------------------------------------------
// 5. CLI
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-verify-"));
const newDir = () => fs.mkdtempSync(path.join(tmp, "a-"));
const opts = (dir, extra = {}) =>
  cli.validateOptions({
    ...cli.parseArgs(["download"], new Date("2026-09-21T00:00:00Z")),
    from: "202608",
    to: "202610",
    archiveDir: dir,
    window: "any",
    expectedVenues: 9, // フィクスチャは9会場（実ページは24）
    ...extra,
  });
const resp = (status, text = "") => ({
  status,
  bytes: new Uint8Array(Buffer.from(text)),
  ms: 5,
  lastModified: null,
});
const harness = (responder) => {
  const sleeps = [];
  const urls = [];
  let t = Date.parse("2026-09-21T13:00:00Z");
  return {
    sleeps,
    urls,
    deps: {
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      fetchOnce: async (url) => {
        urls.push(url);
        return responder(url);
      },
      now: () => new Date(t),
      backoffBaseMs: 30000,
      log: () => {},
    },
  };
};
const byUrl = (url) => resp(200, html(/ym=(\d{6})/.exec(url)[1]));

{
  const dir = newDir();
  const h = harness(byUrl);
  const code = await cli.cmdDownload(opts(dir), h.deps);
  check(
    "download: 3か月分を取得（終了コード0）、URLは monthlyschedule?ym=YYYYMM、間隔は3秒以上",
    code === 0 &&
      h.urls.length === 3 &&
      h.urls[0].endsWith("monthlyschedule?ym=202608") &&
      h.sleeps.every((s) => s >= 3000),
    `code=${code} sleeps=${h.sleeps}`,
  );
  check(
    "download: HTMLをgzipで保存（生のまま。sha256をマニフェストに記録）",
    zlib
      .gunzipSync(fs.readFileSync(cli.rawPath(dir, "202609")))
      .toString("utf8") === html("202609"),
  );
  const h2 = harness(byUrl);
  await cli.cmdDownload(opts(dir), h2.deps);
  check(
    "download: 再実行は取得済みをスキップ（リクエスト0）",
    h2.urls.length === 0,
  );
  const h3 = harness(byUrl);
  await cli.cmdDownload(
    opts(dir, { from: "202609", to: "202610", refresh: true }),
    h3.deps,
  );
  check(
    "download --refresh: 取得済みの月も取り直す（当月・翌月の更新用）",
    h3.urls.length === 2,
  );

  // parse → load
  const logs = [];
  const pcode = await cli.cmdParse(opts(dir), { log: (s) => logs.push(s) });
  const page = cli.readParsedMonth(dir, "202609");
  check(
    "parse: 保存したHTML → 中間JSON（monthly-schedule/v1）。ネットワーク・DB不要",
    pcode === 0 &&
      page.schema === "monthly-schedule/v1" &&
      page.venues.length === 9,
    logs.join(" / "),
  );

  const lo = opts(dir, { from: "202609", to: "202609" });
  const dry = fakeClient({});
  const dcode = await cli.cmdLoad(lo, { client: dry, log: () => {} });
  check(
    "load: --apply なしはDBに触れない（クライアントの呼び出し0回）",
    dcode === 0 &&
      dry.calls.selects.length === 0 &&
      dry.calls.upserts.length === 0,
  );
  const db = fakeClient({});
  const acode = await cli.cmdLoad(
    { ...lo, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  const n = db.tables.race_series?.length ?? 0;
  check(
    "load --apply: 9月に始まる節を race_series へ書く",
    acode === 0 &&
      n > 0 &&
      db.tables.race_series.every((r) => r.start_date.startsWith("2026-09")),
    `n=${n}`,
  );
  const before = db.calls.upserts.length;
  await cli.cmdLoad(
    { ...lo, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 再実行は変更の無い節を書かない",
    db.calls.upserts.length === before,
  );
  db.tables.race_series[0].title = "改変";
  await cli.cmdLoad(
    { ...lo, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 値が変わった節だけを書き直す",
    db.calls.upserts.length === before + 1 &&
      db.calls.upserts.at(-1).n === 1 &&
      db.tables.race_series[0].title !== "改変",
  );
  const noTable = fakeClient({}, { missing: new Set(["race_series"]) });
  const ncode = await cli.cmdLoad(
    { ...lo, apply: true },
    { client: noTable, log: () => {} },
  );
  check(
    "load --apply: DDL 084 が未適用（テーブルなし）なら、書き込まず終了コード1",
    ncode === 1 && noTable.calls.upserts.length === 0,
  );

  // 前後1か月が無ければ停止
  const only = newDir();
  fs.cpSync(path.join(dir, "parsed"), path.join(only, "parsed"), {
    recursive: true,
  });
  fs.rmSync(path.join(only, "parsed/202608.json.gz"));
  const mcode = await cli.cmdLoad(
    { ...lo, archiveDir: only, apply: true },
    { client: fakeClient({}), log: () => {} },
  );
  check(
    "load: 前の月（202608）が解析済みでなければ、節を確定できないため停止（終了コード1）",
    mcode === 1,
  );
  // 範囲の端で確定できない節があれば投入しない（前後1か月が範囲外の節を含むとき）
  const ecode = await cli.cmdLoad(
    { ...lo, from: "202608", to: "202610", apply: true },
    { client: fakeClient({}), log: () => {} },
  );
  check(
    "load: 前後1か月（202607・202611）のページが無い範囲（202608〜202610）は、停止（終了コード1）",
    ecode === 1,
  );

  // 構造の変更・会場数の違いを、取得時に検知する
  const dir2 = newDir();
  const h4 = harness(byUrl);
  const wcode = await cli.cmdDownload(
    opts(dir2, { expectedVenues: 24 }),
    h4.deps,
  );
  check(
    "download: 会場数が想定と違うページは、内容が想定外として3回連続で停止（終了コード4）。保存しない",
    wcode === 4 && !fs.existsSync(path.join(dir2, "raw")),
    `code=${wcode}`,
  );
  const dir3 = newDir();
  const h5 = harness(() => resp(403));
  check(
    "download: 403が2回連続で停止（終了コード4）",
    (await cli.cmdDownload(opts(dir3), h5.deps)) === 4 && h5.urls.length === 2,
  );
  const h6 = harness(() => resp(200, "<html>blocked</html>"));
  check(
    "download: 表の無い応答が3回連続で停止（終了コード4）",
    (await cli.cmdDownload(opts(newDir()), h6.deps)) === 4 &&
      h6.urls.length === 3,
  );
  const h7 = harness(byUrl);
  const wcode2 = await cli.cmdDownload(opts(newDir(), { window: "22-06" }), {
    ...h7.deps,
    now: () => new Date("2026-09-21T03:00:00Z"),
  });
  check(
    "download: 実行窓（JST 22-06）の外では、1件も取得せず安全停止（終了コード2）",
    wcode2 === 2 && h7.urls.length === 0,
  );
}

// ---------------------------------------------------------------------------
// 6. 変異検証
// ---------------------------------------------------------------------------
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
async function withMutant(fileName, replacements, run) {
  let mutated = fs.readFileSync(path.join(LIB, fileName), "utf8");
  for (const [from, to] of replacements) {
    if (from instanceof RegExp ? !from.test(mutated) : !mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 60)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmpFile = path.join(
    LIB,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(tmpFile));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}
const mutants = [
  [
    "見出しの日付と列の対応を1日ずらす",
    [
      [
        "addDays(monthStart, i - firstOfMonth)",
        "addDays(monthStart, i - firstOfMonth + 1)",
      ],
    ],
  ],
  [
    "節の終了列を1つ後ろにする（日数が1増える）",
    [
      ["col_end: col + span - 1,", "col_end: col + span,"],
      [
        "end_date: columnDates[col + span - 2] ?? null,",
        "end_date: columnDates[col + span - 1] ?? null,",
      ],
    ],
  ],
  [
    "左端に接する断片の開始日を確定扱いにする（端の断片を節として採用）",
    [
      [
        /const starts = g\.items\s*\.filter\(\(i\) => !i\.edge_left\)/,
        "const starts = g.items.filter(() => true)",
      ],
    ],
  ],
  [
    "右端に接する断片の終了日を確定扱いにする",
    [
      [
        /const ends = g\.items\s*\.filter\(\(i\) => !i\.edge_right\)/,
        "const ends = g.items.filter(() => true)",
      ],
    ],
  ],
  [
    "総日数から+1を落とす",
    [
      [
        "total_days: daysBetween(start_date, end_date) + 1,",
        "total_days: daysBetween(start_date, end_date),",
      ],
    ],
  ],
  [
    "一般（Ippan）のグレードを G3 にする",
    [
      [
        'Ippan: { grade: "ippan", kind: "ippan" },',
        'Ippan: { grade: "G3", kind: "ippan" },',
      ],
    ],
  ],
  [
    "ヴィーナス・ルーキー等のグレードを一般に決めつける",
    [
      [
        'Venus: { grade: null, kind: "venus" },',
        'Venus: { grade: "ippan", kind: "venus" },',
      ],
      [
        'Takumi: { grade: null, kind: "masters" },',
        'Takumi: { grade: "ippan", kind: "masters" },',
      ],
      [
        'Lady: { grade: null, kind: "lady" },',
        'Lady: { grade: "ippan", kind: "lady" },',
      ],
      [
        'Rookie: { grade: null, kind: "rookie" },',
        'Rookie: { grade: "ippan", kind: "rookie" },',
      ],
    ],
  ],
  [
    "会場コードを読まず、行の順に会場番号を振る",
    [
      [
        /const jcd = \/jcd=\(\\d\+\)\/\.exec\([\s\S]*?\)\?\.\[1\];/,
        "const jcd = String(venues.length + 1);",
      ],
    ],
  ],
];
for (const [label, reps] of mutants) {
  const failed = await withMutant(
    "monthlyScheduleParser.js",
    reps,
    async (mod) => {
      try {
        return evaluate(mod).filter((r) => !r.pass);
      } catch (e) {
        return [{ label: `例外: ${e.message}` }];
      }
    },
  );
  check(
    `変異検証: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

// ---------------------------------------------------------------------------
// 7. 定期取得（raceSeriesJob.js）
// ---------------------------------------------------------------------------
{
  const ymOfUrl = (url) => /ym=(\d{6})/.exec(url)?.[1];
  const jobCtx = (pages, { mode = "live", client = fakeClient({}) } = {}) => {
    const urls = [];
    return {
      urls,
      client,
      ctx: {
        targetDate: "2026-09-14",
        mode,
        client,
        politeFetch: async (url) => {
          urls.push(url);
          const body = pages[ymOfUrl(url)];
          return body === undefined
            ? new Response("", { status: 404 })
            : new Response(body, { status: 200 });
        },
      },
    };
  };
  const OPTS = { expectedVenues: 9, sleepMs: 0 };
  const base = {
    202608: html("202608"),
    202609: html("202609"),
    202610: html("202610"),
  };

  for (const [date, scheduled] of [
    ["2026-09-14", true], ["2026-09-15", false],
    ["2026-09-01", true], ["2026-09-03", true], ["2026-09-04", false],
    ["2026-09-27", false], ["2026-09-28", true], ["2026-09-30", true],
    ["2026-10-28", false], ["2026-10-29", true], ["2026-10-31", true],
    ["2027-02-25", false], ["2027-02-26", true], ["2027-02-28", true],
    ["2028-02-26", false], ["2028-02-27", true], ["2028-02-29", true],
  ]) {
    const j = jobCtx(base);
    j.ctx.targetDate = date;
    // 9月は成功・書き込みも検査。他の月は取得数の境界検査に限定する。
    if (!date.startsWith("2026-09")) {
      j.ctx.politeFetch = async (url) => {
        j.urls.push(url);
        return new Response("", { status: 503 });
      };
    }
    const r = await runRaceSeriesJob(j.ctx, OPTS);
    check(`P5a: ${date} の予定判定とハンドラーの取得数が一致`,
      isScheduledDate(SCRAPE_JOBS.race_series, date) === scheduled &&
      j.urls.length === (scheduled ? 3 : 0) &&
      (!scheduled || !date.startsWith("2026-09") || r.rowsWritten > 0) &&
      (scheduled || (r.rowsWritten === 0 && r.outcome === undefined &&
        j.client.calls.upserts.length === 0)), JSON.stringify(r));
  }

  const j1 = jobCtx(base);
  const r1 = await runRaceSeriesJob(j1.ctx, OPTS);
  const rows = j1.client.tables.race_series ?? [];
  check(
    "定期取得: 前月・当月・翌月（202608〜202610）の3ページを取り、開始日が当月・翌月（9月・10月）の節を書く",
    r1.outcome === undefined &&
      same(j1.urls.map(ymOfUrl), ["202608", "202609", "202610"]) &&
      rows.length > 0 &&
      rows.length === r1.rowsWritten &&
      rows.every(
        (r) => r.start_date >= "2026-09-01" && r.start_date <= "2026-10-31",
      ) &&
      rows.some((r) => r.start_date.startsWith("2026-10")),
    JSON.stringify({ outcome: r1.outcome, error: r1.error, n: rows.length }),
  );
  const r1b = await runRaceSeriesJob(
    jobCtx(base, { client: j1.client }).ctx,
    OPTS,
  );
  check(
    "定期取得: 再実行は変更の無い節を書かない（書き込み0件でも成功）",
    r1b.outcome === undefined &&
      r1b.rowsWritten === 0 &&
      r1b.rowsParsed === rows.length,
    JSON.stringify(r1b.body),
  );

  // 節名がまだ載っていない月（節の td にリンクが無い）。2026-10-02 の 202611 の実測と同じ形
  const untitled = base[202610].replace(
    /(<td[^>]*is-gradeColor[^>]*>)\s*<a[^>]*>[\s\S]*?<\/a>/g,
    "$1",
  );
  const j2 = jobCtx({ ...base, 202610: untitled });
  const r2 = await runRaceSeriesJob(j2.ctx, OPTS);
  const oct = (j2.client.tables.race_series ?? []).filter((r) =>
    r.start_date.startsWith("2026-10"),
  );
  check(
    "定期取得: 節名が未掲載の節（「節名のリンクがありません」の要確認）は許し、節名NULLで書く",
    r2.outcome === undefined &&
      r2.body.untitledSegments > 0 &&
      oct.length > 0 &&
      oct.some((r) => r.title === null),
    JSON.stringify({ outcome: r2.outcome, error: r2.error }),
  );
  // 節名が載った後の取得で、節名を書き直す
  const r2b = await runRaceSeriesJob(
    jobCtx(base, { client: j2.client }).ctx,
    OPTS,
  );
  check(
    "定期取得: 節名が載った後の取得で、節名NULLの節を書き直す",
    r2b.rowsWritten > 0 &&
      (j2.client.tables.race_series ?? []).every((r) => r.title !== null),
    JSON.stringify(r2b.body),
  );

  const unknown = base[202610].replace(
    "is-gradeColorIppan",
    "is-gradeColorXyz",
  );
  const failCases = [
    ["未知の色分け（構造の変更の疑い）", { ...base, 202610: unknown }, OPTS],
    [
      "翌月のページの取得に失敗（HTTP 404）",
      { 202608: base[202608], 202609: base[202609] },
      OPTS,
    ],
    ["会場数が想定と違う", base, { ...OPTS, expectedVenues: 24 }],
  ];
  for (const [label, pages, opts] of failCases) {
    const j = jobCtx(pages);
    const r = await runRaceSeriesJob(j.ctx, opts);
    check(
      `定期取得: ${label}は、何も書かず error`,
      r.outcome === "error" &&
        (j.client.calls.upserts?.length ?? 0) === 0 &&
        !(j.client.tables.race_series?.length > 0),
      JSON.stringify({ outcome: r.outcome, error: r.error }),
    );
  }

  const shadowClient = fakeClient({});
  const r3 = await runRaceSeriesJob(
    jobCtx(base, { mode: "shadow", client: shadowClient }).ctx,
    OPTS,
  );
  check(
    "定期取得: shadow は取得・解析のみで、DBに触れない",
    r3.outcome === undefined &&
      r3.rowsParsed > 0 &&
      shadowClient.calls.selects.length === 0 &&
      shadowClient.calls.upserts.length === 0,
  );

  // 配線: api/cron/race-series.js・vercel.json・レジストリ
  const src = fs.readFileSync(
    path.join(ROOT, "api/cron/race-series.js"),
    "utf8",
  );
  const mod = await import(
    new URL("../../api/cron/race-series.js", import.meta.url)
  );
  const def = SCRAPE_JOBS.race_series;
  const literal = Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]);
  check(
    "配線: api/cron/race-series.js の maxDuration がレジストリと一致し、ハンドラーを export する（日次ジョブ）",
    def?.kind === "daily" &&
      literal === def.maxDurationSec &&
      mod.config.maxDuration === literal &&
      typeof mod.default === "function",
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const schedules = vercel.crons
    .filter((c) => c.path === "/api/cron/race-series")
    .map((c) => c.schedule);
  const instants = schedules.map((s) => {
    const [min, hour] = s.split(" ");
    return new Date(Date.UTC(2026, 8, 30, Number(hour), Number(min)));
  });
  const jst = instants.map((d) => {
    const t = new Date(d.getTime() + 9 * 3600 * 1000);
    return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  });
  const targets = instants.map((d) => resolveTargetDate(d, def.targetTimeJst));
  check(
    "配線: vercel.json の cron は UTC 19:00・20:30（JST 04:00 指定時刻・05:30 補足）で、どちらも同じ対象日に解決される",
    same(schedules, ["0 19 * * *", "30 20 * * *"]) &&
      same(jst, ["04:00", "05:30"]) &&
      def.targetTimeJst === "04:00" &&
      new Set(targets).size === 1,
    JSON.stringify({ schedules, jst, targets }),
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  failures === 0
    ? "\n全ての検証に成功しました"
    : `\n${failures}件の検証に失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
