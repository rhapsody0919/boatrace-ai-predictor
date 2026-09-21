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

// 本番DB races の連続開催日（2026-09-21 SELECT。2026-08-20〜09-19、会場ごと。"会場:開始~終了" を ; 区切り）
const DB_RUNS =
  "1:2026-08-25~2026-08-30;1:2026-09-06~2026-09-10;2:2026-08-20~2026-08-23;2:2026-09-04~2026-09-06;2:2026-09-12~2026-09-14;2:2026-09-18~2026-09-19;5:2026-08-20~2026-08-20;5:2026-08-28~2026-09-02;5:2026-09-10~2026-09-13;5:2026-09-16~2026-09-19;6:2026-08-21~2026-08-26;6:2026-08-31~2026-09-04;6:2026-09-12~2026-09-15;6:2026-09-19~2026-09-19;7:2026-08-21~2026-08-24;7:2026-08-27~2026-09-01;7:2026-09-05~2026-09-08;7:2026-09-13~2026-09-18;8:2026-08-22~2026-08-27;8:2026-08-31~2026-09-03;8:2026-09-12~2026-09-17;12:2026-09-02~2026-09-06;12:2026-09-12~2026-09-16;12:2026-09-18~2026-09-19;18:2026-08-20~2026-08-20;18:2026-08-23~2026-08-27;18:2026-08-31~2026-09-05;18:2026-09-12~2026-09-17;20:2026-08-20~2026-08-20;20:2026-08-22~2026-08-26;20:2026-08-31~2026-09-05;20:2026-09-10~2026-09-15"
    .split(";")
    .map((s) => {
      const [v, r] = s.split(":");
      const [a, b] = r.split("~");
      return { v: Number(v), a, b };
    });

/**
 * パーサー（P）に対する評価。変異検証で、壊した版にも同じ評価をかける。
 * @returns {Array<{label: string, pass: boolean, detail?: string}>}
 */
