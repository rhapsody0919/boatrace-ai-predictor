#!/usr/bin/env node
/**
 * race_conditions.series_day（節の何日目か）を、節（race_series）から導いて過去分に埋める（BOA-501）
 *
 * 背景: 日目は出走表ページの日別タブからしか読んでおらず、タブが取れない・ラベルが既知の3パターンに
 * 当たらないと null になる。過去日を遡って埋める経路も無かったため、2026-09-28 の実測で 2025-12-02 以降の
 * 10,115 レース（940 会場×日）が NULL のまま残っていた。うち 10,099 レースは race_conditions の行そのものが
 * 無い（2025-12・2026-01 は出走表の取得が動いていなかった期間）。
 *
 * 導出は race_date − start_date + 1（scripts/lib/raceSeriesLookup.js）。節の途中に全レース中止の日があると
 * 1日ぶん進みすぎることが実測で分かっている（ページから読めた 3,064 会場×日のうち 8 件、0.26%）。
 * **既に series_day が入っている行は触らない**（ページの値が正で、それを上書きしない）。
 * 節（race_series）に行が無い会場×日は埋めず、件数と内訳を報告する。
 *
 * 【新規の公式サイトアクセスは無い】（DBの読み取りと書き込みのみ）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-series-day.js plan
 *   node --env-file=.env.local scripts/maintenance/backfill-series-day.js plan --from 2026-09-01 --to 2026-09-30
 *   node --env-file=.env.local scripts/maintenance/backfill-series-day.js apply           # DRY-RUN
 *   node --env-file=.env.local scripts/maintenance/backfill-series-day.js apply --apply   # 書き込み（要承認）
 */
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import { planSeriesDayBackfill } from "../lib/raceSeriesLookup.js";

const DEFAULT_FROM = "2000-01-01";
const DEFAULT_TO = "2100-01-01";
const BATCH_SIZE = 500;

/** `--from YYYY-MM-DD` 形式の引数を読む（不正な形式は例外） */
function readDateArg(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`--${name} は YYYY-MM-DD で指定してください: ${value}`);
  }
  return value;
}

/**
 * 対象レース・既存の race_conditions・節を読み、埋める計画を作る。
 * race_id は「YYYY-MM-DD-会場-R」形式のため、race_conditions は race_id の範囲で絞る。
 */
async function loadPlan({ from, to }) {
  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code",
    (q) =>
      q
        .gte("race_date", from)
        .lte("race_date", to)
        // 開催中止が確定したレースは、日目を埋める意味がない（分母からも外している指標と揃える）
        .or("cancellation_status.is.null,cancellation_status.neq.confirmed")
        .order("race_id"),
    { throwOnError: true },
  );
  const conditions = await fetchAll(
    "race_conditions",
    "race_id, series_day",
    (q) => q.gte("race_id", from).lte("race_id", `${to}~`).order("race_id"),
    { throwOnError: true },
  );
  const seriesRows = await fetchAll(
    "race_series",
    "venue_code, start_date, end_date",
    (q) =>
      q
        .lte("start_date", to)
        .gte("end_date", from)
        // 並び順は主キー（venue_code, start_date）で一意にする。start_date だけでは同じ日に始まる節が
        // 複数あり、ページングが不安定になる（取りこぼした節は no_series に化ける）
        .order("venue_code")
        .order("start_date"),
    { throwOnError: true },
  );
  const existingSeriesDay = new Map(
    conditions.map((c) => [c.race_id, c.series_day]),
  );
  return {
    races,
    seriesRows,
    ...planSeriesDayBackfill({ races, existingSeriesDay, seriesRows }),
  };
}

const monthOf = (raceId) => raceId.slice(0, 7);

