// Accuracy Calculation Script
// Calculates prediction accuracy and generates summary.json

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get today's date in JST (YYYY-MM-DD format)
function getTodayDateJST() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000);
  return jstDate.toISOString().split('T')[0];
}

// Calculate accuracy for a single race
function calculateRaceAccuracy(prediction, result) {
  if (!result || !result.finished) {
    return {
      topPickHit: null,
      topPickPlace: null,
      top3Hit: null,
      top3Included: null,
    };
  }

  // Top pick hit (exact 1st place)
  const topPickHit = prediction.topPick === result.rank1;

  // Top pick place (fukusho: top pick finishes in top 2)
  const topPickPlace = (
    prediction.topPick === result.rank1 ||
    prediction.topPick === result.rank2
  );

  // Top 3 hit (3-tanpuku: top 3 includes all podium finishers)
  const top3Hit = (
    prediction.top3.includes(result.rank1) &&
    prediction.top3.includes(result.rank2) &&
    prediction.top3.includes(result.rank3)
  );

  // Top 3 exact match (3-tantan: exact order)
  const top3Included = (
    prediction.top3[0] === result.rank1 &&
    prediction.top3[1] === result.rank2 &&
    prediction.top3[2] === result.rank3
  );

  return {
    topPickHit,
    topPickPlace,
    top3Hit,
    top3Included,
  };
}

// Calculate accuracy for a specific model
function calculateModelRaceAccuracy(modelPrediction, result) {
  if (!modelPrediction || !result || !result.finished) {
    return {
      topPickHit: null,
      topPickPlace: null,
      top3Hit: null,
      top3Included: null,
    };
  }

  const topPickHit = modelPrediction.topPick === result.rank1;
  const topPickPlace = (
    modelPrediction.topPick === result.rank1 ||
    modelPrediction.topPick === result.rank2
  );
  const top3Hit = (
    modelPrediction.top3.includes(result.rank1) &&
    modelPrediction.top3.includes(result.rank2) &&
    modelPrediction.top3.includes(result.rank3)
  );
  const top3Included = (
    modelPrediction.top3[0] === result.rank1 &&
    modelPrediction.top3[1] === result.rank2 &&
    modelPrediction.top3[2] === result.rank3
  );

  return {
    topPickHit,
    topPickPlace,
    top3Hit,
    top3Included,
  };
}

// Calculate summary statistics
// Calculate actual recovery rate for a bet type
function calculateActualRecovery(races, betType, modelKey = null) {
  let totalInvestment = 0;
  let totalPayout = 0;
  let hitCount = 0;

  for (const race of races) {
    // Only count races with finished results and payout data
    if (!race.result?.finished || !race.result?.payouts) {
      continue;
    }

    // Get prediction based on modelKey (if specified)
    let prediction;
    if (modelKey && race.predictions && race.predictions[modelKey]) {
      prediction = race.predictions[modelKey];
    } else if (race.prediction) {
      prediction = race.prediction;
    } else {
      continue;
    }

    const result = race.result;
    const payouts = result.payouts;

    // Investment: 100 yen per race
    totalInvestment += 100;

    if (betType === 'win') {
      // Win bet: topPick must finish 1st
      if (prediction.topPick === result.rank1) {
        const payout = payouts.win[String(result.rank1)];
        if (payout) {
          totalPayout += payout;
          hitCount++;
        }
      }
    } else if (betType === 'place') {
      // Place bet: topPick must finish in top 2 (競艇の複勝は1着と2着のみ)
      const topPick = prediction.topPick;
      if (topPick === result.rank1 || topPick === result.rank2) {
        const payout = payouts.place[String(topPick)];
        if (payout) {
          totalPayout += payout;
          hitCount++;
        }
      }
    } else if (betType === 'trifecta') {
      // Trifecta (3-tanpuku): bet on top 3 in any order
      const sortedTop3 = [...prediction.top3].sort((a, b) => a - b);
      const sortedResult = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b);

      if (JSON.stringify(sortedTop3) === JSON.stringify(sortedResult)) {
        // Find matching payout key (can be in various formats like "1-2-3" or "1=2=3")
        const payoutKeys = Object.keys(payouts.trifecta);
        for (const key of payoutKeys) {
          const numbers = key.split(/[-=]/).map(Number).sort((a, b) => a - b);
          if (JSON.stringify(numbers) === JSON.stringify(sortedResult)) {
            totalPayout += payouts.trifecta[key];
            hitCount++;
            break;
          }
        }
      }
    } else if (betType === 'trio') {
      // Trio (3-tantan): bet on top 3 in exact order
      const predictedOrder = prediction.top3.join('-');
      const resultOrder = `${result.rank1}-${result.rank2}-${result.rank3}`;

      if (predictedOrder === resultOrder) {
        const payout = payouts.trio[resultOrder];
        if (payout) {
          totalPayout += payout;
          hitCount++;
        }
      }
    }
  }

  return {
    totalInvestment,
    totalPayout,
    hitCount,
    recoveryRate: totalInvestment > 0 ? totalPayout / totalInvestment : 0
  };
}

