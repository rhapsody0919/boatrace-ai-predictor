/**
 * verify-motor-pretest.js - 前検タイム・前検順位・節時点のモーター/ボート2連対率（N23、motor_pretest_stats。
 * tasks.md T4b-20）の取得・解析・保存・日次ジョブ・過去分CLIの検証。DBにも取得先にも接続しない
 * （実ページのフィクスチャ・インメモリのSupabaseクライアント・fetch・時計を差し替える）。
 *
 * 確認すること:
 *   (a) パーサー: 実ページ（scripts/lib/__fixtures__/motorPretest/）の項目を、見出しのラベルで解釈する。前検順位は、前検タイムの
 *       昇順で並べたページの「順位」と一致する（ページの既定の「順位」＝モーター2連対率の順位を、前検順位と取り違えない）。
 *       データが無いページ・未知のラベル・必須ラベルの欠落・想定外のセル・選手の重複は、黙って通さず unrecognized
 *   (b) 行の組み立て・書き込み: 変更の無い行は書かない（numeric の文字列と数値の差で「変更あり」に倒れない）・取得時刻 updated_at・
 *       テーブル未適用（マイグレーション090）は成功にしない
 *   (c) 日次ジョブ: off・行なしで何も取得しない・shadow は書かず対象日を処理済みにしない・live は書く・同じ日の2回目は何もしない・
 *       0件はエラー・races が無い／races_init が未完了なら取得しない・一時的な失敗の会場だけを補足の起動が再取得する・
 *       期待した選手が載っていない／前検タイムが欠けたら通知（1回きり）・構造の変化の通知・別のページを保存しない
 *   (d) 過去分CLI: 対象の会場×日（節の初日のみ・全日）・取得（窓・日次上限・サーキットブレーカー・再開・想定外の内容）・解析・投入
 *       （--apply が無ければ書かない・変更の無い行は書かない）
 *   (e) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。オッズの運用窓 07:00〜23:59 JST の外）・認証
 *
 * 実行: node scripts/maintenance/verify-motor-pretest.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  MOTOR_PRETEST_PARSER_VERSION,
  MOTOR_PRETEST_STATUSES,
  buildMotorPretestUrl,
  competitionRanks,
  parseMotorPretestHtml,
  readHeaderLabels,
} from "../lib/motorPretestParser.js";
import {
  MOTOR_PRETEST_TABLE,
  buildMotorPretestRows,
  loadExpectedRacers,
  summarizeVenueCoverage,
  writeMotorPretestRows,
} from "../lib/motorPretestRows.js";
import {
  MOTOR_PRETEST_DRIFT_ALERT_DAYS,
  buildCoverageAlerts,
  findMotorPretestDriftAlerts,
  runMotorPretestJob,
} from "../lib/motorPretestJob.js";
import * as backfill from "./motor-pretest-backfill.js";
import * as cheerio from "cheerio";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

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
const jst = (text) => new Date(`${text}+09:00`);

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const FIXTURES = path.join(ROOT, "scripts/lib/__fixtures__/motorPretest");
const fx = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const TODA = fx("rankingmotor_02_20260921.html"); // 戸田 2026-09-21（節の途中）46人
const TOKUYAMA = fx("rankingmotor_18_20260921.html"); // 徳山 2026-09-21 45人（既定の並び）
const TOKUYAMA_BY_TIME = fx("rankingmotor_18_20260921_sort5.html"); // 同じ徳山を前検タイムの昇順で並べたページ
const SALADPAN = fx("rankingmotor_11_20260922.html"); // びわこ 2026-09-22（グレード表示なし）45人
const TOKONAME = fx("rankingmotor_08_20251205.html"); // 常滑 2025-12-05（過去日）52人
const OMURA = fx("rankingmotor_24_20251204.html"); // 大村 2025-12-04（過去日・節の初日）45人
const NO_DATA = fx("rankingmotor_22_20260921.html"); // 開催の無い日・会場

/** フィクスチャを、別の会場・日付のページに見せる（同じ表を、違う会場・日付として取得した想定の検証用） */
const asPage = (html, venueCode, date) =>
  html
    .replaceAll(/hd=\d{8}/g, `hd=${date.replaceAll("-", "")}`)
    .replace(
      /text_place2_\d{2}\./,
      `text_place2_${String(venueCode).padStart(2, "0")}.`,
    );

