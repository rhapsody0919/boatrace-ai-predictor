/**
 * verify-pit-report-job.js - ピットレポート（選手コメント。N24、BOA-379）のパーサー・行の組み立て・取得ジョブ・DDL案の検証
 * （docs/design/pit-comments/）。DBにも取得先にも接続しない（実ページのフィクスチャ・偽クライアント・メモリのストア）。
 *
 *   (a) 解析: 実ページ（scripts/lib/__fixtures__/pitreport/、2026-09-21に取得）で、コメント本文（末尾の自信度を除いた表記そのまま）・
 *       ★の数・前走・登録番号・レポーター・グレード・締切時刻が取れる。自信度の無いコメント（【取材者寸評】）・前走が空の艇も正常。
 *       コメントの無いページの4種類（対象外のレース番号・最終日の12Rのみ・G3/一般戦・データなし）と、未公開（対象レースで表が空）
 *       ・想定外の構造を、区別できる。本文の改行（<br>）は保つ
 *   (b) 行の組み立て・outcome: 取得の候補（SG全レース・G1/G2は7R以降）、status→outcome、内容ハッシュ（HTMLの体裁に依存せず、
 *       コメントの変更で変わる）、出走表の登録番号との突合
 *   (c) 取得ジョブ（processPitReportRace）: shadow は何も書かない・live は書く。同じ内容の再取得は書かない。内容が変わったら
 *       書き直す。書く順序は「艇ごと → レース単位の行」。未適用のDB・登録番号の不一致・想定外の構造では、書かずに error。
 *       対象外のレース（G3・一般戦）は取得しない。未公開・データなしは書かず no_values。生HTMLの保管は内容が変わったときだけで、
 *       失敗しても取得は続く
 *   (d) 共通ラッパ: off・行なしは何もしない（取得もDB書き込みもしない）。shadow は取得・解析のみ。live で書く。
 *       対象外で終端したスロット（skipped_not_target）は完了として扱う
 *   (e) 予定表: createPitReportStore が、対象レース（SG全レース・G1/G2の7R以降）にだけスロットを作る。期限を過ぎたものは作らない
 *   (f) 配線・DDL: api/cron/pit-reports.js の maxDuration とレジストリの一致、vercel.json の cron、レジストリの整合、
 *       DDL案（085・086）の列とコードが書く行の一致・RLS・公開は SELECT のみ
 *   (g) 変異検証: パーサー・行の組み立て・取得ジョブを壊した版で、上の検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-pit-report-job.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as realParser from "../lib/pitReportParser.js";
import * as realRows from "../lib/pitReportRows.js";
import {
  PIT_REPORT_JOB,
  buildPitReportUrl,
  createPitReportSlotHandler,
  createPitReportStore,
  fetchPitReportHtml,
  processPitReportRace,
  PitReportHttpError,
} from "../lib/pitReportJob.js";
import {
  clearPitReportSchemaCache,
  detectPitReportSchema,
} from "../lib/pitReportSchema.js";
import { rawHtmlPath, archiveRawHtml } from "../lib/rawHtmlArchive.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { isFinalOutcome } from "../lib/scrapeJobs/outcomes.js";
import { computeWindowStats } from "../lib/scrapeJobs/monitor.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";

// 検証の対象コードが出すログ（書き込みの要約・警告）は捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    out.log(`✅ ${label}`);
  } else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/pitreport");
const readFixture = (name) =>
  fs.readFileSync(path.join(FIXTURES, name), "utf8");
const R12 = readFixture("comments-g1-r12-day3.html");
const R10 = readFixture("comments-g1-r10-mixed.html");
const NOT_TARGET_RACE = readFixture("not-target-race-g1-r1.html");
const FINAL_DAY = readFixture("not-target-race-g1-final-day-r7.html");
const G3 = readFixture("not-target-g3-r12.html");
const IPPAN = readFixture("not-target-ippan-r9.html");
const NO_DATA = readFixture("no-data.html");
// 未公開（対象レース。2026-09-21 11:30 JST、多摩川G1最終日の12R・発走16:30の5時間前に取得した実ページ）: 艇ごとの表とレポーター名は
// あるが、コメント欄が空（&nbsp;）・前走のリンクの中身も空。「対象外」のメッセージは出ない
const PENDING_REAL = readFixture("pending-g1-r12-final-day.html");
// 表そのものが無い場合（構造の別の形。フォールバックの検証用の加工版）: 実ページの表（艇ごとの行）を取り除いた形
const PENDING = R12.replace(
  /<tbody>\s*<tr>\s*<td class="is-boatColor[\s\S]*?<\/tbody>/g,
  "",
);

// ---------------------------------------------------------------------------
// 窓（レジストリ pit_reports）の評価。実測（2026-09-21、docs/design/pit-comments/spec.md §1.4・§1.5）:
//   多摩川G1最終日の12R（発走16:30）は、13:30（発走180分前）は未公開、14:30（120分前）は公開済みで、
//   公開後は発走後60分まで内容が変わらなかった。公開は発走の120〜180分前。変異検証でも、壊した版に同じ評価をかける
// ---------------------------------------------------------------------------
const OBSERVED_PUBLISH_LATEST_MIN_BEFORE = 180; // 未公開だった最も近い取得（発走180分前）
const OBSERVED_LAST_UNCHANGED_AFTER_MIN = 60; // 公開後、内容が変わらないことを確認した最後の取得（発走+60分）
/** @returns {string[]} 失敗した項目のラベル */
function evaluateWindow(registry) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const def = registry.pit_reports;
  const start = def.offsets[0];
  const end = start + def.graceMin;
  expect(
    "窓の開始は、実測した公開時刻（発走の120〜180分前）より前（発走180分前以前）",
    start <= -OBSERVED_PUBLISH_LATEST_MIN_BEFORE,
  );
  expect(
    "窓の終わりは、公開後に内容が変わらないことを確認した時刻（発走+60分）以降",
    end >= OBSERVED_LAST_UNCHANGED_AFTER_MIN,
  );
  expect("窓は1本（offsets が1要素）", def.offsets.length === 1);
  return failed;
}

