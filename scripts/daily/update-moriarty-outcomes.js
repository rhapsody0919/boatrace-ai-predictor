// Update actual_hit and actual_payout for Moriarty bet_recommendations,
// then upsert a model_performance_daily row for the given date.
//
// 的中判定は reasons JSONB の bet_type と賭け対象（boat_number / combo）を
// 実際のレース結果と照合して行う。
//   - win:      rank1 === boat_number、payout_win
//   - trifecta: rank1-rank2-rank3 === combo（順序一致）
//   - trio:     {rank1,rank2,rank3} === comboの集合（順不同）
// payout_* は100円あたりの払戻円。実払戻は betAmount/100 倍して集計する。
//
// ⚠️ race_results の payout_trifecta / payout_trio は命名が実体と入れ替わって
// いる（詳細: docs/issues/trifecta-trio-naming-swap.md）:
//   payout_trio     = 3連単（順序一致）の払戻
//   payout_trifecta = 3連複（順不同）の払戻
// judgeBet 内で正しい対応付けを行う。

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  getTodayDateJST,
  getYesterdayDateJST,
  parseDateArg,
} from "../lib/dateUtils.js";

const MODEL_ID = "moriarty";
// Virtual bankroll for ROI calculation
const VIRTUAL_BANKROLL = 10000;

// その日の Moriarty 推奨を全件取得する（settle 済み・未 settle 問わず）。
// 決着更新は actual_hit === null の行だけに行い、日次集計は全件から計算する
// ため、何度再実行しても同じ結果になる（冪等）。
async function fetchRecommendationsForDate(date) {
  const { data, error } = await supabase
    .from("bet_recommendations")
    .select(
      "race_id, recommendation, reasons, expected_value, bet_fraction, actual_hit",
    )
    .eq("model_id", MODEL_ID)
    .gte("created_at", `${date}T00:00:00+09:00`)
    .lt("created_at", `${date}T23:59:59+09:00`);

  if (error)
    throw new Error(`bet_recommendations fetch error: ${error.message}`);
  return data || [];
}

async function fetchRaceResults(raceIds) {
  const { data, error } = await supabase
    .from("race_results")
    .select(
      "race_id, rank1, rank2, rank3, payout_win, payout_trifecta, payout_trio, is_cancelled, is_no_race",
    )
    .in("race_id", raceIds);

  if (error) throw new Error(`race_results fetch error: ${error.message}`);

  return Object.fromEntries((data || []).map((r) => [r.race_id, r]));
}

async function fetchRaceVenues(raceIds) {
  const { data, error } = await supabase
    .from("races")
    .select("race_id, venue_code")
    .in("race_id", raceIds);

  if (error) throw new Error(`races fetch error: ${error.message}`);
  return Object.fromEntries((data || []).map((r) => [r.race_id, r.venue_code]));
}

/**
 * 推奨の賭け対象と実結果を照合して { isHit, payoutPer100 } を返す
 * @param {Object|null} reasons - bet_recommendations.reasons JSONB
 * @param {Object} result - race_results 行
 */
export function judgeBet(reasons, result) {
  if (!reasons || result.rank1 == null) {
    return { isHit: false, payoutPer100: 0 };
  }

  const betType = reasons.bet_type;

  if (betType === "win") {
    const isHit = result.rank1 === reasons.boat_number;
    return {
      isHit,
      payoutPer100: isHit ? (result.payout_win ?? 0) : 0,
    };
  }

  if (betType === "trifecta" || betType === "trio") {
    const combo = String(reasons.combo ?? "")
      .split("-")
      .map((s) => parseInt(s, 10));
    if (combo.length !== 3 || combo.some((n) => !(n >= 1 && n <= 6))) {
      return { isHit: false, payoutPer100: 0 };
    }
    const actual = [result.rank1, result.rank2, result.rank3];
    if (actual.some((r) => r == null)) {
      return { isHit: false, payoutPer100: 0 };
    }

    if (betType === "trifecta") {
      const isHit =
        combo[0] === actual[0] &&
        combo[1] === actual[1] &&
        combo[2] === actual[2];
      return {
        isHit,
        // 命名スワップ: payout_trio が3連単の払戻を保持している
        payoutPer100: isHit ? (result.payout_trio ?? 0) : 0,
      };
    }

    // trio: 順不同の集合一致
    const comboSet = new Set(combo);
    const isHit = actual.every((r) => comboSet.has(r));
    return {
      isHit,
      // 命名スワップ: payout_trifecta が3連複の払戻を保持している
      payoutPer100: isHit ? (result.payout_trifecta ?? 0) : 0,
    };
  }

  // 不明な bet_type は外れ扱い
  return { isHit: false, payoutPer100: 0 };
}

