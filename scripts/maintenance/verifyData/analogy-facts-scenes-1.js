/**
 * verify-analogy-facts.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { exhDiffLevel, exhibitionBoats } from "../../../src/utils/analogySimilarRerank.js";
import {
  slitForms,
  SLIT_FORMS,
  SLIT_EXAMPLE,
  entryType,
  maedukeBoats,
  windBand,
  hintConditions,
  hintToday,
} from "../../../src/utils/analogyScenario.js";
import {
  rateOf,
  usualOf,
  typicalRanks,
  uniformClass,
  scopeKind,
  rankPositions,
  judgeGap,
  judgeLabelParams,
  openCardKeys,
} from "../../../src/utils/analogyFacts.js";
import { wilsonInterval } from "../../../src/utils/wilson.js";

let check, defs, ui;

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

// 作り手から来ない入力の仕様は未定。現在値を観測するだけで assert しない。
export const KNOWN_GAPS = [
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

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// 最初から開くのは、並べた順で「差が大きい」の上位2枚だけ
const lv = (key, level) => ({ key, judge: { level } });

function scene1() {
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
}

function scene2() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・defs） */
export function runAnalogyFactsScenes1(env) {
  ({ check, defs } = env);
  scene1();
  scene2();
}

function scene3() {
  for (const c of ui.rank_positions)
    check(
      `6艇中の順位 ${c.values.join(",")} hib=${c.hib}`,
      rankPositions(c.values, c.hib),
      c.positions,
    );
  for (const c of ui.wilson)
    check(
      `Wilson ${c.x}/${c.n}`,
      close(wilsonInterval(c.x, c.n), c.interval),
      true,
    );
  for (const c of ui.judge)
    check(`判定 ${c.best}/${c.worst}`, judgeGap(c.best, c.worst).level, c.level);
  check("判定（件数0）", judgeGap([0, 0], [1, 2]).level, "none");
  check("判定（逆向き）", judgeGap([10, 100], [60, 100]).reversed, true);
  // BOA-805（2026-10-09 ユーザー決定）: 10ポイント以上で「差が大きい」、5〜10ポイントは「差がある」。件数の判定は今のまま
  check(
    "判定: 差10ポイントちょうどは差が大きい",
    judgeGap([3000, 5000], [2500, 5000]).level,
    "large",
  );
  check(
    "判定: 差9ポイントは差がある",
    judgeGap([2950, 5000], [2500, 5000]).level,
    "some",
  );
  check(
    "判定: 差5ポイントちょうどは差がある",
    judgeGap([2750, 5000], [2500, 5000]).level,
    "some",
  );
  check(
    "判定: 差4ポイントは差は小さい",
    judgeGap([2700, 5000], [2500, 5000]).level,
    "small",
  );
  check(
    "判定: 差40ポイントでもぶれ幅が重なればはっきりしない",
    judgeGap([3, 4], [1, 3]).level,
    "unclear",
  );
  // 札に添える値（D）: 差のポイントと少ない側の件数
  check(
    "札の値: 差と少ない側の件数",
    judgeLabelParams({
      spread: -0.404,
      all: [[29, 72], null, null, null, null, [54, 271]],
    }),
    { pt: 40, n: 72 },
  );
  check(
    "開くカード: 差が大きいの上位2枚",
    [
      ...openCardKeys([
        lv("a", "large"),
        lv("b", "some"),
        lv("c", "large"),
        lv("d", "large"),
        lv("e", "unclear"),
      ]),
    ],
    ["a", "c"],
  );
  check(
    "開くカード: 差が大きいが無ければ0枚",
    [...openCardKeys([lv("a", "some"), lv("b", "unclear")])],
    [],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・defs・ui） */
export function runAnalogyFactsScenes2(env) {
  ({ check, defs, ui } = env);
  scene3();
}