// ---------------------------------------------------------------------------
// (a) 解析と (b) 行の組み立て を、差し替え可能なモジュールに対して評価する（変異検証で、壊した版にも同じ評価をかける）
// ---------------------------------------------------------------------------
/** @returns {string[]} 失敗した項目のラベル */
function evaluateParser(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const r12 = m.parsePitReportHtml(R12);
  expect("R12: status=comments", r12.status === "comments");
  expect(
    "R12: グレード・レース番号・締切・レポーター",
    r12.grade === "G1" &&
      r12.raceNumber === 12 &&
      r12.deadline === "16:30" &&
      r12.reporterName === "八王子 スゴ六",
  );
  expect(
    "R12: 登録番号",
    same(
      r12.boats.map((b) => b.racerNumber),
      [4371, 4335, 4573, 4264, 4095, 4500],
    ),
  );
  expect(
    "R12: ★の数",
    same(
      r12.boats.map((b) => b.confidenceStars),
      [1, 2, 2, 2, 2, 2],
    ),
  );
  expect(
    "R12: 前走",
    same(
      r12.boats.map((b) => b.previousRaceNumber),
      [7, 2, 5, 3, 6, 4],
    ),
  );
  expect(
    "R12: コメント本文（末尾の自信度を除き、表記そのまま。全角の括弧）",
    r12.boats[0].commentText ===
      "整備をしたけど、前半レースは良くなかった。急いでリングを外します。",
  );
  expect(
    "R12: コメント本文（半角の括弧の自信度）",
    r12.boats[1].commentText.endsWith(
      "スタートはフライング一本持ちだし気をつけたいです。",
    ) && !r12.boats[1].commentText.includes("コメント自信度"),
  );
  expect(
    "R12: 艇の属性（級別・年齢・体重・支部）",
    r12.boats[0].racerClass === "A1" &&
      r12.boats[0].age === 39 &&
      r12.boats[0].weightKg === 52 &&
      r12.boats[0].branch === "福岡" &&
      r12.boats[0].hometown === "福岡",
  );
  expect("R12: 異常なし", r12.anomalies.length === 0);

  const r10 = m.parsePitReportHtml(R10);
  expect(
    "R10: 自信度の無いコメント（【取材者寸評】）は★NULL・本文はそのまま",
    r10.boats[2].confidenceStars === null &&
      r10.boats[2].commentText.startsWith("【取材者寸評】"),
  );
  expect(
    "R10: ★の数（自信度なしの艇はnull）",
    same(
      r10.boats.map((b) => b.confidenceStars),
      [2, 2, null, 2, 1, 1],
    ),
  );
  expect(
    "R10: その日まだ走っていない艇の前走はnull（空のリンクは異常にしない）",
    same(
      r10.boats.map((b) => b.previousRaceNumber),
      [null, 5, 3, 4, 2, 1],
    ) && r10.anomalies.length === 0,
  );

  const ntr = m.parsePitReportHtml(NOT_TARGET_RACE);
  expect(
    "G1 1R: not_target_race・対象は7〜12",
    ntr.status === "not_target_race" &&
      same(ntr.targetRange, { from: 7, to: 12 }) &&
      ntr.boats.length === 0,
  );
  const fin = m.parsePitReportHtml(FINAL_DAY);
  expect(
    "G1最終日 7R: not_target_race・対象は12のみ",
    fin.status === "not_target_race" &&
      same(fin.targetRange, { from: 12, to: 12 }) &&
      fin.dayLabel.includes("最終日"),
  );
  const g3 = m.parsePitReportHtml(G3);
  expect(
    "G3: not_target（対象グレードではない）",
    g3.status === "not_target" && g3.targetRange === null && g3.grade === "G3",
  );
  const ippan = m.parsePitReportHtml(IPPAN);
  expect(
    "一般戦: not_target",
    ippan.status === "not_target" && ippan.grade === "ippan",
  );
  const nodata = m.parsePitReportHtml(NO_DATA);
  expect("レースが無い: no_data", nodata.status === "no_data");
  const pending = m.parsePitReportHtml(PENDING);
  expect(
    "対象レースで表が空: target_pending（対象外・データなしと区別できる）",
    pending.status === "target_pending" &&
      pending.boats.length === 0 &&
      pending.grade === "G1",
  );
  const pendingReal = m.parsePitReportHtml(PENDING_REAL);
  expect(
    "未公開の実ページ（表はあるがコメント欄が空）: target_pending・艇6行・レポーター名は取れる・異常なし",
    pendingReal.status === "target_pending" &&
      pendingReal.boats.length === 6 &&
      pendingReal.boats.every((b) => b.commentText === null) &&
      pendingReal.reporterName === "八王子 スゴ六" &&
      pendingReal.anomalies.length === 0 &&
      pendingReal.raceNumber === 12,
  );
  const junk = m.parsePitReportHtml("<html><body><p>x</p></body></html>");
  expect(
    "想定外の構造は unrecognized（黙って「コメント無し」にしない）",
    junk.status === "unrecognized" && junk.anomalies.length > 0,
  );
  const unknownMsg = m.parsePitReportHtml(
    R12.replace(
      /<tbody>\s*<tr>\s*<td class="is-boatColor[\s\S]*?<\/tbody>/g,
      "",
    ).replace(
      "</main>",
      '<div class="title12"><h3 class="title12_title is-type1">※ 別の文言です。</h3></div></main>',
    ),
  );
  expect(
    "未知のメッセージは unrecognized",
    unknownMsg.status === "unrecognized",
  );

  const brHtml = R12.replace(
    "整備をしたけど、前半レースは良くなかった。急いでリングを外します。（コメント自信度・・★☆☆）",
    "一行目<br />二行目\n改行を含む　全角空白（コメント自信度・・★★★）",
  );
  const br = m.parsePitReportHtml(brHtml);
  expect(
    "<br>は改行、ソースの整形の改行は空白、全角空白は残す",
    br.boats[0].commentText === "一行目\n二行目 改行を含む　全角空白" &&
      br.boats[0].confidenceStars === 3,
    show(br.boats[0].commentText),
  );
  const split = (s) => m.splitConfidence(s);
  expect(
    "自信度: 半角括弧・空白の揺れ",
    same(split("本文(コメント自信度・・★★☆)"), {
      text: "本文",
      stars: 2,
      starsMax: 3,
    }) &&
      same(split("本文 （コメント自信度・・☆☆☆）"), {
        text: "本文",
        stars: 0,
        starsMax: 3,
      }),
  );
  expect(
    "自信度なし: 本文はそのまま",
    same(split("【取材者寸評】だけ"), {
      text: "【取材者寸評】だけ",
      stars: null,
      starsMax: null,
    }),
  );
  return failed;
}

