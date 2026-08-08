// Generate bet recommendations for the Moriarty meta-model.
// Loads calibrators from data/moriarty/calibrators.json,
// fetches today's predictions, latest win odds and prediction combo odds,
// computes EV and Kelly fraction, then bulk-inserts into bet_recommendations.
//
// 対象券種:
//   - win:      race_odds の単勝オッズ × 校正済み単勝的中確率
//   - trifecta: prediction_odds の3連単オッズ × 校正済み3連単的中確率
//   - trio:     prediction_odds の3連複オッズ × 校正済み3連複的中確率
// 複勝は実オッズが取得できていないため対象外（winOdds/3 のような
// 近似オッズでのEV計算は偽のエッジを量産するため行わない）。
//
// EVにはオッズ変動ヘアカットを適用する。パリミュチュエル方式では
// 締切までにオッズが動く（特に3連単・3連複は変動が大きい）ため、
// 取得時点のオッズをそのまま使うとEVを過大評価する。

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { OddsAwareCalibrator } from "../lib/parametric-calibration.js";
import { halfKelly, quarterKelly } from "../lib/kelly-criterion.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODEL_ID = "moriarty";
const BASE_MODELS = ["standard", "safeBet", "upsetFocus"];

// 校正誤差が残る前提でEV閾値は控えめに高く設定する
// （閾値1.05では校正誤差±10%で容易に負のEVになる）
const EV_THRESHOLD = 1.15;
const EV_STRONG_THRESHOLD = 1.35;

// オッズ変動ヘアカット（取得時点オッズ → 最終オッズの目減り想定）
const ODDS_HAIRCUT = {
  win: 0.95,
  trifecta: 0.85,
  trio: 0.85,
};

// prediction_odds のカラムサフィックス
const MODEL_TO_COLUMN = {
  standard: "standard",
  safeBet: "safe_bet",
  upsetFocus: "upset_focus",
};

// AIスコアの取得元カラム（race_entries）
// 注: predictions.scores JSONB は 2026-01 以降ほぼ NULL のため使用しない
const MODEL_TO_SCORE_COLUMN = {
  standard: "ai_score_standard",
  safeBet: "ai_score_safe_bet",
  upsetFocus: "ai_score_upset_focus",
};

// 校正器JSONの復元。オッズ条件付き校正器のみサポートする。
// 旧形式（isotonic/platt = スコア単独校正）はEVを過大評価するため
// 意図的に読み込まない（train-moriarty-calibration.js で再学習が必要）。
function calibratorFromJSON(json) {
  if (!json) return null;
  if (json.type === "odds-aware") return OddsAwareCalibrator.fromJSON(json);
  return null;
}

function loadCalibrators(calibratorsJson) {
  const result = {};
  for (const [modelId, betTypes] of Object.entries(calibratorsJson.models)) {
    result[modelId] = {};
    for (const [betType, json] of Object.entries(betTypes)) {
      result[modelId][betType] = calibratorFromJSON(json);
    }
  }
  return result;
}

async function fetchTodayPredictions(date) {
  const { data, error } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd")
    .in("model_id", BASE_MODELS)
    .eq("is_shadow", false)
    // 前方一致 LIKE は btree インデックスに乗らず、テーブル成長で statement timeout
    // になる（本番で発生）。race_id は日付プレフィックスの辞書順なので範囲条件で絞る
    .gte("race_id", date).lt("race_id", `${date}~`);

  if (error) throw new Error(`predictions fetch error: ${error.message}`);
  return data || [];
}

async function fetchLatestOdds(raceIds) {
  // Get the most recent odds snapshot per race
  const { data, error } = await supabase
    .from("race_odds")
    .select(
      "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
    )
    .in("race_id", raceIds)
    .order("captured_at", { ascending: false });

  if (error) throw new Error(`race_odds fetch error: ${error.message}`);

  // Keep only the latest snapshot per race
  const latestByRace = {};
  for (const row of data || []) {
    if (!latestByRace[row.race_id]) {
      latestByRace[row.race_id] = row;
    }
  }
  return latestByRace;
}

