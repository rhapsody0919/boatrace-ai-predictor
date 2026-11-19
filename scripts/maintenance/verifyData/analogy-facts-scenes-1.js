/**
 * verify-analogy-facts.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "fs";
import path from "path";
import {
  rankPositions,
  judgeGap,
  judgeLabelParams,
  openCardKeys,
  agreementVerdict,
  todayPosition,
  factRows,
  seriesScoreNote,
  defaultScope,
} from "../../../src/utils/analogyFacts.js";
import { wilsonInterval } from "../../../src/utils/wilson.js";

let __dirname, check, ui;
let example, scopeFacts;

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// 最初から開くのは、並べた順で「差が大きい」の上位2枚だけ
const lv = (key, level) => ({ key, judge: { level } });

const HIB = { st_mean30: false };

// カードの並び: 差がはっきりしている（大きい・小さい）ものが先、その中は差の大きい順
const pairs = (b, w) => ({
  1: { win: b },
  2: { win: [0, 0] },
  3: { win: [0, 0] },
  4: { win: [0, 0] },
  5: { win: [0, 0] },
  6: { win: w },
});

// 既定の範囲（VC が300件未満なら NC）
export const keys = { VC: "VC:20:2-1-3-0:1A1", NC: "NC:2-1-3-0:1A1", VA: "VA:20" };

function scene1() {
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
  // 展示の形と本番の形（同じ Wilson のぶれ幅で言い分ける）
  check(
    "展示の形: 同じ形のほうがはっきり高い",
    agreementVerdict([300, 1000], [150, 1000]),
    "up",
  );
  check(
    "展示の形: 多摩川12R の例（12% と 15%、件数が少なくぶれ幅が重なる）",
    agreementVerdict([6, 50], [150, 1000]),
    "same",
  );
  check(
    "展示の形: 同じ形のほうがはっきり低い",
    agreementVerdict([100, 1000], [200, 1000]),
    "down",
  );
  check("展示の形: 件数0は出さない", agreementVerdict([0, 0], [1, 10]), null);
  // 例のレースの今日の順位（Python の today_payload と同じ）
  example = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../ml/analogy/testdata/v16-example.json"),
      "utf8",
    ),
  );
}

function scene2() {
  for (const [k, v] of Object.entries(example.today.items))
    check(
      `例のレースの順位 ${k}`,
      rankPositions(v.values, HIB[k] ?? true),
      v.positions,
    );
  // 今日の位置: 同じ値の艇は一番良い・一番悪いの両方（3艇が同じ値の真ん中は min 順位）
  check(
    "今日の位置（同じ値の最良）",
    todayPosition([7, 7, 6, 5, 4, 3], true, 2),
    { bucket: 1, same: 2, value: 7, min: 3, max: 7 },
  );
  check(
    "今日の位置（中間の同じ値）",
    todayPosition([7, 5, 5, 5, 4, 3], true, 3).bucket,
    2,
  );
  check(
    "今日の位置（値なし）",
    todayPosition([null, 5, 5, 5, 4, 3], true, 1),
    null,
  );
  check(
    "今日の位置（遅いほど悪い）",
    todayPosition([0.15, 0.12, 0.13, 0.11, 0.18, 0.18], false, 6).bucket,
    6,
  );
  scopeFacts = {
    by: {
      1: {
        nat_win: pairs([60, 100], [40, 100]), // はっきり・差20
        loc_win: pairs([52, 100], [48, 100]), // はっきりしない
        motor_2: pairs([700, 1000], [600, 1000]), // はっきり・差10
        exh_time: pairs([90, 100], [10, 100]), // 展示前は出さない
      },
    },
  };
  check(
    "カードの並び（展示前）",
    factRows(scopeFacts, 1, 1, false).map((r) => r.key),
    ["nat_win", "motor_2", "loc_win"],
  );
  check(
    "カードの並び（展示後）",
    factRows(scopeFacts, 1, 1, true).map((r) => r.key),
    ["exh_time", "nat_win", "motor_2", "loc_win"],
  );
  // 今節の平均着順点の注記（R1: 最小3未満かつ最大1以上。優勝戦・準優勝戦の日は final だけ。
  // 初日（6艇とも0走）は first: カードと七角形の軸を出さず1行で断る。BOA-802 2026-10-10 ユーザー決定）
  check(
    "注記: 序盤",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [1, 2, 3, 3, 4, 2],
    }),
    "early",
  );
  check(
    "注記: 初日",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [0, 0, 0, 0, 0, 0],
    }),
    "first",
  );
  check(
    "注記: 走数が足りる",
    seriesScoreNote({
      round: "yosen",
      series_runs_before_today: [3, 3, 4, 5, 3, 3],
    }),
    null,
  );
  check(
    "注記: 優勝戦",
    seriesScoreNote({
      round: "yusho",
      series_runs_before_today: [1, 1, 1, 1, 1, 1],
    }),
    "final",
  );
  check("既定の範囲（VC）", defaultScope(keys, () => 300).key, keys.VC);
}

/** verify から呼ぶ入口。env は verify 側の束縛（__dirname・check・ui） */
export function runAnalogyFactsScenes1(env) {
  ({ __dirname, check, ui } = env);
  scene1();
  scene2();
}