function calculateSummaryStats(races) {
  const finishedRaces = races.filter(r => r.result?.finished && r.accuracy);

  if (finishedRaces.length === 0) {
    return {
      totalRaces: 0,
      finishedRaces: 0,
      topPickHits: 0,
      topPickHitRate: 0,
      topPickPlaces: 0,
      topPickPlaceRate: 0,
      top3Hits: 0,
      top3HitRate: 0,
      top3IncludedHits: 0,
      top3IncludedRate: 0,
      actualRecovery: {
        win: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        place: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        trifecta: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        trio: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 }
      }
    };
  }

  // Support both new (3-model) and old (single-model) data structures
  // New: r.accuracy.standard.topPickHit, Old: r.accuracy.topPickHit
  const topPickHits = finishedRaces.filter(r =>
    r.accuracy.standard?.topPickHit ?? r.accuracy.topPickHit
  ).length;
  const topPickPlaces = finishedRaces.filter(r =>
    r.accuracy.standard?.topPickPlace ?? r.accuracy.topPickPlace
  ).length;
  const top3Hits = finishedRaces.filter(r =>
    r.accuracy.standard?.top3Hit ?? r.accuracy.top3Hit
  ).length;
  const top3IncludedHits = finishedRaces.filter(r =>
    r.accuracy.standard?.top3Included ?? r.accuracy.top3Included
  ).length;

  // Calculate actual recovery rates for all bet types
  const actualRecovery = {
    win: calculateActualRecovery(races, 'win'),
    place: calculateActualRecovery(races, 'place'),
    trifecta: calculateActualRecovery(races, 'trifecta'),
    trio: calculateActualRecovery(races, 'trio')
  };

  return {
    totalRaces: finishedRaces.length,
    finishedRaces: finishedRaces.length,
    topPickHits,
    topPickHitRate: topPickHits / finishedRaces.length,
    topPickPlaces,
    topPickPlaceRate: topPickPlaces / finishedRaces.length,
    top3Hits,
    top3HitRate: top3Hits / finishedRaces.length,
    top3IncludedHits,
    top3IncludedRate: top3IncludedHits / finishedRaces.length,
    actualRecovery
  };
}

