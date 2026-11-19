/**
 * BOA-271 アナロジー・ファインダー v16 の定義の固定データ検査（ci）。
 *
 * 1. 優勝戦・準優勝戦の判定 v2（tasks T1-1）: 固定の82件（scripts/ml/analogy/testdata/stage-rule-v2-cases.json）で、
 *    src/constants/raceStageConfig.js の getRaceStageCategory が expected_category と一致すること。
 *    バッジ（getRaceStageKey）と今節の得点の除外（src/pure/seriesPoints.js の classifyStage）が同じ判定に従うこと。
 *    Python 側（features.py の round_from_stage）は scripts/ml/analogy/tests/test_features.py が同じ82件で検査する
 * 2. 展示後の類似レースの並べ直し（tasks T4-1）: src/utils/analogySimilarRerank.js が、Python（v16_similar）の展示後の
 *    表し方での厳密な並び（scripts/ml/analogy/testdata/v16-rerank.json、例のレース）と、順位が完全に一致し、
 *    距離²の差が 1e-5 未満であること。候補が層より少ないときの厳密さの判定
 * 3. 展開シナリオの定義（src/utils/analogyScenario.js）: スリットの7形・進入の型と前付け・風速区分・手がかりの8条件が、
 *    Python（v16_defs・v16_facts）で作った固定データ（scripts/ml/analogy/testdata/v16-defs-cases.json）と一致すること
 * 4. 画面の純粋関数（tasks T6-2）: 6艇中の順位（analogyFacts.rankPositions）・Wilson の95%区間・判定の3段階が、
 *    Python で作った固定データ（testdata/v16-ui-cases.json、make_v16_ui_cases.py）と一致すること。例のレースの今日の
 *    順位（v16-example.json の today.items）を再現すること。並び・今日の位置・範囲の名前・層の説明文・表記・
 *    スライダーの段・類似レースの集計を、手で決めた答えで確かめる
 *
 * 使い方: node scripts/maintenance/verify-analogy-facts.js
 */
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
import {
  getRaceStageCategory,
  getRaceStageKey,
} from "../../src/constants/raceStageConfig.js";
import { classifyStage } from "../../src/pure/seriesPoints.js";
import {
  EXHIBITION_ITEMS,
  exhibitionBoats,
  exhDiffLevel,
  exhibitionItemLevels,
  exhibitionPoolRate,
  poolExhDiffs,
  rerankSimilar,
} from "../../src/utils/analogySimilarRerank.js";
import {
  entryType,
  hintConditions,
  hintToday,
  maedukeBoats,
  SLIT_EXAMPLE,
  SLIT_FORMS,
  slitForms,
  windBand,
} from "../../src/utils/analogyScenario.js";
import { rateOf, usualOf, typicalRanks, uniformClass, scopeKind } from "../../src/utils/analogyFacts.js";





import { runAnalogyFactsScenes1 } from "./verifyData/analogy-facts-scenes-1.js";
import { runAnalogyFactsScenes2, runAnalogyFactsScenes3 } from "./verifyData/analogy-facts-scenes-2.js";
import { runAnalogyFactsScenes4 } from "./verifyData/analogy-facts-scenes-3.js";
import { runAnalogyFactsScenes5 } from "./verifyData/analogy-facts-scenes-4.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_E2E = path.join(__dirname, "../../e2e");
const CASES = path.join(
  __dirname,
  "../ml/analogy/testdata/stage-rule-v2-cases.json",
);

