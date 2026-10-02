/**
 * アナロジー・ファインダーの寄与度（BOA-271 FR-1）の、スライスの選び方とシェアの並べ方の約束を固定データで検証する。
 * src/utils/analogyContribution.js（API と画面のフォールバック経路が共有する純粋関数）だけを使い、実DBに触らない。
 *
 * 1. n（レース数）<30 のスライスは「会場→全会場」「ラウンド→全ラウンド」「グレード→全グレード」の順に
 *    一段ずつ広げ、広げた段を返す（plan「API」、設計レビュー #6）
 * 2. 広げきっても30未満なら、その一番広いスライスを小標本として返す
 * 3. テーマは themes 配列の順と数で並べる（テーマ数を固定しない。spec FR-1「テーマ数は可変」）
 * 5. 表示する % は、四捨五入しても合計が100（内訳は親の値）になるように丸める（ファン評価2周目）
 * 4. 順位を強調してよいのは、上下の隣の順位との差がどちらも SD の2倍以上のときだけ（spec FR-1「安定性」）
 */
import {
  MIN_RACES,
  resolveContributionSlice,
  roundToTotal,
  themeEntries,
} from "../../src/utils/analogyContribution.js";

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};

const row = (
  venue,
  grade,
  round,
  boat,
  nRaces,
  shares = { a: 0.6, b: 0.4 },
) => ({
  venue_code: venue,
  grade,
  round,
  boat_number: boat,
  n_races: nRaces,
  n_boats: boat === 0 ? nRaces * 6 : nRaces,
  period_from: "2025-10-02",
  period_to: "2026-10-01",
  shares,
  share_sd: { a: 0.01, b: 0.01 },
  breakdown: null,
});
const slice = (venue, grade, round, n) =>
  [0, 1, 2, 3, 4, 5, 6].map((b) => row(venue, grade, round, b, n));

// 1. 要求どおりのスライスが30以上ならそのまま
{
  const rows = [
    ...slice(5, "G1", "yusho", 40),
    ...slice(0, "all", "all", 9000),
  ];
  const r = resolveContributionSlice(rows, {
    venue: 5,
    grade: "G1",
    round: "yusho",
  });
  check(
    "n>=30 なら要求どおりのスライスを返す",
    r.resolved.venue === 5 && r.widened.length === 0 && !r.smallSample,
  );
  check("艇番0〜6の7行がそろう", Object.keys(r.boats).length === 7);
}
// 2. 会場→ラウンド→グレードの順に広げる
{
  const rows = [
    ...slice(5, "G1", "yusho", 3),
    ...slice(0, "G1", "yusho", 20),
    ...slice(0, "G1", "all", 31),
    ...slice(0, "all", "all", 9000),
  ];
  const r = resolveContributionSlice(rows, {
    venue: 5,
    grade: "G1",
    round: "yusho",
  });
  check(
    "会場→ラウンドの順に広げ、30以上になった段で止まる",
    r.resolved.venue === 0 &&
      r.resolved.grade === "G1" &&
      r.resolved.round === "all" &&
      r.widened.join(",") === "venue,round",
  );
}
// 3. 行が無いスライスも広げる（n=0 のセルは DB に書かない）
{
  const rows = [...slice(0, "all", "all", 9000)];
  const r = resolveContributionSlice(rows, {
    venue: 5,
    grade: "SG",
    round: "yusho",
  });
  check(
    "行が無ければ全会場・全ラウンド・全グレードまで広げる",
    r.resolved.grade === "all" && r.widened.join(",") === "venue,round,grade",
  );
}
// 4. 広げきっても30未満なら小標本
{
  const rows = [...slice(0, "all", "all", 12)];
  const r = resolveContributionSlice(rows, {
    venue: 0,
    grade: "all",
    round: "all",
  });
  check(
    `広げきっても ${MIN_RACES} 未満なら smallSample`,
    r.smallSample === true,
  );
}
// 5. 1行も無ければ null
check(
  "行が1つも無ければ null",
  resolveContributionSlice([], { venue: 1, grade: "all", round: "all" }) ===
    null,
);
// 6. テーマは themes 配列から（数・順を固定しない）
{
  const themes = [
    { key: "b", name: "B" },
    { key: "a", name: "A" },
    { key: "c", name: "C" },
  ];
  const e = themeEntries(
    themes,
    { a: 0.5, b: 0.3, c: 0.2 },
    { a: 0.01, b: 0.01, c: 0.01 },
  );
  check(
    "themes の順と数で並べ、値はシェア",
    e.map((x) => x.key).join(",") === "b,a,c" && e[1].share === 0.5,
  );
  check(
    "シェアの大きい順の順位を付ける",
    e.map((x) => x.rank).join(",") === "2,1,3",
  );
  check(
    "次の順位との差が SD の2倍以上なら順位を強調する",
    e.find((x) => x.key === "a").rankDistinct === true,
  );
  const close = themeEntries(
    themes,
    { a: 0.5, b: 0.49, c: 0.01 },
    { a: 0.01, b: 0.01, c: 0.01 },
  );
  check(
    "差が SD の2倍未満の隣どうしは、どちらの順位も強調しない",
    close.find((x) => x.key === "a").rankDistinct === false &&
      close.find((x) => x.key === "b").rankDistinct === false &&
      close.find((x) => x.key === "c").rankDistinct === true,
  );
  const noSd = themeEntries(themes, { a: 0.5, b: 0.49, c: 0.01 }, null);
  check(
    "SD が無い版は順位を強調しない",
    noSd.every((x) => x.rankDistinct === false),
  );
  const missing = themeEntries(
    [...themes, { key: "market", name: "市場" }],
    { a: 0.5, b: 0.3, c: 0.2 },
    null,
  );
  check(
    "シェアに無いテーマ（後から足したテーマで古い版など）は0として並べる",
    missing.length === 4 && missing[3].share === 0,
  );
}

// 7. 表示する % の丸め（最大剰余法）
{
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const a = roundToTotal([0.345, 0.372, 0.142, 0.06, 0.035, 0.046], 100);
  check("6テーマの % の合計が100になる", sum(a) === 100);
  check(
    "切り捨てで足りない分は端数の大きい順に1ずつ足す",
    JSON.stringify(a) === JSON.stringify([35, 37, 14, 6, 3, 5]) ||
      JSON.stringify(a) === JSON.stringify([34, 37, 14, 6, 4, 5]),
  );
  const b = roundToTotal([0.05, 0.21, 0.08, 0.05, 0.02], 40);
  check("内訳は親の % に合計がそろう", sum(b) === 40);
  check("全部0でも壊れない", sum(roundToTotal([0, 0, 0], 0)) === 0);
}

if (failures.length) {
  console.error(`\n${failures.length}件の失敗`);
  process.exit(1);
}
console.log("\n寄与度のスライス・テーマの約束はすべて満たしています");
