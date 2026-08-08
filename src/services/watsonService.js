/**
 * ワトソン予想 データ取得サービス
 *
 * ワトソンは Python（LightGBM LambdaRank）のためブラウザ内推論ができない。
 * 日次バッチ（generate-watson-predictions.js、1日3回）が watson_predictions
 * テーブルに書いた予測を読み取って表示する。
 * モデルのメタ情報は data/watson/model.json（週次学習でコミット）から読む。
 */

import { supabase } from "./supabaseClient";
import model from "../../data/watson/model.json";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function jstToday() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

/** モデルのメタ情報（学習日・評価指標・ΔR² など）を返す */
export function getWatsonModelInfo() {
  return {
    trainedAt: model.trained_at,
    nRaces: model.n_races,
    nFeatures: model.n_features,
    metrics: model.metrics,
    vsPoirotV2: model.vs_poirot_v2,
    deltaR2: model.delta_r2,
    deltaR2Detail: model.delta_r2_detail,
  };
}

/**
 * 本日のワトソン予想を取得する
 * @param {string|null} date - YYYY-MM-DD（省略時は今日・JST）
 * @returns {Promise<Array>} レースごとの予測（発走時刻順）
 */
export async function getWatsonPredictions(date) {
  if (!supabase) return [];
  const targetDate = date || jstToday();

  try {
    const [racesRes, entriesRes] = await Promise.all([
      supabase
        .from("races")
        .select("race_id, venue_code, race_number, start_time")
        .eq("race_date", targetDate),
      supabase
        .from("race_entries")
        .select("race_id, boat_number, player_name")
        .gte("race_id", targetDate)
        .lt("race_id", `${targetDate}~`),
    ]);

    const races = racesRes.data || [];
    if (races.length === 0) return [];

    const raceIds = races.map((r) => r.race_id);
    const preds = [];
    for (let i = 0; i < raceIds.length; i += 100) {
      const { data, error } = await supabase
        .from("watson_predictions")
        .select(
          "race_id, rank_order, win_probs, explanations, model_trained_at, predicted_at",
        )
        .in("race_id", raceIds.slice(i, i + 100));
      if (!error && data) preds.push(...data);
    }
    if (preds.length === 0) return [];

    const predByRace = new Map(preds.map((p) => [p.race_id, p]));
    const namesByRace = {};
    for (const e of entriesRes.data || []) {
      (namesByRace[e.race_id] ??= {})[e.boat_number] = e.player_name;
    }

    return races
      .filter((r) => predByRace.has(r.race_id))
      .map((r) => {
        const p = predByRace.get(r.race_id);
        return {
          raceId: r.race_id,
          venueCode: r.venue_code,
          venueName: VENUE_NAMES[r.venue_code] || `会場${r.venue_code}`,
          raceNumber: r.race_number,
          startTime: r.start_time,
          rankOrder: p.rank_order,
          winProbs: p.win_probs,
          explanations: p.explanations,
          playerNames: namesByRace[r.race_id] || {},
          modelTrainedAt: p.model_trained_at,
          predictedAt: p.predicted_at,
        };
      })
      .sort(
        (a, b) =>
          (a.startTime || "99:99").localeCompare(b.startTime || "99:99") ||
          a.venueCode - b.venueCode,
      );
  } catch (e) {
    console.error("ワトソン予想の取得に失敗:", e);
    return [];
  }
}
