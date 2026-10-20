#!/usr/bin/env node
/**
 * Storage の写しの復元の試験（ADR-0100、.github/workflows/storage-mirror-restore-drill.yml が月1回動かす）。
 * R2 の写しを Supabase の試験用のバケット storage-mirror-drill（オーナーが作る）へ戻し、読み直して sha256 と Content-Type を照合する。
 *
 *   node scripts/storage-mirror/restore.js          バケットごとに一番大きいファイルと20件（月1回）
 *   node scripts/storage-mirror/restore.js --all    元にある全部（採用時に1回）
 *
 * 「Supabase は読むだけ」の例外はこのファイルと試験用のバケットに限る。戻す先は定数で、送る直前に正規化した後の URL が
 * 試験用のバケットの下かを確かめる（scripts/lib/storageMirrorDrill.js の createDrillTarget）。消す処理は持たない。
 * 本当の事故で元のバケットへ戻すときは、このファイルの戻す先を変える PR を出して審査を通す（docs/operation/storage-mirror-r2-owner-steps.md）。
 */
import { appendFileSync } from "node:fs";
import {
  createDrillTarget,
  DRILL_BUCKET,
  runDrill,
} from "../lib/storageMirrorDrill.js";
import { createR2Client, r2EnvOrThrow } from "./r2.js";
import { supabaseEnv } from "./supabase-source.js";

const MB = (n) => (n / 1e6).toFixed(1);

async function main() {
  const all = process.argv.includes("--all");
  const r2 = createR2Client(r2EnvOrThrow());
  const result = await runDrill({ r2, drill: createDrillTarget(supabaseEnv()), all });
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