// ===========================================================================
// (a) パーサー
// ===========================================================================
{
  const p = parseMotorPretestHtml(TODA);
  check(
    "パーサー 戸田(2026-09-21): 会場・日付・開催名・46人を読む",
    p.status === "ok" &&
      p.venueCode === 2 &&
      p.date === "2026-09-21" &&
      p.seriesTitle === "BOATBoyカップ" &&
      p.rows.length === 46 &&
      p.anomalies.length === 0,
    show({ status: p.status, v: p.venueCode, d: p.date, n: p.rows.length }),
  );
  check(
    "パーサー 荒井翔伍(4608): 級別A2・モーター43(66.6%)・ボート55(0.0%)・前検タイム6.65",
    same(p.rows[0], {
      racer_id: 4608,
      racer_class: "A2",
      motor_number: 43,
      motor_2rate: 66.6,
      boat_number: 55,
      boat_2rate: 0,
      pretest_time: 6.65,
      pretest_rank: 22,
    }),
    show(p.rows[0]),
  );
  check(
    "パーサー 開催名の全角は、NFKCで正規化する（ＢＯＡＴＢｏｙカップ → BOATBoyカップ）",
    p.seriesTitle === "BOATBoyカップ",
  );
}
{
  // 前検順位: 前検タイムの昇順のページの「順位」（公式）と、本パーサーが計算する前検順位が、全員で一致する
  const $ = cheerio.load(TOKUYAMA_BY_TIME);
  const official = new Map();
  $(".table1 tbody tr").each((_, tr) => {
    const tds = $(tr)
      .children("td")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    official.set(Number(tds[1]), Number(tds[0]));
  });
  const sorted = parseMotorPretestHtml(TOKUYAMA_BY_TIME);
  const defaultPage = parseMotorPretestHtml(TOKUYAMA);
  const mismatched = sorted.rows.filter(
    (r) => official.get(r.racer_id) !== r.pretest_rank,
  );
  check(
    "前検順位: 前検タイム昇順のページの公式の「順位」と、前検タイムから計算した順位が、45人全員で一致する（同タイムは同順位・次は飛ぶ）",
    sorted.rows.length === 45 &&
      official.size === 45 &&
      mismatched.length === 0,
    show(mismatched.slice(0, 3)),
  );
  // 既定の並び（モーター2連対率）のページでも、同じ選手・同じ前検順位になる（ページの「順位」列を読んでいない）
  const byId = (rows) => new Map(rows.map((r) => [r.racer_id, r.pretest_rank]));
  const a = byId(sorted.rows);
  const b = byId(defaultPage.rows);
  check(
    "前検順位: 並び順（sort）に依らない（既定のページと前検タイム昇順のページで、同じ選手は同じ前検順位）",
    [...a.entries()].every(([id, rank]) => b.get(id) === rank),
  );
  const first = defaultPage.rows.find((r) => r.racer_id === 4529);
  check(
    "前検順位: 既定のページで「順位1」の嶋義信(4529)の前検順位は2（ページの「順位」＝モーター2連対率の順位を、前検順位にしない）",
    first?.pretest_rank === 2 && first?.motor_2rate === 50.9,
    show(first),
  );
  check(
    "competitionRanks: 同じ値は同順位・次は飛ぶ・nullは順位なし",
    same(competitionRanks([6.7, 6.65, 6.65, null, 7]), [3, 1, 1, null, 4]),
  );
}
{
  const nd = parseMotorPretestHtml(NO_DATA);
  check(
    "パーサー 開催の無い日・会場（データがありません）は no_data・0行",
    nd.status === MOTOR_PRETEST_STATUSES.noData && nd.rows.length === 0,
    show(nd),
  );
  const mid = parseMotorPretestHtml(TOKONAME);
  const past = parseMotorPretestHtml(OMURA);
  const noClass = parseMotorPretestHtml(SALADPAN);
  check(
    "パーサー 過去日（常滑2025-12-05・52人、大村2025-12-04・45人）・グレード表示の無い開催（びわこ）も読める",
    mid.status === "ok" &&
      mid.rows.length === 52 &&
      past.status === "ok" &&
      past.rows.length === 45 &&
      past.date === "2025-12-04" &&
      noClass.status === "ok" &&
      noClass.rows.length === 45,
    show([mid.rows.length, past.rows.length, noClass.rows.length]),
  );
  check(
    "パーサー 全フィクスチャで、選手は重複せず、2連対率は0〜100・前検タイムは6〜8の範囲",
    [TODA, TOKUYAMA, SALADPAN, TOKONAME, OMURA].every((html) => {
      const rows = parseMotorPretestHtml(html).rows;
      return (
        new Set(rows.map((r) => r.racer_id)).size === rows.length &&
        rows.every(
          (r) =>
            r.motor_2rate >= 0 &&
            r.motor_2rate <= 100 &&
            r.boat_2rate >= 0 &&
            r.boat_2rate <= 100 &&
            r.pretest_time >= 6 &&
            r.pretest_time <= 8,
        )
      );
    }),
  );
  const $ = cheerio.load(TODA);
  check(
    "readHeaderLabels: 2段の見出しを、rowspan・colspan を展開して「親/子」のラベルにする",
    same(readHeaderLabels($, $(".table1 thead")), [
      "順位",
      "登録番号",
      "ボートレーサー",
      "級別",
      "モーター/番号",
      "モーター/2連対率",
      "ボート/番号",
      "ボート/2連対率",
      "前検タイム",
    ]),
  );
}
{
  // 位置ではなくラベルで解釈する: 「前検タイム」の列を、見出しも各行のセルも、級別の右（列の途中）へ移した版でも、
  // 同じ選手・同じ値を読む（位置決め打ちなら、値が別の項目に入る）
  const $ = cheerio.load(TODA);
  const headRow = $(".table1 thead tr").first();
  const timeTh = headRow.children("th").last();
  timeTh.insertAfter(headRow.children("th").eq(3));
  $(".table1 tbody tr").each((_, tr) => {
    const cells = $(tr).children("td");
    cells.last().insertAfter(cells.eq(3));
  });
  const moved = parseMotorPretestHtml($.html());
  check(
    "パーサー ラベルの解釈: 前検タイムの列を級別の右へ移した版（列の位置が違う）でも、同じ結果を読む",
    moved.status === "ok" && same(moved.rows, parseMotorPretestHtml(TODA).rows),
    show({ status: moved.status, anomalies: moved.anomalies }),
  );
  const unknownHeader = TODA.replaceAll("前検タイム", "前検タイム（参考）");
  const u = parseMotorPretestHtml(unknownHeader);
  check(
    "パーサー 未知のラベルは unrecognized（unknown_header）。行は返さない",
    u.status === "unrecognized" &&
      u.rows.length === 0 &&
      u.anomalies.some((a) => a.startsWith("unknown_header:")),
    show(u.anomalies),
  );
  const missingHeader = TODA.replace(">級別<", ">階級<");
  const m = parseMotorPretestHtml(missingHeader);
  check(
    "パーサー 必須のラベルの欠落（級別が階級に変わった）は unrecognized（missing_header:racer_class）",
    m.status === "unrecognized" &&
      m.anomalies.includes("missing_header:racer_class"),
    show(m.anomalies),
  );
  const badCell = TODA.replace(/<td>6\.65\s*<\/td>/, "<td>abc</td>");
  const b = parseMotorPretestHtml(badCell);
  check(
    "パーサー 想定外のセル（前検タイム=abc）は unrecognized（bad_cell）。一部の行だけ返さない",
    b.status === "unrecognized" &&
      b.rows.length === 0 &&
      b.anomalies.some((a) => a.startsWith("bad_cell:")),
    show(b.anomalies),
  );
  const dup = TODA.replace(">3647<", ">4608<").replace(
    /toban=3647/g,
    "toban=4608",
  );
  const d = parseMotorPretestHtml(dup);
  check(
    "パーサー 選手の重複は unrecognized（duplicate_racer）",
    d.status === "unrecognized" &&
      d.anomalies.some((a) => a.startsWith("duplicate_racer:")),
    show(d.anomalies),
  );
  const blankTime = TODA.replace(/<td>6\.65\s*<\/td>/, "<td>-</td>");
  const bt = parseMotorPretestHtml(blankTime);
  check(
    "パーサー 前検タイムが「-」の選手（前検を受けていない）は、前検タイム・前検順位ともNULLで、他の順位に影響しない",
    bt.status === "ok" &&
      bt.rows[0].pretest_time === null &&
      bt.rows[0].pretest_rank === null &&
      bt.rows.filter((r) => r.pretest_rank !== null).length === 45,
    show(bt.rows[0]),
  );
  const noTable = "<html><body><main><p>何かのページ</p></main></body></html>";
  const nt = parseMotorPretestHtml(noTable);
  check(
    "パーサー 表もメッセージも無いページは unrecognized（table_not_found）。「開催なし」に化けさせない",
    nt.status === "unrecognized" && nt.anomalies.includes("table_not_found"),
    show(nt),
  );
  check(
    "buildMotorPretestUrl: 会場コード2桁・日付8桁。不正な入力は例外",
    buildMotorPretestUrl(2, "2026-09-21") ===
      "https://www.boatrace.jp/owpc/pc/race/rankingmotor?jcd=02&hd=20260921" &&
      (() => {
        try {
          buildMotorPretestUrl(25, "2026-09-21");
          return false;
        } catch {
          return true;
        }
      })() &&
      (() => {
        try {
          buildMotorPretestUrl(2, "20260921");
          return false;
        } catch {
          return true;
        }
      })(),
  );
}

