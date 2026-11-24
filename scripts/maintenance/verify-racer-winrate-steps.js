#!/usr/bin/env node
/**
 * 勝率の期ごとの段の形（src/pure/racerWinRateSteps.js）の検査。DB 接続は不要。
 *
 * 守ること（オーナー 2026-11-24「勝率は期ごとの段」、期の事実は official-data-spec 2026-11-25）:
 *   - 期はレース日より前に終わった直近5期を古い順に並べる（11/25 なら右端が 2026/05〜10 の成績）
 *   - 直前の期を取り込んでいない（latestImported が false）ときはその期を外して4期にし、pending に外した期を入れる
 *   - 艇ごとの値は期の並びにそろえ、記録の無い期・勝率が NULL（出走0）の期は null
 *   - 他の選手・範囲外の期の行を混ぜない。取得前（rows が無い）は null
 *   - 札の部品: 同じ年に終わる期は終わりの月、年をまたぐ期は YY/MM
 */
import {
  winRateSteps,
  stepLabelParts,
} from "../../src/pure/racerWinRateSteps.js";

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};
const row = (racer_id, period_year, period_no, win_rate, starts = 100) => ({
  racer_id,
  period_year,
  period_no,
  win_rate,
  starts,
});

const rows = [
  row(1, 2027, 1, 6.41, 116),
  row(1, 2026, 2, 5.9, 118),
  row(1, 2025, 1, 4.2, 112),
  row(1, 2024, 2, 9.99), // 5期より前は使わない
  row(2, 2027, 1, 5.48),
  row(2, 2026, 2, null, 0), // 出走0
  row(3, 2027, 1, 7.77), // 6艇の外の選手
];

const r = winRateSteps(
  { rows, latestImported: true },
  [1, 2, null],
  "2026-11-25",
);
check(
  "5期を古い順",
  JSON.stringify(r.periods.map((p) => p.calcFrom)) ===
    JSON.stringify([
      "2024-05-01",
      "2024-11-01",
      "2025-05-01",
      "2025-11-01",
      "2026-05-01",
    ]),
  JSON.stringify(r.periods),
);
check("右端は 2026/05〜10", r.periods[4].calcTo === "2026-10-31");
check("取り込み済みなら pending なし", r.pending === null);
check(
  "1号の値は期の並び",
  JSON.stringify(r.byRacer.get(1)) ===
    JSON.stringify([
      { winRate: 4.2, starts: 112 },
      null,
      null,
      { winRate: 5.9, starts: 118 },
      { winRate: 6.41, starts: 116 },
    ]),
  JSON.stringify(r.byRacer.get(1)),
);
check("出走0の期は null", r.byRacer.get(2)[3] === null);
check("登録番号の無い艇は入れない", r.byRacer.size === 2);
check("6艇の外の選手を混ぜない", !r.byRacer.has(3));

const f = winRateSteps({ rows, latestImported: false }, [1], "2026-11-03");
check("取り込み前は4期", f.periods.length === 4, String(f.periods.length));
check("取り込み前の右端は 2026/04 まで", f.periods[3].calcTo === "2026-04-30");
check(
  "pending は外した期",
  f.pending?.calcFrom === "2026-05-01" && f.pending?.calcTo === "2026-10-31",
  JSON.stringify(f.pending),
);
check(
  "取り込み前は直前の期の値を使わない",
  f.byRacer.get(1)[3]?.winRate === 5.9,
);

check("取得前は null", winRateSteps(undefined, [1], "2026-11-25") === null);
check(
  "失敗の形（rows なし）は null",
  winRateSteps({ state: "forbidden" }, [1], "2026-11-25") === null,
);

const same = stepLabelParts({ calcFrom: "2026-05-01", calcTo: "2026-10-31" });
check(
  "同じ年は月",
  same.from === "26/05" && same.month === 10,
  JSON.stringify(same),
);
const cross = stepLabelParts({ calcFrom: "2025-11-01", calcTo: "2026-04-30" });
check(
  "年をまたぐ期は YY/MM",
  cross.to === "26/04" && cross.month === null,
  JSON.stringify(cross),
);

if (failures.length > 0) {
  console.error(`verify-racer-winrate-steps: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-racer-winrate-steps: OK");