/** 行の組み立て・outcome・ハッシュ・突合（rows モジュールと parser モジュールの組で評価する） */
function evaluateRows(rows, parser) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const cand = (raceGrade, raceNumber) =>
    rows.isPitReportCandidate({ raceGrade, raceNumber });
  expect(
    "候補: SGは全レース",
    [1, 6, 12].every((n) => cand("SG", n)),
  );
  expect(
    "候補: G1・G2は7R以降のみ",
    cand("G1", 7) && cand("G2", 12) && !cand("G1", 6) && !cand("G2", 1),
  );
  expect(
    "候補: G3・一般戦・NULLは対象外",
    !cand("G3", 12) && !cand("ippan", 12) && !cand(null, 12) && !cand("", 12),
  );
  expect(
    "候補: レース番号の範囲外",
    !cand("SG", 0) && !cand("SG", 13) && !cand("SG", null),
  );
  const o = rows.outcomeForStatus;
  expect(
    "status→outcome",
    o("comments") === "ok" &&
      o("not_target") === "skipped_not_target" &&
      o("not_target_race") === "skipped_not_target" &&
      o("target_pending") === "no_values" &&
      o("no_data") === "no_values" &&
      o("unrecognized") === "error",
  );
  const p12 = parser.parsePitReportHtml(R12);
  const built = rows.buildPitReportRows(p12, { raceId: "2026-09-18-05-12" });
  expect(
    "published の行: レース単位・艇ごと",
    built.report.status === "published" &&
      built.report.comment_count === 6 &&
      built.comments.length === 6 &&
      built.report.reporter_name === "八王子 スゴ六" &&
      built.report.parser_version === "pitreport/v1",
  );
  expect(
    "艇ごとの行の値（★・前走・登録番号・本文）",
    built.comments[0].confidence_stars === 1 &&
      built.comments[0].previous_race_number === 7 &&
      built.comments[0].racer_id === 4371 &&
      built.comments[0].comment_text.startsWith("整備をしたけど"),
  );
  const built10 = rows.buildPitReportRows(parser.parsePitReportHtml(R10), {
    raceId: "2026-09-18-05-10",
  });
  expect(
    "自信度なし・前走なしは NULL で保存",
    built10.comments[2].confidence_stars === null &&
      built10.comments[0].previous_race_number === null,
  );
  const nt = rows.buildPitReportRows(parser.parsePitReportHtml(FINAL_DAY), {
    raceId: "2026-09-21-05-07",
  });
  expect(
    "not_target の行: 範囲を持ち、コメントは無い",
    nt.report.status === "not_target" &&
      nt.report.target_from === 12 &&
      nt.report.target_to === 12 &&
      nt.comments.length === 0 &&
      nt.report.comment_count === 0,
  );
  expect(
    "未公開・データなしは行を作らない",
    rows.buildPitReportRows(parser.parsePitReportHtml(PENDING), {
      raceId: "x",
    }) === null &&
      rows.buildPitReportRows(parser.parsePitReportHtml(NO_DATA), {
        raceId: "x",
      }) === null,
  );
  const h1 = rows.computeContentHash(p12);
  const noisy = parser.parsePitReportHtml(
    R12.replace("</body>", "<!-- ad -->  <div>広告</div></body>").replace(
      /<title>[^<]*<\/title>/,
      "<title>別のタイトル</title>",
    ),
  );
  expect(
    "内容ハッシュ: HTMLの体裁（広告・タイトル）が変わっても同じ",
    rows.computeContentHash(noisy) === h1,
  );
  const edited = parser.parsePitReportHtml(
    R12.replace("急いでリングを外します。", "急いでリングを交換します。"),
  );
  expect(
    "内容ハッシュ: コメントの本文が変わると変わる",
    rows.computeContentHash(edited) !== h1,
  );
  const starEdited = parser.parsePitReportHtml(
    R12.replace("（コメント自信度・・★☆☆）", "（コメント自信度・・★★☆）"),
  );
  expect(
    "内容ハッシュ: ★が変わると変わる",
    rows.computeContentHash(starEdited) !== h1,
  );
  const mm = rows.findRacerMismatches(p12.boats, [
    { boat_number: 1, racer_id: 4371 },
    { boat_number: 2, racer_id: 9999 },
    { boat_number: 3, racer_id: null },
  ]);
  expect(
    "突合: 登録番号が違う艇だけ不一致（出走表が無い・NULLの艇は突合しない）",
    mm.length === 1 && mm[0].startsWith("2号艇"),
  );
  const pr = rows.pendingRetrySec;
  expect(
    "未公開の再試行の間隔: 発走30分より前は10分・30分前〜発走後10分は5分・それ以降は20分",
    pr(150) === 600 &&
      pr(31) === 600 &&
      pr(30) === 300 &&
      pr(0) === 300 &&
      pr(-10) === 300 &&
      pr(-11) === 1200 &&
      pr(Number.NaN) === 300,
  );
  return failed;
}

const parserFailed = evaluateParser(realParser);
check(
  "(a) パーサー: 実ページ・想定外のページ・自信度・改行の評価がすべて通る",
  parserFailed.length === 0,
  parserFailed.join(" / "),
);
const rowsFailed = evaluateRows(realRows, realParser);
check(
  "(b) 行の組み立て・outcome・ハッシュ・突合の評価がすべて通る",
  rowsFailed.length === 0,
  rowsFailed.join(" / "),
);
check(
  "URL: race_id から公式のピットレポートのURLを作る",
  buildPitReportUrl("2026-09-18-05-12") ===
    "https://www.boatrace.jp/owpc/pc/race/pitreport?rno=12&jcd=05&hd=20260918" &&
    buildPitReportUrl("2026-09-21-17-07").includes("rno=7&jcd=17&hd=20260921"),
);
{
  let threw = false;
  try {
    buildPitReportUrl("2026-09-18-5-12");
  } catch {
    threw = true;
  }
  check("URL: 形式の不正な race_id は例外", threw);
}
{
  let err = null;
  try {
    await fetchPitReportHtml("https://x", async () => ({
      ok: false,
      status: 500,
    }));
  } catch (e) {
    err = e;
  }
  check(
    "取得: 200以外は PitReportHttpError",
    err instanceof PitReportHttpError && err.status === 500,
  );
}

// ---------------------------------------------------------------------------
// 偽クライアント（PostgREST の最小限）
// ---------------------------------------------------------------------------
function createFakeClient({
  tables = {},
  missingTables = [],
  failOps = {},
  storageError = null,
} = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  );
  const calls = [];
  const uploads = [];
  const matches = (row, filters) =>
    filters.every(([kind, column, a, b]) => {
      if (kind === "eq") return row[column] === a;
      if (kind === "in") return a.includes(row[column]);
      if (kind === "not") {
        if (a === "in") {
          const list = String(b).replace(/[()]/g, "").split(",").map(Number);
          return !list.includes(row[column]);
        }
        if (a === "is")
          return row[column] !== null && row[column] !== undefined;
      }
      return true;
    });
  const execute = (q) => {
    calls.push({
      table: q.table,
      op: q.op,
      rows: q.payload,
      opts: q.opts,
      filters: q.filters,
    });
    if (missingTables.includes(q.table)) {
      return {
        data: null,
        error: {
          code: "PGRST205",
          message: `Could not find the table 'public.${q.table}' in the schema cache`,
        },
      };
    }
    const failure = failOps[`${q.table}:${q.op}`];
    if (failure) return { data: null, error: { message: failure } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      if (q.limit === 0) return { data: [], error: null };
      const found = rows
        .filter((r) => matches(r, q.filters))
        .map((r) => ({ ...r }));
      return { data: q.single ? (found[0] ?? null) : found, error: null };
    }
    if (q.op === "delete") {
      state[q.table] = rows.filter((r) => !matches(r, q.filters));
      return { data: null, error: null };
    }
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    for (const row of q.payload) {
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        if (!q.opts?.ignoreDuplicates) Object.assign(existing, row);
      } else {
        rows.push({ ...row });
      }
    }
    return {
      data: q.returning ? q.payload.map((r) => ({ race_id: r.race_id })) : null,
      error: null,
    };
  };
  const from = (table) => {
    const q = {
      table,
      op: "select",
      filters: [],
      payload: null,
      opts: null,
      limit: null,
      single: false,
      returning: false,
    };
    const b = {
      select: () => {
        if (q.op === "upsert") q.returning = true;
        return b;
      },
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      not: (c, op, v) => (q.filters.push(["not", c, op, v]), b),
      limit: (n) => ((q.limit = n), b),
      maybeSingle: () => ((q.single = true), b),
      upsert: (rows, opts) => (
        (q.op = "upsert"),
        (q.payload = rows),
        (q.opts = opts),
        b
      ),
      delete: () => ((q.op = "delete"), b),
      then: (resolve, reject) =>
        Promise.resolve(execute(q)).then(resolve, reject),
    };
    return b;
  };
  const storage = {
    from: (bucket) => ({
      upload: async (p, body, opts) => {
        if (storageError)
          return { data: null, error: { message: storageError } };
        uploads.push({ bucket, path: p, bytes: body.length, opts });
        return { data: { path: p }, error: null };
      },
    }),
  };
  return { from, storage, state, calls, uploads };
}
const writes = (client) =>
  client.calls.filter((c) => c.op === "upsert" || c.op === "delete");
