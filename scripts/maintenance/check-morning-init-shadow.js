/**
 * check-morning-init-shadow.js - 朝の初期化（races-init）と公式コンピュータ予想（pcexpect）の shadow の集計
 * （読み取りのみ。DBへは書き込まない。select しか呼ばない）。
 *
 * shadow が記録したダイジェストを、既存基盤（GitHub Actions の morning-init）が races・race_entries・
 * external_predictions に書いた値から同じ関数で計算したダイジェストと比べる
 * （tasks.md T4b-07-7・T4b-08-4、verification-runbook.md「朝の初期化・公式予想の切り替え」）。
 *
 *   node --env-file=.env.local scripts/maintenance/check-morning-init-shadow.js               # 今日（JST）
 *   node --env-file=.env.local scripts/maintenance/check-morning-init-shadow.js --date=2026-09-22
 *   node --env-file=.env.local scripts/maintenance/check-morning-init-shadow.js --strict      # 基準を満たさなければ終了コード1
 *
 * races-init（scrape_job_state.cursor）: 会場・レース・艇数・完了・所要時間（起動〜最後の成功）と、レースごとのダイジェストの
 *   一致 / 不一致 / DBに行なし（既存基盤がまだ書いていない）/ shadowに無い（shadowが取りこぼした）。
 *   注意: cursor は、翌日の最初の起動（05:00 JST）で上書きされる。比較は、その日のうちに（既存基盤が初期化した後に）行う。
 * pcexpect（scrape_slots）: 状態・outcome・run_mode の件数、expired・未実行、shadow の完了（ok）のダイジェストと
 *   external_predictions.payload のダイジェストの一致、完了時刻の発走前の余裕（分）。
 *
 * --strict の基準: races-init のダイジェスト一致率 99%以上・不一致 0 件・shadow が done。
 *   pcexpect のダイジェスト一致率 99%以上・不一致 0 件・expired 0 件。
 */
import { createClient } from "@supabase/supabase-js";
import { compareRaceDigests } from "../lib/racesInit/digest.js";
import { computePcexpectDigest } from "../daily/scrape-pcexpect.js";
import { percentile } from "../lib/scrapeJobs/monitor.js";
import { slotDeadline } from "../lib/scrapeJobs/time.js";

const PAGE = 1000;
const CHUNK = 100;

/**
 * shadow で完了（ok）した公式予想のスロットのダイジェストと、external_predictions の payload から計算したダイジェストを比べる（純粋関数）。
 *
 * @param {Array<{race_id: string, result_digest: string|null}>} slots
 * @param {Array<{race_date: string, venue_code: number, race_no: number, payload: Object}>} rows external_predictions の行
 */
