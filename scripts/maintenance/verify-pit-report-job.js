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


import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { show, same, R12, createFakeClient, RACE_ID, G1_RACE } from "./verifyData/pit-report-job-fixtures.js";
import { evaluateParser, evaluateRows } from "./verifyData/pit-report-job-parse-rows.js";
import { evaluateJob } from "./verifyData/pit-report-job-job.js";
import { runPitReportJobScenes1, runPitReportJobScenes2 } from "./verifyData/pit-report-job-scenes-1.js";
import { runPitReportJobScenes3, runPitReportJobScenes4 } from "./verifyData/pit-report-job-scenes-2.js";

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

// ---- 後半の場面（verifyData/pit-report-job-scenes-1.js） ----
await runPitReportJobScenes1({ check, SLOT, NOW, runWrapped });

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

// ---- 後半の場面（verifyData/pit-report-job-scenes-1.js・pit-report-job-scenes-2.js） ----
runPitReportJobScenes2({ check, SLOT, NOW, runWrapped });
await runPitReportJobScenes3({ out, check, evaluateWindow, withMutant });

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/pit-report-job-scenes-2.js） ----
runPitReportJobScenes4({ out, check, evaluateWindow, withMutant });
