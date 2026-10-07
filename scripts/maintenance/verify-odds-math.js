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
  compositeOdds,
  formatOdds,
  latestSnapshotWith,
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
