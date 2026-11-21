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
import zlib from "zlib";
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
  FACT_ITEMS,
  boatScopeKey,
  defaultScope,
  factRows,
  radarBoats,
  todayLine,
  todayPosition,
  todayValues,
} from "../../src/utils/analogyFacts.js";




import { bandBreakdown, flowLinks } from "../../src/utils/analogyAggregate.js";
import { runAnalogyFactsScenes1, runAnalogyFactsScenes2 } from "./verifyData/analogy-facts-scenes-1.js";
import {
  runAnalogyFactsScenes3,
  runAnalogyFactsScenes4,
  runAnalogyFactsScenes5,
} from "./verifyData/analogy-facts-scenes-2.js";
import { runAnalogyFactsScenes6 } from "./verifyData/analogy-facts-scenes-3.js";
import { runAnalogyFactsScenes7, runAnalogyFactsScenes8 } from "./verifyData/analogy-facts-scenes-4.js";

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

// ---- 後半の場面（verifyData/analogy-facts-scenes-1.js） ----
runAnalogyFactsScenes1({ check, defs });

const ui = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-ui-cases.json"),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/analogy-facts-scenes-1.js・analogy-facts-scenes-2.js） ----
runAnalogyFactsScenes2({ check, defs, ui });
runAnalogyFactsScenes3({ check });

// 例のレースの今日の順位（Python の today_payload と同じ）
const example = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-example.json"),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/analogy-facts-scenes-2.js） ----
runAnalogyFactsScenes4({ check, example });

// 範囲の名前・層の説明文（日本語の文言で組み立てる）
const ja = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../src/locales/ja/common.json"),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/analogy-facts-scenes-2.js・analogy-facts-scenes-3.js・analogy-facts-scenes-4.js） ----
runAnalogyFactsScenes5({ check, example, ja });
runAnalogyFactsScenes6({ check });
runAnalogyFactsScenes7({ check });

// ---- 七角形・項目の表の6艇の値は、その艇を一番上で選んだときと同じ（2026-10-09 ユーザー指摘）
// e2e の固定データ（若松12R・6艇ともA1）で、3号艇の集めたレースの展示タイムだけ値を変え、1号艇の集めたレースの
// 3号艇の列と違う数字にする（以前の「比べる艇」は1号艇の集めたレースで数字を出していたので、ここで食い違った）
{
  const fx = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(path.join(ROOT_E2E, "analogy-v16-fixture.json.gz")),
    ),
  ).facts;
  const k3 = fx.today.scope_keys["3"].VC;
  for (const r of ["1", "2", "3", "4", "5", "6"])
    fx.facts[k3].by["3"].exh_time[r].win = [1, 50];
  const values = todayValues(fx.today, fx.exhibition);
  const items = FACT_ITEMS.filter((it) => it.key !== "boat_2");
  const countOf = (key) => fx.facts[key]?.n ?? null;
  let n = 0;
  for (const picked of [null, "VC", "NC", "NCR", "VA"])
    for (const target of [1, 2, 3]) {
      const radar = radarBoats(
        fx.today,
        fx.facts,
        values,
        items,
        target,
        picked,
      );
      for (const b of [1, 2, 3, 4, 5, 6]) {
        // 一番上で b を選んだとき（ConditionFactsTab と同じ: boatScopeKey → factRows → カードの今日の行）
        const { key } = boatScopeKey(
          fx.today.scope_keys[String(b)],
          countOf,
          picked,
        );
        const sf = fx.facts[key];
        const rows = factRows(sf, b, target, true);
        items.forEach((it, i) => {
          const row = rows.find((r) => r.key === it.key);
          const line = row
            ? todayLine(row, values[it.key], b, sf, target)
            : null;
          check(
            `七角形の表＝一番上で選んだとき: ${b}号艇 ${it.key} target=${target} picked=${picked}`,
            radar[b - 1].cells[i].hit ?? null,
            line?.hit ?? null,
          );
          n += 1;
        });
      }
    }
  // 食い違いを作れているか（1号艇の集めたレースの3号艇の列とは違う数字になる）
  const k1 = fx.today.scope_keys["1"].VC;
  const b3 = todayPosition(values.exh_time, false, 3).bucket;
  check(
    "検査の前提: 1号艇の集めたレースの3号艇の展示タイムは、3号艇の集めたレースと違う",
    JSON.stringify(fx.facts[k1].by["3"].exh_time[String(b3)].win) !==
      JSON.stringify(fx.facts[k3].by["3"].exh_time[String(b3)].win),
    true,
  );
  check(
    "七角形の表: 3号艇の展示タイムは3号艇の集めたレースの値",
    radarBoats(fx.today, fx.facts, values, items, 1, null)[2].cells[
      items.findIndex((it) => it.key === "exh_time")
    ].hit,
    [1, 50],
  );
  // 件数0の区分は、カードの今日の行と同じく「無し」（レビュー指摘: 表だけ「— 0/0件」になっていた）
  {
    const fz = structuredClone(fx);
    const b5 = todayPosition(values.exh_time, false, 5).bucket;
    fz.facts[fz.today.scope_keys["5"].VC].by["5"].exh_time[String(b5)].win = [
      0, 0,
    ];
    const ie = items.findIndex((it) => it.key === "exh_time");
    check(
      "七角形の表: 件数0の区分は無し",
      radarBoats(fz.today, fz.facts, values, items, 1, null)[4].cells[ie].hit,
      null,
    );
  }
  // 手で選んだ範囲の集計がその艇だけ無いときは、既定に戻す（レビュー指摘: 表の行が全部「—」になっていた）
  {
    const keys4 = fx.today.scope_keys["4"];
    const missing = (key) =>
      key === keys4.NC ? null : (fx.facts[key]?.n ?? null);
    check(
      "範囲: 手で選んだ範囲の集計が無い艇は既定に戻す",
      boatScopeKey(keys4, missing, "NC").key,
      defaultScope(keys4, missing).key,
    );
    check(
      "範囲: 手で選んだ範囲の集計があればそれを使う",
      boatScopeKey(keys4, countOf, "NC").key,
      keys4.NC,
    );
  }
  console.log(`七角形の表と一番上で選んだときの一致: ${n} 件`);
}