/** 月別の内訳（挿入・更新の件数） */
function byMonth(inserts, updates) {
  const months = new Map();
  const bump = (raceId, key) => {
    const m = monthOf(raceId);
    if (!months.has(m)) months.set(m, { insert: 0, update: 0 });
    months.get(m)[key]++;
  };
  for (const r of inserts) bump(r.race_id, "insert");
  for (const r of updates) bump(r.race_id, "update");
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function report({ races, inserts, updates, skipped, alreadyFilled }) {
  console.log(`対象レース（中止確定を除く）: ${races.length}件`);
  console.log(`  既に series_day あり（触らない）: ${alreadyFilled}件`);
  console.log(
    `  埋められる: ${inserts.length + updates.length}件（新規行の挿入 ${inserts.length} / 既存行の更新 ${updates.length}）`,
  );
  console.log(`  埋められない: ${skipped.length}件`);
  if (skipped.length > 0) {
    const venueDays = new Set(
      skipped.map(
        (s) => `${s.race_date}-${String(s.venue_code).padStart(2, "0")}`,
      ),
    );
    const reasons = new Map();
    for (const s of skipped)
      reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    console.log(
      `    会場×日 ${venueDays.size}件 / 理由: ${[...reasons].map(([r, n]) => `${r}=${n}`).join(", ")}`,
    );
    console.log(
      `    例: ${[...venueDays].slice(0, 10).join(", ")}${venueDays.size > 10 ? " ..." : ""}`,
    );
    console.log(
      "    no_series = その会場×日を含む節が race_series に無い。月間スケジュールの取り込み（monthly-schedule-backfill.js）が先に要る",
    );
  }
  const months = byMonth(inserts, updates);
  if (months.length > 0) {
    console.log("  月別:");
    for (const [m, n] of months) {
      console.log(`    ${m}: 挿入 ${n.insert} / 更新 ${n.update}`);
    }
  }
}

async function cmdPlan(range) {
  report(await loadPlan(range));
  return 0;
}

/** 既存行の更新は、日目の値ごとにまとめて1回の update にする（race_id の数だけ往復しない） */
async function applyUpdates(updates) {
  const byDay = new Map();
  for (const u of updates) {
    if (!byDay.has(u.series_day)) byDay.set(u.series_day, []);
    byDay.get(u.series_day).push(u.race_id);
  }
  let written = 0;
  for (const [seriesDay, raceIds] of byDay) {
    for (let i = 0; i < raceIds.length; i += BATCH_SIZE) {
      const chunk = raceIds.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from("race_conditions")
        .update({ series_day: seriesDay })
        .in("race_id", chunk)
        // 二重防御: 実行時点で NULL の行だけを対象にする（並行して本筋の経路が書いた値を上書きしない）
        .is("series_day", null)
        .select("race_id");
      if (error) throw new Error(`更新エラー: ${error.message}`);
      written += data.length;
    }
  }
  return written;
}

/** 行が無いレースは、race_id と series_day だけの行を挿入する（他の列は NULL のまま） */
async function applyInserts(inserts) {
  let written = 0;
  for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
    const chunk = inserts.slice(i, i + BATCH_SIZE);
    // 並行して本筋の経路が行を作っていた場合に備え、upsert で衝突を無視する
    // （全行が同じ列の集合なので、既存行の他の列を NULL で潰すことはない）
    const { data, error } = await supabase
      .from("race_conditions")
      .upsert(chunk, { onConflict: "race_id", ignoreDuplicates: true })
      .select("race_id");
    if (error) throw new Error(`挿入エラー: ${error.message}`);
    written += data.length;
  }
  return written;
}

async function cmdApply(range, apply) {
  const plan = await loadPlan(range);
  report(plan);
  const total = plan.inserts.length + plan.updates.length;
  if (total === 0) {
    console.log("対象0件です");
    return 0;
  }
  if (!apply) {
    console.log("\n[DRY-RUN] --apply を付けると本番へ書き込みます");
    console.log(
      `  例: ${[...plan.inserts, ...plan.updates]
        .slice(0, 5)
        .map((r) => `${r.race_id}=${r.series_day}日目`)
        .join(", ")}${total > 5 ? " ..." : ""}`,
    );
    return 0;
  }
  const updated = await applyUpdates(plan.updates);
  const inserted = await applyInserts(plan.inserts);
  console.log(`\n書き込み完了: 挿入 ${inserted}件 / 更新 ${updated}件`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const [command] = args;
  const range = {
    from: readDateArg(args, "from", DEFAULT_FROM),
    to: readDateArg(args, "to", DEFAULT_TO),
  };
  const apply = args.includes("--apply");
  if (command === "plan") return await cmdPlan(range);
  if (command === "apply") return await cmdApply(range, apply);
  console.error(
    "使い方: node scripts/maintenance/backfill-series-day.js <plan|apply> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply]",
  );
  return 1;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
