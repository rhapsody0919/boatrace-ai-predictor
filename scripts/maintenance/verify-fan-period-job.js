#!/usr/bin/env node
/**
 * verify-fan-period-job.js — 期別成績（fan）の定期取り込み（scripts/lib/fanPeriodJob.js、api/cron/fan-period.js）を固定する。
 *
 * 取得（politeFetch）とLZH展開を差し替え、DBは偽のクライアント（scripts/lib/fakeSupabaseClient.js）で動かす。
 * ネットワーク・実DBに繋がない。fan の中身は scripts/lib/__fixtures__/fan/fan-sample.json（fan2604 の実レコード12人分）。
 *
 * 検査すること:
 *   1. 対象日 → fan の対応（期の境目 4/30・5/1・10/31・11/1・1月）と、期の終わりからの日数
 *   2. 取り込み済みなら取得しない（0リクエスト）
 *   3. 未公開（404）: その日は済み（incomplete を立てない＝06:30 の補足は叩かない）。1リクエストだけ
 *   4. 期の終わりから105日を過ぎて未取り込み: 取得せず、通知（last_report.alerts）を出す
 *   5. 公開済み（live）: 全行を書き、生ファイルを Storage（raw-pages）と台帳 raw_snapshots に置く
 *   6. 取り直し（?fanId=）: 取り込み済みでも取り直し、変更の無い行は書かない。対象日は済みにしない
 *   7. shadow: 書かない・保管しない。差分の集計だけ返す
 *   8. レコード数が下限未満・HTTP 500 は error で、書かない
 *   9. 生ファイルの保管に失敗しても、取り込みは成功（警告に残す）
 *  10. vercel.json に 06:00・06:30 JST の2本、レジストリに日次・boatrace.jp で登録されている。125 の台帳は RLS 有効・匿名の権限なし
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  daysSincePeriodEnd,
  FAN_PUBLISH_DEADLINE_DAYS,
  fanIdEndedBefore,
  fanRawPath,
  runFanPeriodJob,
} from "../lib/fanPeriodJob.js";
import { fakeClient } from "../lib/fakeSupabaseClient.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// fan2604 の実レコード（12人）→ ファイルのバイト列（CRLF区切り）。LZH展開は差し替えて、このバイト列をそのまま返す
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "scripts/lib/__fixtures__/fan/fan-sample.json"),
    "utf8",
  ),
);
function fileBytes(id) {
  const parts = [];
  for (const r of FIXTURE.files[id].records) {
    parts.push(Buffer.from(r.b64, "base64"));
    parts.push(Buffer.from([0x0d, 0x0a]));
  }
  return new Uint8Array(Buffer.concat(parts));
}
const FAN2604 = fileBytes("fan2604");
const OPTS = { sleepMs: 0, decode: async (b) => b, minRecords: 10 };

function storageStub({ fail = false } = {}) {
  const uploads = [];
  return {
    uploads,
    from(bucket) {
      return {
        async upload(p, body, o) {
          if (fail) return { error: { message: "bucket not found" } };
          uploads.push({ bucket, path: p, bytes: body.length, o });
          return { error: null };
        },
      };
    },
  };
}

function jobCtx({
  date = "2026-06-10",
  mode = "live",
  tables = {},
  status = 200,
  query = {},
  storageFail = false,
} = {}) {
  const urls = [];
  const client = fakeClient(tables);
  client.storage = storageStub({ fail: storageFail });
  return {
    urls,
    client,
    ctx: {
      targetDate: date,
      mode,
      client,
      query,
      worker: "test-worker",
      politeFetch: async (url) => {
        urls.push(url);
        return status === 200
          ? new Response(FAN2604, { status: 200 })
          : new Response("", { status });
      },
    },
  };
}

// 1. 期の対応
check(
  "対象日 → 前に終わった期の fan（4/30・5/1・10/31・11/1・1月）",
  same(
    ["2026-04-30", "2026-05-01", "2026-10-31", "2026-11-01", "2027-01-15"].map(
      fanIdEndedBefore,
    ),
    ["fan2510", "fan2604", "fan2604", "fan2610", "fan2610"],
  ),
);
check(
  "期の終わりからの日数: fan2610 は 2026-11-01 が1日目、2027-02-13 が105日目",
  daysSincePeriodEnd("fan2610", "2026-11-01") === 1 &&
    daysSincePeriodEnd("fan2610", "2027-02-13") === FAN_PUBLISH_DEADLINE_DAYS,
);

// 2. 取り込み済み
{
  const j = jobCtx({
    tables: {
      racer_period_stats: [{ racer_id: 1, period_year: 2026, period_no: 2 }],
    },
  });
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    "取り込み済みの期は取得しない（0リクエスト・書き込み0・対象日は済み）",
    j.urls.length === 0 &&
      r.rowsWritten === 0 &&
      !r.incomplete &&
      r.report.status === "already_imported",
    JSON.stringify(r.report),
  );
}

// 3. 未公開
{
  const j = jobCtx({ status: 404 });
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    "未公開（404）: 1リクエストだけで、その日は済み（補足の 06:30 は叩かない）",
    j.urls.length === 1 &&
      j.urls[0].endsWith("/kibetsu/fan2604.lzh") &&
      r.outcome === undefined &&
      !r.incomplete &&
      r.report.status === "unpublished",
    JSON.stringify({ urls: j.urls, r }),
  );
}

// 4. 期限超過
{
  const j = jobCtx({ date: "2027-02-14", status: 404 });
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    `期の終わりから${FAN_PUBLISH_DEADLINE_DAYS}日を過ぎたら取得せず、通知を出す（monitor が Slack へ）`,
    j.urls.length === 0 &&
      r.report.status === "overdue" &&
      r.report.alerts?.[0]?.key === "fan_overdue:fan2610" &&
      /106日/.test(r.report.alerts[0].text),
    JSON.stringify(r.report),
  );
  const j2 = jobCtx({ date: "2027-02-13", status: 404 });
  await runFanPeriodJob(j2.ctx, OPTS);
  check(
    `${FAN_PUBLISH_DEADLINE_DAYS}日目まではまだ取得する`,
    j2.urls.length === 1,
  );
}

// 5. 公開済み（live）
const imported = jobCtx();
{
  const r = await runFanPeriodJob(imported.ctx, OPTS);
  const rows = imported.client.tables.racer_period_stats ?? [];
  const ledger = imported.client.tables.raw_snapshots ?? [];
  const up = imported.client.storage.uploads;
  check(
    "公開済み（live）: 12人分を書き、対象日は済み",
    r.outcome === undefined &&
      !r.incomplete &&
      r.rowsWritten === 12 &&
      rows.length === 12 &&
      rows.every((x) => x.period_year === 2026 && x.period_no === 2) &&
      r.report.status === "imported",
    JSON.stringify({ outcome: r.outcome, error: r.error, n: rows.length }),
  );
  check(
    "公開済み（live）: 生ファイルを raw-pages の raw/fan/fan2604/{sha256先頭16桁}.lzh に置き、台帳に1行記録する",
    up.length === 1 &&
      up[0].bucket === "raw-pages" &&
      up[0].bytes === FAN2604.length &&
      ledger.length === 1 &&
      ledger[0].page_type === "fan" &&
      ledger[0].key === "fan2604" &&
      ledger[0].storage_path === up[0].path &&
      ledger[0].storage_path === fanRawPath("fan2604", ledger[0].sha256) &&
      ledger[0].bytes === FAN2604.length &&
      ledger[0].run === "test-worker" &&
      r.body.rawPath === up[0].path,
    JSON.stringify({ up, ledger }),
  );
}

// 6. 取り直し（取り込み済みでも ?fanId= で取り直す）
{
  const j = jobCtx({
    tables: imported.client.tables,
    query: { fanId: "fan2604" },
  });
  j.client.storage = imported.client.storage;
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    "取り直し（?fanId=）: 取り込み済みでも取得し、変更の無い行は書かない。対象日は済みにしない",
    j.urls.length === 1 &&
      r.rowsWritten === 0 &&
      r.report.diff.unchanged === 12 &&
      r.incomplete === true,
    JSON.stringify(r.report?.diff),
  );
  let threw = false;
  try {
    await runFanPeriodJob(jobCtx({ query: { fanId: "../x" } }).ctx, OPTS);
  } catch {
    threw = true;
  }
  check("取り直しの fanId は fanYYMM 以外を受け付けない", threw);
}

// 7. shadow
{
  const j = jobCtx({ mode: "shadow" });
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    "shadow: 取得・解析・差分の集計だけで、書かない・保管しない",
    j.urls.length === 1 &&
      r.rowsWritten === 0 &&
      r.report.diff.toWrite === 12 &&
      (j.client.tables.racer_period_stats ?? []).length === 0 &&
      (j.client.tables.raw_snapshots ?? []).length === 0 &&
      j.client.storage.uploads.length === 0,
    JSON.stringify(r.report?.diff),
  );
}

// 8. 異常
{
  const j = jobCtx();
  const r = await runFanPeriodJob(j.ctx, { ...OPTS, minRecords: 1500 });
  check(
    "レコード数が下限未満なら error で、書かない",
    r.outcome === "error" &&
      /12件（1500件以上のはず）/.test(r.error) &&
      (j.client.tables.racer_period_stats ?? []).length === 0,
    r.error,
  );
  const j2 = jobCtx({ status: 500 });
  const r2 = await runFanPeriodJob(j2.ctx, OPTS);
  check(
    "HTTP 500 は error（未公開と区別する。対象日は済みにならず、06:30 の補足が再試行する）",
    r2.outcome === "error" && /HTTP 500/.test(r2.error),
    JSON.stringify(r2),
  );
}

// 9. 保管の失敗
{
  const j = jobCtx({ storageFail: true });
  const r = await runFanPeriodJob(j.ctx, OPTS);
  check(
    "生ファイルの保管に失敗しても取り込みは成功し、警告に残す",
    r.outcome === undefined &&
      r.rowsWritten === 12 &&
      r.body.rawPath === null &&
      r.report.warnings.some((w) => /生ファイルを保管できません/.test(w)),
    JSON.stringify(r.report?.warnings),
  );
}

// 10. 配線
{
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const schedules = vercel.crons
    .filter((c) => c.path === "/api/cron/fan-period")
    .map((c) => c.schedule)
    .sort();
  check(
    "vercel.json: 06:00・06:30 JST（UTC 21:00・21:30）の2本",
    same(schedules, ["0 21 * * *", "30 21 * * *"]),
    JSON.stringify(schedules),
  );
  const def = SCRAPE_JOBS.fan_period;
  const api = fs.readFileSync(
    path.join(ROOT, "api/cron/fan-period.js"),
    "utf8",
  );
  check(
    "レジストリ: 日次・06:00・boatrace.jp、maxDuration が api と一致",
    def?.kind === "daily" &&
      def.targetTimeJst === "06:00" &&
      same(def.hosts, ["boatrace.jp"]) &&
      new RegExp(`maxDuration:\\s*${def.maxDurationSec}\\b`).test(api),
  );
  const sql = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/125_raw_snapshots.sql"),
    "utf8",
  );
  check(
    "125: raw_snapshots は RLS 有効・匿名の権限なし・(page_type, key, sha256) で一意",
    /ALTER TABLE raw_snapshots ENABLE ROW LEVEL SECURITY/.test(sql) &&
      /REVOKE ALL ON raw_snapshots FROM anon, authenticated/.test(sql) &&
      /UNIQUE \(page_type, key, sha256\)/.test(sql),
  );
}

if (failures > 0) {
  console.log(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全件成功");