// ---- 着順の流れの帯の内訳（BOA-816）: 帯の件数＝その帯に入る3連単の件数の合計 ----
{
  const fx = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(path.join(ROOT_E2E, "analogy-v16-fixture.json.gz")),
    ),
  ).scenario.scenario;
  let n = 0;
  for (const { forms } of Object.values(fx.cells))
    for (const cell of Object.values(forms))
      for (const [first, not1] of [
        [null, false],
        [null, true],
        [1, false],
        [4, false],
      ])
        for (const [p, a, b, c] of flowLinks(cell.tri, { first, not1 })) {
          const bd = bandBreakdown(
            cell.tri,
            { p, a, b, first, not1 },
            { first, not1 },
          );
          check(
            `帯の内訳の合計＝帯の件数: ${p}:${a}-${b} first=${first} not1=${not1}`,
            bd?.total ?? null,
            c,
          );
          n += 1;
        }
  // 押したときと絞り込みが変わったら外れる（ファンパネル: 1着を変えたら帯の選択は外す）
  const any = fx.cells.all.forms.any;
  const [p0, a0, b0] = flowLinks(any.tri)[0];
  check(
    "帯の内訳: 1着の絞り込みが変わったら null",
    bandBreakdown(
      any.tri,
      { p: p0, a: a0, b: b0, first: null, not1: false },
      { first: a0, not1: false },
    ),
    null,
  );
  console.log(`帯の内訳の合計＝帯の件数: ${n} 件`);
}

// ---- 後半の場面（verifyData/analogy-facts-scenes-4.js） ----
runAnalogyFactsScenes8({ check });

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  `✅ 優勝戦・準優勝戦の判定 v2: ${cases.length} 件と旧判定から変わる5種の名前が一致。展示後の並べ直しが Python と一致（距離²の差の最大 ${maxDiff.toExponential(1)}）。画面の純粋関数: 順位 ${ui.rank_positions.length}・Wilson ${ui.wilson.length}・判定 ${ui.judge.length} 件が Python と一致`,
);