// ===========================================================================
// (b) 行の組み立て・書き込み
// ===========================================================================
{
  const parsed = parseMotorPretestHtml(TODA);
  const rows = buildMotorPretestRows({
    venueCode: 2,
    date: "2026-09-21",
    parsed,
  });
  check(
    "行の組み立て: 46行・キー(race_date, venue_code, racer_id)・開催名・created_at/updated_at は持たない",
    rows.length === 46 &&
      rows[0].race_date === "2026-09-21" &&
      rows[0].venue_code === 2 &&
      rows[0].racer_id === 4608 &&
      rows[0].series_title === "BOATBoyカップ" &&
      !("created_at" in rows[0]) &&
      !("updated_at" in rows[0]),
    show(rows[0]),
  );

  const client = createFakeSupabaseClient({
    tables: { motor_pretest_stats: [] },
  });
  const n1 = await writeMotorPretestRows(client, rows, {
    now: new Date("2026-09-21T20:30:00Z"),
  });
  const stored = client.data.motor_pretest_stats;
  check(
    "書き込み: 初回は46行を書き、変更のある（新規の）行に updated_at を設定する",
    n1 === 46 &&
      stored.length === 46 &&
      stored.every((r) => r.updated_at === "2026-09-21T20:30:00.000Z"),
    show({ n1, len: stored.length }),
  );
  const upsertsBefore = client.writesTo("motor_pretest_stats").length;
  const n2 = await writeMotorPretestRows(client, rows);
  check(
    "書き込み: 同じ内容の2回目は0行（変更の無い行は書かない。upsert を呼ばない）",
    n2 === 0 && client.writesTo("motor_pretest_stats").length === upsertsBefore,
    show({ n2 }),
  );
  // 本番のDBは numeric を文字列（"6.65"・"66.6"）で返す。文字列と数値の差で、永久に「変更あり」にならない
  for (const r of stored) {
    r.pretest_time = r.pretest_time.toFixed(2);
    r.motor_2rate = r.motor_2rate.toFixed(1);
    r.boat_2rate = r.boat_2rate.toFixed(1);
  }
  const n3 = await writeMotorPretestRows(client, rows);
  check(
    "書き込み: DBが numeric を文字列で返しても、同じ値なら0行（NUMERIC_SCALES の scale で正規化）",
    n3 === 0,
    show({ n3 }),
  );
  const changed = rows.map((r, i) =>
    i === 0 ? { ...r, pretest_time: 6.7, pretest_rank: 30 } : r,
  );
  const n4 = await writeMotorPretestRows(client, changed, {
    now: new Date("2026-09-21T21:00:00Z"),
  });
  const updated = client.data.motor_pretest_stats.find(
    (r) => r.racer_id === 4608,
  );
  check(
    "書き込み: 1人の前検タイムが変わったら、その1行だけを書き、updated_at を更新する（他の行は変えない）",
    n4 === 1 &&
      updated.pretest_time === 6.7 &&
      updated.updated_at === "2026-09-21T21:00:00.000Z" &&
      client.data.motor_pretest_stats.filter(
        (r) => r.updated_at === "2026-09-21T20:30:00.000Z",
      ).length === 45,
    show({ n4, updated }),
  );
  const dry = await writeMotorPretestRows(
    createFakeSupabaseClient({ tables: { motor_pretest_stats: [] } }),
    rows,
    { dryRun: true },
  );
  check("書き込み: dryRun は書かず、書くはずの行数を返す", dry === 46);

  const failing = createFakeSupabaseClient({
    tables: { motor_pretest_stats: [] },
    failOn: {
      "motor_pretest_stats:select":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      "motor_pretest_stats:upsert":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
    },
  });
  let thrown = null;
  try {
    await writeMotorPretestRows(failing, rows);
  } catch (error) {
    thrown = error;
  }
  check(
    "書き込み: テーブルが無い（マイグレーション090が未適用）は、成功にせず、理由の分かる例外にする",
    thrown !== null && /090が未適用/.test(thrown.message),
    thrown?.message,
  );
  check(
    "テーブル定義: 主キーの列と、既存行の取得の単位",
    MOTOR_PRETEST_TABLE.onConflict === "race_date,venue_code,racer_id" &&
      same(MOTOR_PRETEST_TABLE.keyColumns, [
        "race_date",
        "venue_code",
        "racer_id",
      ]),
  );

  // 期待件数（races・race_entries から）
  const c2 = createFakeSupabaseClient({
    tables: {
      races: [
        {
          race_id: "2026-09-21-02-01",
          race_date: "2026-09-21",
          venue_code: 2,
          cancellation_status: null,
        },
        {
          race_id: "2026-09-21-02-02",
          race_date: "2026-09-21",
          venue_code: 2,
          cancellation_status: "confirmed",
        },
        {
          race_id: "2026-09-21-18-01",
          race_date: "2026-09-21",
          venue_code: 18,
          cancellation_status: null,
        },
        {
          race_id: "2026-09-20-02-01",
          race_date: "2026-09-20",
          venue_code: 2,
          cancellation_status: null,
        },
      ],
      race_entries: [
        { race_id: "2026-09-21-02-01", racer_id: 4608 },
        { race_id: "2026-09-21-02-01", racer_id: 3647 },
        { race_id: "2026-09-21-02-02", racer_id: 5322 }, // 確定中止のレース: 期待から除く
        { race_id: "2026-09-21-18-01", racer_id: 4529 },
        { race_id: "2026-09-21-18-01", racer_id: null },
        { race_id: "2026-09-20-02-01", racer_id: 9999 }, // 別の日
      ],
    },
  });
  const e = await loadExpectedRacers(c2, "2026-09-21");
  check(
    "期待件数: その日の会場（races）と、確定中止を除いたレースの選手（race_entries）だけ。除外した件数を返す（別の日・racer_id無しは数えない）",
    same(
      e.venues.map((v) => v.venueCode),
      [2, 18],
    ) &&
      same([...e.expectedByVenue.get(2)].sort(), [3647, 4608]) &&
      same([...e.expectedByVenue.get(18)], [4529]) &&
      e.raceCount === 3 &&
      e.excludedCancelledRaces === 1,
    show({ v: e.venues, r: e.raceCount, x: e.excludedCancelledRaces }),
  );
  let raceReadError = null;
  try {
    await loadExpectedRacers(
      createFakeSupabaseClient({ failOn: { "races:select": "接続エラー" } }),
      "2026-09-21",
    );
  } catch (error) {
    raceReadError = error;
  }
  check(
    "期待件数: races の読み取り失敗は例外（「レースが無い」と誤判定しない）",
    raceReadError !== null && /接続エラー/.test(raceReadError.message),
  );
  const cov = summarizeVenueCoverage(parsed.rows, new Set([4608, 3647, 99999]));
  check(
    "充足の集計: 期待した選手のうちページに載っていない選手・前検タイムの数",
    cov.expected === 3 &&
      same(cov.missing, [99999]) &&
      cov.pageRows === 46 &&
      cov.pretestFilled === 46 &&
      cov.expectedWithTime === 2,
    show(cov),
  );
}

