#!/usr/bin/env node
/**
 * Supabase Storage の3バケットを Cloudflare R2 に書き足す（ADR-0099、.github/workflows/storage-mirror.yml が1日1回動かす）。
 *
 *   node scripts/storage-mirror/mirror.js                 写す（Environment prod-jobs の secret が要る）
 *   node scripts/storage-mirror/mirror.js --initial       初回だけ（基準の manifest が無いとき。取り寄せの上限を外す）
 *   node scripts/storage-mirror/mirror.js --accept-gone   元の大量の削除を正しいと認め、この run を基準にする
 *   node scripts/storage-mirror/mirror.js --dry-run       元の一覧と基準の manifest の差の件数だけを出す（R2 に書かない）
 *
 * 1件でも写し損ねたら、写せた分の manifest を書いたうえで exit 1（success の run は「その時点の全部を写した」）。
 * 要約（件数・容量だけ。パスは出さない）は GITHUB_STEP_SUMMARY があればそこにも書く。
 */
import { appendFileSync } from "node:fs";
import {
  findBaseline,
  goneKeys,
  MANIFEST_PREFIX,
  manifestKeysNewestFirst,
  planBucket,
  runMirror,
  sourceKey,
  SOURCE_BUCKETS,
} from "../lib/storageMirror.js";
import { createR2Client, r2EnvOrThrow } from "./r2.js";
import { supabaseSource } from "./supabase-source.js";

const MB = (n) => (n / 1e6).toFixed(1);

function summaryLines({ stamp, manifestKey, baseline, perBucket, failures }) {
  const lines = [
    `## Storage の写し（R2） ${stamp}`,
    "",
    manifestKey
      ? `manifest: \`${manifestKey}\`${baseline ? "" : "（基準にしない）"}`
      : "manifest: 変化なし（書いていない）",
    "",
    "| バケット | 元の件数 | 元の容量MB | 変わらず | 取り寄せ | 書いた | 書いたMB | 元で消えた | GET が 404 | 失敗 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...Object.entries(perBucket).map(
      ([b, s]) =>
        `| ${b} | ${s.listed} | ${MB(s.bytes)} | ${s.unchanged} | ${s.fetched} | ${s.written} | ${MB(s.writtenBytes)} | ${s.gone}${s.massGone ? "（大量）" : ""} | ${s.notFound} | ${s.failed} |`,
    ),
    "",
  ];
  if (failures.length)
    lines.push(`### 失敗 ${failures.length}件`, "", ...failures.map((f) => `- ${f}`), "");
  return lines;
}

async function dryRun(r2, source) {
  const keys = manifestKeysNewestFirst((await r2.list(MANIFEST_PREFIX)).map((o) => o.key));
  const base = await findBaseline(keys, (k) => r2.getManifest(k));
  const prev = base?.manifest.entries ?? {};
  console.log(`基準の manifest: ${base?.key ?? "無し"}（manifest は全部で ${keys.length}本）`);
  for (const b of SOURCE_BUCKETS) {
    const files = await source.list(b);
    const { unchanged, fetch } = planBucket(b, files, prev);
    const gone = goneKeys(b, files.map((f) => sourceKey(b, f.path)), prev);
    console.log(
      `${b}: ${files.length}件 ${MB(files.reduce((a, f) => a + f.size, 0))}MB、変わらず ${unchanged.length}、取り寄せ ${fetch.length}、元で消えた ${gone.length}`,
    );
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const r2 = createR2Client(r2EnvOrThrow());
  const source = supabaseSource();
  if (args.has("--dry-run")) return dryRun(r2, source);
  const result = await runMirror({
    source,
    r2,
    now: new Date(),
    initial: args.has("--initial"),
    acceptGone: args.has("--accept-gone"),
    log: (s) => console.log(s),
  });
  const text = summaryLines(result).join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (result.failures.length) {
    for (const f of result.failures) console.error(`::error::${f}`);
    process.exit(1);
  }
}

// 起動の判定（モジュールの URL と argv の比較）は置かない。パスの符号化で外れると、何もせず exit 0（success）になる
main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