// Calculate summary statistics for a specific model
function calculateModelSummaryStats(races, modelKey) {
  const finishedRaces = races.filter(r =>
    r.result?.finished &&
    r.accuracy &&
    r.accuracy[modelKey]
  );

  if (finishedRaces.length === 0) {
    return {
      totalRaces: 0,
      finishedRaces: 0,
      topPickHits: 0,
      topPickHitRate: 0,
      topPickPlaces: 0,
      topPickPlaceRate: 0,
      top3Hits: 0,
      top3HitRate: 0,
      top3IncludedHits: 0,
      top3IncludedRate: 0,
      actualRecovery: {
        win: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        place: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        trifecta: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 },
        trio: { totalInvestment: 0, totalPayout: 0, hitCount: 0, recoveryRate: 0 }
      }
    };
  }

  const topPickHits = finishedRaces.filter(r => r.accuracy[modelKey].topPickHit).length;
  const topPickPlaces = finishedRaces.filter(r => r.accuracy[modelKey].topPickPlace).length;
  const top3Hits = finishedRaces.filter(r => r.accuracy[modelKey].top3Hit).length;
  const top3IncludedHits = finishedRaces.filter(r => r.accuracy[modelKey].top3Included).length;

  // Calculate actual recovery rates for all bet types for this model
  // IMPORTANT: Use finishedRaces (filtered by modelKey) instead of all races
  const actualRecovery = {
    win: calculateActualRecovery(finishedRaces, 'win', modelKey),
    place: calculateActualRecovery(finishedRaces, 'place', modelKey),
    trifecta: calculateActualRecovery(finishedRaces, 'trifecta', modelKey),
    trio: calculateActualRecovery(finishedRaces, 'trio', modelKey)
  };

  return {
    totalRaces: finishedRaces.length,
    finishedRaces: finishedRaces.length,
    topPickHits,
    topPickHitRate: topPickHits / finishedRaces.length,
    topPickPlaces,
    topPickPlaceRate: topPickPlaces / finishedRaces.length,
    top3Hits,
    top3HitRate: top3Hits / finishedRaces.length,
    top3IncludedHits,
    top3IncludedRate: top3IncludedHits / finishedRaces.length,
    actualRecovery
  };
}

