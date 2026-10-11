import { supabase } from "./supabaseClient";

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

/**
 * 本日のポアロ予想（V1/V2 両モデル）をレース情報付きで取得
 * @returns {Promise<{date: string, races: Array}>}
 *   races: [{ race_id, venue_code, venue_name, race_number, start_time,
 *             models: { 'rf-v1': {...}, 'lgbm-v2': {...} } }]
 */
export async function getPoirotPredictions() {
  const date = jstToday();
  if (!supabase) return { date, races: [] };

  try {
    const { data: races } = await supabase
      .from("races")
      .select("race_id, venue_code, race_number, start_time")
      .eq("race_date", date)
      .order("venue_code")
      .order("race_number");
    if (!races || races.length === 0) return { date, races: [] };

    const raceIds = races.map((r) => r.race_id);
    const preds = [];
    for (let i = 0; i < raceIds.length; i += 100) {
      const { data } = await supabase
        .from("poirot_predictions")
        .select(
          "race_id, model_version, win_probs, top_pick, top_2nd, top_3rd, trifecta_prob, predicted_at",
        )
        .in("race_id", raceIds.slice(i, i + 100));
      if (data) preds.push(...data);
    }
    if (preds.length === 0) return { date, races: [] };

    const predsByRace = new Map();
    for (const p of preds) {
      if (!predsByRace.has(p.race_id)) predsByRace.set(p.race_id, {});
      predsByRace.get(p.race_id)[p.model_version] = p;
    }

    const result = races
      .filter((r) => predsByRace.has(r.race_id))
      .map((r) => ({
        ...r,
        venue_name: VENUE_NAMES[r.venue_code] || `会場${r.venue_code}`,
        models: predsByRace.get(r.race_id),
      }));
    return { date, races: result };
  } catch (e) {
    console.error("ポアロ予想の取得に失敗:", e);
    return { date, races: [] };
  }
}
