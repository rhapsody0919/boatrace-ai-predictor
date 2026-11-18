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
 *       失敗しても取得は続く。公開後もコメントが出走艇の数に満たない間は、発走まで partial（再試行）で取り直し、
 *       そろうか発走後は ok で閉じる（BOA-611）
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
import { rawHtmlPath } from "../lib/rawHtmlArchive.js";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { isFinalOutcome } from "../lib/scrapeJobs/outcomes.js";
import { computeWindowStats } from "../lib/scrapeJobs/monitor.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { show, same, R12, FINAL_DAY, PENDING, createFakeClient, RACE_ID, G1_RACE, freshClient } from "./verifyData/pit-report-job-fixtures.js";
import { evaluateParser, evaluateRows } from "./verifyData/pit-report-job-parse-rows.js";
import { evaluateJob } from "./verifyData/pit-report-job-job.js";

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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
    /\| 085 \|[^\n]*085_race_pit_reports\.sql[^\n]*\|/.test(applied) &&
      /\| 086 \|[^\n]*086_race_pit_reports_public_read\.sql[^\n]*\|/.test(
        applied,
      ),
  );
}

// ---------------------------------------------------------------------------
// (g) 変異検証: 壊した版で、(a)(b)(c) の評価が失敗する
// ---------------------------------------------------------------------------
const LIB = path.join(ROOT, "scripts/lib");
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;
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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmp, mutated);
  try {
    return await runFn(await import(tmp));
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
  [
    "公開後、コメントが足りなくても完了にする（BOA-611 の取りこぼし）",
    [["commentCount < expectedBoats &&", "false &&"]],
  ],
  [
    "発走後もコメントが足りない間は再試行し続ける",
    [["minutesToStart > 0", "minutesToStart > -Infinity"]],
  ],
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
