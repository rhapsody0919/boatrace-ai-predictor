// accuracy_cache（calculate-accuracy.js）の集計の純関数。DB・ファイル・ネットワークに触れない。
// calculate-accuracy.js の越え（calculateVolatilityStats・buildAndStoreAccuracyCache）を分けた（中身は元のまま）
import { isJudgeable } from "../../src/utils/raceOutcome.js";
import { VENUE_NAMES } from "./venueNames.js";

/**
 * 券種ごとの的中数・母数・払戻の合計（純関数。BOA-544）。
 * 母数は、その券種の is_hit_* が NULL でない予想の数。不成立のレースと、返還艇を含む券種は判定対象外（NULL）で、
 * 母数から外す（公式の回収率と同じ扱い。返還は「投資100円・戻り0円」ではない）。top_3rd を予想しないモデルの
 * 3連系も NULL なので母数に入らない。
 *
 * @param {Array<Object>} predictions is_hit_win/place/trifecta/trio・payout_* を持つ行
 * @returns {{win: Bet, place: Bet, trifecta: Bet, trio: Bet}} Bet = {n, hits, hitRate, recoveryRate}
 */
export function summarizeHits(predictions) {
  const bet = (key) => {
    const judged = predictions.filter((p) => p[`is_hit_${key}`] != null);
    const n = judged.length;
    const hits = judged.filter((p) => p[`is_hit_${key}`]).length;
    const payout = judged.reduce((s, p) => s + (p[`payout_${key}`] || 0), 0);
    return {
      n,
      hits,
      hitRate: n > 0 ? hits / n : 0,
      recoveryRate: n > 0 ? payout / (n * 100) : 0,
    };
  };
  return {
    win: bet("win"),
    place: bet("place"),
    trifecta: bet("trifecta"),
    trio: bet("trio"),
  };
}

// 統計を計算するヘルパー（predictions 配列 → フロントが期待する形式）
const NO_BET = { n: 0, hits: 0, hitRate: 0, recoveryRate: 0 };

export function computeStats(predictions) {
  const empty = !predictions || predictions.length === 0;
  // 予想が無いときは全部 0（summarizeHits を空で呼んだときと同じ値）
  const h = empty
    ? { win: NO_BET, place: NO_BET, trifecta: NO_BET, trio: NO_BET }
    : summarizeHits(predictions);
  return {
    totalRaces: empty ? 0 : predictions.length,
    topPickHitRate: h.win.hitRate,
    topPickPlaceRate: h.place.hitRate,
    top3HitRate: h.trifecta.hitRate,
    top3IncludedRate: h.trio.hitRate,
    actualRecovery: {
      win: { recoveryRate: h.win.recoveryRate },
      place: { recoveryRate: h.place.recoveryRate },
      trifecta: { recoveryRate: h.trifecta.recoveryRate },
      trio: { recoveryRate: h.trio.recoveryRate },
    },
  };
}

// JST 日付文字列を生成するヘルパー
export function jstDateStr(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

export function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}



// races × race_results をアプリ側で JOIN する（不成立・中止・結果なしは外す）
// races の各行は level（荒れ度のレベル）を持つ。止める予定の列の名前は呼び手（calculate-accuracy.js）だけが読む
function joinVolatility(races, results) {
  const resultMap = new Map(results.map((r) => [r.race_id, r]));
  return races
    .map((race) => {
      const result = resultMap.get(race.race_id);
      // 不成立は race_status で判定する（is_no_race は全行 false で機能していない。078・BOA-544）
      if (!result || result.is_cancelled || !isJudgeable(result)) return null;
      return {
        venueCode: race.venue_code,
        level: race.level,
        grade: race.race_grade,
        upset: result.rank1 !== 1,
      };
    })
    .filter(Boolean);
}

// レベル別集計（calculate-unified-volatility-accuracy.js も使う）
export function volatilityByLevel(joined, baseline) {
  const byLevel = {};
  for (const level of ["low", "medium", "high"]) {
    const rows = joined.filter((r) => r.level === level);
    if (rows.length === 0) continue;
    const upsetCount = rows.filter((r) => r.upset).length;
    const upsetRate = parseFloat(((upsetCount / rows.length) * 100).toFixed(1));
    byLevel[level] = {
      raceCount: rows.length,
      upsetRate,
      lift: parseFloat((upsetRate - baseline.upsetRate).toFixed(1)),
    };
  }
  return byLevel;
}