const RACE_ID = "2026-09-18-05-12";
const ENTRIES = [
  { race_id: RACE_ID, boat_number: 1, racer_id: 4371 },
  { race_id: RACE_ID, boat_number: 2, racer_id: 4335 },
  { race_id: RACE_ID, boat_number: 3, racer_id: 4573 },
  { race_id: RACE_ID, boat_number: 4, racer_id: 4264 },
  { race_id: RACE_ID, boat_number: 5, racer_id: 4095 },
  { race_id: RACE_ID, boat_number: 6, racer_id: 4500 },
];
const G1_RACE = { race_grade: "G1", race_number: 12 };
const freshClient = (opts = {}) => {
  const c = createFakeClient({
    tables: {
      race_entries: ENTRIES,
      race_pit_reports: [],
      race_pit_comments: [],
    },
    ...opts,
  });
  clearPitReportSchemaCache(c);
  return c;
};

// ---------------------------------------------------------------------------
// (c) 取得ジョブ
// ---------------------------------------------------------------------------
/** 取得ジョブの評価（変異検証で、壊した版にも同じ評価をかける） */
async function evaluateJob(processFn) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const go = (over) =>
    processFn({
      raceId: RACE_ID,
      race: G1_RACE,
      mode: "live",
      fetchHtml: async () => R12,
      client: freshClient(),
      ...over,
    });

  // shadow: 取得・解析のみ。DBにもStorageにも触れない
  {
    const client = freshClient();
    const r = await go({ mode: "shadow", client });
    expect(
      "shadow: 何も書かず、resultDigest を返す",
      r.outcome === "ok" &&
        r.rowsWritten === 0 &&
        typeof r.resultDigest === "string" &&
        r.resultDigest.length === 64 &&
        client.calls.length === 0 &&
        client.uploads.length === 0,
    );
  }
  // live: 書く。順序は 艇ごと → レース単位
  {
    const client = freshClient();
    const r = await go({ client });
    expect(
      "live: ok。艇ごと6行＋レース単位1行を書く",
      r.outcome === "ok" &&
        r.rowsWritten === 7 &&
        client.state.race_pit_comments.length === 6 &&
        client.state.race_pit_reports.length === 1 &&
        r.rowsParsed === 6 &&
        r.rowsExpected === 1,
    );
    const order = writes(client)
      .filter((c) => c.op === "upsert")
      .map((c) => c.table);
    expect(
      "書く順序: race_pit_comments → race_pit_reports（レース単位の行が「完了」の目印）",
      same(order, ["race_pit_comments", "race_pit_reports"]),
    );
    const rep = client.state.race_pit_reports[0];
    expect(
      "レース単位の行: status・ハッシュ・保管パス・更新時刻",
      rep.status === "published" &&
        rep.comment_count === 6 &&
        rep.content_hash === r.resultDigest &&
        /^raw\/pitreport\/2026-09-18\/2026-09-18-05-12\/[0-9a-f]{16}\.html\.gz$/.test(
          rep.raw_storage_path,
        ) &&
        typeof rep.updated_at === "string",
    );
    expect(
      "生HTMLを1件、gzipして保管する",
      client.uploads.length === 1 &&
        client.uploads[0].path === rep.raw_storage_path &&
        client.uploads[0].opts.contentType === "application/gzip",
    );
    expect(
      "コメント本文は公式の表記のまま保存される（自信度の末尾なし）",
      client.state.race_pit_comments[0].comment_text ===
        "整備をしたけど、前半レースは良くなかった。急いでリングを外します。" &&
        client.state.race_pit_comments[0].confidence_stars === 1,
    );

    // 同じ内容の再取得は、何も書かない・保管もしない
    const before = client.calls.length;
    const again = await go({ client });
    expect(
      "同じ内容の再取得: 書き込み0件・保管なし（変更の無い行は書かない）",
      again.outcome === "ok" &&
        again.rowsWritten === 0 &&
        writes(client).length === 2 &&
        client.uploads.length === 1 &&
        client.calls.length > before,
    );
    // 内容が変わったら書き直す
    const edited = R12.replace(
      "急いでリングを外します。",
      "急いでリングを交換します。",
    );
    const changed = await go({ client, fetchHtml: async () => edited });
    expect(
      "内容が変わった再取得: 変更のある行だけ書き直し、生HTMLも新しく保管する",
      changed.outcome === "ok" &&
        changed.rowsWritten === 2 &&
        client.state.race_pit_comments[0].comment_text.includes("交換") &&
        client.uploads.length === 2 &&
        client.state.race_pit_reports[0].content_hash === changed.resultDigest,
    );
    // 更新で艇が減った場合は、残らない
    const fewer = R12.replace(
      /<tbody>\s*<tr>\s*<td class="is-boatColor6"[\s\S]*?<\/tbody>/,
      "",
    );
    const fewerResult = await go({ client, fetchHtml: async () => fewer });
    // 艇の行が5件は想定外（anomalies）のため書かない
    expect(
      "艇の行が6件でない（想定外）は書かず error",
      fewerResult.outcome === "error" &&
        /parse_anomaly/.test(fewerResult.error) &&
        client.state.race_pit_comments.length === 6,
    );
  }
  // 未適用のDB
  {
    const client = freshClient({
      missingTables: ["race_pit_reports", "race_pit_comments"],
    });
    const r = await go({ client });
    expect(
      "085が未適用のDB: 書かず error（成功にしない。理由を残す）",
      r.outcome === "error" &&
        /085/.test(r.error) &&
        writes(client).length === 0 &&
        client.uploads.length === 0,
    );
    const shadow = await go({ client, mode: "shadow" });
    expect(
      "085が未適用でも shadow は動く（取得・解析のみ）",
      shadow.outcome === "ok",
    );
  }
  // 登録番号の不一致
  {
    const client = freshClient();
    client.state.race_entries[1].racer_id = 1234;
    const r = await go({ client });
    expect(
      "出走表の登録番号と不一致: 書かず error",
      r.outcome === "error" &&
        /2号艇/.test(r.error) &&
        writes(client).length === 0,
    );
  }
  // 対象外のレース（G3・一般戦・G1の6R以前）は、取得しない
  {
    let fetched = 0;
    const client = freshClient();
    for (const race of [
      { race_grade: "G3", race_number: 12 },
      { race_grade: "ippan", race_number: 12 },
      { race_grade: "G1", race_number: 6 },
    ]) {
      const r = await go({
        client,
        race,
        fetchHtml: async () => (fetched++, R12),
      });
      expect(
        `対象外(${race.race_grade} ${race.race_number}R): 取得せず skipped_not_target`,
        r.outcome === "skipped_not_target" && r.rowsWritten === 0,
      );
    }
    expect("対象外のレースでは、取得（HTTP）を1回もしない", fetched === 0);
  }
  // ページ側が対象外と答えた場合（最終日のG1 7R）
  {
    const client = freshClient();
    const r = await go({
      client,
      raceId: "2026-09-21-05-07",
      race: { race_grade: "G1", race_number: 7 },
      fetchHtml: async () => FINAL_DAY,
    });
    expect(
      "ページが対象外（最終日）: skipped_not_target・not_target の行を1件（範囲つき）",
      r.outcome === "skipped_not_target" &&
        client.state.race_pit_reports.length === 1 &&
        client.state.race_pit_reports[0].status === "not_target" &&
        client.state.race_pit_reports[0].target_from === 12 &&
        client.state.race_pit_comments.length === 0 &&
        client.uploads.length === 0,
    );
  }
  // 未公開・データなし・想定外
  {
    const client = freshClient();
    const pending = await go({ client, fetchHtml: async () => PENDING });
    expect(
      "未公開(対象レースで表が空): no_values・何も書かない",
      pending.outcome === "no_values" &&
        writes(client).length === 0 &&
        client.uploads.length === 0,
    );
    const pendingReal = await go({
      client,
      fetchHtml: async () => PENDING_REAL,
    });
    expect(
      "未公開の実ページ（表はあるがコメント欄が空）: no_values・何も書かない（rowsParsed なし）",
      pendingReal.outcome === "no_values" &&
        writes(client).length === 0 &&
        pendingReal.rowsParsed === undefined,
    );
    const nodata = await go({ client, fetchHtml: async () => NO_DATA });
    expect(
      "データなし: no_values・何も書かない",
      nodata.outcome === "no_values" && writes(client).length === 0,
    );
    const junk = await go({
      client,
      fetchHtml: async () => "<html><body>x</body></html>",
    });
    expect(
      "想定外の構造: error（parse_anomaly）",
      junk.outcome === "error" && /parse_anomaly/.test(junk.error),
    );
    expect(
      "races に行が無い: error",
      (await go({ client, race: null })).outcome === "error",
    );
  }
  // 取得の失敗は例外のまま（共通ラッパが error として記録する）
  {
    let threw = false;
    try {
      await go({
        fetchHtml: async () => {
          throw new PitReportHttpError("u", 500);
        },
      });
    } catch {
      threw = true;
    }
    expect("取得の失敗（HTTP 500）は握りつぶさず例外", threw);
  }
  // 書き込みの失敗
  {
    const client = freshClient({
      failOps: { "race_pit_comments:upsert": "boom" },
    });
    const r = await go({ client });
    expect(
      "艇ごとの書き込みに失敗したら、レース単位の行を書かず error（次の取得が書き直す）",
      r.outcome === "error" &&
        /boom/.test(r.error) &&
        client.state.race_pit_reports.length === 0,
    );
  }
  // 保管の失敗は取得を止めない
  {
    const client = freshClient({ storageError: "Bucket not found" });
    const r = await go({ client, archive: (c, p) => archiveRawHtml(c, p) });
    expect(
      "生HTMLの保管に失敗しても書き込みは成功（保管パスはNULL）",
      r.outcome === "ok" &&
        client.state.race_pit_reports[0].raw_storage_path === null &&
        client.state.race_pit_comments.length === 6,
    );
  }
  return failed;
}
const jobFailed = await evaluateJob(processPitReportRace);
check(
  "(c) 取得ジョブ: shadow/live・冪等・順序・未適用・不一致・対象外・失敗の評価がすべて通る",
  jobFailed.length === 0,
  jobFailed.join(" / "),
);
check(
  "保管パス: 内容ハッシュで一意（同じ内容は同じパス）",
  rawHtmlPath({
    pageType: "pitreport",
    raceId: RACE_ID,
    contentHash: "a".repeat(64),
  }) === `raw/pitreport/2026-09-18/${RACE_ID}/${"a".repeat(16)}.html.gz`,
);
{
  const c = createFakeClient();
  clearPitReportSchemaCache(c);
  check(
    "スキーマ判定: テーブルがあれば true",
    (await detectPitReportSchema(c)) === true,
  );
  const missing = createFakeClient({ missingTables: ["race_pit_comments"] });
  check(
    "スキーマ判定: 片方でも無ければ false（キャッシュされ、再確認しない）",
    (await detectPitReportSchema(missing)) === false &&
      (await detectPitReportSchema(missing)) === false &&
      missing.calls.filter((x) => x.table === "race_pit_comments").length === 1,
  );
  const flaky = createFakeClient({
    failOps: { "race_pit_reports:select": "network" },
  });
  const first = await detectPitReportSchema(flaky, { warn: () => {} });
  const second = await detectPitReportSchema(flaky, { warn: () => {} });
  check(
    "スキーマ判定: 通信エラーは false（書かない）で、キャッシュしない",
    first === false &&
      second === false &&
      flaky.calls.filter((x) => x.table === "race_pit_reports").length === 2,
  );
}