async function fetchPredictionOdds(raceIds) {
  const { data, error } = await supabase
    .from("prediction_odds")
    .select("*")
    .in("race_id", raceIds);

  if (error) throw new Error(`prediction_odds fetch error: ${error.message}`);
  return Object.fromEntries((data || []).map((r) => [r.race_id, r]));
}

async function fetchEntryScores(raceIds) {
  const { data, error } = await supabase
    .from("race_entries")
    .select(
      "race_id, boat_number, ai_score_standard, ai_score_safe_bet, ai_score_upset_focus",
    )
    .in("race_id", raceIds);

  if (error) throw new Error(`race_entries fetch error: ${error.message}`);

  const byRace = {};
  for (const e of data || []) {
    (byRace[e.race_id] ??= {})[e.boat_number] = e;
  }
  return byRace;
}

function getOddsForBoat(oddsRow, boatNumber) {
  return oddsRow[`odds_win_${boatNumber}`] ?? null;
}

// 指定艇の該当モデルAIスコア
function getBoatScore(entriesForRace, modelId, boatNumber) {
  const score = entriesForRace?.[boatNumber]?.[MODEL_TO_SCORE_COLUMN[modelId]];
  return typeof score === "number" ? score : null;
}

// 1候補のEVを評価して {ev, reason} を返す（オッズ・校正器がなければ null）
function evaluateCandidate({ betType, calibrator, score, odds, extra }) {
  if (!calibrator || score == null || odds == null || odds <= 1) return null;
  const haircut = ODDS_HAIRCUT[betType] ?? 1;
  const effectiveOdds = odds * haircut;
  // P(的中 | オッズ, スコア): 確率の推定には取得時点の生オッズを使う
  const prob = calibrator.predict(score, odds);
  const ev = prob * effectiveOdds;
  return {
    ev,
    reason: {
      bet_type: betType,
      calibrated_probability: Math.round(prob * 10000) / 10000,
      odds,
      effective_odds: Math.round(effectiveOdds * 100) / 100,
      ...extra,
    },
  };
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.",
    );
    process.exit(1);
  }

  // 使い方: node generate-moriarty-recommendations.js [--date=YYYY-MM-DD] [--dry-run]
  const isDryRun = process.argv.includes("--dry-run");
  const date = parseDateArg() || getTodayDateJST();
  console.log(
    `Generating Moriarty recommendations for ${date}${isDryRun ? " (dry-run)" : ""}`,
  );

  const calibratorsPath = path.join(
    __dirname,
    "../../data/moriarty/calibrators.json",
  );
  let calibratorsJson;
  try {
    calibratorsJson = JSON.parse(await fs.readFile(calibratorsPath, "utf-8"));
  } catch {
    console.error(
      `calibrators.json not found at ${calibratorsPath}. Run train-moriarty-calibration.js first.`,
    );
    process.exit(1);
  }

  const calibrators = loadCalibrators(calibratorsJson);

  const predictions = await fetchTodayPredictions(date);
  if (predictions.length === 0) {
    console.log("No predictions found for today.");
    return;
  }

  const raceIds = [...new Set(predictions.map((p) => p.race_id))];
  console.log(
    `  Races: ${raceIds.length}, prediction rows: ${predictions.length}`,
  );

  const [oddsMap, predOddsMap, entryScoresMap] = await Promise.all([
    fetchLatestOdds(raceIds),
    fetchPredictionOdds(raceIds),
    fetchEntryScores(raceIds),
  ]);

  // Group predictions by race
  const byRace = {};
  for (const p of predictions) {
    if (!byRace[p.race_id]) byRace[p.race_id] = [];
    byRace[p.race_id].push(p);
  }

  const recommendations = [];

  for (const raceId of raceIds) {
    const racePreds = byRace[raceId];
    const oddsRow = oddsMap[raceId];
    const predOddsRow = predOddsMap[raceId];

    // Collect best EV candidate across all base models and bet types
    let bestEv = 0;
    let bestReason = null;

    for (const p of racePreds) {
      const modelId = p.model_id;
      const boatNumber = p.top_pick;
      const col = MODEL_TO_COLUMN[modelId];
      // 代表スコア = top_pick 艇のAIスコア（train-moriarty-calibration.js と同一定義）
      const topScore = getBoatScore(entryScoresMap[raceId], modelId, boatNumber);
      const candidates = [];

      // win: boat-level score vs win odds
      if (oddsRow) {
        candidates.push(
          evaluateCandidate({
            betType: "win",
            calibrator: calibrators[modelId]?.win,
            score: topScore,
            odds: getOddsForBoat(oddsRow, boatNumber),
            extra: { boat_number: boatNumber, based_on_model: modelId },
          }),
        );
      }

      // trifecta / trio: prediction_odds の予想買い目オッズを使用
      if (predOddsRow && col) {
        candidates.push(
          evaluateCandidate({
            betType: "trifecta",
            calibrator: calibrators[modelId]?.trifecta,
            score: topScore,
            odds: predOddsRow[`trifecta_odds_${col}`],
            extra: {
              combo: predOddsRow[`trifecta_pred_${col}`],
              based_on_model: modelId,
            },
          }),
        );
        candidates.push(
          evaluateCandidate({
            betType: "trio",
            calibrator: calibrators[modelId]?.trio,
            score: topScore,
            odds: predOddsRow[`trio_odds_${col}`],
            extra: {
              combo: predOddsRow[`trio_pred_${col}`],
              based_on_model: modelId,
            },
          }),
        );
      }

      for (const cand of candidates) {
        if (cand && cand.ev > bestEv) {
          bestEv = cand.ev;
          bestReason = cand.reason;
        }
      }
    }

    let recommendation;
    let betFraction = null;

    if (bestReason && bestEv >= EV_STRONG_THRESHOLD) {
      recommendation = "strong_bet";
    } else if (bestReason && bestEv >= EV_THRESHOLD) {
      recommendation = "bet";
    } else {
      recommendation = "skip";
    }

    if (recommendation !== "skip") {
      // 単勝はHalf Kelly、3連単・3連複は推定誤差が大きいためQuarter Kelly
      const kellyFn = bestReason.bet_type === "win" ? halfKelly : quarterKelly;
      betFraction = kellyFn(
        bestReason.calibrated_probability,
        bestReason.effective_odds,
      );
    }

    recommendations.push({
      race_id: raceId,
      model_id: MODEL_ID,
      recommendation,
      reasons: bestReason ?? null,
      expected_value: bestEv > 0 ? Math.round(bestEv * 100) / 100 : null,
      bet_fraction:
        betFraction != null ? Math.round(betFraction * 10000) / 10000 : null,
    });
  }

  const betCount = recommendations.filter(
    (r) => r.recommendation !== "skip",
  ).length;
  console.log(
    `  Recommendations: ${betCount} bet / ${recommendations.length - betCount} skip`,
  );

  if (isDryRun) {
    for (const r of recommendations.filter((x) => x.recommendation !== "skip")) {
      console.log(
        `  [dry-run] ${r.race_id}: ${r.recommendation} EV=${r.expected_value} fraction=${r.bet_fraction} ${JSON.stringify(r.reasons)}`,
      );
    }
    console.log(`[dry-run] upsert をスキップしました (${recommendations.length} rows)`);
    return;
  }

  // Bulk upsert into bet_recommendations
  const { error: upsertError } = await supabase
    .from("bet_recommendations")
    .upsert(recommendations, { onConflict: "race_id,model_id" });

  if (upsertError) {
    console.error("bet_recommendations upsert error:", upsertError.message);
    process.exit(1);
  }

  console.log(
    `Inserted/updated ${recommendations.length} rows in bet_recommendations.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