// グレード別集計
function volatilityByGrade(joined) {
  const GRADE_KEYS = ["SG", "G1", "G2", "G3", "ippan"];
  const byGrade = {};
  for (const grade of GRADE_KEYS) {
    const rows = joined.filter((r) => r.grade === grade);
    if (rows.length < 5) continue; // 5件未満はスキップ
    const upsetCount = rows.filter((r) => r.upset).length;
    const upsetRate = parseFloat(((upsetCount / rows.length) * 100).toFixed(1));
    const highRows = rows.filter((r) => r.level === "high");
    const highUpsetCount = highRows.filter((r) => r.upset).length;
    byGrade[grade] = {
      raceCount: rows.length,
      upsetRate,
      highRaceCount: highRows.length,
      highUpsetRate:
        highRows.length > 0
          ? parseFloat(((highUpsetCount / highRows.length) * 100).toFixed(1))
          : null,
    };
  }
  return byGrade;
}

function countUpsets(rows) {
  const map = new Map();
  for (const row of rows) {
    const vc = row.venueCode;
    if (!map.has(vc)) map.set(vc, { total: 0, upset: 0 });
    const v = map.get(vc);
    v.total++;
    if (row.upset) v.upset++;
  }
  return map;
}

function volatilityByVenue(joined) {
  // 会場別ベースライン（全レベル合計）
  const venueAllMap = countUpsets(joined);
  // 会場別 high 集計
  const venueHighMap = countUpsets(joined.filter((row) => row.level === "high"));

  return Array.from(venueAllMap.entries())
    .map(([venueCode, all]) => {
      const high = venueHighMap.get(venueCode) || { total: 0, upset: 0 };
      return {
        venueCode: String(venueCode).padStart(2, "0"),
        venueName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
        highRaceCount: high.total,
        highUpsetRate:
          high.total > 0
            ? parseFloat(((high.upset / high.total) * 100).toFixed(1))
            : 0,
        baselineUpsetRate: parseFloat(
          ((all.upset / all.total) * 100).toFixed(1),
        ),
        isReliable: high.total >= 5,
      };
    })
    .sort((a, b) => b.highUpsetRate - a.highUpsetRate);
}

/**
 * イン崩れ予測精度の集計。JOIN の行が無ければ null。
 * lastUpdated は呼ぶ側が入れる（元の順のまま、ログの後に時刻を取るため）
 */
export function buildVolatilityStats(races, results) {
  const joined = joinVolatility(races, results);
  if (joined.length === 0) return null;

  // ベースライン（全体）
  const totalUpset = joined.filter((r) => r.upset).length;
  const baseline = {
    raceCount: joined.length,
    upsetRate: parseFloat(((totalUpset / joined.length) * 100).toFixed(1)),
  };
  const byLevel = volatilityByLevel(joined, baseline);
  const byGrade = volatilityByGrade(joined);
  const byVenue = volatilityByVenue(joined);
  return {
    joinedCount: joined.length,
    stats: {
      baseline,
      byLevel,
      byVenue,
      byGrade: Object.keys(byGrade).length > 0 ? byGrade : undefined,
      period: "90days",
    },
  };
}

const pad = (n) => String(n).padStart(2, "0");

/** accuracy_cache の期間（JST の今月・先月・過去6ヶ月・7日前・90日前） */
export function accuracyPeriods(now) {
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);

  const thisYear = jstNow.getUTCFullYear();
  const thisMonth = jstNow.getUTCMonth() + 1;

  // 先月
  const lastMonthDate = addMonths(new Date(thisYear, thisMonth - 1, 1), -1);

  // 過去6ヶ月
  const monthsToFetch = [];
  for (let i = 1; i <= 6; i++) {
    const d = addMonths(new Date(thisYear, thisMonth - 1, 1), -i);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    monthsToFetch.push({
      year: y,
      month: m,
      start: `${y}-${pad(m)}-01`,
      end: `${y}-${pad(m)}-31`,
    });
  }

  return {
    thisYear,
    thisMonth,
    lastYear: lastMonthDate.getFullYear(),
    lastMonth: lastMonthDate.getMonth() + 1,
    monthsToFetch,
    // 7日前 / 90日前
    sevenDaysAgoStr: jstDateStr(
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    ),
    ninetyDaysAgoStr: jstDateStr(
      new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
    ),
  };
}