// ---------------------------------------------------------------------------
// (d) 共通ラッパ
// ---------------------------------------------------------------------------
const SLOT = {
  job: PIT_REPORT_JOB,
  race_id: RACE_ID,
  offset_min: SCRAPE_JOBS.pit_reports.offsets[0],
  lease_until: new Date(Date.now() + 60000).toISOString(),
  attempts: 1,
};
const NOW = () => new Date("2026-09-18T14:00:00+09:00");
async function runWrapped({ mode, rows, client, fetched }) {
  const store = createMemoryStore({
    rows: rows ?? {
      [PIT_REPORT_JOB]: { job: PIT_REPORT_JOB, mode, consecutive_failures: 0 },
    },
    slots: [SLOT],
  });
  const handleSlot = createPitReportSlotHandler({
    load: async () => G1_RACE,
    process: (params) =>
      processPitReportRace({
        ...params,
        fetchHtml: async () => (fetched.count++, R12),
      }),
  });
  const result = await runScrapeJob({
    job: PIT_REPORT_JOB,
    store,
    handleSlot,
    now: NOW,
    client,
    modeGated: true,
    politeFetch: async () => {
      throw new Error("使わない");
    },
  });
  return { result, store };
}
{
  const fetched = { count: 0 };
  const client = freshClient();
  const off = await runWrapped({ mode: "off", client, fetched });
  check(
    "(d) off: 何も取得せず、DBにも予定表にも書かない",
    off.result.body.skipped === "mode_off" &&
      fetched.count === 0 &&
      client.calls.length === 0 &&
      off.store.completed.length === 0 &&
      off.store.retried.length === 0,
  );
  const noRow = await runWrapped({ rows: {}, client, fetched });
  check(
    "(d) 行なし: off として扱い、何も取得しない（行を作るのみ）",
    noRow.result.body.skipped === "mode_off" &&
      fetched.count === 0 &&
      client.calls.length === 0 &&
      noRow.store.state.get(PIT_REPORT_JOB)?.mode === "off",
  );
  const shadow = await runWrapped({ mode: "shadow", client, fetched });
  check(
    "(d) shadow: 取得・解析のみ。データにもStorageにも書かず、予定表に result_digest を残す",
    fetched.count === 1 &&
      client.calls.length === 0 &&
      client.uploads.length === 0 &&
      shadow.store.completed.length === 1 &&
      shadow.store.completed[0].outcome === "ok" &&
      shadow.store.completed[0].resultDigest?.length === 64 &&
      shadow.store.completed[0].rowsWritten === 0,
  );
  const live = await runWrapped({ mode: "live", client, fetched });
  check(
    "(d) live: 書き込み、予定表を完了にする",
    client.state.race_pit_comments.length === 6 &&
      live.store.completed.length === 1 &&
      live.store.completed[0].rowsWritten === 7,
  );
  {
    // 未公開のレース: 発走まで150分。再試行は10分間隔（claim した時刻から590秒後）で、共通ラッパの既定（300秒）を上書きする
    const claimedAt = "2026-09-18T13:59:30+09:00";
    const store = createMemoryStore({
      rows: {
        [PIT_REPORT_JOB]: {
          job: PIT_REPORT_JOB,
          mode: "live",
          consecutive_failures: 0,
        },
      },
      slots: [{ ...SLOT, last_attempt_at: claimedAt }],
    });
    await runScrapeJob({
      job: PIT_REPORT_JOB,
      store,
      now: NOW,
      client: freshClient(),
      politeFetch: async () => {
        throw new Error("使わない");
      },
      handleSlot: createPitReportSlotHandler({
        load: async () => ({
          ...G1_RACE,
          race_date: "2026-09-18",
          start_time: "16:30:00",
        }),
        process: (p) =>
          processPitReportRace({ ...p, fetchHtml: async () => PENDING }),
      }),
    });
    const retried = store.retried[0];
    check(
      "(d) 未公開: 発走までの時間に応じた間隔（150分前→10分）で再試行する",
      store.retried.length === 1 &&
        retried.outcome === "no_values" &&
        new Date(retried.retryAt).getTime() ===
          new Date(claimedAt).getTime() + 590 * 1000,
      show(retried?.retryAt),
    );
  }
}
{
  // 対象外で終端（最終日のG1 7R）は完了。未公開は再試行
  const store = createMemoryStore({
    rows: {
      [PIT_REPORT_JOB]: {
        job: PIT_REPORT_JOB,
        mode: "live",
        consecutive_failures: 0,
      },
    },
    slots: [
      { ...SLOT, race_id: "2026-09-21-05-07" },
      { ...SLOT, race_id: "2026-09-21-05-12" },
    ],
  });
  const client = freshClient();
  await runScrapeJob({
    job: PIT_REPORT_JOB,
    store,
    now: NOW,
    client,
    politeFetch: async () => {
      throw new Error("使わない");
    },
    handleSlot: createPitReportSlotHandler({
      load: async (_c, id) => ({
        race_grade: "G1",
        race_number: Number(id.slice(-2)),
      }),
      process: (p) =>
        processPitReportRace({
          ...p,
          fetchHtml: async () =>
            p.raceId.endsWith("07") ? FINAL_DAY : PENDING,
        }),
    }),
  });
  const byRace = Object.fromEntries([
    ...store.completed.map((c) => [c.slot.race_id, "done:" + c.outcome]),
    ...store.retried.map((c) => [c.slot.race_id, "retry:" + c.outcome]),
  ]);
  check(
    "(d) 対象外で終端は完了（skipped_not_target）・未公開は再試行（no_values）",
    byRace["2026-09-21-05-07"] === "done:skipped_not_target" &&
      byRace["2026-09-21-05-12"] === "retry:no_values",
    show(byRace),
  );
  check(
    "(d) skipped_not_target は完了の outcome",
    isFinalOutcome("skipped_not_target") &&
      isFinalOutcome("ok") &&
      !isFinalOutcome("no_values"),
  );
  const mk = (outcome, doneAt) => ({
    job: PIT_REPORT_JOB,
    race_id: "r",
    offset_min: -60,
    race_date: "2026-09-21",
    status: "done",
    outcome,
    run_mode: "live",
    done_at: doneAt,
    races: { start_time: "16:30:00", cancellation_status: null },
  });
  const stats = computeWindowStats([
    mk("ok", "2026-09-21T06:00:00Z"),
    mk("skipped_not_target", "2026-09-21T06:00:00Z"),
  ]);
  check(
    "(d) 監視: skipped_not_target は窓内取得率の分母に入れない",
    stats.length === 1 && stats[0].total === 1,
    show(stats),
  );
}

