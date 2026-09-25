#!/usr/bin/env node
/**
 * 開催されなかった（中止・順延確定済みで race_results が存在しない）レースに
 * 誤生成された predictions を削除する（BOA-411）。
 *
 * 背景: BOA-406の調査（PR #816）で、2025-12-03〜2026-03-31のcancellation_status未設定
 * だった中止・打ち切りレース269件で、predictions（standard/safeBet/upsetFocus計779行）が
 * 生成済みと判明した。269件は2026-09-24にcancellation_status='confirmed'へ是正済みだが、
 * predictions側は残存している。
 *
 * 加えてBOA-411の再調査で、この不具合はBOA-254（cancellation_status検出機構、2026-09-06導入）
 * 後も現在進行形で再発していると判明した（2026-09-09/12/21/22、61レース・244行）。原因は、
 * generate-predictions.js（mainRefresh）が発走前の時間窓（発走60/30/15/10/5分前）で予測を
 * 生成する一方、中止・順延の確定（confirmCancellationsForRaceIds）は発走90分超・結果未取得を
 * 待つ、または公式の早期告知（raceStatusJob）に依存するため、確定より先に予測生成が走ってしまう
 * 構造的なタイムラグがあること。generate-predictions.js 側の再発防止（cancellation_status が
 * 既に設定されているレースを生成対象から除外する）は別途実装済み（fetchRaceDataFromSupabase）。
 * 本スクリプトは、その対策が入る前に生成されてしまった既存の残骸行を削除する。
 *
 * 対象の定義（date range を決め打ちしない汎用条件）:
 *   races.cancellation_status IS NOT NULL（'tentative'または'confirmed'）
 *   AND race_results が存在しない（今後も結果が来ない = is_hit_win 等が永遠にNULLのまま）
 *
 * 安全確認（2026-09-25実測、docs/design/scraping-vercel-consolidation/boa411-cancelled-race-predictions-fix.md参照）:
 *   - 対象行は全件 is_hit_win/is_hit_place/is_hit_trifecta/is_hit_trio/payout_* が NULL
 *   - calculate-accuracy.js の集計は `.not("is_hit_win", "is", null)` でフィルタしており、
 *     対象行は現在の的中率・回収率集計に一切混入していない（削除しても集計値は変化しない）
 *   - predictions.race_id は races への ON DELETE CASCADE のみ。races 自体は削除しない
 *     （cancellation_status の是正結果は保持する）
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js plan
 *   node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js delete          # DRY-RUN
 *   node --env-file=.env.local scripts/maintenance/delete-cancelled-race-predictions.js delete --apply  # 書き込み（要承認）
 */
import { fetchAll, supabase } from "../lib/supabaseClient.js";

/** 対象 race_id の一覧（cancellation_status IS NOT NULL AND race_results なし）を返す */
async function findTargetRaceIds() {
  const cancelledRaces = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number, cancellation_status",
    (q) => q.not("cancellation_status", "is", null),
    { throwOnError: true },
  );
  if (cancelledRaces.length === 0) return [];

  const raceIds = cancelledRaces.map((r) => r.race_id);
  // race_results の存在確認は race_id の IN が大量になりうるため、races と同じ範囲でチャンク取得する
  const CHUNK = 500;
  const withResults = new Set();
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const chunk = raceIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id")
      .in("race_id", chunk);
    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    for (const row of data ?? []) withResults.add(row.race_id);
  }

  return cancelledRaces.filter((r) => !withResults.has(r.race_id));
}

async function fetchPredictionCount(raceIds) {
  if (raceIds.length === 0) return 0;
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const chunk = raceIds.slice(i, i + CHUNK);
    const { count, error } = await supabase
      .from("predictions")
      .select("prediction_id", { count: "exact", head: true })
      .in("race_id", chunk);
    if (error) throw new Error(`predictions件数取得エラー: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

async function cmdPlan() {
  const targets = await findTargetRaceIds();
  const raceIds = targets.map((r) => r.race_id);
  const predCount = await fetchPredictionCount(raceIds);

  console.log(
    `削除対象: ${targets.length}レース（cancellation_status非NULL・race_resultsなし）・predictions ${predCount}行`,
  );

  const byStatus = new Map();
  for (const r of targets) {
    byStatus.set(
      r.cancellation_status,
      (byStatus.get(r.cancellation_status) ?? 0) + 1,
    );
  }
  for (const [status, count] of byStatus) {
    console.log(`  cancellation_status='${status}': ${count}レース`);
  }

  const byDate = new Map();
  for (const r of targets) {
    byDate.set(r.race_date, (byDate.get(r.race_date) ?? 0) + 1);
  }
  const dates = [...byDate.keys()].sort();
  console.log(`対象日: ${dates.length}日（${dates[0]} 〜 ${dates.at(-1)}）`);
  for (const date of dates) {
    console.log(`  ${date}: ${byDate.get(date)}レース`);
  }
  return 0;
}

async function cmdDelete(apply) {
  const targets = await findTargetRaceIds();
  const raceIds = targets.map((r) => r.race_id);
  console.log(`削除対象: ${raceIds.length}レース`);
  if (raceIds.length === 0) {
    console.log("対象0件です");
    return 0;
  }

  const predCount = await fetchPredictionCount(raceIds);
  console.log(`  predictions ${predCount}行が削除されます`);

  if (!apply) {
    console.log("[DRY-RUN] --apply を付けると本番から削除します");
    console.log(
      raceIds.slice(0, 10).join(", ") + (raceIds.length > 10 ? " ..." : ""),
    );
    return 0;
  }

  // races は削除しない（cancellation_status の是正結果を保持する）。predictions のみ削除する
  const CHUNK = 500;
  let deleted = 0;
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const chunk = raceIds.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("predictions")
      .delete({ count: "exact" })
      .in("race_id", chunk);
    if (error) {
      console.error("削除エラー:", error.message);
      return 1;
    }
    deleted += count ?? 0;
  }
  console.log(`削除完了: predictions ${deleted}行`);
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (command === "plan") return await cmdPlan();
  if (command === "delete") return await cmdDelete(apply);
  console.error(
    "使い方: node scripts/maintenance/delete-cancelled-race-predictions.js <plan|delete> [--apply]",
  );
  return 1;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
