#!/usr/bin/env node
/**
 * 出走表の「今日出走する選手の中の位置」（上位N割・下位N割）と当地−全国の差 src/pure/dayEntrantRank.js の回帰テスト。
 * 意味づけ（オーナー 2026-11-28 が物差しを「今日の出走者」に決めた）。DB 接続は不要。
 *
 * 守ること:
 *   - 同じ日に2走する選手を2回数えない（選手ごとに1つ）。racerId が無い行・値が空・0 の選手は外す
 *   - 母集団が200人未満なら出さない（朝の取り込みの途中で一部の会場だけのとき）
 *   - 上半分は「上位N割」、下半分は「下位N割」。1位も上位1割（0割にしない）。同じ値は同じ位置
 *   - 当地−全国の差は小数2桁。当地が 0（当地の出走なし）なら出さない
 */
import * as rank from "../../src/pure/dayEntrantRank.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.log(`✗ ${name} ${detail}`);
  }
};

// 勝率 1.00〜(N/100) を1人ずつ持つ N 人の日。racerId は 1..N
const day = (n, extra = []) => [
  {
    players: [
      ...Array.from({ length: n }, (_, i) => ({ racerId: i + 1, winRate: String((i + 1) / 100 + 1), global2Rate: String(i % 60) })),
      ...extra,
    ],
  },
];

// 選手ごとに1つ・外す行
const dup = [{ players: [{ racerId: 1, winRate: "6.00" }] }, { players: [{ racerId: 1, winRate: "6.00" }, { racerId: null, winRate: "7.00" }, { racerId: 2, winRate: "" }, { racerId: 3, winRate: "0.00" }] }];
check("2走の選手を1人に、racerId なし・空・0 を外す", rank.collectDayEntrantValues(dup, "winRate").length === 1);

// 母集団の線
check("199人なら出さない", rank.buildDayRanks(day(199), [{ number: 1, winRate: "2.99" }]) === null);
const big = rank.buildDayRanks(day(300), [
  { number: 1, winRate: "4.00", global2Rate: "59" }, // 最大 → 上位1割
  { number: 2, winRate: "1.01", global2Rate: "0" }, // 最小 → 下位1割、2連率 0 は外す
  { number: 3, winRate: "2.50" }, // 真ん中（300人中 151人以上）
]);
check("300人なら出す・n は人数", big?.n === 300, JSON.stringify(big?.n));
check("1位は上位1割", big.winRate.get(1)?.side === "top" && big.winRate.get(1)?.tenths === 1, JSON.stringify(big.winRate.get(1)));
check("最下位は下位1割", big.winRate.get(2)?.side === "bottom" && big.winRate.get(2)?.tenths === 1, JSON.stringify(big.winRate.get(2)));
check("真ん中は5割の段", big.winRate.get(3)?.tenths === 5, JSON.stringify(big.winRate.get(3)));
check("2連率 0 は位置を出さない", !big.twoRate.has(2));

// 同じ値は同じ位置
const tie = day(250, [{ racerId: 900, winRate: "3.50" }, { racerId: 901, winRate: "3.50" }]);
const a = rank.dayRankOf(rank.collectDayEntrantValues(tie, "winRate"), "3.50");
check("同じ値は同じ位置（2人とも同じ段）", a?.side === "top" && a?.tenths === 1, JSON.stringify(a));

// 当地−全国
check("当地−全国は小数2桁", rank.localVsNational("6.83", "6.31") === 0.52);
check("当地 0.00 は出さない", rank.localVsNational("0.00", "6.31") === null);
check("全国が空なら出さない", rank.localVsNational("5.00", "") === null);

if (failed > 0) {
  console.log(`\n❌ verify-day-entrant-rank: ${failed}件失敗`);
  process.exit(1);
}
console.log("\n✅ verify-day-entrant-rank: 全件合格");
