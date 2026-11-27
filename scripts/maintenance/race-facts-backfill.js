#!/usr/bin/env node
/**
 * race-facts-backfill.js - facts の表（race_facts・run_facts、マイグレーション 212・ADR-0113）の kb 層を、kb_archive_* から組み立てて書く CLI。オーナーが実行する。
 *
 *   node scripts/maintenance/race-facts-backfill.js --era=kb            # 組み立てて、書く予定と消す予定の数を出す（書かない）
 *   node scripts/maintenance/race-facts-backfill.js --era=kb --apply    # 書く（kb_archive を入れ直したときだけ再実行）
 *
 * オプション:
 *   --apply              書く（無ければ数えるだけ）
 *   --from=YYYY-MM-DD    始まり（既定は kb の最初の日 2019-04-01）
 *   --to=YYYY-MM-DD      終わり（両端を含む。既定は kb の最後の日 2025-12-02。それより後は拒む）
 *   --allow-mass-delete  消える行が窓の2割を超えても止めない（組み立ての規則を変えたときだけ）
 *
 * kb_archive は race_id の範囲（PK の先頭）で半月ずつ読む（racer-career-backfill.js と同じ）。グレードの補正は 190 と同じ
 * loadJudgeInputs。変わった行だけを upsertChangedRows で書き、窓の中で組み立て直した行に無い facts の kb の行は消す。
 * 夜間に回す（約221万艇。所要時間は未計測）。設計: docs/design/past-data-backfill/plan.md §3、ADR-0113
 */
import { isDirectRun } from "../lib/isDirectRun.js";
import { KB_FIRST_DATE, KB_LAST_DATE } from "../lib/kbArchiveBoundary.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { era: null, apply: false, from: KB_FIRST_DATE, to: KB_LAST_DATE, allowMassDelete: false };
  for (const a of argv) {
    if (a.startsWith("--era=")) opts.era = a.slice(6);
    else if (a === "--apply") opts.apply = true;
    else if (a.startsWith("--from=")) opts.from = a.slice(7);
    else if (a.startsWith("--to=")) opts.to = a.slice(5);
    else if (a === "--allow-mass-delete") opts.allowMassDelete = true;
    else throw new Error(`知らないオプション: ${a}`);
  }
  if (opts.era !== "kb") throw new Error("--era=kb を指定する（main 層は Cron が書く）");
  for (const k of ["from", "to"]) if (!DATE.test(opts[k])) throw new Error(`--${k} は YYYY-MM-DD: ${opts[k]}`);
  if (opts.from < KB_FIRST_DATE || opts.to > KB_LAST_DATE || opts.from > opts.to) {
    throw new Error(`期間は ${KB_FIRST_DATE}〜${KB_LAST_DATE} の中で、始まり ≤ 終わり: ${opts.from}〜${opts.to}`);
  }
  return opts;
}

const byRange = (q, { from, to }, column = "race_id") => q.gte(column, from).lt(column, to);

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 引数の検査（verify が読む）だけで .env.local を読まないよう、クライアントと DB の部品は実行のときに読み込む
  const { supabase, isSupabaseEnabled, fetchAll } = await import("../lib/supabaseClient.js");
  if (!isSupabaseEnabled()) throw new Error("Supabase の環境変数が未設定（SUPABASE_URL / SUPABASE_SERVICE_KEY）");
  const { loadJudgeInputs } = await import("../lib/racerCareerDb.js");
  const { halfMonthRanges, kbYearRanges } = await import("../lib/racerCareerSeries.js");
  const { writeFactsWindow } = await import("../lib/raceFactsWrite.js");
  const { runKbFacts } = await import("../lib/raceFactsKbJob.js");
  const dryRun = !opts.apply;
  const client = supabase;
  console.log(`race-facts-backfill: kb ${opts.from}〜${opts.to}${dryRun ? "（数えるだけ。書くには --apply）" : "（書く）"}`);

  const inputs = await loadJudgeInputs({ client, era: "kb", ranges: kbYearRanges() });
  const seedMissing = inputs.overrides.report.filter((r) => r.seedMissing);
  if (seedMissing.length > 0) throw new Error(`特別な節の基準のレースが見つからない: ${JSON.stringify(seedMissing)}`);

  const totals = await runKbFacts({
    ranges: halfMonthRanges(opts.from, opts.to),
    overrides: inputs.overrides,
    allowMassDelete: opts.allowMassDelete,
    fetchWindow: async (range) => ({
      races: await fetchAll("kb_archive_races", "*", (q) => byRange(q, range).order("race_id"), { client }),
      boats: await fetchAll("kb_archive_boats", "*", (q) => byRange(q, range).order("race_id").order("boat_number"), { client }),
      venueDays: await fetchAll("kb_archive_venue_days", "*", (q) => byRange(q, range, "venue_day_id").order("venue_day_id"), { client }),
    }),
    fetchExistingKeys: async (range) => ({
      race: (await fetchAll("race_facts", "race_id", (q) => byRange(q, range).eq("era", "kb").order("race_id"), { client }))
        .map((r) => r.race_id),
      run: (await fetchAll("run_facts", "race_id,boat_number", (q) => byRange(q, range).eq("era", "kb").order("race_id").order("boat_number"), { client }))
        .map((r) => `${r.race_id}|${r.boat_number}`),
    }),
    writeWindow: (plan) => writeFactsWindow(client, plan, { dryRun }),
  });
  console.log(`\n合計: ${JSON.stringify(totals)}`);
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    console.error(`race-facts-backfill: ${e.message}`);
    process.exit(1);
  });
}