function evaluate(P) {
  const out = [];
  const add = (label, pass, detail = "") => out.push({ label, pass, detail });
  const pages = ["202608", "202609", "202610"].map((ym) =>
    P.parseMonthlySchedule(html(ym), ym),
  );
  add(
    "3か月分のページ: 異常0、会場9、窓は前後4日を含む（30日の月は38列、31日の月は39列）",
    pages.every((p) => p.anomalies.length === 0 && p.venues.length === 9) &&
      pages[1].window.from === "2026-08-28" &&
      pages[1].window.to === "2026-10-04" &&
      pages[0].window.from === "2026-07-28" &&
      pages[2].window.to === "2026-11-04",
    JSON.stringify(pages.map((p) => [p.window, p.anomalies.length])),
  );
  const merged = P.mergeMonthlySchedules(pages);
  add(
    "節の確定: 異常0",
    merged.anomalies.length === 0,
    JSON.stringify(merged.anomalies.slice(0, 2)),
  );
  const find = (v, start) =>
    merged.series.find((s) => s.venue_code === v && s.start_date === start);

  // a. 公式の raceindex（2026-09-21取得）: 住之江 9/1 初日〜9/6 最終日
  const suminoe = find(12, "2026-09-01");
  add(
    "公式の raceindex と一致: 住之江 9/1初日〜9/6最終日（6日）、節名",
    suminoe &&
      suminoe.end_date === "2026-09-06" &&
      suminoe.total_days === 6 &&
      suminoe.title === "日刊スポーツ杯争奪第３０回ブルースターカップ",
    JSON.stringify(suminoe),
  );

  // b. Kファイル（2019-04-15）: 蒲郡 第4日・多摩川 第3日
  const p1904 = P.parseMonthlySchedule(html("201904"), "201904");
  const m1904 = P.mergeMonthlySchedules([p1904]);
  const k = parseKText(
    fs.readFileSync(path.join(LIB, "__fixtures__/kbfile/k190415.txt"), "utf8"),
  );
  const kDays = {};
  for (const v of k.venues) {
    const s = m1904.series.find(
      (x) =>
        x.venue_code === v.venue_code &&
        x.start_date <= "2019-04-15" &&
        x.end_date >= "2019-04-15",
    );
    kDays[v.venue_code] = {
      k: v.series_day,
      bar: s ? P.daysBetween(s.start_date, "2019-04-15") + 1 : null,
    };
  }
  add(
    "Kファイル（2019-04-15）の日目と一致: 蒲郡=4日目、多摩川=3日目（月間スケジュールから導出）",
    same(kDays, { 5: { k: 3, bar: 3 }, 7: { k: 4, bar: 4 } }),
    JSON.stringify(kDays),
  );

  // c. 本番DB races の連続開催日との突合（8/20以降に始まり、9/19までに終わった節）
  const done = merged.series.filter(
    (s) => s.start_date >= "2026-08-20" && s.end_date <= "2026-09-19",
  );
  let exact = 0;
  let firstDayMissing = 0;
  const bad = [];
  for (const s of done) {
    const run = DB_RUNS.find((r) => r.v === s.venue_code && r.b === s.end_date);
    if (run && run.a === s.start_date) exact++;
    else if (run && run.a === P.addDays(s.start_date, 1)) firstDayMissing++;
    else
      bad.push(
        `${s.venue_code} ${s.start_date}~${s.end_date} DB=${JSON.stringify(run)}`,
      );
  }
  add(
    "本番DBの連続開催日と、節の終了日が全て一致（開始日は、一致か、DBに初日の races が無い1日ずれのみ）",
    done.length > 0 &&
      bad.length === 0 &&
      exact + firstDayMissing === done.length,
    `節${done.length} 一致${exact} DB初日欠落${firstDayMissing} 不一致${bad.join(" / ")}`,
  );
  add(
    "DBの初日欠落を検出できる（節の初日でDBに races が無い日が、この9会場・期間で複数ある）",
    firstDayMissing >= 5,
    `firstDayMissing=${firstDayMissing}`,
  );

  // 3. 節の確定: 範囲の外の端だけが unresolved に残る
  add(
    "端の断片は隣の月で解消し、未確定は範囲の外の端（8月前端・10月後端）のみ",
    merged.unresolved.length > 0 &&
      merged.unresolved.every(
        (u) =>
          u.seen_from < "2026-08-01" ||
          u.seen_to > "2026-10-31" ||
          u.seen_from < "2026-07-31",
      ),
    JSON.stringify(
      merged.unresolved
        .filter(
          (u) => !(u.seen_from < "2026-08-01" || u.seen_to > "2026-10-31"),
        )
        .slice(0, 3),
    ),
  );
  add(
    "範囲の外の端は確定扱いにしない: 8月ページの左端（7/28）と10月ページの右端（11/4）の断片が、それぞれ未確定として残る",
    merged.unresolved.some(
      (u) => u.seen_from === "2026-07-28" && /開始日/.test(u.reason),
    ) &&
      merged.unresolved.some(
        (u) => u.seen_to === "2026-11-04" && /終了日/.test(u.reason),
      ),
    JSON.stringify(merged.unresolved.slice(0, 3)),
  );
  add(
    "9月に始まる節は全て確定している（未確定なし）",
    !merged.unresolved.some(
      (u) => u.seen_from >= "2026-09-01" && u.seen_from <= "2026-09-30",
    ) &&
      merged.series.filter((s) => s.start_date.startsWith("2026-09")).length >
        0,
  );
  // 種別
  const kinds = new Map(merged.series.map((s) => [s.class_code, s]));
  add(
    "色分けの種別: SG・G1・Lady・Venus・Rookie・Takumi・Ippan を区別し、グレードが確定するのは SG/G1/G2/G3/Ippan のみ",
    ["Lady", "Venus", "Rookie", "Takumi"].every(
      (c) => kinds.get(c)?.grade === null,
    ) &&
      kinds.get("G1")?.grade === "G1" &&
      kinds.get("Ippan")?.grade === "ippan" &&
      kinds.get("Takumi")?.kind === "masters" &&
      kinds.get("Lady")?.kind === "lady",
    JSON.stringify([...kinds.entries()].map(([c, s]) => [c, s.grade, s.kind])),
  );
  add(
    "総日数 = 終了日 − 開始日 + 1（全節）",
    merged.series.every(
      (s) => s.total_days === P.daysBetween(s.start_date, s.end_date) + 1,
    ) && merged.series.every((s) => s.total_days >= 1 && s.total_days <= 8),
    JSON.stringify(
      merged.series
        .filter((s) => s.total_days > 8 || s.total_days < 1)
        .slice(0, 2),
    ),
  );
  return out;
}

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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(`${tmpFile}?t=${Date.now()}`));
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  failures === 0
    ? "\n全ての検証に成功しました"
    : `\n${failures}件の検証に失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
