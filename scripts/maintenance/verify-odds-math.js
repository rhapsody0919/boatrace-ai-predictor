/**
 * verify-odds-math.js - オッズの計算（src/utils/oddsMath.js）と、思考アシストの ja 専用の判定（BOA-430）
 *
 * oddsMath.js は RaceOddsListTab.jsx から移した関数（PR1、計算は変えていない）。思考アシストの買い目でも使うので、
 * 手計算の固定値で挙動を固定する（tasks T2-4 で人気順・配分・倍率の幅を足す）。
 * あわせて /race/{id}/assist が末尾のスラッシュの有無にかかわらず ja 専用（翻訳済みでない）であることを見る
 *
 * 実行: node scripts/maintenance/verify-odds-math.js
 */
import {
  allocateStakes,
  compositeOdds,
  expandTickets,
  formatOdds,
  latestSnapshotWith,
  popularityRanks,
} from "../../src/utils/oddsMath.js";
import { isPathTranslated } from "../../src/config/languages.js";

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

// formatOdds: 小数1桁。1000倍以上は小数なし（公式と同じ）。丸めてから判定する
check(
  "formatOdds: 6.44→6.4、999.96→1000（1000.0 にしない）、1364.4→1364",
  formatOdds(6.44) === "6.4" &&
    formatOdds(999.96) === "1000" &&
    formatOdds(1364.4) === "1364",
  [formatOdds(6.44), formatOdds(999.96), formatOdds(1364.4)].join(" / "),
);

// compositeOdds: 逆数の和の逆数。null・0 以下（票なし・欠場）は除く
const c = compositeOdds([6.4, 15.2, null, 0, 14.8]);
const expected = 1 / (1 / 6.4 + 1 / 15.2 + 1 / 14.8);
check(
  "compositeOdds: 1-2-3・1-2-4・1-2-5（6.4・15.2・14.8）の合成は 1÷Σ(1/オッズ)、null と 0 は数えない",
  Math.abs(c - expected) < 1e-12 && formatOdds(c) === "3.5",
  `${c}`,
);
check(
  "compositeOdds: オッズが1つも無ければ null",
  compositeOdds([null, 0]) === null && compositeOdds([]) === null,
);

// latestSnapshotWith: その券種の値を持つ最新の行。単勝は値が1艇でもある最新の行、無ければ最新の行
const snaps = [
  { id: "a", trifecta: { "1-2-3": 6.4 }, win: { 1: 1.5 } },
  { id: "b", trifecta: null, win: { 1: null } },
];
check(
  "latestSnapshotWith: 最新の行にその券種が無ければ、値のある前の行を使う",
  latestSnapshotWith(snaps, "trifecta")?.id === "a" &&
    latestSnapshotWith(snaps, "win")?.id === "a",
);
check(
  "latestSnapshotWith: 単勝が全行で全艇 null なら最新の行（票なしの注記のため）",
  latestSnapshotWith(
    [
      { id: "x", win: { 1: null } },
      { id: "y", win: {} },
    ],
    "win",
  )?.id === "y" && latestSnapshotWith([], "trifecta") === null,
);

