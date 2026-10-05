// Train calibrators for the Moriarty meta-model.
// Reads 180 days of predictions + odds + race_entries from Supabase,
// fits one OddsAwareCalibrator per (base_model x bet_type),
// and writes data/moriarty/calibrators.json.
//
// 校正器はオッズ条件付きロジスティック（P(的中 | オッズ, AIスコア)）を使う。
// スコア単独の校正（Isotonic等）は「どんなオッズの買い目か」を無視するため、
// 大穴買い目に平均的中率を適用して EV を桁違いに過大評価する。
// オッズを条件に含めることで、EV > 1 は「スコアが市場オッズに上乗せする
// 情報を持つ場合」にのみ発生する（Benter 1994 の二段階結合と同構造）。
//
// 対象券種とオッズの取得元:
//   - win:      race_odds の単勝オッズ（レースごと最新スナップショット）
//   - trifecta: prediction_odds の3連単オッズ（予想買い目に対する）
//   - trio:     prediction_odds の3連複オッズ
// 複勝は実オッズが取得されていないため対象外。

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { isSupabaseEnabled, fetchAll } from "../lib/supabaseClient.js";
import { OddsAwareCalibrator } from "../lib/parametric-calibration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_MODELS = ["standard", "safeBet", "upsetFocus"];
const BET_TYPES = ["win", "trifecta", "trio"];
const MIN_SAMPLES = 100;

// AIスコアの取得元カラム（race_entries）
// 注: predictions.scores JSONB は 2026-01 以降ほぼ NULL のため使用しない
const MODEL_TO_SCORE_COLUMN = {
  standard: "ai_score_standard",
  safeBet: "ai_score_safe_bet",
  upsetFocus: "ai_score_upset_focus",
};

// prediction_odds のカラムサフィックス
const MODEL_TO_ODDS_COLUMN = {
  standard: "standard",
  safeBet: "safe_bet",
  upsetFocus: "upset_focus",
};

// ⚠️ predictions テーブルの is_hit_trifecta / is_hit_trio は命名が実体と
// 入れ替わっている（詳細: docs/issues/trifecta-trio-naming-swap.md）:
//   is_hit_trio     = 3連単（順序一致）の的中  ← 実測1.9%・完全一致のみ
//   is_hit_trifecta = 3連複（順不同）の的中    ← 実測16-19%・集合一致
// prediction_odds 側のカラム名は正しいため、ここで正しい対応付けを行う。
const BET_TYPE_TO_HIT_KEY = {
  win: "is_hit_win",
  trifecta: "is_hit_trio", // 3連単の的中フラグ（命名スワップのため）
  trio: "is_hit_trifecta", // 3連複の的中フラグ（命名スワップのため）
};

// Brier score: lower is better, 0 = perfect
function brierScore(probs, outcomes) {
  if (probs.length === 0) return null;
  const sum = probs.reduce((s, p, i) => s + (p - outcomes[i]) ** 2, 0);
  return sum / probs.length;
}

async function fetchTrainingData(fromDate) {
  const fromDateStr = fromDate.slice(0, 10);
  const [predictions, entries, predOdds, oddsRows] = await Promise.all([
    fetchAll(
      "predictions",
      "race_id, model_id, top_pick, is_hit_win, is_hit_trifecta, is_hit_trio",
      (q) =>
        q
          .in("model_id", BASE_MODELS)
          .not("is_hit_win", "is", null)
          .gte("predicted_at", fromDate)
          .eq("is_shadow", false).order("race_id").order("model_id").order("prediction_id"),
    ),
    fetchAll(
      "race_entries",
      "race_id, boat_number, ai_score_standard, ai_score_safe_bet, ai_score_upset_focus",
      (q) => q.gte("race_id", fromDateStr).order("race_id").order("boat_number"),
    ),
    fetchAll("prediction_odds", "*", (q) => q.gte("race_id", fromDateStr).order("race_id")),
    fetchAll(
      "race_odds",
      "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      (q) => q.gte("race_id", fromDateStr).order("race_id").order("captured_at"),
    ),
  ]);

  // race_id → boat_number → race_entries 行
  const entriesByRace = {};
  for (const e of entries) {
    (entriesByRace[e.race_id] ??= {})[e.boat_number] = e;
  }

  // race_id → prediction_odds 行
  const predOddsByRace = Object.fromEntries(
    predOdds.map((r) => [r.race_id, r]),
  );

  // race_id → 最新の単勝オッズスナップショット
  const latestOddsByRace = {};
  for (const row of oddsRows) {
    const cur = latestOddsByRace[row.race_id];
    if (!cur || row.captured_at > cur.captured_at)
      latestOddsByRace[row.race_id] = row;
  }

  return { predictions, entriesByRace, predOddsByRace, latestOddsByRace };
}