// ---------------------------------------------------------------------------
// (e) 予定表: 対象レースにだけスロットを作る
// ---------------------------------------------------------------------------
{
  const races = [];
  for (let n = 1; n <= 12; n++) {
    const t = `${String(10 + Math.floor(n / 2)).padStart(2, "0")}:${n % 2 ? "05" : "40"}:00`;
    races.push({
      race_id: `2026-09-21-01-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "SG",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-05-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "G1",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-17-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "G3",
      start_time: t,
    });
    races.push({
      race_id: `2026-09-21-03-${String(n).padStart(2, "0")}`,
      race_date: "2026-09-21",
      race_number: n,
      race_grade: "ippan",
      start_time: t,
    });
  }
  races.push({
    race_id: "2026-09-21-09-01",
    race_date: "2026-09-21",
    race_number: 1,
    race_grade: "SG",
    start_time: null,
  });
  const client = createFakeClient({ tables: { races, scrape_slots: [] } });
  // 期限が過ぎていない時刻（朝）
  const store = createPitReportStore(client, { base: {} });
  const created = await store.ensureSlots({
    date: "2026-09-21",
    jobs: [PIT_REPORT_JOB],
    now: new Date("2026-09-21T07:00:00+09:00"),
  });
  const slots = client.state.scrape_slots;
  const ids = slots.map((s) => s.race_id);
  check(
    "(e) 予定表: SG全12レース＋G1の7R〜12R（6レース）の18件だけを作る",
    created === 18 && slots.length === 18,
    `created=${created}`,
  );
  check(
    "(e) 予定表: G3・一般戦・発走時刻なしのスロットは作らない",
    !ids.some((id) => ["17", "03", "09"].includes(id.split("-")[3])),
  );
  check(
    "(e) 予定表: G1の1R〜6Rは作らない・SGの1Rは作る",
    !ids.includes("2026-09-21-05-06") &&
      ids.includes("2026-09-21-05-07") &&
      ids.includes("2026-09-21-01-01"),
  );
  check(
    "(e) 予定表: job・offset・race_date を持ち、二重生成は ignoreDuplicates",
    slots.every(
      (s) =>
        s.job === PIT_REPORT_JOB &&
        s.offset_min === SCRAPE_JOBS.pit_reports.offsets[0] &&
        s.race_date === "2026-09-21",
    ) && client.calls.at(-1).opts.ignoreDuplicates === true,
  );
  const again = await store.ensureSlots({
    date: "2026-09-21",
    jobs: [PIT_REPORT_JOB],
    now: new Date("2026-09-21T07:00:00+09:00"),
  });
  check(
    "(e) 予定表: 2回目は増えない（冪等）",
    (client.state.scrape_slots.length === 18 &&
      again ===
        18) /* 偽クライアントは returning で件数を返す。実DBは新規のみ */ ||
      client.state.scrape_slots.length === 18,
  );
  const lateClient = createFakeClient({ tables: { races, scrape_slots: [] } });
  const late = await createPitReportStore(lateClient, { base: {} }).ensureSlots(
    {
      date: "2026-09-21",
      jobs: [PIT_REPORT_JOB],
      now: new Date("2026-09-22T09:00:00+09:00"),
    },
  );
  check(
    "(e) 予定表: 期限＋許容幅を過ぎたレースのスロットは作らない（有効化が遅い日の一斉 expired を防ぐ）",
    late === 0 && lateClient.state.scrape_slots.length === 0,
  );
  const failClient = createFakeClient({
    tables: { races: [] },
    failOps: { "races:select": "db down" },
  });
  let threw = false;
  try {
    await createPitReportStore(failClient, { base: {} }).ensureSlots({
      date: "2026-09-21",
      jobs: [PIT_REPORT_JOB],
    });
  } catch (e) {
    threw = /db down/.test(e.message);
  }
  check("(e) 予定表: races の取得失敗は、対象なしに化けさせず例外", threw);
}

// ---------------------------------------------------------------------------
// (f) 配線・DDL
// ---------------------------------------------------------------------------
{
  const api = fs.readFileSync(
    path.join(ROOT, "api/cron/pit-reports.js"),
    "utf8",
  );
  const declared = Number(/maxDuration:\s*(\d+)/.exec(api)?.[1]);
  check(
    "(f) api/cron/pit-reports.js の maxDuration がレジストリと一致",
    declared === SCRAPE_JOBS.pit_reports.maxDurationSec,
    `${declared} vs ${SCRAPE_JOBS.pit_reports.maxDurationSec}`,
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const cron = vercel.crons.filter((c) => c.path === "/api/cron/pit-reports");
  check(
    "(f) vercel.json: cron は毎分・UTC 22〜15時（JST 07:00〜翌00:55。他の窓型ジョブと同じ。死活の閾値との整合）",
    cron.length === 1 && cron[0].schedule === "* 22-23,0-15 * * *",
  );
  check(
    "(f) レジストリの整合（リース<許容幅、waves×見積り<リース 等）",
    same(validateRegistry(), []),
    show(validateRegistry()),
  );
  const windowFailed = evaluateWindow(SCRAPE_JOBS);
  check(
    "(f) pit_reports の窓: 開始が実測した公開時刻（発走の120〜180分前）より前・終わりが発走+60分以降",
    windowFailed.length === 0,
    windowFailed.join(" / "),
  );
  check(
    "(f) pit_reports: 窓型・対象ホスト boatrace.jp",
    SCRAPE_JOBS.pit_reports.kind === "window" &&
      same(SCRAPE_JOBS.pit_reports.hosts, ["boatrace.jp"]),
  );

  const ddl085 = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/085_race_pit_reports.sql"),
    "utf8",
  );
  const ddl086 = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/086_race_pit_reports_public_read.sql"),
    "utf8",
  );
  const columnsOf = (sql, table) => {
    const body =
      new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,
      ).exec(sql)?.[1] ?? "";
    return body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) =>
        /^[a-z_]+\s+(varchar|text|smallint|integer|timestamptz)/.test(l),
      )
      .map((l) => l.split(/\s+/)[0]);
  };
  const built = realRows.buildPitReportRows(
    realParser.parsePitReportHtml(R12),
    { raceId: RACE_ID },
  );
  const reportCols = columnsOf(ddl085, "race_pit_reports");
  const commentCols = columnsOf(ddl085, "race_pit_comments");
  const codeReportKeys = Object.keys(built.report);
  const codeCommentKeys = Object.keys(built.comments[0]);
  check(
    "(f) DDL(085): race_pit_reports の列が、コードが書く行の列（＋created_at・updated_at）と一致",
    same(
      [...reportCols].sort(),
      [...codeReportKeys, "created_at", "updated_at"].sort(),
    ),
    `${reportCols} / ${codeReportKeys}`,
  );
  check(
    "(f) DDL(085): race_pit_comments の列が、コードが書く行の列（＋created_at・updated_at）と一致",
    same(
      [...commentCols].sort(),
      [...codeCommentKeys, "created_at", "updated_at"].sort(),
    ),
    `${commentCols} / ${codeCommentKeys}`,
  );
  check(
    "(f) DDL(085): 2表ともRLS有効・anon/authenticated の権限を剥奪・ポリシーなし（書き込みは service_role のみ）",
    /ALTER TABLE race_pit_reports ENABLE ROW LEVEL SECURITY/.test(ddl085) &&
      /ALTER TABLE race_pit_comments ENABLE ROW LEVEL SECURITY/.test(ddl085) &&
      /REVOKE ALL ON race_pit_reports FROM anon, authenticated/.test(ddl085) &&
      /REVOKE ALL ON race_pit_comments FROM anon, authenticated/.test(ddl085) &&
      !/CREATE POLICY/.test(ddl085.replace(/--[^\n]*/g, "")),
  );
  check(
    "(f) DDL(085): status の値・★の範囲・艇番の範囲が、コードの値と一致",
    /status IN \('published', 'not_target'\)/.test(ddl085) &&
      /confidence_stars BETWEEN 0 AND 3/.test(ddl085) &&
      /boat_number BETWEEN 1 AND 6/.test(ddl085) &&
      built.report.status === "published",
  );
  const body086 = ddl086.replace(/--[^\n]*/g, "");
  check(
    "(f) DDL(086): 匿名に SELECT のみ（FOR SELECT のポリシー＋GRANT SELECT。書き込み系の権限・ポリシーなし）",
    /CREATE POLICY race_pit_reports_public_read[\s\S]*?FOR SELECT TO anon, authenticated USING \(true\)/.test(
      body086,
    ) &&
      /CREATE POLICY race_pit_comments_public_read[\s\S]*?FOR SELECT TO anon, authenticated USING \(true\)/.test(
        body086,
      ) &&
      /GRANT SELECT ON public\.race_pit_reports TO anon, authenticated/.test(
        body086,
      ) &&
      !/(INSERT|UPDATE|DELETE|FOR ALL)/i.test(body086),
  );
  const applied = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/APPLIED.md"),
    "utf8",
  );
  check(
    // 適用状況（適用済み/未適用）は本番の進行に伴って変わるため、行の存在だけを見る。
    // 086の「未適用」を期待値に固定していたため、2026-09-23に適用された時点で壊れていた。
    "(f) 台帳: 085と086の行が載っている",
    /\| 085 \|[^\n]*\|/.test(applied) && /\| 086 \|[^\n]*\|/.test(applied),
  );
}

// ---------------------------------------------------------------------------
// (g) 変異検証: 壊した版で、(a)(b)(c) の評価が失敗する
// ---------------------------------------------------------------------------
const LIB = path.join(ROOT, "scripts/lib");
async function withMutant(fileName, replacements, runFn) {
  const source = fs.readFileSync(path.join(LIB, fileName), "utf8");
  let mutated = source;
  for (const [from, to] of replacements) {
    if (!mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 60)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmp = path.join(
    LIB,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await runFn(await import(`${tmp}?t=${Date.now()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
/** 変異で壊れた版は、評価の途中で例外になることがある。例外も「検証が失敗した」として数える */
const safeEval = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return [`例外: ${e.message}`];
  }
};
const parserMutants = [
  [
    "★の数を、空（☆）の数にする",
    [['filter((c) => c === "★")', 'filter((c) => c === "☆")']],
  ],
  [
    "本文から自信度の末尾を分離しない",
    [
      [
        'text: source.slice(0, m.index).replace(/\\s+$/u, ""),',
        "text: source,",
      ],
    ],
  ],
  [
    "最終日の「12Rが」を単独の範囲にしない（toを常に空にする）",
    [
      [
        "to: range[2] ? Number(range[2]) : from }",
        "to: range[2] ? Number(range[2]) : 0 }",
      ],
    ],
  ],
  [
    "「表示対象レースではありません」を判別しない",
    [['if (text.includes("表示対象レースではありません")) {', "if (false) {"]],
  ],
  [
    "艇の行を見つけない",
    [["[class*='is-boatColor']", "[class*='is-boatColorX']"]],
  ],
  [
    "前走を読まない",
    [
      [
        "previousRaceNumber: prevMatch ? Number(prevMatch[1]) : null,",
        "previousRaceNumber: null,",
      ],
    ],
  ],
  [
    "登録番号を読まない",
    [
      [
        "racerNumber: idMatch ? Number(idMatch[1]) : null,",
        "racerNumber: null,",
      ],
    ],
  ],
  [
    "<br>を改行にしない",
    [['.replace(/ ?\\uE000 ?/g, "\\n")', '.replace(/ ?\\uE000 ?/g, "")']],
  ],
];
for (const [label, replacements] of parserMutants) {
  const failed = await withMutant(
    "pitReportParser.js",
    replacements,
    async (m) => safeEval(() => evaluateParser(m)),
  );
  check(
    `(g) 変異検証（パーサー）: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
const rowsMutants = [
  [
    "SGを7R以降だけにする",
    [
      [
        'if (raceGrade === "SG") return true;',
        'if (raceGrade === "SG") return raceNumber >= 7;',
      ],
    ],
  ],
  ["G2を対象グレードから外す", [['["SG", "G1", "G2"]', '["SG", "G1"]']]],
  [
    "内容ハッシュにコメント本文を含めない",
    [["        b.commentText,\n", "        null,\n"]],
  ],
  [
    "未公開を ok にする",
    [["return PIT_REPORT_OUTCOMES.pending;", "return PIT_REPORT_OUTCOMES.ok;"]],
  ],
  [
    "登録番号の突合をしない",
    [
      [
        "if (b.racerNumber !== null && b.racerNumber !== expected) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "★を保存しない",
    [["confidence_stars: b.confidenceStars,", "confidence_stars: null,"]],
  ],
  [
    "未公開の再試行の間隔を、発走までの時間によらず一定にする",
    [
      [
        "if (minutesToStart > config.nearFromMin) return config.farSec;",
        "if (false) return config.farSec;",
      ],
    ],
  ],
];
// 窓（レジストリ）の変異: 当初の窓（発走60分前から）に戻すと、実測した公開時刻（120〜180分前）を取り逃がす
for (const [label, replacements] of [
  [
    "窓の開始を発走60分前に戻す（実測した公開時刻より遅い）",
    [
      [
        "offsets: [-240],\n    graceMin: 420,",
        "offsets: [-60],\n    graceMin: 420,",
      ],
    ],
  ],
  [
    "窓の終わりを発走前に縮める",
    [
      [
        "offsets: [-240],\n    graceMin: 420,",
        "offsets: [-240],\n    graceMin: 200,",
      ],
    ],
  ],
]) {
  const failed = await withMutant(
    "scrapeJobs/registry.js",
    replacements,
    async (m) => safeEval(() => evaluateWindow(m.SCRAPE_JOBS)),
  );
  check(
    `(g) 変異検証（窓）: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
for (const [label, replacements] of rowsMutants) {
  const failed = await withMutant("pitReportRows.js", replacements, async (m) =>
    safeEval(() => evaluateRows(m, realParser)),
  );
  check(
    `(g) 変異検証（行の組み立て）: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
const jobMutants = [
  ["shadow でも書く", [['mode !== "live" ||', "false ||"]]],
  [
    "内容が同じでも毎回書く",
    [["existing.content_hash === digest &&", "false &&"]],
  ],
  [
    "未適用のDBを確認せずに書く",
    [["if (!(await detectPitReportSchema(client))) {", "if (false) {"]],
  ],
  ["対象外のレースも取得する", [["!skipCandidateCheck &&", "false &&"]]],
  [
    "艇ごとの行を別の表（race_pit_reports）へ書く",
    [
      [
        '"race_pit_comments",\n      rows.comments,',
        '"race_pit_reports",\n      rows.comments,',
      ],
    ],
  ],
];
for (const [label, replacements] of jobMutants) {
  let failed;
  try {
    failed = await withMutant("pitReportJob.js", replacements, async (m) =>
      evaluateJob(m.processPitReportRace),
    );
  } catch (e) {
    failed = [`例外: ${e.message}`];
  }
  check(
    `(g) 変異検証（取得ジョブ）: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
{
  const failed = await withMutant(
    "pitReportJob.js",
    [
      [
        "isPitReportCandidate({\n            raceGrade: r.race_grade,",
        "((x) => true)({\n            raceGrade: r.race_grade,",
      ],
    ],
    async (m) => {
      const client = createFakeClient({
        tables: {
          races: [
            {
              race_id: "2026-09-21-17-12",
              race_date: "2026-09-21",
              race_number: 12,
              race_grade: "G1",
              start_time: "16:00:00",
            },
            {
              race_id: "2026-09-21-17-01",
              race_date: "2026-09-21",
              race_number: 1,
              race_grade: "G1",
              start_time: "10:00:00",
            },
          ],
          scrape_slots: [],
        },
      });
      await m.createPitReportStore(client, { base: {} }).ensureSlots({
        date: "2026-09-21",
        jobs: ["pit_reports"],
        now: new Date("2026-09-21T07:00:00+09:00"),
      });
      return client.state.scrape_slots.length === 1
        ? []
        : ["1R（対象外）にもスロットができた"];
    },
  );
  check(
    `(g) 変異検証（予定表）: 対象レースの絞り込みを外すと、対象外のスロットができる → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\nALL OK");
