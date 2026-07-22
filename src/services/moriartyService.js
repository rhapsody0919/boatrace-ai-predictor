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

export async function getMoriartyStats(daysWindow = null) {
  if (!supabase) return {};
  try {
    let query = supabase
      .from("model_performance_daily")
      .select(
        "date, total_predictions, win_hits, investment, payout_win, recovery_rate_win",
      )
      .eq("model_id", "moriarty")
      .order("date", { ascending: true });

    if (daysWindow) {
      const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
      query = query.gte("date", cutoff.toISOString().split("T")[0]);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) return {};

    const operation_days = data.length;
    const total_predictions = data.reduce(
      (s, r) => s + (r.total_predictions || 0),
      0,
    );
    const win_hits = data.reduce((s, r) => s + (r.win_hits || 0), 0);
    const investment = data.reduce((s, r) => s + (r.investment || 0), 0);
    const payout = data.reduce((s, r) => s + (r.payout_win || 0), 0);
    const win_rate = total_predictions > 0 ? win_hits / total_predictions : 0;
    const cumulative_roi = investment > 0 ? payout / investment : 0;

    // 累積推奨レース数は「実際に賭けたレース」のみ（skip は除外）
    const { count: betCount } = await supabase
      .from("bet_recommendations")
      .select("race_id", { count: "exact", head: true })
      .eq("model_id", "moriarty")
      .neq("recommendation", "skip");

    const total_bets = betCount || 0;

    return {
      operation_days,
      total_predictions,
      total_bets,
      win_hits,
      cumulative_roi,
      win_rate,
      investment,
      payout,
    };
  } catch {
    return {};
  }
}

// 券種の表示名
const BET_TYPE_LABELS = {
  win: "単勝",
  trifecta: "3連単",
  trio: "3連複",
};

// モデルIDの表示名
const MODEL_LABELS = {
  standard: "スタンダード",
  safeBet: "本命狙い",
  upsetFocus: "穴狙い",
};

/**
 * reasons を表示用の文字列配列に変換する。
 * 新形式（オブジェクト: {bet_type, boat_number|combo, odds, ...}）と
 * 旧形式（文字列配列）の両方に対応する。
 */
function formatReasons(reasons) {
  if (Array.isArray(reasons)) return reasons;
  if (!reasons || typeof reasons !== "object") return [];

  const lines = [];
  const betLabel = BET_TYPE_LABELS[reasons.bet_type] || reasons.bet_type;
  const target =
    reasons.bet_type === "win"
      ? `${reasons.boat_number}号艇`
      : reasons.combo || "";
  if (betLabel && target) lines.push(`${betLabel} ${target}`);
  if (typeof reasons.calibrated_probability === "number") {
    lines.push(
      `補正的中確率 ${(reasons.calibrated_probability * 100).toFixed(1)}%`,
    );
  }
  if (typeof reasons.odds === "number") {
    lines.push(`取得時オッズ ${reasons.odds}倍`);
  }
  if (reasons.based_on_model) {
    lines.push(
      `ベース: ${MODEL_LABELS[reasons.based_on_model] || reasons.based_on_model}`,
    );
  }
  return lines;
}

export async function getMoriartyRecommendations(date) {
  if (!supabase) return [];
  try {
    const targetDate = date || jstToday();
    const { data, error } = await supabase
      .from("bet_recommendations")
      .select(
        "race_id, expected_value, bet_fraction, actual_hit, actual_payout, reasons",
      )
      .eq("model_id", "moriarty")
      .neq("recommendation", "skip")
      .like("race_id", `${targetDate}%`)
      .order("expected_value", { ascending: false });

    if (error || !data) return [];

    return data.map((row) => {
      const parts = (row.race_id || "").split("-");
      const venue_code = parts[3] ? parseInt(parts[3], 10) : null;
      const race_no = parts[4] ? parseInt(parts[4], 10) : null;
      return {
        race_id: row.race_id,
        venue: venue_code
          ? VENUE_NAMES[venue_code] || `会場${venue_code}`
          : "—",
        race_no,
        expected_value: row.expected_value,
        bet_fraction: row.bet_fraction,
        actual_hit: row.actual_hit,
        actual_payout: row.actual_payout,
        reasons: formatReasons(row.reasons),
      };
    });
  } catch {
    return [];
  }
}