// 予想の代表スコア = top_pick 艇の該当モデルAIスコア
function scoreOf(entriesByRace, p) {
  const entry = entriesByRace[p.race_id]?.[p.top_pick];
  const score = entry?.[MODEL_TO_SCORE_COLUMN[p.model_id]];
  return typeof score === "number" ? score : null;
}

// 券種に応じた歴史オッズ（学習時と推論時で同じ定義を使う）
function oddsOf(data, p, betType) {
  if (betType === "win") {
    const row = data.latestOddsByRace[p.race_id];
    const odds = row?.[`odds_win_${p.top_pick}`];
    return typeof odds === "number" && odds > 1 ? odds : null;
  }
  const col = MODEL_TO_ODDS_COLUMN[p.model_id];
  const row = data.predOddsByRace[p.race_id];
  const odds = row?.[`${betType}_odds_${col}`];
  return typeof odds === "number" && odds > 1 ? odds : null;
}

function extractSamples(data, modelId, betType) {
  const isHitKey = BET_TYPE_TO_HIT_KEY[betType];
  const scores = [];
  const oddsArr = [];
  const outcomes = [];

  for (const p of data.predictions) {
    if (p.model_id !== modelId) continue;
    if (p[isHitKey] == null) continue;

    const score = scoreOf(data.entriesByRace, p);
    const odds = oddsOf(data, p, betType);
    if (score == null || odds == null) continue;

    scores.push(score);
    oddsArr.push(odds);
    outcomes.push(p[isHitKey] ? 1 : 0);
  }

  return { scores, oddsArr, outcomes };
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.",
    );
    process.exit(1);
  }

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 180);
  const fromDateStr = fromDate.toISOString().slice(0, 10);
  const toDateStr = toDate.toISOString().slice(0, 10);

  console.log(`Fetching predictions from ${fromDateStr} to ${toDateStr}...`);
  const data = await fetchTrainingData(fromDate.toISOString());
  console.log(`  Total prediction rows: ${data.predictions.length}`);

  const calibrators = {};

  for (const modelId of BASE_MODELS) {
    calibrators[modelId] = {};
    for (const betType of BET_TYPES) {
      const { scores, oddsArr, outcomes } = extractSamples(
        data,
        modelId,
        betType,
      );

      if (scores.length < MIN_SAMPLES) {
        console.log(
          `  ${modelId}/${betType}: insufficient samples (${scores.length} < ${MIN_SAMPLES}), skipping`,
        );
        calibrators[modelId][betType] = null;
        continue;
      }

      const cal = new OddsAwareCalibrator();
      cal.fit(scores, oddsArr, outcomes);

      const calibratedProbs = scores.map((s, i) => cal.predict(s, oddsArr[i]));
      const bs = brierScore(calibratedProbs, outcomes);
      const hitRate = outcomes.filter((o) => o === 1).length / outcomes.length;
      // 平均EV（学習データ上）: 1.0付近なら市場整合的に校正されている
      const avgEv =
        calibratedProbs.reduce((s, p, i) => s + p * oddsArr[i], 0) /
        calibratedProbs.length;

      console.log(
        `  ${modelId}/${betType}: n=${scores.length}, hit_rate=${(hitRate * 100).toFixed(1)}%, brier=${bs.toFixed(4)}, avg_train_EV=${avgEv.toFixed(3)}`,
      );

      calibrators[modelId][betType] = cal.toJSON();
    }
  }

  const output = {
    trained_at: toDate.toISOString(),
    training_data_from: fromDateStr,
    training_data_to: toDateStr,
    models: calibrators,
  };

  const outPath = path.join(__dirname, "../../data/moriarty/calibrators.json");
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Calibrators written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
