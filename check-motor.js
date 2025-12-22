import fs from 'fs/promises';
const data = JSON.parse(await fs.readFile('./data/races.json', 'utf-8'));

console.log('=== モーター2連率が0の選手を確認 ===\n');

let count = 0;
data.data.forEach(venue => {
  venue.races.forEach(race => {
    race.racers.forEach(racer => {
      if (!racer.motor2Rate || racer.motor2Rate === 0) {
        count++;
        console.log(`${count}人目:`);
        console.log(`  会場: ${venue.placeName}`);
        console.log(`  レース: ${race.raceNo}R`);
        console.log(`  選手: ${racer.name} (${racer.grade})`);
        console.log(`  モーター番号: ${racer.motorNumber}`);
        console.log(`  モーター2連率: ${racer.motor2Rate}`);
        console.log(`  ボート2連率: ${racer.boat2Rate}`);
        console.log('');
      }
    });
  });
});

console.log('合計:', count, '人 / 全体:', data.data.reduce((sum, v) => sum + v.races.reduce((s, r) => s + r.racers.length, 0), 0), '人');
console.log('割合:', (count / data.data.reduce((sum, v) => sum + v.races.reduce((s, r) => s + r.racers.length, 0), 0) * 100).toFixed(2), '%');