// Get date info (year, month)
function getDateInfo(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

// Process all prediction files and calculate accuracy
async function calculateAccuracy() {
  try {
    console.log('Starting accuracy calculation...\n');

    const predictionsDir = path.join(__dirname, '..', 'data', 'predictions');

    // Get all prediction files
    let files;
    try {
      files = await fs.readdir(predictionsDir);
    } catch (error) {
      console.error(`Predictions directory not found: ${predictionsDir}`);
      process.exit(1);
    }

    const predictionFiles = files
      .filter(f => f.endsWith('.json') && f !== 'summary.json')
      .sort();

    if (predictionFiles.length === 0) {
      console.log('No prediction files found');
      process.exit(0);
    }

    console.log(`Found ${predictionFiles.length} prediction files\n`);

    // Load and process all predictions
    const allRaces = [];
    const dailyStats = [];

    for (const file of predictionFiles) {
      const filePath = path.join(predictionsDir, file);
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      console.log(`Processing ${data.date}...`);

      let updatedRaces = 0;

      // Calculate accuracy for each race
      for (const race of data.races) {
        const modelAccuracy = {};
        const models = ['standard', 'safeBet', 'upsetFocus'];

        // If race has new 3-model structure, calculate accuracy for all 3 models
        if (race.predictions) {
          for (const modelKey of models) {
            if (race.predictions[modelKey]) {
              modelAccuracy[modelKey] = calculateModelRaceAccuracy(
                race.predictions[modelKey],
                race.result
              );
            }
          }
          race.accuracy = modelAccuracy;
        }
        // Backward compatibility: if old single-model structure, treat as "standard" model
        else if (race.prediction) {
          const accuracy = calculateRaceAccuracy(race.prediction, race.result);
          // Store in model-specific format, assigning old prediction to "standard"
          race.accuracy = {
            standard: accuracy
          };
        }

        allRaces.push({ ...race, date: data.date });

        // Count updated races
        const hasAccuracy = race.accuracy &&
          (race.accuracy.standard?.topPickHit !== null ||
           race.accuracy.safeBet?.topPickHit !== null ||
           race.accuracy.upsetFocus?.topPickHit !== null);
        if (hasAccuracy) {
          updatedRaces++;
        }
      }

      // Calculate daily stats
      const dayStats = calculateSummaryStats(data.races);
      if (dayStats.finishedRaces > 0) {
        dailyStats.push({
          date: data.date,
          totalRaces: dayStats.totalRaces,
          topPickHitRate: dayStats.topPickHitRate,
          topPickPlaceRate: dayStats.topPickPlaceRate,
          top3HitRate: dayStats.top3HitRate,
          top3IncludedRate: dayStats.top3IncludedRate,
          actualRecovery: dayStats.actualRecovery,
        });
      }

      // Save updated file
      data.updatedAt = new Date().toISOString();
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      console.log(`  Finished races: ${dayStats.finishedRaces}/${data.races.length}`);
      if (dayStats.finishedRaces > 0) {
        console.log(`  Top pick hit rate: ${(dayStats.topPickHitRate * 100).toFixed(1)}%`);
      }
    }

    // Calculate overall statistics
    const overallStats = calculateSummaryStats(allRaces);

    // Calculate yesterday's stats
    const today = getTodayDateJST();
    const yesterday = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    const yesterdayRaces = allRaces.filter(r => r.date === yesterday);
    const yesterdayStats = calculateSummaryStats(yesterdayRaces);

    // Calculate yesterday's actual recovery rates
    const yesterdayActualRecovery = {
      win: calculateActualRecovery(yesterdayRaces, 'win'),
      place: calculateActualRecovery(yesterdayRaces, 'place'),
      trifecta: calculateActualRecovery(yesterdayRaces, 'trifecta'),
      trio: calculateActualRecovery(yesterdayRaces, 'trio')
    };

    // Calculate this month's stats
    const { year: thisYear, month: thisMonth } = getDateInfo(today);
    const thisMonthRaces = allRaces.filter(r => {
      const { year, month } = getDateInfo(r.date);
      return year === thisYear && month === thisMonth;
    });
    const thisMonthStats = calculateSummaryStats(thisMonthRaces);

    // Calculate this month's actual recovery rates
    const thisMonthActualRecovery = {
      win: calculateActualRecovery(thisMonthRaces, 'win'),
      place: calculateActualRecovery(thisMonthRaces, 'place'),
      trifecta: calculateActualRecovery(thisMonthRaces, 'trifecta'),
      trio: calculateActualRecovery(thisMonthRaces, 'trio')
    };

    // Calculate last month's stats
    const lastMonthDate = new Date(thisYear, thisMonth - 2, 1); // month is 1-indexed, so -2 for last month
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth() + 1;
    const lastMonthRaces = allRaces.filter(r => {
      const { year, month } = getDateInfo(r.date);
      return year === lastYear && month === lastMonth;
    });
    const lastMonthStats = calculateSummaryStats(lastMonthRaces);

    // Calculate last month's actual recovery rates
    const lastMonthActualRecovery = {
      win: calculateActualRecovery(lastMonthRaces, 'win'),
      place: calculateActualRecovery(lastMonthRaces, 'place'),
      trifecta: calculateActualRecovery(lastMonthRaces, 'trifecta'),
      trio: calculateActualRecovery(lastMonthRaces, 'trio')
    };

    // Calculate model-specific statistics for all 3 models
    const models = ['standard', 'safeBet', 'upsetFocus'];
    const modelsSummary = {};

    for (const modelKey of models) {
      // Overall stats for this model
      const modelOverallStats = calculateModelSummaryStats(allRaces, modelKey);

      // Yesterday stats for this model
      const modelYesterdayStats = calculateModelSummaryStats(yesterdayRaces, modelKey);

      // This month stats for this model
      const modelThisMonthStats = calculateModelSummaryStats(thisMonthRaces, modelKey);

      // Last month stats for this model
      const modelLastMonthStats = calculateModelSummaryStats(lastMonthRaces, modelKey);

      // Daily history for this model
      const modelDailyStats = [];
      for (const file of predictionFiles) {
        const filePath = path.join(predictionsDir, file);
        const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const dayStats = calculateModelSummaryStats(data.races, modelKey);
        if (dayStats.finishedRaces > 0) {
          modelDailyStats.push({
            date: data.date,
            totalRaces: dayStats.totalRaces,
            topPickHitRate: dayStats.topPickHitRate,
            topPickPlaceRate: dayStats.topPickPlaceRate,
            top3HitRate: dayStats.top3HitRate,
            top3IncludedRate: dayStats.top3IncludedRate,
            actualRecovery: dayStats.actualRecovery,
          });
        }
      }

      // Generate monthly summaries (for data older than 90 days)
      const modelMonthlyStats = [];
      const cutoffDate = new Date(new Date(today).getTime() - 90 * 24 * 60 * 60 * 1000);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      // Group old data by month
      const oldDataByMonth = {};
      for (const dayStat of modelDailyStats) {
        if (dayStat.date < cutoffDateStr) {
          const { year, month } = getDateInfo(dayStat.date);
          const monthKey = `${year}-${String(month).padStart(2, '0')}`;
          if (!oldDataByMonth[monthKey]) {
            oldDataByMonth[monthKey] = { year, month, days: [] };
          }
          oldDataByMonth[monthKey].days.push(dayStat);
        }
      }

      // Calculate monthly aggregates
      for (const monthKey of Object.keys(oldDataByMonth).sort()) {
        const monthData = oldDataByMonth[monthKey];
        const monthRaces = allRaces.filter(r => {
          const { year, month } = getDateInfo(r.date);
          return year === monthData.year && month === monthData.month;
        });
        const monthStats = calculateModelSummaryStats(monthRaces, modelKey);

        if (monthStats.finishedRaces > 0) {
          modelMonthlyStats.push({
            year: monthData.year,
            month: monthData.month,
            totalRaces: monthStats.totalRaces,
            topPickHitRate: monthStats.topPickHitRate,
            topPickPlaceRate: monthStats.topPickPlaceRate,
            top3HitRate: monthStats.top3HitRate,
            top3IncludedRate: monthStats.top3IncludedRate,
            actualRecovery: monthStats.actualRecovery,
          });
        }
      }

      // Calculate venue-specific statistics (24 venues)
      const byVenue = {};
      for (let venueCode = 1; venueCode <= 24; venueCode++) {
        // Filter races for this venue
        const venueOverallRaces = allRaces.filter(r => r.venueCode === venueCode);
        const venueThisMonthRaces = thisMonthRaces.filter(r => r.venueCode === venueCode);

        // Calculate stats for this venue
        const venueOverallStats = calculateModelSummaryStats(venueOverallRaces, modelKey);
        const venueThisMonthStats = calculateModelSummaryStats(venueThisMonthRaces, modelKey);

        byVenue[venueCode] = {
          overall: {
            totalRaces: venueOverallStats.totalRaces,
            finishedRaces: venueOverallStats.finishedRaces,
            topPickHits: venueOverallStats.topPickHits,
            topPickHitRate: venueOverallStats.topPickHitRate,
            topPickPlaces: venueOverallStats.topPickPlaces,
            topPickPlaceRate: venueOverallStats.topPickPlaceRate,
            top3Hits: venueOverallStats.top3Hits,
            top3HitRate: venueOverallStats.top3HitRate,
            top3IncludedHits: venueOverallStats.top3IncludedHits,
            top3IncludedRate: venueOverallStats.top3IncludedRate,
            actualRecovery: venueOverallStats.actualRecovery,
          },
          thisMonth: {
            year: thisYear,
            month: thisMonth,
            totalRaces: venueThisMonthStats.totalRaces,
            topPickHitRate: venueThisMonthStats.topPickHitRate,
            topPickPlaceRate: venueThisMonthStats.topPickPlaceRate,
            top3HitRate: venueThisMonthStats.top3HitRate,
            top3IncludedRate: venueThisMonthStats.top3IncludedRate,
            actualRecovery: venueThisMonthStats.actualRecovery,
          },
        };
      }

      modelsSummary[modelKey] = {
        overall: {
          totalRaces: modelOverallStats.totalRaces,
          finishedRaces: modelOverallStats.finishedRaces,
          topPickHits: modelOverallStats.topPickHits,
          topPickHitRate: modelOverallStats.topPickHitRate,
          topPickPlaces: modelOverallStats.topPickPlaces,
          topPickPlaceRate: modelOverallStats.topPickPlaceRate,
          top3Hits: modelOverallStats.top3Hits,
          top3HitRate: modelOverallStats.top3HitRate,
          top3IncludedHits: modelOverallStats.top3IncludedHits,
          top3IncludedRate: modelOverallStats.top3IncludedRate,
          actualRecovery: modelOverallStats.actualRecovery,
        },
        yesterday: {
          date: yesterday,
          totalRaces: modelYesterdayStats.totalRaces,
          topPickHitRate: modelYesterdayStats.topPickHitRate,
          topPickPlaceRate: modelYesterdayStats.topPickPlaceRate,
          top3HitRate: modelYesterdayStats.top3HitRate,
          top3IncludedRate: modelYesterdayStats.top3IncludedRate,
          actualRecovery: modelYesterdayStats.actualRecovery,
        },
        thisMonth: {
          year: thisYear,
          month: thisMonth,
          totalRaces: modelThisMonthStats.totalRaces,
          topPickHitRate: modelThisMonthStats.topPickHitRate,
          topPickPlaceRate: modelThisMonthStats.topPickPlaceRate,
          top3HitRate: modelThisMonthStats.top3HitRate,
          top3IncludedRate: modelThisMonthStats.top3IncludedRate,
          actualRecovery: modelThisMonthStats.actualRecovery,
        },
        lastMonth: {
          year: lastYear,
          month: lastMonth,
          totalRaces: modelLastMonthStats.totalRaces,
          topPickHitRate: modelLastMonthStats.topPickHitRate,
          topPickPlaceRate: modelLastMonthStats.topPickPlaceRate,
          top3HitRate: modelLastMonthStats.top3HitRate,
          top3IncludedRate: modelLastMonthStats.top3IncludedRate,
          actualRecovery: modelLastMonthStats.actualRecovery,
        },
        dailyHistory: modelDailyStats.filter(d => d.date >= cutoffDateStr), // Last 90 days
        monthlyHistory: modelMonthlyStats, // Older data aggregated by month
        byVenue: byVenue, // Venue-specific statistics
      };
    }

    // Calculate venue recommendations (best model per venue)
    const venueRecommendations = {
      overall: {},
      thisMonth: {}
    };

    for (let venueCode = 1; venueCode <= 24; venueCode++) {
      // Find best model for overall stats
      let bestOverallModel = null;
      let bestOverallRecovery = 0;

      // Find best model for this month
      let bestThisMonthModel = null;
      let bestThisMonthRecovery = 0;

      for (const modelKey of models) {
        const venueStats = modelsSummary[modelKey].byVenue[venueCode];

        // Overall: use trio (3連単) recovery rate as primary metric
        if (venueStats.overall.finishedRaces >= 5) { // Minimum 5 races for reliable stats
          const trioRecovery = venueStats.overall.actualRecovery.trio.recoveryRate;
          if (trioRecovery > bestOverallRecovery) {
            bestOverallRecovery = trioRecovery;
            bestOverallModel = modelKey;
          }
        }

        // This month: use trio recovery rate
        if (venueStats.thisMonth.totalRaces >= 3) { // Minimum 3 races for monthly stats
          const trioRecovery = venueStats.thisMonth.actualRecovery.trio.recoveryRate;
          if (trioRecovery > bestThisMonthRecovery) {
            bestThisMonthRecovery = trioRecovery;
            bestThisMonthModel = modelKey;
          }
        }
      }

      if (bestOverallModel) {
        venueRecommendations.overall[venueCode] = {
          bestModel: bestOverallModel,
          recoveryRate: bestOverallRecovery
        };
      }

      if (bestThisMonthModel) {
        venueRecommendations.thisMonth[venueCode] = {
          bestModel: bestThisMonthModel,
          recoveryRate: bestThisMonthRecovery
        };
      }
    }

    // Generate summary with model-specific data
    // Calculate cutoff date for 90 days
    const cutoffDate = new Date(new Date(today).getTime() - 90 * 24 * 60 * 60 * 1000);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    // Generate monthly summaries for old data (for backward compatibility)
    const monthlyStats = [];
    const oldDataByMonth = {};
    for (const dayStat of dailyStats) {
      if (dayStat.date < cutoffDateStr) {
        const { year, month } = getDateInfo(dayStat.date);
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        if (!oldDataByMonth[monthKey]) {
          oldDataByMonth[monthKey] = { year, month, days: [] };
        }
        oldDataByMonth[monthKey].days.push(dayStat);
      }
    }

    // Calculate monthly aggregates
    for (const monthKey of Object.keys(oldDataByMonth).sort()) {
      const monthData = oldDataByMonth[monthKey];
      const monthRaces = allRaces.filter(r => {
        const { year, month } = getDateInfo(r.date);
        return year === monthData.year && month === monthData.month;
      });
      const monthStats = calculateSummaryStats(monthRaces);

      if (monthStats.finishedRaces > 0) {
        monthlyStats.push({
          year: monthData.year,
          month: monthData.month,
          totalRaces: monthStats.totalRaces,
          topPickHitRate: monthStats.topPickHitRate,
          topPickPlaceRate: monthStats.topPickPlaceRate,
          top3HitRate: monthStats.top3HitRate,
          top3IncludedRate: monthStats.top3IncludedRate,
          actualRecovery: monthStats.actualRecovery,
        });
      }
    }

    const summary = {
      lastUpdated: new Date().toISOString(),

      // Model-specific statistics
      models: modelsSummary,

      // Backward compatibility: keep old structure using standard model data
      overall: {
        totalRaces: overallStats.totalRaces,
        finishedRaces: overallStats.finishedRaces,
        topPickHits: overallStats.topPickHits,
        topPickHitRate: overallStats.topPickHitRate,
        topPickPlaces: overallStats.topPickPlaces,
        topPickPlaceRate: overallStats.topPickPlaceRate,
        top3Hits: overallStats.top3Hits,
        top3HitRate: overallStats.top3HitRate,
        top3IncludedHits: overallStats.top3IncludedHits,
        top3IncludedRate: overallStats.top3IncludedRate,
        actualRecovery: overallStats.actualRecovery,
      },
      yesterday: {
        date: yesterday,
        totalRaces: yesterdayStats.totalRaces,
        topPickHitRate: yesterdayStats.topPickHitRate,
        topPickPlaceRate: yesterdayStats.topPickPlaceRate,
        top3HitRate: yesterdayStats.top3HitRate,
        top3IncludedRate: yesterdayStats.top3IncludedRate,
        actualRecovery: yesterdayActualRecovery,
      },
      thisMonth: {
        year: thisYear,
        month: thisMonth,
        totalRaces: thisMonthStats.totalRaces,
        topPickHitRate: thisMonthStats.topPickHitRate,
        topPickPlaceRate: thisMonthStats.topPickPlaceRate,
        top3HitRate: thisMonthStats.top3HitRate,
        top3IncludedRate: thisMonthStats.top3IncludedRate,
        actualRecovery: thisMonthActualRecovery,
      },
      lastMonth: {
        year: lastYear,
        month: lastMonth,
        totalRaces: lastMonthStats.totalRaces,
        topPickHitRate: lastMonthStats.topPickHitRate,
        topPickPlaceRate: lastMonthStats.topPickPlaceRate,
        top3HitRate: lastMonthStats.top3HitRate,
        top3IncludedRate: lastMonthStats.top3IncludedRate,
        actualRecovery: lastMonthActualRecovery,
      },
      dailyHistory: dailyStats.filter(d => d.date >= cutoffDateStr), // Last 90 days
      monthlyHistory: monthlyStats, // Older data aggregated by month
      venueRecommendations: venueRecommendations, // Best model per venue
    };

    // Save summary
    const summaryPath = path.join(predictionsDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log(`\n===== Summary =====`);
    console.log(`Overall:`);
    console.log(`  Total races: ${overallStats.totalRaces}`);
    console.log(`  Top pick hit rate: ${(overallStats.topPickHitRate * 100).toFixed(1)}%`);
    console.log(`  Top 3 hit rate: ${(overallStats.top3HitRate * 100).toFixed(1)}%`);
    console.log(`  Top 3 exact rate: ${(overallStats.top3IncludedRate * 100).toFixed(1)}%`);
    console.log(`\nSaved: ${summaryPath}`);

  } catch (error) {
    console.error('Error occurred:', error);
    process.exit(1);
  }
}

// Execute script
calculateAccuracy();
