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

  // Top pick place (fukusho: top pick finishes in top 3)
  const topPickPlace = (
    prediction.topPick === result.rank1 ||
    prediction.topPick === result.rank2 ||
    prediction.topPick === result.rank3
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

// Calculate summary statistics
// Calculate actual recovery rate for a bet type
function calculateActualRecovery(races, betType) {
  let totalInvestment = 0;
  let totalPayout = 0;
  let hitCount = 0;

  for (const race of races) {
    // Only count races with finished results and payout data
    if (!race.result?.finished || !race.result?.payouts || !race.prediction) {
      continue;
    }

    const prediction = race.prediction;
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
      // Place bet: topPick must finish in top 3
      const topPick = prediction.topPick;
      if (topPick === result.rank1 || topPick === result.rank2 || topPick === result.rank3) {
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

  const topPickHits = finishedRaces.filter(r => r.accuracy.topPickHit).length;
  const topPickPlaces = finishedRaces.filter(r => r.accuracy.topPickPlace).length;
  const top3Hits = finishedRaces.filter(r => r.accuracy.top3Hit).length;
  const top3IncludedHits = finishedRaces.filter(r => r.accuracy.top3Included).length;

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
        const accuracy = calculateRaceAccuracy(race.prediction, race.result);
        race.accuracy = accuracy;
        allRaces.push({ ...race, date: data.date });

        if (accuracy.topPickHit !== null) {
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

    // Calculate this month's stats
    const { year: thisYear, month: thisMonth } = getDateInfo(today);
    const thisMonthRaces = allRaces.filter(r => {
      const { year, month } = getDateInfo(r.date);
      return year === thisYear && month === thisMonth;
    });
    const thisMonthStats = calculateSummaryStats(thisMonthRaces);

    // Calculate last month's stats
    const lastMonthDate = new Date(thisYear, thisMonth - 2, 1); // month is 1-indexed, so -2 for last month
    const lastYear = lastMonthDate.getFullYear();
    const lastMonth = lastMonthDate.getMonth() + 1;
    const lastMonthRaces = allRaces.filter(r => {
      const { year, month } = getDateInfo(r.date);
      return year === lastYear && month === lastMonth;
    });
    const lastMonthStats = calculateSummaryStats(lastMonthRaces);

    // Generate summary
    const summary = {
      lastUpdated: new Date().toISOString(),
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
      },
      thisMonth: {
        year: thisYear,
        month: thisMonth,
        totalRaces: thisMonthStats.totalRaces,
        topPickHitRate: thisMonthStats.topPickHitRate,
        topPickPlaceRate: thisMonthStats.topPickPlaceRate,
        top3HitRate: thisMonthStats.top3HitRate,
        top3IncludedRate: thisMonthStats.top3IncludedRate,
      },
      lastMonth: {
        year: lastYear,
        month: lastMonth,
        totalRaces: lastMonthStats.totalRaces,
        topPickHitRate: lastMonthStats.topPickHitRate,
        topPickPlaceRate: lastMonthStats.topPickPlaceRate,
        top3HitRate: lastMonthStats.top3HitRate,
        top3IncludedRate: lastMonthStats.top3IncludedRate,
      },
      dailyHistory: dailyStats.slice(-30), // Last 30 days
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