// ---- 思考アシストの買い目（T2-3。spec FR-7・FR-8・D-38）----
check(
  "expandTickets: 1-34-2345 は6点（同じ艇の重複を除く）",
  JSON.stringify(expandTickets({ 1: [1], 2: [3, 4], 3: [2, 3, 4, 5] })) ===
    JSON.stringify(["1-3-2", "1-3-4", "1-3-5", "1-4-2", "1-4-3", "1-4-5"]),
);
check(
  "expandTickets: 欠場の艇（4）を含む組は数えない（D-38）",
  JSON.stringify(expandTickets({ 1: [1], 2: [3, 4], 3: [2, 3, 4, 5] }, [4])) ===
    JSON.stringify(["1-3-2", "1-3-5"]),
);
check(
  "expandTickets: 候補が空の着があれば0点",
  expandTickets({ 1: [1], 2: [2], 3: [] }).length === 0,
);
const ranks = popularityRanks({ a: 2, b: 1, c: 2, d: null, e: 5, f: 0 });
check(
  "popularityRanks: オッズの昇順、同じオッズは同じ順位で次を飛ばす、オッズの無い組は順位なし",
  ranks.get("b") === 1 &&
    ranks.get("a") === 2 &&
    ranks.get("c") === 2 &&
    ranks.get("e") === 4 &&
    !ranks.has("d") &&
    !ranks.has("f"),
  JSON.stringify([...ranks]),
);
const odds3 = { "1-2-3": 6.4, "1-2-4": 15.2, "1-3-2": 7.2 };
const tickets3 = ["1-2-3", "1-2-4", "1-3-2"];
const ep = allocateStakes({
  tickets: tickets3,
  trifecta: odds3,
  budget: 1000,
  mode: "equalPayout",
});
check(
  "均等払戻: 予算1000円で 400・200・400円（逆数に比例・100円単位で切り捨て、余り200円は払戻の少ない組から足す。spec FR-8・D-43）、残り0円・最低払戻 1,520円→2,560円",
  !ep.insufficient &&
    ep.rows.map((r) => r.stake).join(",") === "400,200,400" &&
    ep.total === 1000 &&
    ep.remainder === 0 &&
    ep.topped === true &&
    Math.min(...ep.rows.map((r) => r.payout)) === 2560,
  JSON.stringify(ep.rows),
);
check(
  "均等払戻: 払戻 2,560・3,040・2,880円、倍率の幅 2.56〜3.04倍（余りを足した後）、合成オッズ 2.77（理論値）",
  ep.rows.map((r) => r.payout).join(",") === "2560,3040,2880" &&
    ep.multiplier.min === 2.56 &&
    ep.multiplier.max === 3.04 &&
    formatOdds(ep.composite) === "2.8" &&
    ep.trigami === false,
  JSON.stringify({ m: ep.multiplier, c: ep.composite }),
);
// 4.1×100＝409.99… で払戻が10円落ちないこと（PR #1307 /code-review）。0.1刻みの全オッズ（1.0〜1000.0倍）で確かめる
const floatMiss = [];
for (let p = 100; p <= 100000; p += 10) {
  const r = allocateStakes({
    tickets: ["1-2-3"],
    trifecta: { "1-2-3": p / 100 },
    budget: 100,
    mode: "equal",
  });
  if (r.rows[0].payout !== p) floatMiss.push(p / 100);
}
check(
  "払戻: オッズ4.1の100円は410円（浮動小数の誤差で10円落ちない）",
  floatMiss.length === 0,
  JSON.stringify(floatMiss.slice(0, 5)),
);
const eq = allocateStakes({
  tickets: tickets3,
  trifecta: odds3,
  budget: 1000,
  mode: "equal",
});
check(
  "均等: 予算1000円・3点で各300円、残り100円、合計は予算以下",
  eq.rows.every((r) => r.stake === 300) &&
    eq.total === 900 &&
    eq.remainder === 100,
);
const few = allocateStakes({
  tickets: tickets3,
  trifecta: odds3,
  budget: 200,
  mode: "equal",
});
check(
  "予算が 100円×点数 に足りなければ配分を出さない（3点には最低300円。Codex F05）",
  few.insufficient === true && few.minimum === 300,
);
const lowOdds = allocateStakes({
  tickets: ["1-2-3", "1-3-2"],
  trifecta: { "1-2-3": 1.5, "1-3-2": 1.8 },
  budget: 1000,
  mode: "equalPayout",
});
check(
  "トリガミ: 合成オッズ（理論値）が1.0未満なら trigami",
  lowOdds.trigami === true && lowOdds.composite < 1,
  `${lowOdds.composite}`,
);
const skewed = allocateStakes({
  tickets: ["1-2-3", "6-5-4"],
  trifecta: { "1-2-3": 2.0, "6-5-4": 9999 },
  budget: 300,
  mode: "equalPayout",
});
check(
  "均等払戻: 比例で0円になる組にも最低100円を入れ、合計は予算以下",
  skewed.rows.every((r) => r.stake >= 100) && skewed.total <= 300,
  JSON.stringify(skewed.rows),
);
// 余りの足し方（D-43）: どの予算・オッズでも予算を超えず、余りは100円未満、最低払戻は足す前より下がらない
const badTop = [];
let seed = 7;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
for (let n = 0; n < 300; n++) {
  const k = 1 + Math.floor(rnd() * 6);
  const ts = Array.from({ length: k }, (_, i) => `t${i}`);
  const od = Object.fromEntries(
    ts.map((t) => [t, Math.round((1.2 + rnd() * 80) * 10) / 10]),
  );
  const budget = 100 * (k + Math.floor(rnd() * 40));
  const r = allocateStakes({
    tickets: ts,
    trifecta: od,
    budget,
    mode: "equalPayout",
  });
  if (r.insufficient) continue;
  if (
    r.total > budget ||
    r.remainder >= 100 ||
    r.rows.some((x) => x.stake < 100)
  )
    badTop.push({ od, budget, rows: r.rows });
}
check(
  "均等払戻: 300通りで予算を超えない・残りは100円未満・各組100円以上",
  badTop.length === 0,
  JSON.stringify(badTop.slice(0, 2)),
);
const eqNoTop = allocateStakes({
  tickets: tickets3,
  trifecta: odds3,
  budget: 1000,
  mode: "equal",
});
check(
  "均等（同じ額）は余りを足さない（残り100円のまま、topped なし）",
  eqNoTop.remainder === 100 && eqNoTop.topped === false,
);
const missingOdds = allocateStakes({
  tickets: ["1-2-3", "1-2-4"],
  trifecta: { "1-2-3": 6.4 },
  budget: 1000,
  mode: "equal",
});
check(
  "オッズの無い組は配分から外して missing に返す",
  missingOdds.rows.length === 1 &&
    missingOdds.missing.join(",") === "1-2-4" &&
    allocateStakes({
      tickets: ["1-2-4"],
      trifecta: {},
      budget: 1000,
      mode: "equal",
    }).insufficient === true,
);

// 思考アシストのルートは ja 専用（/race 配下は翻訳済みだが例外）。末尾のスラッシュも同じ（/code-review 指摘）
check(
  "/race/{id}/assist と末尾スラッシュ付きは翻訳済みでない、/race/{id} は翻訳済み",
  !isPathTranslated("/race/2026-10-06-18-10/assist") &&
    !isPathTranslated("/race/2026-10-06-18-10/assist/") &&
    isPathTranslated("/race/2026-10-06-18-10"),
);

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