export function comparePcexpectDigests(slots, rows) {
  const byRaceId = new Map(
    rows.map((r) => [
      `${r.race_date}-${String(r.venue_code).padStart(2, "0")}-${String(r.race_no).padStart(2, "0")}`,
      r,
    ]),
  );
  const out = { matched: 0, mismatched: [], missing: [], noDigest: [] };
  for (const slot of slots) {
    if (!slot.result_digest) {
      out.noDigest.push(slot.race_id);
      continue;
    }
    const row = byRaceId.get(slot.race_id);
    if (!row) {
      out.missing.push(slot.race_id);
      continue;
    }
    const db = computePcexpectDigest(row.payload);
    if (db === slot.result_digest) out.matched++;
    else
      out.mismatched.push({
        race_id: slot.race_id,
        shadow: slot.result_digest,
        db,
      });
  }
  return out;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const rateOf = (matched, denominator) =>
  denominator === 0 ? null : matched / denominator;
const pct = (r) => (r === null ? "算出不能" : `${(r * 100).toFixed(2)}%`);

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const strict = args.includes("--strict");
  const date = arg("date") ?? jstToday();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("❌ SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exit(1);
  }
  const client = createClient(url, key);
  let failed = false;

  // -------------------------------------------------------------------------
  // races-init
  // -------------------------------------------------------------------------
  console.log(`■ races-init（朝の初期化） 対象日 ${date}\n`);
  const { data: state, error: stateError } = await client
    .from("scrape_job_state")
    .select("mode,cursor,last_success_at,last_error,consecutive_failures")
    .eq("job", "races_init")
    .maybeSingle();
  if (stateError) throw new Error(`scrape_job_state: ${stateError.message}`);
  const cursor = state?.cursor;
  if (!state) {
    console.log("  races_init の行がありません（未起動）");
    failed = true;
  } else if (!cursor || cursor.targetDate !== date) {
    console.log(
      `  cursor の対象日が ${date} ではありません（cursor: ${cursor?.targetDate ?? "なし"}、mode=${state.mode}）。翌日の最初の起動で上書きされた可能性`,
    );
    failed = true;
  } else {
    const elapsedMin =
      cursor.startedAt && state.last_success_at
        ? (new Date(state.last_success_at) - new Date(cursor.startedAt)) / 60000
        : null;
    console.log(
      `  mode=${state.mode}（cursorのmode=${cursor.mode}） done=${cursor.done} 会場 ${cursor.settled.length}/${cursor.targets.length}（一覧 ${cursor.venues.length}・初期化済み ${cursor.existing.length}） レース ${cursor.races} 艇 ${cursor.entries}`,
    );
    console.log(
      `  開始 ${cursor.startedAt} 最終成功 ${state.last_success_at} 所要 ${elapsedMin === null ? "-" : elapsedMin.toFixed(1)}分 連続失敗 ${state.consecutive_failures} 直近エラー ${state.last_error ?? "なし"}`,
    );
    const attemptCounts = Object.entries(cursor.attempts ?? {}).filter(
      ([, n]) => n > 1,
    );
    if (attemptCounts.length > 0) {
      console.log(
        `  再試行した会場: ${attemptCounts.map(([v, n]) => `${v}(${n}回)`).join(", ")}`,
      );
    }
    if (!cursor.done) failed = true;

    const raceRows = await fetchAll(() =>
      client
        .from("races")
        .select("race_id,start_time")
        .gte("race_id", date)
        .lt("race_id", `${date}~`)
        .order("race_id"),
    );
    const entryRows = await fetchAll(() =>
      client
        .from("race_entries")
        .select(
          "race_id,boat_number,racer_id,grade,age,motor_number,boat_number_id",
        )
        .gte("race_id", date)
        .lt("race_id", `${date}~`)
        .order("race_id")
        .order("boat_number"),
    );
    const cmp = compareRaceDigests(cursor.digests ?? {}, raceRows, entryRows);
    const denominator = cmp.matched + cmp.mismatched.length;
    const rate = rateOf(cmp.matched, denominator);
    console.log(
      `\n  DB: races ${raceRows.length}件・race_entries ${entryRows.length}行`,
    );
    console.log(
      `  ダイジェスト: 一致 ${cmp.matched} / 不一致 ${cmp.mismatched.length} / DBに行なし ${cmp.missingInDb.length} / shadowに無い ${cmp.extraInDb.length}`,
    );
    console.log(`  一致率: ${pct(rate)}（${cmp.matched}/${denominator}）`);
    for (const m of cmp.mismatched.slice(0, 20)) {
      console.log(`    不一致 ${m.race_id}: shadow=${m.shadow} db=${m.db}`);
    }
    if (cmp.missingInDb.length > 0) {
      console.log(
        `    DBに行なし（既存基盤がまだ初期化していない・書けなかった）: ${cmp.missingInDb.slice(0, 10).join(", ")}${cmp.missingInDb.length > 10 ? " …" : ""}`,
      );
    }
    if (cmp.extraInDb.length > 0) {
      console.log(
        `    shadowに無い（shadowが取りこぼした会場・レース）: ${cmp.extraInDb.slice(0, 10).join(", ")}${cmp.extraInDb.length > 10 ? " …" : ""}`,
      );
    }
    if (
      cmp.mismatched.length > 0 ||
      cmp.extraInDb.length > 0 ||
      (rate !== null && rate < 0.99) ||
      (state.mode === "shadow" && !cursor.done)
    ) {
      failed = true;
    }
    if (denominator === 0) failed = true;
  }

  // -------------------------------------------------------------------------
  // pcexpect
  // -------------------------------------------------------------------------
  console.log(`\n■ pcexpect（公式コンピュータ予想） 対象日 ${date}\n`);
  const slots = await fetchAll(() =>
    client
      .from("scrape_slots")
      .select(
        "race_id,race_date,offset_min,status,attempts,outcome,run_mode,done_at,result_digest,last_error,races(start_time,cancellation_status)",
      )
      .eq("job", "pcexpect")
      .eq("race_date", date)
      .order("race_id"),
  );
  console.log(`  スロット ${slots.length}件`);
  const tally = new Map();
  for (const s of slots) {
    const k = `${(s.run_mode ?? "未着手").padEnd(6)} ${s.status.padEnd(8)} ${s.outcome ?? "-"}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...tally].sort()) console.log(`    ${k}: ${v}`);
  const expired = slots.filter((s) => s.status === "expired");
  console.log(
    `  expired: ${expired.length}件（うち未実行 attempts=0: ${expired.filter((s) => (s.attempts ?? 0) === 0).length}件）`,
  );
  if (expired.length > 0) failed = true;

  const shadowOk = slots.filter(
    (s) => s.run_mode === "shadow" && s.status === "done" && s.outcome === "ok",
  );
  if (shadowOk.length > 0) {
    const rows = await fetchAll(() =>
      client
        .from("external_predictions")
        .select("race_date,venue_code,race_no,payload,scraped_at")
        .eq("source", "pcexpect_official")
        .eq("race_date", date),
    );
    const cmp = comparePcexpectDigests(shadowOk, rows);
    const denominator = cmp.matched + cmp.mismatched.length;
    const rate = rateOf(cmp.matched, denominator);
    console.log(
      `\n  shadow の完了（ok）: ${shadowOk.length}件 → ダイジェスト 一致 ${cmp.matched} / 不一致 ${cmp.mismatched.length} / DBに行なし ${cmp.missing.length} / digest未記録 ${cmp.noDigest.length}`,
    );
    console.log(`  一致率: ${pct(rate)}（${cmp.matched}/${denominator}）`);
    for (const m of cmp.mismatched.slice(0, 20)) {
      console.log(`    不一致 ${m.race_id}: shadow=${m.shadow} db=${m.db}`);
    }
    if (cmp.mismatched.length > 0 || (rate !== null && rate < 0.99)) {
      failed = true;
    }
    // 完了時刻の、発走30分前（許容幅の終わり）までの余裕
    const margins = [];
    for (const s of shadowOk) {
      if (s.races?.start_time && s.done_at) {
        const start = slotDeadline(s.race_date, s.races.start_time, 0);
        margins.push((start - new Date(s.done_at)) / 60000);
      }
    }
    margins.sort((a, b) => a - b);
    const fmt = (v) => (v === null ? "-" : v.toFixed(0));
    console.log(
      `  完了時刻の発走前の余裕: 最小 ${fmt(margins[0] ?? null)}分 / p5 ${fmt(percentile(margins, 5))}分 / p50 ${fmt(percentile(margins, 50))}分（n=${margins.length}）。期限は発走30分前`,
    );
  } else {
    console.log("\n  shadow で完了（ok）したスロットがありません");
    if (slots.some((s) => s.run_mode === "live")) {
      console.log(
        "  （live のスロットのみ。live のデータは、別途 external_predictions の件数で確認）",
      );
    } else {
      failed = true;
    }
  }

  if (strict && failed) {
    console.error("\n❌ --strict: 基準を満たしていません（上の出力を確認）");
    process.exit(1);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌", error.message);
    process.exit(1);
  });
}