let failures = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures += 1;
  console.error(
    `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---- 1. 優勝戦・準優勝戦の判定 v2 ----------------------------------------
const { cases } = JSON.parse(fs.readFileSync(CASES, "utf8"));
check("固定データの件数", cases.length, 82);
for (const c of cases) {
  const category = getRaceStageCategory(c.stage)?.key ?? null;
  check(`種別 ${c.stage}`, category, c.expected_category);
  const roundKey = ["final", "semifinal"].includes(c.expected_category)
    ? c.expected_category
    : null;
  check(`バッジ ${c.stage}`, getRaceStageKey(c.stage), roundKey);
  if (roundKey)
    check(`今節の得点から除く ${c.stage}`, classifyStage(c.stage), "excluded");
}

// 旧判定から変わる本体の6レースの名前（analysis/t1/t1-1-stage-rule.json の v2.d）
for (const [stage, key] of [
  ["準決勝戦", "semifinal"],
  ["決勝戦", "final"],
  ["王将位決定戦", "final"],
  ["県内選手権優", "final"],
  ["賞金女王決定", "final"],
]) {
  check(`v2 で変わる名前のバッジ ${stage}`, getRaceStageKey(stage), key);
  check(
    `v2 で変わる名前の今節の得点 ${stage}`,
    classifyStage(stage),
    "excluded",
  );
}

// ---- 2. 展示後の並べ直し ------------------------------------------------
// BOA-1130: float32 の平均との差・min 順位と「同じ・近い」の境界を直接固定する。
{
  const f = Math.fround;
  const E = [6.70, 6.75, 6.80, 6.70, 6.85, 6.90].map(f);
  check("exhibitionBoats: exh_time は入力と同じ参照", exhibitionBoats(E).exh_time === E, true);
  for (const [label, input, diffs, ranks] of [
    ["同タイムはmin順位", E,
      [-0.0833, -0.0333, 0.0167, -0.0833, 0.0667, 0.1167], [1, 3, 4, 1, 5, 6]],
    ["NaNを除く5艇の平均", [f(6.7), NaN, f(6.8), f(6.7), f(6.85), f(6.9)],
      [-0.09, NaN, 0.01, -0.09, 0.06, 0.11], [1, NaN, 3, 1, 4, 5]],
    ["全艇NaN", Array(6).fill(NaN), Array(6).fill(NaN), Array(6).fill(NaN)],
    ["空配列", [], [], []],
    ["全艇同タイム", Array(6).fill(f(6.8)), Array(6).fill(0), Array(6).fill(1)],
  ]) {
    const boats = exhibitionBoats(input);
    check(`exhibitionBoats: ${label} exh_time`, boats.exh_time, input);
    for (const [key, expected] of [["exh_time_diff", diffs], ["exh_time_rank", ranks]]) {
      const values = boats[key];
      // JSON.stringify は NaN と null を区別しないため、NaN の位置を別に検査する。
      check(`exhibitionBoats: ${label} ${key} NaN位置`,
        values.map(Number.isNaN), expected.map(Number.isNaN));
      check(`exhibitionBoats: ${label} ${key}`,
        key === "exh_time_diff" ? values.map((v) => Math.round(v * 1e4) / 1e4) : values, expected);
    }
  }
  const z = Array(6).fill(0);
  const c = (a) => a.map(f);
  const offsetValues = new Float32Array([9, 9, 9, 9, 9, 9, 0, 0, 0, 0, 0, 0.06]);
  for (const [label, dq, dc, off, expected] of [
    ["差0は同じ", z, z, undefined, 2],
    ["0.03境界は同じ", z, c(Array(6).fill(0.03)), undefined, 2],
    ["0.031は近い", z, c(Array(6).fill(0.031)), undefined, 1],
    ["0.05境界は近い", z, c(Array(6).fill(0.05)), undefined, 1],
    ["0.051は違う", z, c(Array(6).fill(0.051)), undefined, 0],
    ["負の差も絶対値", z, c(Array(6).fill(-0.04)), undefined, 1],
    ["片側NaNの艇は除外", [NaN, 0, 0, 0, 0, 0], c([0.5, 0, 0, 0, 0, 0]), undefined, 2],
    ["dq全艇NaNは欠損", Array(6).fill(NaN), z, undefined, -1],
    ["dc全艇NaNは欠損", z, Array(6).fill(NaN), undefined, -1],
    ["offから6艇", z, offsetValues, 6, 2],
    ["off省略は0", z, offsetValues, undefined, 0],
    ["3艇だけなら3艇の平均", z, c([0.1, 0.1, 0.1]), undefined, 0],
  ]) check(`exhDiffLevel: ${label}`, exhDiffLevel(dq, dc, off), expected);
}

const rerank = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-rerank.json"),
    "utf8",
  ),
);
const got = rerankSimilar(rerank.candidates, rerank.today);
check(
  "並べ直しの順位",
  got.neighbors.map((n) => n.race_id),
  rerank.expected.race_ids,
);
const maxDiff = Math.max(
  ...got.neighbors.map((n, i) => Math.abs(n.d2 - rerank.expected.d2[i])),
);
check("並べ直しの距離²の差 < 1e-5", maxDiff < 1e-5, true);
check("候補が層の全件なら厳密", got.exact, true);
// 候補が層の一部（層 100件・候補 3件）: 候補の最後の出走表の距離²が、2件目の展示後の距離²より大きければ厳密
const tiny = {
  n_layer: 100,
  lambda_racecard: 0.1,
  candidates: ["a", "b", "c"],
  d2_racecard: [0.1, 0.2, 0.9],
  venue_match: [true, true, true],
  exhibition: {
    lambda: 0.2,
    columns: [{ feature: "wind_speed", slot: 0, kind: "race_num" }],
    weights: [1],
    norm: { wind_speed: { mean: 0, sd: 1 } },
  },
  exhibition_raw: { race: { wind_speed: [0, 0, 0] }, boats: {} },
};
const today0 = { boats: {}, race: { wind_speed: 0 } };
check(
  "厳密（下限 0.9 ≥ 2件目 0.2）",
  rerankSimilar(tiny, today0, 2).exact,
  true,
);
// 展示の列で b・c が遠くなる（b 0.2+1、c 0.9+1）と、2件目は b の 1.2 で、候補の外の下限 0.9 より大きい
check(
  "厳密でない（下限 0.9 < 2件目 1.2）",
  rerankSimilar(
    { ...tiny, exhibition_raw: { race: { wind_speed: [0, 1, 1] }, boats: {} } },
    today0,
    2,
  ).exact,
  false,
);

// 展示で決まる5項目の「同じ・近い」（Python の item_levels と同じ基準）
const exhItems = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-exh-items.json"),
    "utf8",
  ),
);
exhItems.candidates.forEach((c, j) => {
  check(
    `展示で決まる5項目 ${j}`,
    exhibitionItemLevels(exhItems.today, c),
    c.levels,
  );
});

// 展示で決まる5項目の pool_rate（展示後の段）: 上の400件を母集団にして、Python の判定（levels）で「同じ」の割合と一致する
{
  const cols = [
    "weather_code",
    "wind_x",
    "wind_y",
    "wind_speed",
    "wave_height",
  ];
  const groups = new Map();
  for (const c of exhItems.candidates) {
    const key = JSON.stringify(cols.map((k) => c.race[k]));
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const pool = {
    n: exhItems.candidates.length,
    race_cols: cols,
    race_rows: [...groups].map(([k, n]) => [...JSON.parse(k), n]),
    exh_time: exhItems.candidates.flatMap((c) =>
      c.exh_time.map((v) => (v === null ? null : Math.round(v * 100))),
    ),
  };
  const got = exhibitionPoolRate(
    pool,
    poolExhDiffs(pool.exh_time),
    exhItems.today,
  );
  const want = Object.fromEntries(
    EXHIBITION_ITEMS.map((k) => [
      k,
      exhItems.candidates.filter((c) => c.levels[k] === 2).length / pool.n,
    ]),
  );
  check("展示で決まる5項目の pool_rate（400件の母集団）", got, want);
  check(
    "展示で決まる5項目の pool_rate: 今日の値が無ければ0",
    exhibitionPoolRate(pool, poolExhDiffs(pool.exh_time), {
      race: {},
      exh_time: [null, null, null, null, null, null],
    }),
    Object.fromEntries(EXHIBITION_ITEMS.map((k) => [k, 0])),
  );
}

// ---- 3. 展開シナリオの定義 ------------------------------------------------
const defs = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-defs-cases.json"),
    "utf8",
  ),
);
for (const c of defs.slit_forms)
  check(`スリットの形 ${c.st.join(",")}`, slitForms(c.st), c.forms);
// 龍神ソナーの形の絵の例は、その形の定義を満たす（差に 0.10 を足して ST にする。d3 が凹みの新定義 BOA-777 を満たさなかった）
for (const f of SLIT_FORMS)
  check(
    `形の絵の例 ${f}`,
    slitForms(SLIT_EXAMPLE[f].map((v) => v + 0.1))[f],
    true,
  );
for (const c of defs.entry_types) {
  check(`進入の型 ${c.course.join(",")}`, entryType(c.course), c.type);
  check(`前付け ${c.course.join(",")}`, maedukeBoats(c.course), c.maeduke);
}
for (const c of defs.wind_bands)
  check(`風速区分 ${c.wind_speed}`, windBand(c.wind_speed), c.band);
for (const c of defs.hints)
  check(`手がかり ${c.avg_st.join(",")}`, hintConditions(c.avg_st), c.conds);
// 当てはまる条件のカードの「今日」の行（BOA-814）: 出す差は判定に使った差と同じ。当てはまる条件ごとに、差がしきい値を満たす
{
  const ok = {
    kado4: (d) => d > 0,
    kado4_02: (d) => d >= 20,
    in_slow02: (d) => d >= 20,
    in_fastest: (d) => d > 0,
    d2_slow01: (d) => d >= 10,
    d3_slow01: (d) => d >= 10,
    dash03: (d) => d >= 30,
    flat03: (d) => d <= 30,
  };
  let n = 0;
  for (const c of defs.hints)
    for (const [id, hit] of Object.entries(c.conds)) {
      const tl = hintToday(id, c.avg_st);
      if (!tl) continue;
      n += 1;
      check(
        `今日の行の差と判定 ${id} ${c.avg_st.join(",")}`,
        ok[id](tl.diff),
        hit,
      );
    }
  check("今日の行を確かめた件数", n > 0, true);
  // 津4R 2026-10-10 のこのコースの平均ST（④.093 が ①〜③で一番早い ①.130 より 0.037秒早い）
  check(
    "今日の行 津4R",
    hintToday("kado4", [0.13, 0.159, 0.144, 0.093, 0.138, 0.152]),
    {
      a: { boats: [4], sum: false, v: 93 },
      b: { boats: [1], sum: false, v: 130 },
      dir: "fast",
      diff: 37,
    },
  );
  check(
    "今日の行 ダッシュ勢先行は和",
    hintToday("dash03", [0.13, 0.159, 0.144, 0.093, 0.138, 0.152]).diff,
    50,
  );
  check(
    "今日の行 欠けがあれば出さない",
    hintToday("kado4", [0.13, null, 0.1, 0.1, 0.1, 0.1]),
    null,
  );
}

// ---- 4. 画面の純粋関数 ------------------------------------------------------
// BOA-1129: 来る艇の条件の率・件数・平均の順位・級別・範囲の種類
const SF = {
  usual: {
    "1": { win: [55, 100], top2: [70, 100], top3: [80, 100] },
    "2": { win: [14, 100] },
  },
  typ: {
    "1": {
      series_score: { win: 2.1, top2: 2.5, top3: null },
      exh_time: { win: 3 },
    },
  },
};
const ITEMS = [{ key: "series_score" }, { key: "exh_time" }, { key: "motor_top2" }];
for (const [label, input, expected] of [
  ["3/10", [3, 10], 0.3],
  ["0/10", [0, 10], 0],
  ["5/5", [5, 5], 1],
  ["1/3", [1, 3], 0.3333333333333333],
  ["母数0", [3, 0], null],
  ["null", null, null],
  ["undefined", undefined, null],
  ["空配列", [], null],
]) check(`rateOf: ${label}`, rateOf(input), expected);
for (const [label, sf, boat, target, expected] of [
  ["1着", SF, 1, 1, [55, 100]],
  ["2着以内", SF, 1, 2, [70, 100]],
  ["3着以内", SF, 1, 3, [80, 100]],
  ["文字列の艇番", SF, "1", 1, [55, 100]],
  ["文字列のtarget", SF, 1, "2", [70, 100]],
  ["着順キーなし", SF, 2, 2, null],
  ["艇なし", SF, 3, 1, null],
  ["target範囲外", SF, 1, 4, null],
  ["null", null, 1, 1, null],
  ["undefined", undefined, 1, 1, null],
  ["空オブジェクト", {}, 1, 1, null],
  ["母数0も組のまま", { usual: { "1": { win: [0, 0] } } }, 1, 1, [0, 0]],
]) check(`usualOf: ${label}`, usualOf(sf, boat, target), expected);
for (const [label, sf, boat, target, items, expected] of [
  ["1着の項目順", SF, 1, 1, ITEMS, [2.1, 3, null]],
  ["2着以内の欠けた軸", SF, 1, 2, ITEMS, [2.5, null, null]],
  ["3着以内の明示null", SF, 1, 3, ITEMS, [null, null, null]],
  ["文字列の艇番", SF, "1", 1, ITEMS, [2.1, 3, null]],
  ["艇なし", SF, 2, 1, ITEMS, [null, null, null]],
  ["null", null, 1, 1, ITEMS, [null, null, null]],
  ["target範囲外", SF, 1, 4, ITEMS, [null, null, null]],
  ["項目なし", SF, 1, 1, [], []],
  ["0を保持", { typ: { "1": { series_score: { win: 0 } } } }, 1, 1,
    [{ key: "series_score" }], [0]],
]) check(`typicalRanks: ${label}`, typicalRanks(sf, boat, target, items), expected);
for (const [label, input, expected] of [
  ["6艇A1", { classes: Array(6).fill("A1") }, "A1"],
  ["級別混在", { classes: ["A1", "A1", "A1", "A1", "A1", "B1"] }, null],
  ["5艇", { classes: Array(5).fill("B1") }, null],
  ["7艇", { classes: Array(7).fill("B1") }, null],
  ["配列でない", { classes: "A1A1A1" }, null],
  ["null", null, null],
  ["空オブジェクト", {}, null],
  ["6艇null", { classes: Array(6).fill(null) }, null],
]) check(`uniformClass: ${label}`, uniformClass(input), expected);
for (const [input, expected] of [
  ["VC:01:A1", "VC"], ["NC", "NC"], ["NCR:x", "NCR"], ["", ""],
]) check(`scopeKind: ${JSON.stringify(input)}`, scopeKind(input), expected);

// 作り手から来ない入力の仕様は未定。現在値を観測するだけで assert しない。
const KNOWN_GAPS = [
  // BOA-1130: float32 と NaN を渡す前提。境界の丸め・null の仕様は決めず現在値だけを出す。
  ["exhDiffLevel: [0.18,0,0,0,0,0]をfloat32化（平均0.03の丸め、Python nanmeanとの一致は未確認）",
    () => exhDiffLevel(Array(6).fill(0), [0.18, 0, 0, 0, 0, 0].map(Math.fround))],
  ["exhDiffLevel: [null,0,0,0,0,0.3]（nullを0として平均0.05）",
    () => exhDiffLevel(Array(6).fill(0), [null, 0, 0, 0, 0, 0.3])],
  ["exhibitionBoats: null混在（0秒として平均・順位に含む。呼び出し側はNaNに変換）",
    () => exhibitionBoats([Math.fround(6.7), null, Math.fround(6.8), Math.fround(6.7), Math.fround(6.85), Math.fround(6.9)])],
  ["exhibitionBoats: 全艇float32の6.8（平均との差の生値は0でない）",
    () => exhibitionBoats(Array(6).fill(Math.fround(6.8))).exh_time_diff],
  ["rateOf([12, 10])", () => rateOf([12, 10])],
  ["rateOf([3, -10])", () => rateOf([3, -10])],
  ["rateOf([null, 10])", () => rateOf([null, 10])],
  ['rateOf(["3", "10"])', () => rateOf(["3", "10"])],
  ["typicalRanks(SF, 1, 1, null)", () => typicalRanks(SF, 1, 1, null)],
  ['uniformClass: 6艇とも空文字', () => uniformClass({ classes: Array(6).fill("") })],
  ["uniformClass: 空き要素6個", () => uniformClass({ classes: new Array(6) })],
  ["scopeKind(null)", () => scopeKind(null)],
  ["scopeKind(undefined)", () => scopeKind(undefined)],
  ["scopeKind(12)", () => scopeKind(12)],
];

const ui = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-ui-cases.json"),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/analogy-facts-scenes-1.js・analogy-facts-scenes-2.js） ----
runAnalogyFactsScenes1({ __dirname, check, ui });
runAnalogyFactsScenes2({ check });

// 範囲の名前・層の説明文（日本語の文言で組み立てる）
const ja = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../src/locales/ja/common.json"),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/analogy-facts-scenes-2.js・analogy-facts-scenes-3.js・analogy-facts-scenes-4.js） ----
runAnalogyFactsScenes3({ check, ja });
runAnalogyFactsScenes4({ check });
runAnalogyFactsScenes5({ ROOT_E2E, check, KNOWN_GAPS });

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  `✅ 優勝戦・準優勝戦の判定 v2: ${cases.length} 件と旧判定から変わる5種の名前が一致。展示後の並べ直しが Python と一致（距離²の差の最大 ${maxDiff.toExponential(1)}）。画面の純粋関数: 順位 ${ui.rank_positions.length}・Wilson ${ui.wilson.length}・判定 ${ui.judge.length} 件が Python と一致`,
);
