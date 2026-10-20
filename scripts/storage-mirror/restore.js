#!/usr/bin/env node
/**
 * Storage の写しの復元の試験（ADR-0098、.github/workflows/storage-mirror-restore-drill.yml が月1回動かす）。
 * R2 の写しを Supabase の試験用のバケット storage-mirror-drill（オーナーが作る）へ戻し、読み直して sha256 と Content-Type を照合する。
 *
 *   node scripts/storage-mirror/restore.js          バケットごとに一番大きいファイルと20件（月1回）
 *   node scripts/storage-mirror/restore.js --all    元にある全部（採用時に1回）
 *
 * 「Supabase は読むだけ」の例外はこのファイルと試験用のバケットに限る。戻す先は定数で、写す元のバケットは拒む。消す処理は持たない。
 * 本当の事故で元のバケットへ戻すときは、このファイルの戻す先を変える PR を出して審査を通す（docs/operation/storage-mirror-r2-owner-steps.md）。
 */
import { appendFileSync } from "node:fs";
import { encodeKeyPath } from "../lib/awsSigV4.js";
import { DRILL_BUCKET, runDrill } from "../lib/storageMirrorDrill.js";
import { createR2Client, r2EnvOrThrow } from "./r2.js";
import { download, supabaseEnv } from "./supabase-source.js";

const MB = (n) => (n / 1e6).toFixed(1);

function drillTarget() {
  const { url, key } = supabaseEnv();
  return {
    bucket: DRILL_BUCKET,
    async upload(path, body, contentType) {
      const res = await fetch(
        `${url}/storage/v1/object/${DRILL_BUCKET}/${encodeKeyPath(path)}`,
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body,
          signal: AbortSignal.timeout(300_000),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const hint = /Bucket not found/i.test(text)
          ? `（バケット ${DRILL_BUCKET} が無い。手順書の 10）`
          : "";
        throw new Error(`Supabase storage HTTP ${res.status}（upload）${hint}`);
      }
    },
    download: (path) => download(DRILL_BUCKET, path),
  };
}

async function main() {
  const all = process.argv.includes("--all");
  const r2 = createR2Client(r2EnvOrThrow());
  const result = await runDrill({ r2, drill: drillTarget(), all });
  const lines = [
    `## Storage の写しの復元の試験（${all ? "全部" : "見本"}）`,
    "",
    `manifest: \`${result.manifestKey}\`、戻す先: \`${DRILL_BUCKET}\``,
    "",
    "| バケット | 試した | 一致 | MB | 失敗 |",
    "|---|---|---|---|---|",
    ...Object.entries(result.perBucket).map(
      ([b, s]) =>
        `| ${b} | ${s.tried} | ${s.ok} | ${MB(s.bytes)} | ${s.failed} |`,
    ),
    "",
    ...(result.failures.length
      ? [`### 失敗`, "", ...result.failures.map((f) => `- ${f}`), ""]
      : []),
  ];
  const text = lines.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (result.failures.length) {
    for (const f of result.failures) console.error(`::error::${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