export async function getMoriartyROIHistory(daysWindow = 30) {
  if (!supabase) return [];
  try {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("model_performance_daily")
      .select(
        "date, total_predictions, win_hits, investment, payout_win, recovery_rate_win",
      )
      .eq("model_id", "moriarty")
      .gte("date", cutoffStr)
      .order("date", { ascending: true });

    if (error || !data || data.length === 0) return [];

    let cumInvestment = 0;
    let cumPayout = 0;

    return data.map((row) => {
      const inv = row.investment || 0;
      const pay = row.payout_win || 0;
      cumInvestment += inv;
      cumPayout += pay;
      const cumulative_roi =
        cumInvestment > 0 ? (cumPayout / cumInvestment) * 100 : 100;
      const daily_roi = inv > 0 ? (pay / inv) * 100 : null;

      return {
        date: row.date,
        cumulative_roi: Math.round(cumulative_roi * 10) / 10,
        daily_roi: daily_roi !== null ? Math.round(daily_roi * 10) / 10 : null,
        bets: row.total_predictions || 0,
        hits: row.win_hits || 0,
      };
    });
  } catch {
    return [];
  }
}

export async function getMoriartyVenueBreakdown(daysWindow = 30) {
  if (!supabase) return [];
  try {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("model_performance_daily")
      .select("date, by_venue")
      .eq("model_id", "moriarty")
      .gte("date", cutoffStr)
      .order("date", { ascending: true });

    if (error || !data || data.length === 0) return [];

    const venueAgg = {};
    for (const row of data) {
      const byVenue = row.by_venue || {};
      for (const [code, stats] of Object.entries(byVenue)) {
        if (!venueAgg[code]) {
          venueAgg[code] = { bets: 0, hits: 0, investment: 0, payout: 0 };
        }
        venueAgg[code].bets += stats.bets || 0;
        venueAgg[code].hits += stats.hits || 0;
        venueAgg[code].investment += stats.investment || 0;
        venueAgg[code].payout += stats.payout || 0;
      }
    }

    return Object.entries(venueAgg)
      .map(([code, agg]) => ({
        venue_code: parseInt(code, 10),
        venue_name: VENUE_NAMES[parseInt(code, 10)] || `会場${code}`,
        bets: agg.bets,
        hits: agg.hits,
        roi:
          agg.investment > 0
            ? Math.round((agg.payout / agg.investment) * 1000) / 10
            : null,
      }))
      .sort((a, b) => b.bets - a.bets);
  } catch {
    return [];
  }
}

export async function getMoriartyCalibrationData() {
  if (!supabase) return [];
  try {
    // skip 行は actual_hit を強制的に false にしているため、実際に賭けた
    // 推奨（非 skip）だけでキャリブレーションを評価する
    const { data, error } = await supabase
      .from("bet_recommendations")
      .select("expected_value, actual_hit")
      .eq("model_id", "moriarty")
      .neq("recommendation", "skip")
      .not("actual_hit", "is", null);

    if (error || !data || data.length === 0) return [];

    const buckets = {};
    for (const row of data) {
      const ev = row.expected_value || 0;
      const bucket = Math.floor(ev * 10) / 10;
      if (!buckets[bucket]) buckets[bucket] = { total: 0, hits: 0 };
      buckets[bucket].total += 1;
      if (row.actual_hit) buckets[bucket].hits += 1;
    }

    return Object.entries(buckets)
      .map(([bucket, agg]) => ({
        predicted_bucket: parseFloat(bucket),
        actual_rate:
          agg.total > 0 ? Math.round((agg.hits / agg.total) * 1000) / 10 : 0,
        sample_size: agg.total,
      }))
      .sort((a, b) => a.predicted_bucket - b.predicted_bucket);
  } catch {
    return [];
  }
}