// ===========================================================================
// (c) 日次ジョブ
// ===========================================================================
const JOB = "motor_pretest";
const liveRow = (mode = "live") => ({
  job: JOB,
  mode,
  consecutive_failures: 0,
});

const createFakeFetch = (resolve) => {
  const log = [];
  const f = async (url) => {
    log.push(String(url));
    const r = await resolve(String(url));
    if (r instanceof Error) throw r;
    if (r instanceof Response) return r;
    return new Response(r, { status: 200 });
  };
  f.log = log;
  return f;
};
const throwingFetch = () => {
  const f = async () => {
    f.count++;
    throw new Error("取得してはいけません");
  };
  f.count = 0;
  return f;
};
const strictClient = () => ({
  from() {
    throw new Error("DBへアクセスしてはいけません");
  },
});

const DATE = "2026-09-21";
const at = (time) => jst(`${DATE}T${time}`);
const pageByVenue = (venueCode) =>
  venueCode === "02" ? TODA : venueCode === "18" ? TOKUYAMA : NO_DATA;
const jobTables = ({ initState = null, extraEntries = [] } = {}) => ({
  races: [
    {
      race_id: `${DATE}-02-01`,
      race_date: DATE,
      venue_code: 2,
      cancellation_status: null,
    },
    {
      race_id: `${DATE}-18-01`,
      race_date: DATE,
      venue_code: 18,
      cancellation_status: null,
    },
  ],
  race_entries: [
    { race_id: `${DATE}-02-01`, racer_id: 4608 },
    { race_id: `${DATE}-02-01`, racer_id: 3647 },
    { race_id: `${DATE}-18-01`, racer_id: 4529 },
    ...extraEntries,
  ],
  scrape_job_state: initState ? [initState] : [],
  motor_pretest_stats: [],
});
const runJob = ({ store, client, politeFetch, when, deps }) =>
  runScrapeJob({
    job: JOB,
    run: (ctx) => runMotorPretestJob(ctx, deps),
    store,
    client,
    politeFetch,
    now: typeof when === "function" ? when : () => when,
    worker: "verify",
  });
const jcdOf = (url) => new URL(url).searchParams.get("jcd");
const hdOf = (url) => new URL(url).searchParams.get("hd");

