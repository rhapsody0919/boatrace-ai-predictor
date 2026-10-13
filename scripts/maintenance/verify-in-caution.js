/**
 * BOA-822 イン崩れ注意度の検証（DB には繋がない）。
 *
 *   (a) 定義の1か所: JS の正（src/constants/inCautionConfig.js）と Python が読む src/data/inCautionConfig.json が同じ値。
 *       値の組と def を固定する（閾値・帯・期間を変えたら def を上げる。/accuracy の公開後の実績は同じ def の行だけを数える）
 *   (b) 表の欠けのガード（scripts/lib/inCaution.js の toInCautionRates）: 最初の日・最後の日・合計の件数
 *   (c) レースの値（computeInCaution）: 出さない理由の全分岐、境目、同点、欠場1艇、件数少なめ、例のレース
 *   (d) JS と Python の勝率差・帯が同じ: Python の pytest と同じ固定の入力
 *       （scripts/ml/analogy/tests/fixtures/in_caution_cases.json）を computeInCaution に通す
 *
 * 使い方: node scripts/maintenance/verify-in-caution.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IN_CAUTION_CONFIG } from "../../src/constants/inCautionConfig.js";
import { computeInCaution, toInCautionRates } from "../lib/inCaution.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
// キーの順に依らない比較
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// ---------------------------------------------------------------- (a)
{
  const json = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/inCautionConfig.json"), "utf8"),
  );
  check(
    same(IN_CAUTION_CONFIG, json),
    "(a) src/constants/inCautionConfig.js と src/data/inCautionConfig.json が同じ値",
    `JS: ${JSON.stringify(canonical(IN_CAUTION_CONFIG))}\n   JSON: ${JSON.stringify(canonical(json))}`,
  );
  // 値の組を変えたのに def を上げ忘れると、/accuracy の公開後の実績に違う定義の行が混ざる
  const DEF_V1 = {
    def: "gapband-r-v1",
    thresholds: [35, 55],
    bandWidthCents: 50,
    bandMin: -8,
    bandMax: 6,
    from: "2019-04-01",
    minCellN: 100,
    lowSampleN: 300,
  };
  const pick = Object.fromEntries(
    Object.keys(DEF_V1).map((k) => [k, IN_CAUTION_CONFIG[k]]),
  );
  check(
    IN_CAUTION_CONFIG.def !== DEF_V1.def || same(pick, DEF_V1),
    "(a) def が gapband-r-v1 の間は、閾値・帯・期間・件数の下限が v1 の値のまま",
    JSON.stringify(pick),
  );
  check(
    Object.isFrozen(IN_CAUTION_CONFIG) &&
      Object.isFrozen(IN_CAUTION_CONFIG.thresholds) &&
      Object.isFrozen(IN_CAUTION_CONFIG.prelaunch),
    "(a) JS の定数は書き換えられない（freeze）",
  );
}

// ---------------------------------------------------------------- (b)
const PREV = "2026-10-10";
// 全期間の表の形（合計 40万件以上、最初の日が from、最後の日が前日）
function tableRows({
  first = "2019-04-01",
  last = PREV,
  cells = [
    ["other", -5, 34842, 22634],
    ["other", 0, 380000, 170000],
    ["junyu", 4, 236, 28],
    ["yusho", -8, 2, 0],
    ["junyu", -5, 225, 107],
    ["other", 6, 107, 15],
  ],
} = {}) {
  return cells.map(([round_grp, gap_band, n, non_win]) => ({
    round_grp,
    gap_band,
    n: String(n), // bigint は文字列で来ることもある
    non_win: String(non_win),
    first_date: first,
    last_date: last,
  }));
}
{
  const ok = toInCautionRates(tableRows(), PREV);
  check(
    ok.usable &&
      ok.through === PREV &&
      ok.base.n === 34842 + 380000 + 236 + 2 + 225 + 107 &&
      same(ok.cells.get("other|-5"), { n: 34842, nonWin: 22634 }),
    "(b) 全期間の表は使える（合計・セル・through）",
    JSON.stringify({ ...ok, cells: [...ok.cells] }),
  );
  const reasons = [
    toInCautionRates([], PREV),
    toInCautionRates(tableRows({ first: "2026-09-27" }), PREV),
    toInCautionRates(tableRows({ last: "2026-10-07" }), PREV),
    toInCautionRates(tableRows({ cells: [["other", -5, 9000, 5000]] }), PREV),
  ].map((r) => r.usable);
  check(
    same(reasons, [false, false, false, false]),
    "(b) 空・最初の日が from より後（直近14日だけの表）・最後の日が3日以上古い・合計の件数が下限未満は使わない",
    JSON.stringify(reasons),
  );
  check(
    toInCautionRates(tableRows({ last: "2026-10-08" }), PREV).usable === true,
    "(b) 最後の日が前日の2日前までは使う（夜のジョブが1回遅れた日）",
  );
}

// ---------------------------------------------------------------- (c)
const RATES = toInCautionRates(tableRows(), PREV);
const race = (rates, opts = {}) =>
  rates.map((r, i) => ({
    boat_number: i + 1,
    win_rate: r,
    is_absent: (opts.absent ?? []).includes(i + 1),
  }));
const run = (rates, opts = {}) =>
  computeInCaution({
    entries: race(rates, opts),
    raceStage: opts.stage ?? "予選",
    rates: opts.table === undefined ? RATES : opts.table,
  });
const five = [5.0, 5.0, 5.0, 5.0, 5.0];
{
  const ex = run([4.81, 5.12, 6.93, 3.2, 4.0, 5.5]);
  check(
    same(ex, {
      inCaution: {
        pct: 65,
        n: 34842,
        nonWin: 22634,
        level: "high",
        gapCents: -212,
        band: -5,
        round: "other",
        boat1WinRate: 4.81,
        topOtherBoat: 3,
        topOtherWinRate: 6.93,
        basePct: ex.inCaution?.basePct,
        absentBoats: [],
        lowSample: false,
        through: PREV,
        def: "gapband-r-v1",
      },
      skip: null,
    }) && Number.isInteger(ex.inCaution.basePct),
    "(c) 例のレース 2026-10-11 戸田4R: 4.81 と 6.93 → −212 → 帯 −5 → 34,842件・65%・崩れやすい",
    JSON.stringify(ex),
  );
  const skips = [
    run([4.8, ...five], { absent: [1] }).skip,
    run([null, ...five]).skip,
    run(["", ...five]).skip,
    run([4.8, ...five], { absent: [2, 5] }).skip,
    run([4.8, null, null, null, null, null]).skip,
    run([4.8, 5.0, null, null, null, null], { absent: [2] }).skip,
    run([4.8, ...five], { table: null }).skip,
    run([4.8, ...five], { table: toInCautionRates([], PREV) }).skip,
    run([3.0, ...five], { stage: "優勝戦" }).skip, // (yusho, −8) は2件
    run([5.0, 1.0, 1.0, 1.0, 1.0, 1.0], { stage: "準優勝戦" }).skip, // (junyu, 6) はセルが無い
  ];
  check(
    same(skips, [
      "boat1_absent",
      "boat1_no_rate",
      "boat1_no_rate",
      "multi_absent",
      "others_no_rate",
      "others_no_rate",
      "rates_unavailable",
      "rates_unavailable",
      "sparse_cell",
      "sparse_cell",
    ]),
    "(c) 出さない理由: 1号艇の欠場・勝率なし（null・空）・2艇以上の欠場・他の艇の勝率が全部なし（欠場を除く）・表なし・表の欠け・件数100未満・セルなし",
    JSON.stringify(skips),
  );
  const zero = run([0.0, ...five]);
  check(
    zero.skip === "sparse_cell" || zero.inCaution?.band === -8,
    "(c) 1号艇の勝率 0.00 は勝率として扱う（boat1_no_rate にしない）",
    JSON.stringify(zero),
  );
  const tie = run([4.81, 6.93, 5.0, 6.93, 4.0, 4.0]);
  check(
    tie.inCaution?.topOtherBoat === 2,
    "(c) 最大が同点なら艇番の小さい方",
    JSON.stringify(tie.inCaution),
  );
  const one = run([4.81, 5.12, 9.99, 3.2, 4.0, 6.93], { absent: [3] });
  check(
    same([one.inCaution?.absentBoats, one.inCaution?.topOtherBoat], [[3], 6]) &&
      one.inCaution?.gapCents === -212,
    "(c) 1艇の欠場は残りの艇で出し、absentBoats に入れる（欠場の艇の勝率は使わない）",
    JSON.stringify(one.inCaution),
  );
  const low = run([7.0, ...five], { stage: "準優勝戦" }); // (junyu, 4) 236件
  check(
    low.inCaution?.lowSample === true && low.inCaution?.round === "junyu",
    "(c) 件数 100〜299 は出して lowSample（「件数少なめ」）",
    JSON.stringify(low),
  );
  const edge = run([7.0, ...five], { stage: "準優進出戦" }); // other の帯 4 はセルが無い
  check(
    edge.skip === "sparse_cell",
    "(c) 準優進出戦は準優勝戦（junyu）に入れない",
    JSON.stringify(edge),
  );
}

// ---------------------------------------------------------------- (d)
{
  const cases = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "scripts/ml/analogy/tests/fixtures/in_caution_cases.json",
      ),
      "utf8",
    ),
  ).gapCases;
  // 全部の帯にセルがある表（帯の答えだけを比べる）
  const all = [];
  for (let b = -8; b <= 6; b++) all.push(["other", b, 30000, 15000]);
  const table = toInCautionRates(tableRows({ cells: all }), PREV);
  const got = cases.map((c) => {
    const r = computeInCaution({
      entries: race(c.rates),
      raceStage: "予選",
      rates: table,
    });
    return [r.inCaution?.gapCents ?? null, r.inCaution?.band ?? null];
  });
  const want = cases.map((c) => [c.gapCents, c.band]);
  const diff = cases
    .map((c, i) => [c, got[i], want[i]])
    .filter(([, g, w]) => !same(g, w))
    .map(([c, g]) => `${c.name}: ${JSON.stringify(g)}`);
  check(
    diff.length === 0,
    `(d) Python と同じ固定の入力 ${cases.length}件で勝率差・帯が同じ`,
    diff.join("\n   "),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\n✅ すべての検査が通過");