// 各月の predictions をメモリでフィルタ
export function predsInMonth(predictions, year, month) {
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-31`;
  return predictions.filter(
    (p) => p.race_id >= start && p.race_id <= `${end}-99-99`,
  );
}

// 月別履歴（過去6ヶ月、新しい月から）
function monthlyHistoryOf(allRecentPredictions, monthsToFetch, modelId) {
  return monthsToFetch
    .map(({ year, month }) => {
      const preds = predsInMonth(allRecentPredictions, year, month).filter(
        (p) => p.model_id === modelId,
      );
      const stats = computeStats(preds);
      if (stats.totalRaces === 0) return null;
      return { year, month, ...stats };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month,
    );
}

// 日別履歴（過去7日）
function dailyHistoryOf(allRecentPredictions, sevenDaysAgoStr, modelId) {
  const recentPreds = allRecentPredictions.filter(
    (p) => p.model_id === modelId && p.race_id >= sevenDaysAgoStr,
  );
  const dateMap = new Map();
  for (const pred of recentPreds) {
    const date = pred.race_id.substring(0, 10);
    if (!dateMap.has(date)) dateMap.set(date, []);
    dateMap.get(date).push(pred);
  }
  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, preds]) => ({ date, ...computeStats(preds) }));
}

// 会場別統計（過去90日）
function byVenueOf(allRecentPredictions, modelId) {
  const venueMap = new Map();
  for (const pred of allRecentPredictions.filter(
    (p) => p.model_id === modelId,
  )) {
    const venueCode = parseInt(pred.race_id.substring(11, 13), 10);
    if (!venueMap.has(venueCode)) venueMap.set(venueCode, []);
    venueMap.get(venueCode).push(pred);
  }
  const byVenue = {};
  for (const [venueCode, preds] of venueMap) {
    byVenue[venueCode] = { overall: computeStats(preds) };
  }
  return byVenue;
}

// models テーブルの行 → overall（無い列は 0）
function overallOf(modelRow) {
  const r = modelRow ?? {};
  return {
    totalRaces: r.total_predictions || 0,
    finishedRaces: r.total_predictions || 0,
    topPickHitRate: r.hit_rate_win || 0,
    topPickPlaceRate: r.hit_rate_place || 0,
    top3HitRate: r.hit_rate_trifecta || 0,
    top3ExactHitRate: r.hit_rate_trio || 0,
    actualRecovery: {
      win: { recoveryRate: r.recovery_rate_win || 0 },
      place: { recoveryRate: r.recovery_rate_place || 0 },
      trifecta: { recoveryRate: r.recovery_rate_trifecta || 0 },
      trio: { recoveryRate: r.recovery_rate_trio || 0 },
    },
  };
}

/**
 * 1モデル分の accuracy_cache の models[modelId]。
 * ctx: { periods, modelRow, allRecentPredictions, thisMonthPredictions, lastMonthPredictions }
 */
export function buildModelCache(modelId, ctx) {
  const { periods, modelRow, allRecentPredictions } = ctx;
  // 今月統計
  const thisMonthPreds = ctx.thisMonthPredictions.filter(
    (p) => p.model_id === modelId,
  );
  // 先月統計
  const lastMonthPreds = ctx.lastMonthPredictions.filter(
    (p) => p.model_id === modelId,
  );
  return {
    thisMonthCount: thisMonthPreds.length,
    lastMonthCount: lastMonthPreds.length,
    entry: {
      overall: overallOf(modelRow),
      thisMonth: {
        year: periods.thisYear,
        month: periods.thisMonth,
        ...computeStats(thisMonthPreds),
      },
      lastMonth: {
        year: periods.lastYear,
        month: periods.lastMonth,
        ...computeStats(lastMonthPreds),
      },
      monthlyHistory: monthlyHistoryOf(
        allRecentPredictions,
        periods.monthsToFetch,
        modelId,
      ),
      dailyHistory: dailyHistoryOf(
        allRecentPredictions,
        periods.sevenDaysAgoStr,
        modelId,
      ),
      byVenue: byVenueOf(allRecentPredictions, modelId),
    },
  };
}