{
  // off・行なし・075未適用は、何も取得せず、DBのデータテーブルにもアクセスしない（マージしても本番の挙動が変わらない）
  for (const [label, storeOptions] of [
    ["mode=off", { rows: { [JOB]: { job: JOB, mode: "off" } } }],
    ["行なし", {}],
    ["075未適用", { available: false }],
  ]) {
    const store = createMemoryStore(storeOptions);
    const f = throwingFetch();
    const res = await runJob({
      store,
      client: strictClient(),
      politeFetch: f,
      when: at("05:30:00"),
    });
    check(
      `日次ジョブ ${label}: 何も取得せず、DBにもアクセスせず、200で終わる`,
      res.status === 200 &&
        f.count === 0 &&
        !store.calls.some((c) => c.name === "acquireLease"),
      show(res),
    );
  }
}
{
  // shadow: 取得・解析のみ。書かない・処理済みにしない
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
  const f = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  const res = await runJob({
    store,
    client,
    politeFetch: f,
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ shadow: 会場ごとに対象日のページを1回ずつ取得し、書かず、対象日を処理済みにしない",
    res.status === 200 &&
      f.log.length === 2 &&
      f.log.every((u) => hdOf(u) === "20260921") &&
      same(f.log.map(jcdOf).sort(), ["02", "18"]) &&
      client.writesTo("motor_pretest_stats").length === 0 &&
      row.last_target_date === undefined &&
      row.last_report?.summary?.pageRows === 91,
    show({ status: res.status, log: f.log, report: row.last_report?.summary }),
  );
  check(
    "日次ジョブ shadow: 期待した選手（races・race_entries）がページに全員載っている・前検タイムが全員入っている",
    row.last_report?.summary?.expectedRacers === 3 &&
      row.last_report?.summary?.expectedRacersOnPage === 3 &&
      row.last_report?.summary?.pretestFilled === 91 &&
      row.last_report?.alerts?.length === 0,
    show(row.last_report?.summary),
  );
}
{
  // live: 書く。同じ日の2回目は何もしない
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const f = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  const res = await runJob({
    store,
    client,
    politeFetch: f,
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ live: 91行を書き、対象日(2026-09-21)を処理済みにする",
    res.status === 200 &&
      client.data.motor_pretest_stats.length === 91 &&
      row.last_target_date === DATE &&
      row.last_rows_written === 91,
    show({
      status: res.status,
      n: client.data.motor_pretest_stats.length,
      row,
    }),
  );
  const f2 = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  const res2 = await runJob({
    store,
    client,
    politeFetch: f2,
    when: at("06:00:00"),
  });
  check(
    "日次ジョブ live: 06:00 の補足の起動は、処理済みの対象日を再取得しない（冪等）",
    res2.body.skipped === "already_done" && f2.log.length === 0,
    show(res2.body),
  );
  // 翌日の05:30では、対象日は翌日
  const res3 = await runJob({
    store,
    client: createFakeSupabaseClient({ tables: { ...jobTables(), races: [] } }),
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: jst("2026-09-22T05:30:00"),
  });
  check(
    "日次ジョブ: 翌日 05:30 の起動の対象日は翌日（races が無ければ取得せず incomplete）",
    res3.body.targetDate === "2026-09-22" && res3.body.waiting === "races",
    show(res3.body),
  );
  // 指定時刻（05:20）の前は前日（日付を取り違えない）
  const res4 = await runJob({
    store: createMemoryStore({ rows: { [JOB]: liveRow() } }),
    client: createFakeSupabaseClient({ tables: { ...jobTables(), races: [] } }),
    politeFetch: throwingFetch(),
    when: at("05:10:00"),
  });
  check(
    "日次ジョブ: 指定時刻(05:20)より前の起動の対象日は前日",
    res4.body.targetDate === "2026-09-20",
    show(res4.body),
  );
}
{
  // races が無い・races_init が live で未完了 → 取得せず incomplete（last_target_date を進めない）
  for (const [label, tables, expectedWaiting] of [
    ["races が無い", { ...jobTables(), races: [] }, "races"],
    [
      "races_init が live で、その日の分が未完了",
      jobTables({
        initState: {
          job: "races_init",
          mode: "live",
          last_target_date: "2026-09-20",
        },
      }),
      "races_init",
    ],
  ]) {
    const client = createFakeSupabaseClient({ tables });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const f = throwingFetch();
    const res = await runJob({
      store,
      client,
      politeFetch: f,
      when: at("05:30:00"),
    });
    const row = store.state.get(JOB);
    check(
      `日次ジョブ ${label}: 取得せず、対象日を処理済みにしない（次の起動が続きを処理する）`,
      res.status === 200 &&
        res.body.waiting === expectedWaiting &&
        res.body.incomplete === true &&
        f.count === 0 &&
        row.last_target_date === undefined,
      show({ status: res.status, body: res.body }),
    );
  }
  const client = createFakeSupabaseClient({
    tables: jobTables({
      initState: { job: "races_init", mode: "live", last_target_date: DATE },
    }),
  });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    client,
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: at("05:30:00"),
  });
  check(
    "日次ジョブ: races_init が live で、その日の分が完了していれば、取得する",
    res.status === 200 && store.state.get(JOB).last_target_date === DATE,
    show(res.body),
  );
  const shadowInit = createFakeSupabaseClient({
    tables: jobTables({
      initState: { job: "races_init", mode: "shadow", last_target_date: null },
    }),
  });
  const store2 = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res2 = await runJob({
    store: store2,
    client: shadowInit,
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: at("05:30:00"),
  });
  check(
    "日次ジョブ: races_init が shadow・off（朝の初期化が旧基盤）なら、races があれば取得する",
    res2.status === 200 && store2.state.get(JOB).last_target_date === DATE,
    show(res2.body),
  );
}
{
  // 0件エラー: 全会場のページが解析できない（構造の変化）→ 失敗（500）・対象日を処理済みにしない
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const f = createFakeFetch(
    () => "<html><body><main><p>変更後のページ</p></main></body></html>",
  );
  const res = await runJob({
    store,
    client,
    politeFetch: f,
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ 0件: 全会場のページを解析できなければ、成功にせず失敗（500）にし、対象日を処理済みにしない",
    res.status === 500 &&
      row.last_target_date === undefined &&
      client.writesTo("motor_pretest_stats").length === 0 &&
      /0件/.test(row.last_error ?? ""),
    show({ status: res.status, err: row.last_error }),
  );
}
{
  // 一時的な失敗（503）の会場: incomplete。補足の起動は、書き込み済みでない会場だけを再取得する
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const f1 = createFakeFetch((url) => {
    if (jcdOf(url) === "18") return new Response("busy", { status: 503 });
    return pageByVenue(jcdOf(url));
  });
  const r1 = await runJob({
    store,
    client,
    politeFetch: f1,
    when: at("05:30:00"),
  });
  const row1 = store.state.get(JOB);
  check(
    "日次ジョブ 一時的な失敗: 徳山が503でも、戸田は書く。対象日は処理済みにならず(incomplete)、履歴に失敗の理由が残る",
    r1.status === 200 &&
      r1.body.incomplete === true &&
      client.data.motor_pretest_stats.length === 46 &&
      row1.last_target_date === undefined &&
      row1.last_report?.health?.["18"]?.lastReason === "http_503" &&
      same(row1.last_report?.settledVenues, [2]),
    show({
      body: r1.body,
      health: row1.last_report?.health,
      settled: row1.last_report?.settledVenues,
    }),
  );
  const f2 = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  await runJob({
    store,
    client,
    politeFetch: f2,
    when: at("06:00:00"),
  });
  const row2 = store.state.get(JOB);
  check(
    "日次ジョブ 補足の起動: 書き込み済みの戸田を再取得せず、徳山だけ取得して完了する。集計は前回から引き継ぐ",
    f2.log.length === 1 &&
      jcdOf(f2.log[0]) === "18" &&
      client.data.motor_pretest_stats.length === 91 &&
      row2.last_target_date === DATE &&
      row2.last_report?.summary?.pageRows === 91 &&
      row2.last_report?.coverage?.length === 2,
    show({ log: f2.log, summary: row2.last_report?.summary }),
  );
}
{
  // 期待した選手がページに載っていない → 通知（1回きり: until 付き）。載っていれば通知なし
  const client = createFakeSupabaseClient({
    tables: jobTables({
      extraEntries: [{ race_id: `${DATE}-02-01`, racer_id: 99999 }],
    }),
  });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    client,
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: at("05:30:00"),
  });
  const alerts = store.state.get(JOB).last_report?.alerts ?? [];
  check(
    "日次ジョブ 期待した選手(99999)がページに無い会場: 通知(coverage:日付)を出す。1回きり（until = 30分後）・書き込みは続ける",
    res.status === 200 &&
      alerts.length === 1 &&
      alerts[0].key === `coverage:${DATE}` &&
      /戸田1人/.test(alerts[0].text) &&
      alerts[0].until ===
        new Date(at("05:30:00").getTime() + 30 * 60 * 1000).toISOString() &&
      client.data.motor_pretest_stats.length === 91,
    show(alerts),
  );
}
{
  // 前検タイムの欠落（構造は正常だが、前検タイムが空のページ）→ 通知
  const blank = TODA.replaceAll(/<td>6\.\d\d\s*<\/td>/g, "<td>-</td>");
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    client,
    politeFetch: createFakeFetch((url) =>
      jcdOf(url) === "02" ? blank : pageByVenue(jcdOf(url)),
    ),
    when: at("05:30:00"),
  });
  const alerts = store.state.get(JOB).last_report?.alerts ?? [];
  check(
    "日次ジョブ 前検タイムの非NULL率が95%未満（戸田46人が全員空）: 通知(pretest_fill)を出す",
    res.status === 200 && alerts.some((a) => a.key === `pretest_fill:${DATE}`),
    show(alerts),
  );
  const ok = buildCoverageAlerts(
    DATE,
    [
      {
        venueCode: 2,
        pageRows: 46,
        expected: 3,
        missing: [],
        pretestFilled: 46,
      },
    ],
    new Date(),
  );
  check(
    "通知の判定: 全員載っていて前検タイムも入っていれば通知なし",
    ok.length === 0,
  );
  const few = buildCoverageAlerts(
    DATE,
    [{ venueCode: 2, pageRows: 5, expected: 3, missing: [], pretestFilled: 0 }],
    new Date(),
  );
  check(
    "通知の判定: 母数が20行未満の前検タイム欠落は通知しない（少数での誤報を避ける）",
    few.length === 0,
  );
}
{
  // 別のページ（日付・会場が違う）は保存しない。構造の変化は、2日連続で通知する
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const f = createFakeFetch((url) =>
    jcdOf(url) === "18"
      ? asPage(TOKUYAMA, 18, "2026-09-20")
      : pageByVenue(jcdOf(url)),
  );
  const res = await runJob({
    store,
    client,
    politeFetch: f,
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ 別のページ: 徳山のページの日付が要求と違えば page_mismatch で保存しない（戸田は保存する）",
    res.status === 200 &&
      client.data.motor_pretest_stats.every((r) => r.venue_code === 2) &&
      row.last_report?.health?.["18"]?.lastReason === "page_mismatch",
    show({ health: row.last_report?.health }),
  );
  // 会場が違うページ（徳山のURLへの応答が戸田のページ）も保存しない
  const client2 = createFakeSupabaseClient({ tables: jobTables() });
  const store2 = createMemoryStore({ rows: { [JOB]: liveRow() } });
  await runJob({
    store: store2,
    client: client2,
    politeFetch: createFakeFetch((url) =>
      jcdOf(url) === "18" ? TODA : pageByVenue(jcdOf(url)),
    ),
    when: at("05:30:00"),
  });
  check(
    "日次ジョブ 別のページ: 徳山のURLへの応答が戸田のページ（会場が違う）でも、page_mismatch で保存しない",
    client2.data.motor_pretest_stats.every((r) => r.venue_code === 2) &&
      store2.state.get(JOB).last_report?.health?.["18"]?.lastReason ===
        "page_mismatch",
    show(store2.state.get(JOB).last_report?.health),
  );
  check(
    "構造変化の通知: 構造起因の理由（parse_anomaly・no_data_page・page_mismatch）が2日連続で通知。1日目・一時的な失敗(http_503)は通知しない",
    MOTOR_PRETEST_DRIFT_ALERT_DAYS === 2 &&
      findMotorPretestDriftAlerts({
        18: { consecutiveFailDays: 2, lastReason: "page_mismatch" },
        2: { consecutiveFailDays: 5, lastReason: "http_503" },
        3: {
          consecutiveFailDays: 1,
          lastReason: "parse_anomaly:table_not_found",
        },
        5: {
          consecutiveFailDays: 3,
          lastReason: "parse_anomaly:unknown_header:x",
        },
      })
        .map((a) => a.key)
        .join() === "drift:5,drift:18",
  );
}
{
  // マイグレーション090が未適用のDBで live: 成功にせず、失敗（500）。対象日を処理済みにしない
  const client = createFakeSupabaseClient({
    tables: jobTables(),
    failOn: {
      "motor_pretest_stats:select":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      "motor_pretest_stats:upsert":
        "Could not find the table 'public.motor_pretest_stats' in the schema cache",
    },
  });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    client,
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: at("05:30:00"),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ マイグレーション090が未適用: live は成功にせず失敗（500）にし、理由（090）を残す。対象日を処理済みにしない",
    res.status === 500 &&
      /090/.test(row.last_error ?? "") &&
      row.last_target_date === undefined,
    show({ status: res.status, err: row.last_error }),
  );
  const shadowStore = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
  const shadowRes = await runJob({
    store: shadowStore,
    client,
    politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
    when: at("05:30:00"),
  });
  check(
    "日次ジョブ マイグレーション090が未適用: shadow は書かないため影響しない（先に shadow で確認できる）",
    shadowRes.status === 200,
    show(shadowRes.body),
  );
}

