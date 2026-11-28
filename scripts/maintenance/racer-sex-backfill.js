#!/usr/bin/env node
/**
 * 過去の fan（期別成績）から racer_sex（214）を埋める CLI。設計: docs/design/data-gaps/db-draft.md §1.5（M5）
 *
 * 毎日の Cron（fanPeriodJob.js）は新しい期の fan を取り込むときだけ racer_sex を書く。今ある期（取り込み済み）と
 * 過去の期はこの CLI で1回流す。書き方は Cron と同じ racerSexRows.js（1・2 だけ、sex だけを比べる、
 * 男女が逆なら書かずに警告、updated_at は書き手が入れる）。古い順に流すので、source_fan は最初に載った fan になる。
 *
 * 読むのは fan-backfill.js の中間JSON（data/fan-archive/parsed）。無ければ先に取得と解析をする:
 *   node scripts/maintenance/fan-backfill.js download --from=fan1904 --to=fan2604
 *   node scripts/maintenance/fan-backfill.js parse --from=fan1904 --to=fan2604
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/racer-sex-backfill.js --from=fan1904 --to=fan2604           # 数えるだけ
 *   node --env-file=.env.local scripts/maintenance/racer-sex-backfill.js --from=fan1904 --to=fan2604 --apply   # 書く（要承認）
 *
 * 終了コード: 0=完了 / 1=エラー（範囲に中間JSONの無い fan がある・読み書きの失敗・書く行も変わらない行も0）
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAN_SCHEMA, listFanIds, parseFanId } from "../lib/fanPeriodParser.js";
import { syncRacerSex } from "../lib/racerSexRows.js";
import { readParsedFan } from "./fan-backfill-load.js";

const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function parseArgs(argv) {
  const opts = {
    from: null,
    to: null,
    apply: false,
    archiveDir: path.join(REPO_ROOT, "data/fan-archive"),
  };
  for (const arg of argv) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k === "from") opts.from = v;
    else if (k === "to") opts.to = v;
    else if (k === "apply") opts.apply = true;
    else if (k === "archive-dir") opts.archiveDir = path.resolve(v);
    else throw new Error(`不明なオプション: ${arg}`);
  }
  if (!opts.from || !opts.to)
    throw new Error(
      "--from と --to を付けてください（例 --from=fan1904 --to=fan2604）",
    );
  parseFanId(opts.from);
  parseFanId(opts.to);
  return opts;
}

/** 範囲の fan を古い順に読む。中間JSONが1つでも無ければ、書く前に例外 */
export function readFans(opts, read = readParsedFan) {
  const ids = listFanIds(opts.from, opts.to);
  if (ids.length === 0) throw new Error("--from は --to 以前にしてください");
  const fans = ids.map((id) => ({ id, fan: read(opts.archiveDir, id) }));
  const missing = fans.filter((f) => !f.fan).map((f) => f.id);
  if (missing.length > 0)
    throw new Error(
      `中間JSONがありません: ${missing.join(", ")}（fan-backfill.js の download → parse を先に）`,
    );
  for (const { id, fan } of fans)
    if (fan.schema !== FAN_SCHEMA)
      throw new Error(`${id}: 未対応のスキーマ ${fan.schema}`);
  return fans.map((f) => f.fan);
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{client?: object, read?: Function, log?: Function, now?: Date}} [deps] テスト用の差し替え
 */
export async function run(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const fans = readFans(opts, deps.read);
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const total = { written: 0, unchanged: 0, conflicts: 0 };
  for (const fan of fans) {
    // dry-run は既存の行と比べるだけなので、同じ選手が後の fan で「書く」に数え直される（--apply の数より多い）
    const r = await syncRacerSex(client, fan, {
      dryRun: !opts.apply,
      now: deps.now,
    });
    for (const w of r.warnings) console.warn(`  ⚠ ${w}`);
    const counted = opts.apply
      ? r.written
      : r.rows - r.unchanged - r.conflicts.length;
    total.written += counted;
    total.unchanged += r.unchanged;
    total.conflicts += r.conflicts.length;
    log(
      `${fan.id}: ${r.rows}人（${opts.apply ? "書いた" : "書く候補"} ${counted} / 変わらない ${r.unchanged} / 逆 ${r.conflicts.length} / 1・2以外 ${r.skipped}）`,
    );
  }
  log(
    `${opts.apply ? "書いた" : "[DRY-RUN] 書く候補"} ${total.written} / 変わらない ${total.unchanged} / 逆 ${total.conflicts}`,
  );
  if (total.written + total.unchanged === 0) {
    console.error("書く行も変わらない行も0でした。異常として扱います");
    return 1;
  }
  return 0;
}

async function main() {
  try {
    return await run(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
