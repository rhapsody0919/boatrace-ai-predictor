#!/usr/bin/env node
/**
 * モーターの推移の線（src/pure/motorGenerationTrend.js）の回帰テスト。DB 接続は不要。
 *
 * 守ること:
 *   - 節は日があくか公式の率が変わった所で区切る
 *   - 2連率・3連率は節の初日の公式の値。前の節までの走が20に満たない節は描かない
 *   - 右の端は今日まで最後の値を延ばし、走数は全部の走
 *   - 展示タイムは直近30走の平均で、展示のある走が24たまってから。日ごとに1点
 *   - 推移を出さない指標は例外にする
 *   - 節の点の吹き出しは、その節の走の選手と着順、会場の節の期間・グレード・日数。その日に始まる節が無ければ null
 */
import {
  motorMeets,
  motorRateTrend,
  motorExhibitionTrend,
  motorMeetTip,
} from "../../src/pure/motorGenerationTrend.js";

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const day = (n) => new Date(Date.UTC(2026, 7, 6) + n * 86400000).toISOString().slice(0, 10);
// 節 k（0から）は 8日ごとに始まり6日間、1日2走。公式の率は節ごとに 30+k（初めの節は0）
const runs = [];
for (let k = 0; k < 5; k += 1) {
  for (let d = 0; d < 6; d += 1) {
    for (let r = 0; r < 2; r += 1) {
      const date = day(k * 8 + d);
      runs.push({
        raceId: `${date}-02-${String(r * 6 + 1).padStart(2, "0")}`,
        date,
        motor2Rate: k === 0 ? 0 : 30 + k,
        motor3Rate: k === 0 ? 0 : 50 + k,
        exhibitionTime: 6.8 - runs.length * 0.001,
      });
    }
  }
}

const meets = motorMeets([...runs].reverse());
check("節は5つ", meets.length === 5, String(meets.length));
check("節の前の走数は12ずつ", meets.map((m) => m.runsBefore).join() === "0,12,24,36,48", meets.map((m) => m.runsBefore).join());

// 日があかずに率が変わっても区切る
const back = [
  { raceId: "2026-09-01-02-01", date: "2026-09-01", motor2Rate: 30, motor3Rate: 50 },
  { raceId: "2026-09-02-02-01", date: "2026-09-02", motor2Rate: 31, motor3Rate: 50 },
];
check("率が変われば別の節", motorMeets(back).length === 2);

const today = day(40);
const t2 = motorRateTrend(runs, "top2Rate", { today });
check("20走に満たない節は描かない", t2[0]?.date === day(16) && t2[0]?.runs === 24, JSON.stringify(t2[0]));
check("点は節の初日の公式の値", t2.slice(0, 3).map((p) => p.value).join() === "32,33,34", t2.map((p) => p.value).join());
const end = t2[t2.length - 1];
check("右の端は今日まで延ばす", end?.date === today && end.extended && end.value === 34 && end.runs === 60, JSON.stringify(end));
const t3 = motorRateTrend(runs, "top3Rate", { today: day(32) });
check("今日が最後の節の初日なら延ばさない", t3.length === 3 && t3.every((p) => !p.extended), JSON.stringify(t3));
check("走が足りなければ空", motorRateTrend(runs.slice(0, 20), "top2Rate", { today }).length === 0);

const ex = motorExhibitionTrend(runs);
check("展示は24走から", ex[0]?.runs === 24, JSON.stringify(ex[0]));
check("展示は日ごとに1点", new Set(ex.map((p) => p.date)).size === ex.length);
const want = runs.slice(-30).reduce((a, r) => a + r.exhibitionTime, 0) / 30;
check("展示は直近30走の平均", Math.abs(ex[ex.length - 1]?.value - want) < 1e-12, String(ex[ex.length - 1]?.value));
const noEx = runs.map((r, i) => (i % 2 === 0 ? { ...r, exhibitionTime: null } : r));
check("展示の無い走は数えない", motorExhibitionTrend(noEx)[0]?.runs === 24 && motorExhibitionTrend(noEx).length > 0);

// 吹き出し: 節 k は選手 k、着順は走の順に 1〜6 を繰り返す。会場の節は前日の前検を含む7日間
const tipRuns = runs.map((r, i) => ({ ...r, racerName: `選手${Math.floor(i / 12)}`, finish: i % 7 === 6 ? null : (i % 6) + 1 }));
const seriesMeets = [0, 1, 2, 3, 4].map((k) => ({ start: day(k * 8 - 1), end: day(k * 8 + 5), days: 7, grade: k === 2 ? "G1" : "一般", title: `節${k}` }));
const tip = motorMeetTip(tipRuns, day(16), seriesMeets);
check("吹き出しは会場の節の期間・グレード", tip?.start === day(15) && tip?.end === day(21) && tip?.grade === "G1" && tip?.days === 7, JSON.stringify(tip));
check("吹き出しはその節の選手", tip?.racerName === "選手2", String(tip?.racerName));
check("吹き出しはその節の走の着順（無ければ null）", tip?.finishes.length === 12 && tip.finishes[0] === tipRuns[24].finish && tip.finishes.includes(null), JSON.stringify(tip?.finishes));
const noSeries = motorMeetTip(tipRuns, day(16), []);
check("会場の節が無ければ走の日で期間", noSeries?.start === day(16) && noSeries?.end === day(21) && noSeries?.grade === null);
check("その日に始まる節が無ければ null", motorMeetTip(tipRuns, day(17), seriesMeets) === null);

let threw = false;
try { motorRateTrend(runs, "winRate", { today }); } catch { threw = true; }
check("勝率は推移を出さない", threw);

if (failures.length > 0) {
  console.error("verify-motor-generation-trend: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify-motor-generation-trend: OK");
