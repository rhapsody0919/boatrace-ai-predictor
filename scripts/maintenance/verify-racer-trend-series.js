#!/usr/bin/env node
/**
 * 選手の成績の推移の線（src/pure/racerTrendSeries.js）の回帰テスト。DB 接続は不要。
 *
 * 守ること:
 *   - 窓は30走。30走に満たない選手は点が無い（短い窓の線を出さない）
 *   - 各点は、その走までの直近30走の率（2連対率・3連対率は艇番と着で数える）
 *   - 平均ST は ST のある走だけで30走を数える
 *   - 点は最大60。前の点からの空き日数を持ち、30日以上の空きに印を付ける
 *   - 推移を出さない指標（勝率など）は例外にする
 */
import { trendSeries, trendGapIndexes } from "../../src/pure/racerTrendSeries.js";

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const day = (n) => {
  const d = new Date(Date.UTC(2026, 0, 1) + n * 86400000);
  return d.toISOString().slice(0, 10);
};
// 1号艇で走り、i が偶数の走だけ2着（2連対・3連対）。3の倍数の走は ST なし
const run = (i, d = i) => ({
  raceId: `${day(d)}-02-${String((i % 12) + 1).padStart(2, "0")}`,
  boatNumber: 1,
  rank1: 3,
  rank2: i % 2 === 0 ? 1 : 4,
  rank3: 5,
  startTiming: i % 3 === 0 ? null : 0.1 + (i % 5) / 100,
});

check("29走は点なし", trendSeries(Array.from({ length: 29 }, (_, i) => run(i)), "top2Rate").length === 0);
const s30 = trendSeries(Array.from({ length: 30 }, (_, i) => run(i)), "top2Rate");
check("30走で1点", s30.length === 1, JSON.stringify(s30));
check("2連対率は半分", Math.abs(s30[0]?.value - 50) < 1e-9, String(s30[0]?.value));
check("最初の点の空きは null", s30[0]?.gapDays === null);

const many = Array.from({ length: 100 }, (_, i) => run(i, i < 80 ? i : i + 45));
const s = trendSeries(many, "top3Rate");
check("点は最大60", s.length === 60, String(s.length));
check("最後の点は最後の走", s[59]?.raceId === many[99].raceId);
const gaps = trendGapIndexes(s);
check("45日あいた所に印が1つ", gaps.length === 1 && s[gaps[0]].gapDays === 46, JSON.stringify(gaps.map((i) => s[i].gapDays)));

const st = trendSeries(Array.from({ length: 60 }, (_, i) => run(i)), "avgSt");
const stRuns = Array.from({ length: 60 }, (_, i) => run(i)).filter((r) => r.startTiming !== null);
check("平均ST は ST のある走で30走を数える", st.length === stRuns.length - 29, `${st.length}/${stRuns.length}`);
const want = stRuns.slice(-30).reduce((a, r) => a + r.startTiming, 0) / 30;
check("平均ST の最後の点", Math.abs(st[st.length - 1]?.value - want) < 1e-12);

let threw = false;
try { trendSeries([], "winRate"); } catch { threw = true; }
check("勝率は推移を出さない", threw);

if (failures.length > 0) {
  console.error("verify-racer-trend-series: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify-racer-trend-series: OK");
