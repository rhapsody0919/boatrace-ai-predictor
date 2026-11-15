/**
 * シャーロック予想 データ取得・推論サービス
 *
 * モデル重み（data/sherlock/model.json、週次再学習でコミット）を
 * ビルド時に取り込み、当日のレースデータ（出走表・展示・オッズ）を
 * Supabase から取得して**ブラウザ内で**勝率を計算する。
 * 推論ロジックは学習スクリプトと共有（sherlockModel.js）。
 */

import { supabase } from "./supabaseClient";
import { predictRace } from "./sherlockModel";
import model from "../../data/sherlock/model.json";

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

/** モデルのメタ情報（学習日・評価指標など）を返す */
export function getSherlockModelInfo() {
  return {
    trainedAt: model.trained_at,
    trainingRaces: model.training_races,
    trainingFrom: model.training_from,
    trainingTo: model.training_to,
    eval: model.walk_forward_eval,
    combiner: model.combiner,
    weights: model.weights,
    featureNames: model.feature_names,
    oddsHaircut: model.odds_haircut,
  };
}

function fetchDayTables(targetDate) {
  return Promise.all([
    supabase
      .from("races")
      .select("race_id, venue_code, race_number, start_time")
      .eq("race_date", targetDate),
    supabase
      .from("race_entries")
      .select(
        "race_id, boat_number, player_name, grade, win_rate, local_win_rate, motor_2rate, boat_2rate",
      )
      .like("race_id", `${targetDate}%`),
    supabase
      .from("exhibition_data")
      .select("race_id, boat_number, exhibition_time, start_timing")
      .like("race_id", `${targetDate}%`),
    supabase
      .from("race_odds")
      .select(
        "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      )
      .like("race_id", `${targetDate}%`)
      .order("captured_at", { ascending: false }),
  ]);
}

function indexByRace(entriesRes, exhibitionRes, oddsRes) {
  const entriesByRace = {};
  for (const e of entriesRes.data || []) {
    (entriesByRace[e.race_id] ??= []).push(e);
  }
  const exhibitionByRace = {};
  for (const ex of exhibitionRes.data || []) {
    (exhibitionByRace[ex.race_id] ??= {})[ex.boat_number] = ex;
  }
  // 最新スナップショットのみ保持（captured_at 降順で最初の行）
  const latestOdds = {};
  for (const row of oddsRes.data || []) {
    if (!latestOdds[row.race_id]) latestOdds[row.race_id] = row;
  }
  return { entriesByRace, exhibitionByRace, latestOdds };
}

function extractOdds(oddsRow) {
  const odds = oddsRow
    ? [1, 2, 3, 4, 5, 6].map((b) => oddsRow[`odds_win_${b}`] ?? null)
    : null;
  return odds && odds.some((o) => !(o > 1)) ? null : odds;
}

// EV = 確率 × オッズ × ヘアカット（オッズがある場合のみ）
function computeEvs(probs, odds) {
  const evs = odds
    ? probs.map((p, i) => p * odds[i] * (model.odds_haircut ?? 1))
    : null;
  if (!evs) return { evs, bestEv: null, bestEvBoat: null };
  const maxEv = Math.max(...evs);
  return { evs, bestEv: maxEv, bestEvBoat: evs.indexOf(maxEv) + 1 };
}

function buildRacePrediction(race, entries, exhibitionByRace, oddsRow) {
  const odds = extractOdds(oddsRow);
  const { fund, implied, combined } = predictRace(
    model,
    {
      entries,
      exhibition: exhibitionByRace[race.race_id] ?? {},
      venueCode: race.venue_code,
    },
    odds,
  );

  // 表示用の最終確率（オッズがあれば結合、なければ基礎モデル）
  const probs = combined ?? fund;
  const hasExhibition = !!exhibitionByRace[race.race_id];
  const { evs, bestEv, bestEvBoat } = computeEvs(probs, odds);

  return {
    raceId: race.race_id,
    venueCode: race.venue_code,
    venueName: VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`,
    raceNumber: race.race_number,
    startTime: race.start_time,
    boats: entries.map((e, i) => ({
      boatNumber: e.boat_number,
      playerName: e.player_name,
      grade: e.grade,
      prob: probs[i],
      fundProb: fund[i],
      implied: implied ? implied[i] : null,
      odds: odds ? odds[i] : null,
      ev: evs ? evs[i] : null,
    })),
    topPick: probs.indexOf(Math.max(...probs)) + 1,
    hasOdds: !!odds,
    hasExhibition,
    bestEv,
    bestEvBoat,
  };
}

/**
 * 指定日の全レースについてシャーロック予想を計算する
 * @returns {Promise<Array>} レースごとの予測（発走時刻順）
 */
export async function getSherlockPredictions(date) {
  if (!supabase) return [];
  const targetDate = date || jstToday();

  try {
    const [racesRes, entriesRes, exhibitionRes, oddsRes] =
      await fetchDayTables(targetDate);

    const races = racesRes.data || [];
    if (races.length === 0) return [];

    const { entriesByRace, exhibitionByRace, latestOdds } = indexByRace(
      entriesRes,
      exhibitionRes,
      oddsRes,
    );

    const results = [];
    for (const race of races) {
      const entries = (entriesByRace[race.race_id] || []).sort(
        (a, b) => a.boat_number - b.boat_number,
      );
      if (entries.length !== 6) continue;
      results.push(
        buildRacePrediction(
          race,
          entries,
          exhibitionByRace,
          latestOdds[race.race_id],
        ),
      );
    }

    // 発走時刻順にソート
    results.sort((a, b) =>
      (a.startTime || "99:99") < (b.startTime || "99:99") ? -1 : 1,
    );
    return results;
  } catch (err) {
    console.error("[sherlockService] fetch error:", err);
    return [];
  }
}
