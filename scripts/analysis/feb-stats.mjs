import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({
  path: resolve("/Users/terukina/boatrace-ai-predictor", ".env.local"),
});

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getFebruaryStats() {
  const startDate = "2026-02-01";
  const endDate = "2026-02-28";

  // 1. Total race count in February
  const { count: raceCount } = await supabase
    .from("races")
    .select("*", { count: "exact", head: true })
    .gte("race_date", startDate)
    .lte("race_date", endDate);
  console.log("Total races in Feb:", raceCount);

  // 2. Get predictions with results for each model
  const models = ["standard", "safeBet", "upsetFocus"];

  for (const model of models) {
    // Predictions: race_id format is like "2026-02-01-01-01"
    // We filter by race_id prefix to match the date range
    const { data: predictions, error: predErr } = await supabase
      .from("predictions")
      .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
      .eq("model_id", model)
      .gte("race_id", "2026-02-01")
      .lt("race_id", "2026-03-01");

    if (predErr) {
      console.log(model, "prediction error:", predErr.message);
      continue;
    }

    const { data: results, error: resErr } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, is_cancelled, is_no_race",
      )
      .gte("race_id", "2026-02-01")
      .lt("race_id", "2026-03-01");

    if (resErr) {
      console.log(model, "results error:", resErr.message);
      continue;
    }

    if (!predictions || !results) {
      console.log(model, ": No data");
      continue;
    }

    const resultMap = {};
    results.forEach((r) => {
      resultMap[r.race_id] = r;
    });

    let winHit = 0,
      placeHit = 0,
      trioHit = 0,
      trifectaHit = 0;
    let winPayout = 0,
      placePayout = 0,
      trioPayout = 0,
      trifectaPayout = 0;
    let matched = 0;

    for (const pred of predictions) {
      const result = resultMap[pred.race_id];
      if (!result) continue;
      if (result.is_cancelled || result.is_no_race) continue;
      matched++;

      // Win (単勝)
      if (pred.top_pick === result.rank1) {
        winHit++;
        winPayout += result.payout_win || 0;
      }

      // Place (複勝) - top pick finishes 1st or 2nd
      if (pred.top_pick === result.rank1 || pred.top_pick === result.rank2) {
        placeHit++;
        // Use payout_place_1 if top_pick is rank1, payout_place_2 if rank2
        if (pred.top_pick === result.rank1) {
          placePayout += result.payout_place_1 || 0;
        } else {
          placePayout += result.payout_place_2 || 0;
        }
      }

      // Trio (3連複) - combination match regardless of order
      const predSet = [pred.top_pick, pred.top_2nd, pred.top_3rd]
        .sort()
        .join("-");
      const resultSet = [result.rank1, result.rank2, result.rank3]
        .sort()
        .join("-");
      if (predSet === resultSet) {
        trioHit++;
        trioPayout += result.payout_trio || 0;
      }

      // Trifecta (3連単) - exact order match
      if (
        pred.top_pick === result.rank1 &&
        pred.top_2nd === result.rank2 &&
        pred.top_3rd === result.rank3
      ) {
        trifectaHit++;
        trifectaPayout += result.payout_trifecta || 0;
      }
    }

    console.log("\n===", model, "===");
    console.log("Matched predictions:", matched);
    if (matched > 0) {
      console.log(
        "Win hit:",
        winHit,
        "rate:",
        ((winHit / matched) * 100).toFixed(1) + "%",
        "recovery:",
        ((winPayout / (matched * 100)) * 100).toFixed(1) + "%",
      );
      console.log(
        "Place hit:",
        placeHit,
        "rate:",
        ((placeHit / matched) * 100).toFixed(1) + "%",
        "recovery:",
        ((placePayout / (matched * 100)) * 100).toFixed(1) + "%",
      );
      console.log(
        "Trio hit:",
        trioHit,
        "rate:",
        ((trioHit / matched) * 100).toFixed(1) + "%",
        "recovery:",
        ((trioPayout / (matched * 100)) * 100).toFixed(1) + "%",
      );
      console.log(
        "Trifecta hit:",
        trifectaHit,
        "rate:",
        ((trifectaHit / matched) * 100).toFixed(1) + "%",
        "recovery:",
        ((trifectaPayout / (matched * 100)) * 100).toFixed(1) + "%",
      );
    }
  }

  // 3. Get cumulative stats (all time)
  console.log("\n=== CUMULATIVE (All Time) ===");
  for (const model of models) {
    const { count } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true })
      .eq("model_id", model);
    console.log(model, "total predictions:", count || 0);
  }
}

getFebruaryStats().catch(console.error);
