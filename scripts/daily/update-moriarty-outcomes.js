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
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { isNoRaceResult } from "../lib/raceOutcomeFilters.js";
import { judgeThreeBoatBet } from "../lib/moriartyBetJudge.js";

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
      "race_id, rank1, rank2, rank3, payout_win, payout_trifecta, payout_trio, is_cancelled, race_status",
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
    return judgeThreeBoatBet(betType, reasons, result);
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
    if (result.is_cancelled || isNoRaceResult(result)) {
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

/**
 * 決着したレースの推奨を、賭けごとに集計する（DBへは書かない）。
 * total_predictions は「実際に賭けたレース数」を表す。skip や中止は含めない
 * ため、ここではカウントせずループ内で bet ごとに加算する（的中率の分母が
 * 賭けたレース数になり、フロントの表示と一致する）。
 */
function tallyDailyBets(resolved, resultsMap, venueMap) {
  const t = {
    betsPlaced: 0,
    totalInvestment: 0,
    totalPayoutWin: 0,
    totalPayoutTrifecta: 0,
    investmentWin: 0,
    investmentTrifecta: 0,
    winHits: 0,
    trifectaHits: 0,
    byVenue: {},
  };

  for (const rec of resolved) {
    const result = resultsMap[rec.race_id];
    if (!result || result.is_cancelled || isNoRaceResult(result)) continue;
    if (rec.recommendation === "skip") continue;
    tallyOneBet(t, rec, result, venueMap[rec.race_id]);
  }
  return t;
}

/** 1件の賭けを集計に足す */
function tallyOneBet(t, rec, result, venueCode) {
  t.betsPlaced++;
  const betAmount = betAmountFor(rec);
  const { isHit, payoutPer100 } = judgeBet(rec.reasons, result);
  const payout = isHit ? Math.round((payoutPer100 * betAmount) / 100) : 0;
  const betType = rec.reasons?.bet_type;

  t.totalInvestment += betAmount;

  if (betType === "win") {
    t.investmentWin += betAmount;
    t.totalPayoutWin += payout;
    if (isHit) t.winHits++;
  } else if (betType === "trifecta" || betType === "trio") {
    // trio は少数のため trifecta 側に合算して集計する
    t.investmentTrifecta += betAmount;
    t.totalPayoutTrifecta += payout;
    if (isHit) t.trifectaHits++;
  }

  if (venueCode != null) {
    if (!t.byVenue[venueCode])
      t.byVenue[venueCode] = { investment: 0, payout: 0, count: 0 };
    t.byVenue[venueCode].investment += betAmount;
    t.byVenue[venueCode].payout += payout;
    t.byVenue[venueCode].count++;
  }
}

/** model_performance_daily の1行（集計から） */
function dailyPerformanceRow(date, t) {
  const byVenueRoi = Object.fromEntries(
    Object.entries(t.byVenue).map(([code, v]) => [
      code,
      {
        investment: v.investment,
        payout: v.payout,
        roi: v.investment > 0 ? v.payout / v.investment : null,
        count: v.count,
      },
    ]),
  );
  return {
    model_id: MODEL_ID,
    date,
    total_predictions: t.betsPlaced,
    win_hits: t.winHits,
    place_hits: null,
    trifecta_hits: t.trifectaHits,
    investment: t.totalInvestment,
    payout_win: t.totalPayoutWin,
    payout_trifecta: t.totalPayoutTrifecta,
    recovery_rate_win:
      t.investmentWin > 0 ? t.totalPayoutWin / t.investmentWin : null,
    recovery_rate_trifecta:
      t.investmentTrifecta > 0
        ? t.totalPayoutTrifecta / t.investmentTrifecta
        : null,
    by_venue: byVenueRoi,
    by_volatility: null,
  };
}

async function upsertDailyPerformance(date, recs, resultsMap, venueMap) {
  const resolved = recs.filter((r) => resultsMap[r.race_id]);
  if (resolved.length === 0) return;

  const t = tallyDailyBets(resolved, resultsMap, venueMap);

  // 賭けが1件も無かった日は「運用日」ではないため行を作らない
  // （運用日数・的中率の分母が実際に賭けた日だけになる）
  if (t.betsPlaced === 0) {
    console.log(`  No bets placed on ${date}; skipping daily performance row`);
    return;
  }

  const row = dailyPerformanceRow(date, t);
  const { totalInvestment, totalPayoutWin, totalPayoutTrifecta } = t;

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

// 既定のルックバック日数。スケジュール遅延だけなら2日で足りるが、
// Actions のランナー障害等で1晩まるごと実行が飛ぶと、その日が永久に
// 未決着のまま残る（2026-08-06 に実際に発生）。決着処理は冪等で
// 決着済みの日はほぼ素通りするため、余裕を持って7日間さかのぼる。
const LOOKBACK_DAYS = 7;

// JST 今日から days 日前の YYYY-MM-DD
function daysAgoJST(days) {
  const d = new Date(`${getTodayDateJST()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

// 処理対象日を決める
//   --date=YYYY-MM-DD          … その1日だけ
//   --from=YYYY-MM-DD --to=... … 範囲（バックフィル用。--to 省略時は今日）
//   引数なし                    … 直近 LOOKBACK_DAYS 日＋当日（JST）
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

  return dateRange(daysAgoJST(LOOKBACK_DAYS), getTodayDateJST());
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