// bet_fraction とバンクロールから賭け額を算出（100円単位、最低100円）
function betAmountFor(rec) {
  if (rec.recommendation === "skip") return 0;
  const fraction = rec.bet_fraction ?? 0;
  return Math.max(100, Math.floor((fraction * VIRTUAL_BANKROLL) / 100) * 100);
}

async function updateRecommendations(pending, resultsMap) {
  const updates = [];

  for (const rec of pending) {
    const result = resultsMap[rec.race_id];
    if (!result) continue;
    if (result.is_cancelled || result.is_no_race) {
      updates.push({
        race_id: rec.race_id,
        actual_hit: false,
        actual_payout: 0,
      });
      continue;
    }

    if (rec.recommendation === "skip") {
      // skip は賭けていないので hit=false, payout=0 で確定させる
      updates.push({
        race_id: rec.race_id,
        actual_hit: false,
        actual_payout: 0,
      });
      continue;
    }

    const { isHit, payoutPer100 } = judgeBet(rec.reasons, result);
    const betAmount = betAmountFor(rec);
    const actualPayout = isHit
      ? Math.round((payoutPer100 * betAmount) / 100)
      : 0;

    updates.push({
      race_id: rec.race_id,
      actual_hit: isHit,
      actual_payout: actualPayout,
    });
  }

  if (updates.length === 0) return 0;

  for (const u of updates) {
    const { error } = await supabase
      .from("bet_recommendations")
      .update({ actual_hit: u.actual_hit, actual_payout: u.actual_payout })
      .eq("race_id", u.race_id)
      .eq("model_id", MODEL_ID);

    if (error) console.error(`  update error ${u.race_id}: ${error.message}`);
  }

  return updates.length;
}

async function upsertDailyPerformance(date, recs, resultsMap, venueMap) {
  const resolved = recs.filter((r) => resultsMap[r.race_id]);
  if (resolved.length === 0) return;

  // total_predictions は「実際に賭けたレース数」を表す。skip や中止は含めない
  // ため、ここではカウントせずループ内で bet ごとに加算する（的中率の分母が
  // 賭けたレース数になり、フロントの表示と一致する）。
  let betsPlaced = 0;
  let totalInvestment = 0;
  let totalPayoutWin = 0;
  let totalPayoutTrifecta = 0;
  let investmentWin = 0;
  let investmentTrifecta = 0;
  let winHits = 0;
  let trifectaHits = 0;
  const byVenue = {};

  for (const rec of resolved) {
    const result = resultsMap[rec.race_id];
    if (!result || result.is_cancelled || result.is_no_race) continue;
    if (rec.recommendation === "skip") continue;

    betsPlaced++;
    const venueCode = venueMap[rec.race_id];
    const betAmount = betAmountFor(rec);
    const { isHit, payoutPer100 } = judgeBet(rec.reasons, result);
    const payout = isHit ? Math.round((payoutPer100 * betAmount) / 100) : 0;
    const betType = rec.reasons?.bet_type;

    totalInvestment += betAmount;

    if (betType === "win") {
      investmentWin += betAmount;
      totalPayoutWin += payout;
      if (isHit) winHits++;
    } else if (betType === "trifecta" || betType === "trio") {
      // trio は少数のため trifecta 側に合算して集計する
      investmentTrifecta += betAmount;
      totalPayoutTrifecta += payout;
      if (isHit) trifectaHits++;
    }

    if (venueCode != null) {
      if (!byVenue[venueCode])
        byVenue[venueCode] = { investment: 0, payout: 0, count: 0 };
      byVenue[venueCode].investment += betAmount;
      byVenue[venueCode].payout += payout;
      byVenue[venueCode].count++;
    }
  }

  const byVenueRoi = Object.fromEntries(
    Object.entries(byVenue).map(([code, v]) => [
      code,
      {
        investment: v.investment,
        payout: v.payout,
        roi: v.investment > 0 ? v.payout / v.investment : null,
        count: v.count,
      },
    ]),
  );

  // 賭けが1件も無かった日は「運用日」ではないため行を作らない
  // （運用日数・的中率の分母が実際に賭けた日だけになる）
  if (betsPlaced === 0) {
    console.log(`  No bets placed on ${date}; skipping daily performance row`);
    return;
  }

  const row = {
    model_id: MODEL_ID,
    date,
    total_predictions: betsPlaced,
    win_hits: winHits,
    place_hits: null,
    trifecta_hits: trifectaHits,
    investment: totalInvestment,
    payout_win: totalPayoutWin,
    payout_trifecta: totalPayoutTrifecta,
    recovery_rate_win:
      investmentWin > 0 ? totalPayoutWin / investmentWin : null,
    recovery_rate_trifecta:
      investmentTrifecta > 0 ? totalPayoutTrifecta / investmentTrifecta : null,
    by_venue: byVenueRoi,
    by_volatility: null,
  };

  const { error } = await supabase
    .from("model_performance_daily")
    .upsert(row, { onConflict: "model_id,date" });

  if (error)
    console.error("model_performance_daily upsert error:", error.message);
  else
    console.log(
      `  model_performance_daily upserted for ${date}: investment=${totalInvestment}, payout=${totalPayoutWin + totalPayoutTrifecta}`,
    );
}