// ===========================================================================
// (d) 過去分CLI
// ===========================================================================
{
  const args = backfill.parseArgs(
    ["plan"],
    new Date("2026-09-21T10:00:00+09:00"),
  );
  check(
    "CLI 既定: 期間は 2025-12-03 〜 前日、範囲は節の初日のみ、窓は JST 00-06（オッズの運用窓の外）、日次上限1,500、間隔3〜5秒",
    args.from === "2025-12-03" &&
      args.to === "2026-09-20" &&
      args.scope === "first-days" &&
      args.window === "00-06" &&
      args.dailyLimit === 1500 &&
      args.intervalMinMs === 3000 &&
      args.intervalMaxMs === 5000,
    show(args),
  );
  const throwsFor = (argv) => {
    try {
      backfill.validateOptions(backfill.parseArgs(argv));
      return false;
    } catch {
      return true;
    }
  };
  check(
    "CLI 検証: races の最古(2025-12-03)より前・逆転した期間・不正な範囲・不明なオプションは拒否",
    throwsFor(["plan", "--from=2025-11-30"]) &&
      throwsFor(["plan", "--from=2026-02-01", "--to=2026-01-01"]) &&
      throwsFor(["plan", "--scope=weekly"]) &&
      throwsFor(["plan", "--nonsense"]),
  );
  const floor = backfill.validateOptions(
    backfill.parseArgs([
      "download",
      "--interval-min-ms=500",
      "--interval-max-ms=1000",
    ]),
  );
  check(
    "CLI 間隔: 3秒未満は3秒に切り上げる（ADR-0067）",
    floor.intervalMinMs === 3000 && floor.intervalMaxMs >= 3000,
    show(floor),
  );
}
{
  // 対象の会場×日: 節の初日（前日に同じ会場の開催が無い）と全日
  const days = (list) =>
    list.map(([v, d]) => ({ venue_code: v, race_date: d }));
  const venueDays = days([
    [2, "2025-12-03"],
    [2, "2025-12-04"],
    [2, "2025-12-05"],
    [2, "2025-12-10"], // 前日が無い → 初日
    [18, "2025-12-04"], // 前日（12-03）に開催が無い → 初日
    [18, "2025-12-05"],
    [5, "2025-12-03"], // races の最初の日: 全会場を初日とみなす
  ]);
  const range = { from: "2025-12-03", to: "2025-12-31" };
  const first = backfill.buildItems(venueDays, {
    ...range,
    scope: "first-days",
  });
  const all = backfill.buildItems(venueDays, { ...range, scope: "all-days" });
  check(
    "CLI 対象: first-days は前日に同じ会場の開催が無い会場×日と races の最初の日（日付・会場の順。キーは会場-日付）",
    same(
      first.map((i) => i.key),
      ["02-20251203", "05-20251203", "18-20251204", "02-20251210"],
    ) &&
      first[0].url ===
        "https://www.boatrace.jp/owpc/pc/race/rankingmotor?jcd=02&hd=20251203" &&
      all.length === 7,
    show(first.map((i) => i.key)),
  );
  // from が data の途中: from の前日も読んでいるため、from の日の判定が正しい（全会場を初日にしない）
  const mid = backfill.buildItems(venueDays, {
    from: "2025-12-05",
    to: "2025-12-31",
    scope: "first-days",
  });
  check(
    "CLI 対象: --from が途中の日でも、前日のデータで初日を判定する（12-05は、前日に開催がある会場を初日としない）",
    same(
      mid.map((i) => i.key),
      ["02-20251210"],
    ),
    show(mid.map((i) => i.key)),
  );
}
{
  // download・parse・load を、一時ディレクトリと、偽の取得・DBで通す
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  const races = [
    ["2025-12-03", 2],
    ["2025-12-04", 2],
    ["2025-12-04", 18],
    ["2025-12-10", 2],
    ["2025-12-11", 2],
  ].map(([race_date, venue_code]) => ({
    race_id: `${race_date}-${String(venue_code).padStart(2, "0")}-01`,
    race_date,
    venue_code,
    race_number: 1,
  }));
  const client = createFakeSupabaseClient({
    tables: { races, motor_pretest_stats: [] },
  });
  const optsFor = (extra = []) =>
    backfill.validateOptions(
      backfill.parseArgs(
        [
          "download",
          "--from=2025-12-03",
          "--to=2025-12-31",
          `--archive-dir=${tmp}`,
          ...extra,
        ],
        new Date("2026-01-05T10:00:00+09:00"),
      ),
    );
  const insideWindow = () => new Date("2026-09-22T02:00:00+09:00");
  const requested = [];
  const depsFor = (resolve, now = insideWindow) => ({
    client,
    log: () => {},
    sleep: async () => {},
    now,
    fetchOnce: async (url) => {
      requested.push(url);
      const r = await resolve(url);
      return {
        status: r.status,
        bytes: new TextEncoder().encode(r.body ?? ""),
        ms: 1,
        lastModified: null,
      };
    },
  });
  const okPage = (url) => {
    const jcd = Number(new URL(url).searchParams.get("jcd"));
    const hd = new URL(url).searchParams.get("hd");
    return {
      status: 200,
      body: asPage(
        TODA,
        jcd,
        `${hd.slice(0, 4)}-${hd.slice(4, 6)}-${hd.slice(6, 8)}`,
      ),
    };
  };

  // 窓の外（12:00 JST）: 何も取得せず、安全に停止（2）
  const outside = await backfill.cmdDownload(
    optsFor(),
    depsFor(okPage, () => new Date("2026-09-22T12:00:00+09:00")),
  );
  check(
    "CLI download: 実行窓（JST 00-06）の外では、1件も取得せず、安全に停止する（終了コード2）",
    outside === 2 && requested.length === 0,
    show({ outside, n: requested.length }),
  );

  // plan（dry-run）: ネットワークなし
  const planOpts = optsFor();
  planOpts.dryRun = true;
  const planCode = await backfill.cmdDownload(planOpts, depsFor(okPage));
  check(
    "CLI plan: ネットワーク・書き込みなし（終了コード0）",
    planCode === 0 &&
      requested.length === 0 &&
      !fs.existsSync(path.join(tmp, "manifest.jsonl")),
  );

  // 日次上限（1件）で停止 → 再開
  const limited = await backfill.cmdDownload(
    optsFor(["--daily-limit=1"]),
    depsFor(okPage),
  );
  check(
    "CLI download: 日次上限に達したら安全に停止する（終了コード2・1件取得）",
    limited === 2 && requested.length === 1,
    show({ limited, n: requested.length }),
  );
  const finished = await backfill.cmdDownload(optsFor(), depsFor(okPage));
  check(
    "CLI download: 再実行は続きから（取得済みは再取得しない）。first-days の3件（02-20251203・18-20251204・02-20251210）を取得し終える",
    finished === 0 &&
      requested.length === 3 &&
      new Set(requested).size === 3 &&
      fs.existsSync(backfill.rawPath(tmp, "02-20251203")) &&
      fs.existsSync(backfill.rawPath(tmp, "18-20251204")) &&
      fs.existsSync(backfill.rawPath(tmp, "02-20251210")),
    show({ finished, requested }),
  );
  const again = await backfill.cmdDownload(optsFor(), depsFor(okPage));
  check(
    "CLI download: 完了済みの再実行は0リクエスト（終了コード0）",
    again === 0 && requested.length === 3,
  );
  check(
    "CLI download: User-Agent は BoatraceAIBot/1.0",
    backfill.USER_AGENT.startsWith("BoatraceAIBot/1.0"),
  );

  // parse → load
  const parseCode = await backfill.cmdParse(
    backfill.parseArgs([
      "parse",
      `--archive-dir=${tmp}`,
      "--from=2025-12-03",
      "--to=2025-12-31",
    ]),
    { log: () => {} },
  );
  const loadOpts = backfill.parseArgs([
    "load",
    `--archive-dir=${tmp}`,
    "--from=2025-12-03",
    "--to=2025-12-31",
  ]);
  const plan = backfill.buildLoadPlan(loadOpts);
  check(
    "CLI parse: 保存したHTMLを中間JSONにする。投入対象は3ページ・138行（前検タイムあり138行）",
    parseCode === 0 &&
      plan.pages === 3 &&
      plan.rows.length === 138 &&
      plan.missingParsed.length === 0,
    show({ parseCode, pages: plan.pages, rows: plan.rows.length }),
  );
  const dryLoad = await backfill.cmdLoad(loadOpts, { client, log: () => {} });
  check(
    "CLI load: --apply が無ければ書き込まない（終了コード0）",
    dryLoad === 0 && client.data.motor_pretest_stats.length === 0,
  );
  const applyOpts = { ...loadOpts, apply: true, sleepMs: 0 };
  const applied = await backfill.cmdLoad(applyOpts, {
    client,
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: 138行を書く（会場・日付ごと。キーが重複しない）",
    applied === 0 &&
      client.data.motor_pretest_stats.length === 138 &&
      new Set(
        client.data.motor_pretest_stats.map(
          (r) => `${r.race_date}|${r.venue_code}|${r.racer_id}`,
        ),
      ).size === 138,
    show({ applied, n: client.data.motor_pretest_stats.length }),
  );
  const upsertsBefore = client.writesTo("motor_pretest_stats").length;
  const reapplied = await backfill.cmdLoad(applyOpts, {
    client,
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: 2回目は、変更の無い行を書かない（upsert を呼ばない）",
    reapplied === 0 &&
      client.writesTo("motor_pretest_stats").length === upsertsBefore,
  );
  const noTable = await backfill.cmdLoad(applyOpts, {
    client: createFakeSupabaseClient({
      failOn: {
        "motor_pretest_stats:select":
          "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      },
    }),
    log: () => {},
    sleep: async () => {},
  });
  check(
    "CLI load --apply: テーブルが無い（マイグレーション090が未適用）なら、書かずに失敗（終了コード1）",
    noTable === 1,
  );

  // 取得の安全策: 403が2回連続 → サーキットブレーカー（4）。データが無い・別のページが3回連続 → 4
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  const opts2 = () => ({ ...optsFor(["--scope=all-days"]), archiveDir: tmp2 });
  requested.length = 0;
  const blocked = await backfill.cmdDownload(
    opts2(),
    depsFor(async () => ({ status: 403, body: "" })),
  );
  check(
    "CLI download: 403が2回連続したらサーキットブレーカー（終了コード4）で停止する",
    blocked === 4 && requested.length === 2,
    show({ blocked, n: requested.length }),
  );
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "motor-pretest-"));
  requested.length = 0;
  const invalid = await backfill.cmdDownload(
    { ...optsFor(["--scope=all-days"]), archiveDir: tmp3 },
    depsFor(async () => ({ status: 200, body: NO_DATA })),
  );
  check(
    "CLI download: 開催のある会場×日のはずのページが「データがありません」を3回連続で返したら、内容が想定外として停止する（終了コード4）",
    invalid === 4 && requested.length === 3,
    show({ invalid, n: requested.length }),
  );
  const manifest3 = backfill.rawPath(tmp3, "02-20251203");
  check("CLI download: 想定外の内容は保存しない", !fs.existsSync(manifest3));
  const v = backfill.validateHtml(
    new TextEncoder().encode(asPage(TODA, 2, "2025-12-03")),
    { venueCode: 2, date: "2025-12-03" },
  );
  let mismatchThrown = null;
  try {
    backfill.validateHtml(new TextEncoder().encode(TODA), {
      venueCode: 2,
      date: "2025-12-03",
    });
  } catch (error) {
    mismatchThrown = error;
  }
  let venueMismatch = null;
  try {
    backfill.validateHtml(
      new TextEncoder().encode(asPage(TODA, 5, "2025-12-03")),
      {
        venueCode: 2,
        date: "2025-12-03",
      },
    );
  } catch (error) {
    venueMismatch = error;
  }
  check(
    "CLI 検査: 要求した会場・日付のページなら通し、別の日・別の会場のページは拒否する",
    v.status === "ok" &&
      mismatchThrown !== null &&
      /別のページ/.test(mismatchThrown.message) &&
      venueMismatch !== null &&
      /別のページ/.test(venueMismatch.message),
  );
  // 日次ジョブとCLIが、同じ取得ロジックを共有している（二重実装しない）
  check(
    "取得ロジックの共有: CLI は、日次ジョブと同じパーサー版・URL組み立て・行の組み立て・書き込みを使う",
    backfill.buildItems([{ venue_code: 2, race_date: "2025-12-03" }], {
      from: "2025-12-03",
      to: "2025-12-03",
      scope: "all-days",
    })[0].url === buildMotorPretestUrl(2, "2025-12-03") &&
      MOTOR_PRETEST_PARSER_VERSION === "rankingmotor/v1",
  );
  for (const dir of [tmp, tmp2, tmp3])
    fs.rmSync(dir, { recursive: true, force: true });
}

// ===========================================================================
// (e) 配線
// ===========================================================================
{
  const def = SCRAPE_JOBS.motor_pretest;
  check(
    "レジストリ: motor_pretest は日次・05:20指定・boatrace.jp・maxDuration300・整合性の検査が通る",
    def?.kind === "daily" &&
      def.targetTimeJst === "05:20" &&
      same(def.hosts, ["boatrace.jp"]) &&
      def.maxDurationSec === 300 &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const apiSource = fs.readFileSync(
    path.join(ROOT, "api/cron/motor-pretest.js"),
    "utf8",
  );
  check(
    "api/cron/motor-pretest.js: maxDuration はレジストリと同じ300（リテラル）・共通ラッパ経由・job名",
    /maxDuration:\s*300/.test(apiSource) &&
      /createScrapeCronHandler/.test(apiSource) &&
      /job:\s*"motor_pretest"/.test(apiSource),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const crons = vercel.crons.filter(
    (c) => c.path === "/api/cron/motor-pretest",
  );
  const jstMinutes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    return ((Number(hour) + 9) % 24) * 60 + Number(min);
  };
  check(
    "vercel.json: motor-pretest の cron は3本（UTC 20:30・21:00・21:30 = JST 05:30・06:00・06:30）",
    same(
      crons.map((c) => c.schedule),
      ["30 20 * * *", "0 21 * * *", "30 21 * * *"],
    ) &&
      same(
        crons.map((c) => jstMinutes(c.schedule)),
        [330, 360, 390],
      ),
    show(crons),
  );
  check(
    "vercel.json: 全ての起動が、オッズの運用窓（07:00〜23:59 JST）の外（07:00前）で、指定時刻(05:20)より後",
    crons.every(
      (c) =>
        jstMinutes(c.schedule) < 7 * 60 &&
        jstMinutes(c.schedule) >= 5 * 60 + 20,
    ),
  );
  check(
    "vercel.json: api/cron/*.js は syd1 に固定されている",
    same(vercel.functions?.["api/cron/*.js"]?.regions, ["syd1"]),
  );
  const handler = (await import("../../api/cron/motor-pretest.js")).default;
  const res = { statusCode: null, body: null };
  res.status = (s) => ((res.statusCode = s), res);
  res.json = (b) => ((res.body = b), res);
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "verify-secret";
  await handler({ headers: {} }, res);
  process.env.CRON_SECRET = prevSecret;
  check(
    "api/cron/motor-pretest.js: 認証なしのリクエストは401",
    res.statusCode === 401,
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\nverify-motor-pretest: すべて通りました");
