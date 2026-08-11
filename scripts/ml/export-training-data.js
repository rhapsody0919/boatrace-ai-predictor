/**
 * ML学習用データセット輸出スクリプト（BOA-104 ポアロ予想 V1/V2）
 *
 * Supabase の以下テーブルを結合し、1行 = 1艇×1レースの学習用CSVを出力する。
 *   - races            レース基本情報（会場・R番号・グレード）
 *   - race_entries     艇別出走情報（選手勝率・モーター・級別 等）
 *   - exhibition_data  展示タイム・展示ST（直前情報）
 *   - race_conditions  天候・風・波高
 *   - race_results     着順・払戻（ラベル）
 *
 * 出力:
 *   data/ml/dataset.csv         メイン学習データ（艇別特徴量 + 着順ラベル + レース払戻）
 *   data/ml/start_timings.csv   本番STの履歴（選手のST傾向特徴量の材料）
 *
 * 使い方:
 *   node scripts/ml/export-training-data.js
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../data/ml");

/** CSVエスケープ（カンマ・引用符・改行を含む値を quote する） */
function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です（.env.local を確認）");
    process.exit(1);
  }
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log("📥 テーブル取得中（数分かかります）...");
  const [races, entries, exhibitions, conditions, results, timings] =
    await Promise.all([
      fetchAll(
        "races",
        "race_id, race_date, venue_code, race_number, race_grade",
      ),
      fetchAll(
        "race_entries",
        "race_id, boat_number, racer_id, player_name, grade, age, win_rate, local_win_rate, global_2rate, global_3rate, local_2rate, local_3rate, motor_number, motor_2rate, motor_3rate, boat_2rate, boat_3rate",
      ),
      fetchAll(
        "exhibition_data",
        "race_id, boat_number, exhibition_time, start_timing",
      ),
      fetchAll(
        "race_conditions",
        "race_id, weather, wind_direction, wind_speed, wave_height, temperature, water_temperature, series_day, is_final_day",
      ),
      fetchAll(
        "race_results",
        "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, is_cancelled, is_no_race, course_1, course_2, course_3, course_4, course_5, course_6, winning_technique",
      ),
      fetchAll(
        "race_start_timings",
        "race_id, boat_number, start_timing, is_flying, is_late_start",
      ),
    ]);

  console.log(
    `  races=${races.length} entries=${entries.length} exhibitions=${exhibitions.length}` +
      ` conditions=${conditions.length} results=${results.length} timings=${timings.length}`,
  );

  // インデックス化
  const raceById = new Map(races.map((r) => [r.race_id, r]));
  const condById = new Map(conditions.map((c) => [c.race_id, c]));
  const resultById = new Map(results.map((r) => [r.race_id, r]));
  const exhByKey = new Map(
    exhibitions.map((e) => [`${e.race_id}:${e.boat_number}`, e]),
  );

  // 結果あり・非中止レースのみを学習対象にする
  const rows = [];
  let skippedNoResult = 0;
  let skippedCancelled = 0;

  for (const e of entries) {
    const race = raceById.get(e.race_id);
    const result = resultById.get(e.race_id);
    if (!race || !result) {
      skippedNoResult++;
      continue;
    }
    if (result.is_cancelled || result.is_no_race) {
      skippedCancelled++;
      continue;
    }
    const cond = condById.get(e.race_id) || {};
    const exh = exhByKey.get(`${e.race_id}:${e.boat_number}`) || {};

    // 実際の進入コース（course_N = そのコースに入った艇番）から、この艇のコースを逆引き
    let actualCourse = null;
    for (let c = 1; c <= 6; c++) {
      if (result[`course_${c}`] === e.boat_number) {
        actualCourse = c;
        break;
      }
    }

    // ラベル: 着順（1/2/3、それ以外は0）
    let finishPos = 0;
    if (result.rank1 === e.boat_number) finishPos = 1;
    else if (result.rank2 === e.boat_number) finishPos = 2;
    else if (result.rank3 === e.boat_number) finishPos = 3;

    rows.push({
      // キー
      race_id: e.race_id,
      race_date: race.race_date,
      venue_code: race.venue_code,
      race_number: race.race_number,
      race_grade: race.race_grade,
      boat_number: e.boat_number,
      racer_id: e.racer_id,
      // 選手特徴量
      grade: e.grade,
      age: e.age,
      win_rate: e.win_rate,
      local_win_rate: e.local_win_rate,
      global_2rate: e.global_2rate,
      global_3rate: e.global_3rate,
      local_2rate: e.local_2rate,
      local_3rate: e.local_3rate,
      // 機材特徴量
      motor_2rate: e.motor_2rate,
      motor_3rate: e.motor_3rate,
      boat_2rate: e.boat_2rate,
      boat_3rate: e.boat_3rate,
      // 直前情報
      exhibition_time: exh.exhibition_time,
      exhibition_st: exh.start_timing,
      // レース条件
      weather: cond.weather,
      wind_direction: cond.wind_direction,
      wind_speed: cond.wind_speed,
      wave_height: cond.wave_height,
      temperature: cond.temperature,
      water_temperature: cond.water_temperature,
      series_day: cond.series_day,
      is_final_day: cond.is_final_day,
      // ラベル・結果情報（学習/バックテスト用。予測時には使わないこと）
      finish_pos: finishPos,
      actual_course: actualCourse,
      winning_technique: result.winning_technique,
      payout_win: result.payout_win,
      payout_place_1: result.payout_place_1,
      payout_place_2: result.payout_place_2,
      payout_trifecta: result.payout_trifecta,
      payout_trio: result.payout_trio,
      rank1: result.rank1,
      rank2: result.rank2,
      rank3: result.rank3,
    });
  }

  const columns = Object.keys(rows[0]);
  await fs.writeFile(path.join(OUT_DIR, "dataset.csv"), toCsv(rows, columns));
  console.log(
    `✅ dataset.csv: ${rows.length.toLocaleString()}行 ` +
      `(結果なしスキップ=${skippedNoResult}, 中止スキップ=${skippedCancelled})`,
  );

  // 本番ST履歴（選手ごとのローリング特徴量の材料。racer_id を付与して出力）
  const racerByKey = new Map(
    entries.map((e) => [`${e.race_id}:${e.boat_number}`, e.racer_id]),
  );
  const stRows = timings
    .map((t) => ({
      race_id: t.race_id,
      race_date: raceById.get(t.race_id)?.race_date ?? null,
      boat_number: t.boat_number,
      racer_id: racerByKey.get(`${t.race_id}:${t.boat_number}`) ?? null,
      start_timing: t.start_timing,
      is_flying: t.is_flying,
      is_late_start: t.is_late_start,
    }))
    .filter((t) => t.race_date != null);
  await fs.writeFile(
    path.join(OUT_DIR, "start_timings.csv"),
    toCsv(stRows, Object.keys(stRows[0])),
  );
  console.log(`✅ start_timings.csv: ${stRows.length.toLocaleString()}行`);

  // 単勝オッズ（各レースの最新スナップショットのみ。ΔR²評価・オッズ結合の材料）
  // 特徴量には使わない: 日次推論時点ではオッズが存在しないため（学習/評価専用）
  const oddsSnapshots = await fetchAll(
    "race_odds",
    "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
    (q) => q.order("race_id").order("captured_at"),
  );
  const latestOdds = new Map();
  for (const o of oddsSnapshots) {
    const prev = latestOdds.get(o.race_id);
    if (!prev || o.captured_at > prev.captured_at) latestOdds.set(o.race_id, o);
  }
  const oddsRows = [...latestOdds.values()].filter((o) =>
    [1, 2, 3, 4, 5, 6].every((b) => o[`odds_win_${b}`] > 1),
  );
  if (oddsRows.length > 0) {
    await fs.writeFile(
      path.join(OUT_DIR, "odds.csv"),
      toCsv(oddsRows, Object.keys(oddsRows[0])),
    );
    console.log(
      `✅ odds.csv: ${oddsRows.length.toLocaleString()}レース（最新スナップショット・全艇オッズあり）`,
    );
  } else {
    console.log(
      "📭 odds.csv: 有効なオッズスナップショットなし（出力スキップ）",
    );
  }
  console.log(`📁 出力先: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("❌ エラー:", err);
  process.exit(1);
});
