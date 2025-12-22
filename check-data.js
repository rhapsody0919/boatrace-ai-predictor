// データ完全性チェックスクリプト
import fs from 'fs/promises';
const data = JSON.parse(await fs.readFile('./data/races.json', 'utf-8'));

console.log('=== 全会場・全レースのデータ完全性チェック ===\n');

let totalRaces = 0;
let totalRacers = 0;
let issues = {
  noWeather: 0,
  noWind: 0,
  noWave: 0,
  noLocalRate: 0,
  noMotorRate: 0,
  racersNotSix: 0
};

data.data.forEach(venue => {
  venue.races.forEach(race => {
    totalRaces++;

    // 天候データチェック
    if (!race.weather) issues.noWeather++;
    if (race.windVelocity === null || race.windVelocity === undefined) issues.noWind++;
    if (race.waveHeight === null || race.waveHeight === undefined) issues.noWave++;

    // 選手数チェック
    if (race.racers.length !== 6) {
      issues.racersNotSix++;
      console.log(`⚠️  ${venue.placeName} ${race.raceNo}R: 選手数が${race.racers.length}人`);
    }

    totalRacers += race.racers.length;

    // 選手データチェック
    race.racers.forEach(racer => {
      if (racer.localWinRate === null || racer.localWinRate === undefined) issues.noLocalRate++;
      if (!racer.motor2Rate || racer.motor2Rate === 0) issues.noMotorRate++;
    });
  });
});

console.log('総会場数:', data.data.length);
console.log('総レース数:', totalRaces);
console.log('総選手数:', totalRacers);
console.log('\n--- データ欠損状況 ---');
console.log('天気データなし:', issues.noWeather, 'レース');
console.log('風速データなし:', issues.noWind, 'レース');
console.log('波高データなし:', issues.noWave, 'レース');
console.log('当地勝率なし:', issues.noLocalRate, '人');
console.log('モーター2連率なし:', issues.noMotorRate, '人');
console.log('選手数が6人でない:', issues.racersNotSix, 'レース');

console.log('\n=== 各モデルの実装可能性 ===\n');

// 天候アダプティブモデル
if (issues.noWeather === 0 && issues.noWind === 0 && issues.noWave === 0) {
  console.log('✅ 天候アダプティブモデル: 実装可能（全データ揃っている）');
} else {
  console.log('⚠️  天候アダプティブモデル: 一部データ欠損あり');
  console.log('   - 天気なし:', issues.noWeather, 'レース');
  console.log('   - 風速なし:', issues.noWind, 'レース');
  console.log('   - 波高なし:', issues.noWave, 'レース');
}

// 地元の鬼モデル
if (issues.noLocalRate === 0) {
  console.log('✅ 地元の鬼モデル: 実装可能（全データ揃っている）');
} else {
  console.log('⚠️  地元の鬼モデル: 当地勝率欠損が', issues.noLocalRate, '人');
  console.log('   ※ 当地未経験者は localWinRate=0 として扱えば実装可能');
}

// モーターハンターモデル
if (issues.noMotorRate === 0) {
  console.log('✅ モーターハンターモデル: 実装可能（全データ揃っている）');
} else {
  console.log('⚠️  モーターハンターモデル: モーター2連率欠損が', issues.noMotorRate, '人');
}

// サンプルレースの詳細表示
console.log('\n=== サンプルレース詳細（1会場1レース目）===\n');
const sampleVenue = data.data[0];
const sampleRace = sampleVenue.races[0];

console.log('会場:', sampleVenue.placeName);
console.log('レース番号:', sampleRace.raceNo);
console.log('開始時刻:', sampleRace.startTime);
console.log('\n【天候】');
console.log('  天気:', sampleRace.weather);
console.log('  気温:', sampleRace.airTemp, '℃');
console.log('  風向:', sampleRace.windDirection, '(方位)');
console.log('  風速:', sampleRace.windVelocity, 'm');
console.log('  水温:', sampleRace.waterTemp, '℃');
console.log('  波高:', sampleRace.waveHeight, 'cm');

console.log('\n【選手データ】');
sampleRace.racers.forEach((r, idx) => {
  console.log(`\n${idx + 1}号艇: ${r.name} (${r.grade}, ${r.age}歳)`);
  console.log(`  全国勝率: ${r.globalWinRate} / 2連率: ${r.global2Rate}`);
  console.log(`  当地勝率: ${r.localWinRate} / 2連率: ${r.local2Rate}`);
  console.log(`  モーター: No.${r.motorNumber} (2連率: ${r.motor2Rate}%)`);
  console.log(`  ボート: No.${r.boatNumber} (2連率: ${r.boat2Rate}%)`);
});