// 指定日1日ぶんの outcome 決着 + model_performance_daily upsert を行う
async function processDate(date) {
  console.log(`Updating Moriarty outcomes for ${date}`);

  const allRecs = await fetchRecommendationsForDate(date);
  if (allRecs.length === 0) {
    console.log("  No Moriarty recommendations for this date.");
    return;
  }

  const raceIds = allRecs.map((r) => r.race_id);
  const [resultsMap, venueMap] = await Promise.all([
    fetchRaceResults(raceIds),
    fetchRaceVenues(raceIds),
  ]);

  // 決着更新は未決着（actual_hit === null）の行だけに限定する
  const pending = allRecs.filter((r) => r.actual_hit == null);
  const updatedCount = await updateRecommendations(pending, resultsMap);
  console.log(
    `  ${allRecs.length} recs (${pending.length} pending), updated ${updatedCount}`,
  );

  // 日次集計は全件から計算する（再実行しても同じ結果になる）
  await upsertDailyPerformance(date, allRecs, resultsMap, venueMap);
}

// YYYY-MM-DD の連続する日付配列を作る（両端含む）
function dateRange(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().split("T")[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// 処理対象日を決める
//   --date=YYYY-MM-DD          … その1日だけ
//   --from=YYYY-MM-DD --to=... … 範囲（バックフィル用。--to 省略時は今日）
//   引数なし                    … 昨日＋今日（JST）の2日ぶん
// 既定で2日ぶん処理するのは、GitHub Actions のスケジュール遅延で実行が
// JST 翌日にずれても当日ぶんを取りこぼさないため（決着処理は冪等）。
function resolveTargetDates() {
  const single = parseDateArg();
  if (single) return [single];

  const args = process.argv.slice(2);
  const fromArg = args.find((a) => a.startsWith("--from="));
  if (fromArg) {
    const from = fromArg.split("=")[1];
    const toArg = args.find((a) => a.startsWith("--to="));
    const to = toArg ? toArg.split("=")[1] : getTodayDateJST();
    return dateRange(from, to);
  }

  return [getYesterdayDateJST(), getTodayDateJST()];
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.",
    );
    process.exit(1);
  }

  const dates = resolveTargetDates();
  for (const date of dates) {
    await processDate(date);
  }
}

// CLI 実行時のみ main を起動（judgeBet はテスト用に export）
const isCli =
  process.argv[1] && process.argv[1].endsWith("update-moriarty-outcomes.js");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
