/**
 * 推論用データ輸出スクリプト（BOA-104 ポアロ予想）
 *
 * 指定日のレースについて、学習時と同じ特徴量ソース列（結果ラベルなし）を
 * data/ml/inference.csv に出力する。predict.py はこれを履歴データに連結して
 * ローリング特徴量を構築し、V1/V2 モデルで予測する。
 *
 * 使い方:
 *   node scripts/ml/export-inference-data.js            # 今日（JST）
 *   node scripts/ml/export-inference-data.js --date=2026-07-07
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../data/ml");

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// dataset.csv と同一のカラム順（ラベル系は空で出力し、predict.py 側で NaN 扱い）
const COLUMNS = [
  "race_id",
  "race_date",
  "venue_code",
  "race_number",
  "race_grade",
  "boat_number",
  "racer_id",
  "grade",
  "age",
  "win_rate",
  "local_win_rate",
  "global_2rate",
  "global_3rate",
  "local_2rate",
  "local_3rate",
  "motor_2rate",
  "motor_3rate",
  "boat_2rate",
  "boat_3rate",
  "exhibition_time",
  "exhibition_st",
  "weather",
  "wind_direction",
  "wind_speed",
  "wave_height",
  "temperature",
  "water_temperature",
  "series_day",
  "is_final_day",
  "finish_pos",
  "actual_course",
  "winning_technique",
  "payout_win",
  "payout_place_1",
  "payout_place_2",
  "payout_trifecta",
  "payout_trio",
  "rank1",
  "rank2",
  "rank3",
];

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です（.env.local を確認）");
    process.exit(1);
  }
  const date = parseDateArg() || getTodayDateJST();
  await fs.mkdir(OUT_DIR, { recursive: true });

  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number, race_grade",
    (q) => q.eq("race_date", date).order("race_id"),
  );
  if (races.length === 0) {
    console.log(`📭 ${date} のレースなし`);
    await fs.writeFile(
      path.join(OUT_DIR, "inference.csv"),
      COLUMNS.join(",") + "\n",
    );
    return;
  }
  const raceIds = races.map((r) => r.race_id);

  // Supabase の .in() は URL 長制限があるためチャンク分割して取得
  async function fetchByRaceIds(table, select) {
    const out = [];
    for (let i = 0; i < raceIds.length; i += 100) {
      const chunk = raceIds.slice(i, i + 100);
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in("race_id", chunk);
      if (error) console.error(`  ⚠️ ${table} 取得エラー:`, error.message);
      out.push(...(data || []));
    }
    return out;
  }

  const [entries, exhibitions, conditions] = await Promise.all([
    fetchByRaceIds(
      "race_entries",
      "race_id, boat_number, racer_id, grade, age, win_rate, local_win_rate, global_2rate, global_3rate, local_2rate, local_3rate, motor_2rate, motor_3rate, boat_2rate, boat_3rate",
    ),
    fetchByRaceIds(
      "exhibition_data",
      "race_id, boat_number, exhibition_time, start_timing",
    ),
    fetchByRaceIds(
      "race_conditions",
      "race_id, weather, wind_direction, wind_speed, wave_height, temperature, water_temperature, series_day, is_final_day",
    ),
  ]);

  const raceById = new Map(races.map((r) => [r.race_id, r]));
  const condById = new Map(conditions.map((c) => [c.race_id, c]));
  const exhByKey = new Map(
    exhibitions.map((e) => [`${e.race_id}:${e.boat_number}`, e]),
  );

  const lines = [COLUMNS.join(",")];
  for (const e of entries) {
    const race = raceById.get(e.race_id);
    const cond = condById.get(e.race_id) || {};
    const exh = exhByKey.get(`${e.race_id}:${e.boat_number}`) || {};
    const row = {
      ...race,
      ...e,
      exhibition_time: exh.exhibition_time,
      exhibition_st: exh.start_timing,
      weather: cond.weather,
      wind_direction: cond.wind_direction,
      wind_speed: cond.wind_speed,
      wave_height: cond.wave_height,
      temperature: cond.temperature,
      water_temperature: cond.water_temperature,
      series_day: cond.series_day,
      is_final_day: cond.is_final_day,
    };
    lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
  }

  await fs.writeFile(
    path.join(OUT_DIR, "inference.csv"),
    lines.join("\n") + "\n",
  );
  console.log(
    `✅ inference.csv: ${date} ${races.length}レース ${entries.length}行`,
  );
}

main().catch((err) => {
  console.error("❌ エラー:", err);
  process.exit(1);
});
