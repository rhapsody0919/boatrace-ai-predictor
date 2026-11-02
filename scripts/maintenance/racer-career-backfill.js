#!/usr/bin/env node
/**
 * racer-career-backfill.js - 選手ページ（GS00 案2）の集計の表（マイグレーション 190）を手で計算する CLI。オーナーが実行する。
 *
 *   node scripts/maintenance/racer-career-backfill.js --era=kb             # kb 層（2019-04-01〜2025-12-02）を数えて、書く予定を出す（書かない）
 *   node scripts/maintenance/racer-career-backfill.js --era=kb --apply     # 書く（1回だけ。kb_archive が変わったときだけ再実行）
 *   node scripts/maintenance/racer-career-backfill.js --era=main --all --apply
 *                                                                          # main 層（2025-12-03〜）の全選手（初回。毎晩は Cron が直近の選手だけ）
 *
 * オプション:
 *   --apply              書く（無ければ数えるだけで、書く行数・消すセルの数を出す）
 *   --all                （main）2025-12-03 以降に出た全選手を計算する。無ければ直近3日に出た選手
 *   --today=YYYY-MM-DD   （main）基準の日（既定は JST の今日）
 *   --allow-mass-delete  消えるセルが2割を超えても止めない（規則を変えて計算し直すときだけ）
 *
 * kb は race_id の範囲（kb_archive_boats の PK の先頭）で半月ずつ読む（1回の RPC を 8秒の打ち切りより十分短くするため。
 * 1か月で約3秒、2026-10-31 の本番の読み取り）。年ごとの艇の行数と kb_archive の指紋（開催日・レースの数・最大の日付）を
 * racer_career_meta に残し、毎晩の Cron が変化を見張る。設計: docs/design/racer-period-stats/plan.md §14、ADR-0104
 */
import { isDirectRun } from "../lib/isDirectRun.js";
import { runKbEra, runMainEra } from "../lib/racerCareerJob.js";

const todayJst = () =>
  new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = {
    era: null,
    apply: false,
    all: false,
    today: null,
    allowMassDelete: false,
  };
  for (const a of argv) {
    if (a.startsWith("--era=")) opts.era = a.slice(6);
    else if (a === "--apply") opts.apply = true;
    else if (a === "--all") opts.all = true;
    else if (a.startsWith("--today=")) opts.today = a.slice(8);
    else if (a === "--allow-mass-delete") opts.allowMassDelete = true;
    else throw new Error(`知らないオプション: ${a}`);
  }
  if (opts.era !== "kb" && opts.era !== "main")
    throw new Error("--era=kb か --era=main を指定する");
  if (opts.era === "kb" && (opts.all || opts.today))
    throw new Error(
      "--all・--today は --era=main だけで使う（kb は常に全期間・全選手）",
    );
  if (opts.today && !/^\d{4}-\d{2}-\d{2}$/.test(opts.today))
    throw new Error(`--today は YYYY-MM-DD: ${opts.today}`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 引数の検査（verify が読む）だけで .env.local を読まないよう、クライアントは実行のときに読み込む
  const { supabase, isSupabaseEnabled } = await import(
    "../lib/supabaseClient.js"
  );
  if (!isSupabaseEnabled())
    throw new Error(
      "Supabase の環境変数が未設定（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  const dryRun = !opts.apply;
  console.log(
    `racer-career-backfill: era=${opts.era}${dryRun ? "（数えるだけ。書くには --apply）" : "（書く）"}`,
  );
  const t0 = Date.now();
  if (opts.era === "kb") {
    const { meta, writeRes } = await runKbEra({
      client: supabase,
      dryRun,
      allowMassDelete: opts.allowMassDelete,
    });
    console.log(
      `\nkb: 艇 ${meta.source_rows} 行（${meta.source_from}〜${meta.source_to}）、年ごと ${JSON.stringify(meta.fingerprint.boats_by_year)}`,
    );
    console.log(`表ごと: ${JSON.stringify(writeRes.perTable)}`);
  } else {
    const res = await runMainEra({
      client: supabase,
      today: opts.today ?? todayJst(),
      dryRun,
      all: opts.all,
      allowMassDelete: opts.allowMassDelete,
    });
    console.log(`\nmain: ${JSON.stringify(res)}`);
  }
  console.log(
    `\n${dryRun ? "書いていない（--apply で書く）" : "書いた"}。${Math.round((Date.now() - t0) / 1000)}秒`,
  );
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n失敗: ${error.message}`);
    process.exit(1);
  });
}
