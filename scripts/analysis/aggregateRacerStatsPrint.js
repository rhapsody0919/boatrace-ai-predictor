// aggregate-racer-stats.js から字のまま移した表示の部品（console への出力だけ）。DB に触らない

// ===== 結果表示 =====

/** コースごとの決まり手の割合を、割合の大きい順に1コース1行で出す */
function printTechDistribution(heading, distribution) {
  console.log(heading);
  for (const [course, techs] of Object.entries(distribution)) {
    const techStr = Object.entries(techs)
      .sort((a, b) => b[1] - a[1])
      .map(([t, v]) => `${t}:${(v * 100).toFixed(1)}%`)
      .join(", ");
    console.log(`    ${course}コース: ${techStr}`);
  }
}

function printCourseRaceCounts(courseRaceCounts) {
  console.log(`  コース別出走数:`);
  for (const [course, counts] of Object.entries(courseRaceCounts)) {
    const rate = (n) =>
      counts.total > 0 ? ((n / counts.total) * 100).toFixed(1) : "0.0";
    console.log(
      `    ${course}コース: ${counts.total}走 ${counts.wins}勝 (勝率${rate(counts.wins)}% 2連率${rate(counts.top2 ?? 0)}% 3連率${rate(counts.top3 ?? 0)}%)`,
    );
  }
}

function printCourseEntryTendency(tendency) {
  const line = (boat, { n, courses }) => {
    const courseStr = Object.entries(courses)
      .sort((a, b) => b[1] - a[1])
      .map(([c, count]) => `${c}コース:${count}走`)
      .join(", ");
    return `${boat}号艇 (${n}走): ${courseStr}`;
  };
  console.log(`  進入コース傾向（${tendency.since}以降）:`);
  for (const [boat, entry] of Object.entries(tendency.all)) {
    console.log(`    ${line(boat, entry)}`);
  }
  console.log(`    会場別: ${Object.keys(tendency.venues).length}会場分を保存`);
}

function printRacerHeader(record) {
  console.log(
    `\n  選手: ${record.racer_id} (会場: ${record.venue_code === 0 ? "全会場" : record.venue_code})`,
  );
  console.log(`  総レース数: ${record.total_races}`);
  console.log(
    `  平均ST: ${record.avg_st ?? "-"}  直近30走ST: ${record.avg_st_last_30 ?? "-"}  ST標準偏差: ${record.st_stddev ?? "-"}`,
  );
  console.log(
    `  フライング率: ${record.flying_rate !== null ? (record.flying_rate * 100).toFixed(2) + "%" : "-"}`,
  );
}

function printRacerStats(record) {
  printRacerHeader(record);

  if (record.attack_distribution) {
    printTechDistribution(`  決まり手分布:`, record.attack_distribution);
  }

  if (
    record.defense_distribution &&
    Object.keys(record.defense_distribution).length > 0
  ) {
    printTechDistribution(`  被攻撃分布:`, record.defense_distribution);
  }

  if (
    record.course_race_counts &&
    Object.keys(record.course_race_counts).length > 0
  ) {
    printCourseRaceCounts(record.course_race_counts);
  }

  if (record.course_entry_tendency) {
    printCourseEntryTendency(record.course_entry_tendency);
  }
}

// ===== メイン処理 =====

function printUsage() {
  console.log("使い方:");
  console.log("  node scripts/analysis/aggregate-racer-stats.js --racer=4203");
  console.log(
    "  node scripts/analysis/aggregate-racer-stats.js --racer=4203 --venue=12",
  );
  console.log("  node scripts/analysis/aggregate-racer-stats.js --all");
  console.log(
    "  node scripts/analysis/aggregate-racer-stats.js --all --venue=12",
  );
  console.log(
    "  node scripts/analysis/aggregate-racer-stats.js --all --dry-run",
  );
}

/** 全選手モード: 進捗表示（50人ごと） */
function printProgress(processed, total, startTime) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = ((processed / (Date.now() - startTime)) * 1000).toFixed(1);
  console.log(
    `  進捗: ${processed}/${total} (${((processed / total) * 100).toFixed(1)}%) - ${elapsed}秒経過 - ${rate}人/秒`,
  );
}

export { printRacerStats, printUsage, printProgress };
