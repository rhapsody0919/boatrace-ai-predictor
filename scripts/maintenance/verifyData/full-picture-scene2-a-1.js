/**
 * verify-full-picture-scene2.js の後半の場面（1/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { templateLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import { lineWidth, MAX_WIDTH, checkLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";

let focus1;

export const overview = {
  kind: "overview",
  leaders: [2],
  maxTop2: 4,
  axesCount: 5,
  withinRank: 2,
  runner: { boats: [1], count: 3 },
};

export const focus3 = {
  kind: "focus",
  boat: 3,
  item: "当地勝率",
  value: "7.78",
  rank: "2位",
  tie: false,
  otherFirstItems: [],
  otherFirstCount: 0,
  compare: {
    role: "1位",
    boats: [{ boat: 2, value: "8.28", sameDisplay: false }],
  },
  top2Count: 1,
  axesCount: 5,
};

// 平均ST は文では期間を付ける（BOA-815）。一番長くなる形
const focusSt = {
  kind: "focus",
  boat: 1,
  item: "平均ST（直近30走）",
  value: "0.12秒",
  rank: "1位",
  tie: false,
  otherFirstItems: ["モーター2連率"],
  otherFirstCount: 1,
  compare: {
    role: "2番手",
    boats: [{ boat: 2, value: "0.12秒", sameDisplay: true }],
  },
  top2Count: 3,
  axesCount: 6,
};

export const card = {
  kind: "card",
  boat: 1,
  item: "当地勝率",
  todayRank: 3,
  todayRate: 69,
  rate1: 74,
  rate6: 61,
  compareRanks: [1, 6],
  spreadPt: 13,
  usual: 71.1,
  usualDiffPt: 2.1,
  direction: "低い",
  roundDay: null,
  todayRankRef: null,
  todayN: 691,
  usualN: 4294,
};

// 優勝戦・準優勝戦の日の今節の着順点（画面は今日の順位を出すが、棒の今日の位置は出さない）
const cardFinal = {
  kind: "card",
  boat: 1,
  item: "今節の着順点",
  todayRank: null,
  todayRate: null,
  rate1: 77,
  rate6: 64,
  compareRanks: [1, 6],
  spreadPt: 13,
  usual: 71.1,
  usualDiffPt: null,
  direction: null,
  roundDay: "準優勝戦の日",
  todayRankRef: 1,
  todayN: null,
  usualN: 4294,
};

// BOA-1109: 2026-10-25 06場11R。最多が5艇（1・2・4・5・6号艇）で、次点は残りの3号艇。
// 長い文が幅に入るときは変えず、越えたときだけ頭の「今日の6艇で」を外す。艇番は必ず残す。
const overviewThreeLeaders = {
  ...overview,
  leaders: [2, 4, 6],
  runner: { boats: [1, 3, 5], count: 3 },
};

const overviewFourLeaders = {
  ...overview,
  leaders: [2, 3, 4, 6],
  runner: { boats: [1, 5], count: 3 },
};

const overviewFiveLeaders = {
  ...overview,
  leaders: [1, 2, 4, 5, 6],
  runner: { boats: [3], count: 3 },
};

const overviewSixLeaders = {
  ...overview,
  leaders: [1, 2, 3, 4, 5, 6],
  runner: null,
};

// 検査が落とすもの
export const has = (why, s) =>
  assert.ok(
    why.some((w) => w.includes(s)),
    `「${s}」で落ちる: ${why.join(" | ")}`,
  );

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runFullPictureScene2A1() {

}

function scene1() {
  // 文型の版（項目＋値＋順位を1文に。2行目で比べる相手）。選手の成績か、機械の数字か、過去のレースの集計かが分かる主語（2026-10-20 オーナー）
  assert.deepEqual(templateLines(overview), [
    "今日の6艇で2位以内の項目が最多は2号艇",
    "5項目中4、次は1号艇の3",
  ]);
  assert.deepEqual(templateLines({ ...overview, leaders: [2, 4] }), [
    "今日の6艇で2位以内の項目が最多は2・4号艇",
    "5項目中4、次は1号艇の3",
  ]);
  for (const f of [
    overviewThreeLeaders,
    overviewFourLeaders,
    overviewFiveLeaders,
    overviewSixLeaders,
  ]) {
    const lines = templateLines(f);
    for (const line of lines)
      assert.ok(
        lineWidth(line) <= MAX_WIDTH,
        `最多が${f.leaders.length}艇でも全角${MAX_WIDTH}字分以内: ${line}（${lineWidth(line)}）`,
      );
    assert.ok(
      lines[0].includes(`${f.leaders.join("・")}号艇`),
      `最多の艇番を消さない: ${lines[0]}`,
    );
    assert.deepEqual(
      checkLines(lines, f, null),
      [],
      "最多が並ぶ文型が検査を通る",
    );
  }
  // 3艇は長い文のまま（21.75 で幅に入る）
  assert.deepEqual(templateLines(overviewThreeLeaders), [
    "今日の6艇で2位以内の項目が最多は2・4・6号艇",
    "5項目中4、次は1・3・5号艇の3",
  ]);
  // 5艇は幅を越えるので短い文
  assert.deepEqual(templateLines(overviewFiveLeaders), [
    "2位以内の項目が最多は1・2・4・5・6号艇",
    "5項目中4、次は3号艇の3",
  ]);
  assert.deepEqual(templateLines(overviewSixLeaders), [
    "2位以内の項目が最多は1・2・3・4・5・6号艇",
    "6艇とも5項目中4",
  ]);
  assert.deepEqual(templateLines(focus1), [
    "1号艇の選手は全国勝率8.06で6人中1位",
    "2番手は2号艇の7.61、ほか2項目も1位",
  ]);
  assert.deepEqual(templateLines(focus3), [
    "3号艇の選手は当地勝率7.78で6人中2位",
    "1位は2号艇の8.28",
  ]);
  assert.deepEqual(templateLines(focusSt), [
    "1号艇の選手は平均ST（直近30走）で6人中1位",
    "0.12秒、2番手は2号艇の同じ0.12秒",
  ]);
  // 過去のレースの集計と分かるように（今日の1号艇の選手の成績と読まれない。2026-10-20 オーナー）
  assert.deepEqual(templateLines(card), [
    "当地勝率3位だった過去の1号艇は1着69%",
    "同じ級別の1号艇の71.1%より2.1ポイント低い",
  ]);
  // 「今日の順位を当てはめない」だけでは、カードの「今日 6艇中1位」と食い違って見えた（2026-10-20 オーケストレーター指摘）
  assert.deepEqual(templateLines(cardFinal), [
    "過去の1号艇は今節の着順点1位77%・6位64%",
    "1号艇は1位、準優勝戦の日は枠順に近く参考",
  ]);
  for (const f of [overview, focus1, focus3, focusSt, card, cardFinal]) {
    for (const l of templateLines(f))
      assert.ok(
        lineWidth(l) <= MAX_WIDTH,
        `文型の版は全角${MAX_WIDTH}字分以内: ${l}（${lineWidth(l)}）`,
      );
    assert.deepEqual(
      checkLines(templateLines(f), f, null),
      [],
      `文型の版が検査を通る: ${f.kind}`,
    );
  }
  has(
    checkLines(["1号艇は全国勝率8.10で1位"], focus1, null),
    "facts に無い数値「8.10」",
  );
  has(
    checkLines(["4号艇は全国勝率で1位"], focus1, null),
    "facts に無い艇番「4号艇」",
  );
  has(
    checkLines(["1号艇はモーター2連率で1位"], focus1, null),
    "facts に無い材料名「モーター2連率」",
  );
  has(
    checkLines(["3号艇は当地勝率で3位"], focus3, null),
    "facts に無い順位「3位」",
  );
}

function scene2() {
  // 禁止表現は risk-rules.json から読む（字幕と投稿本文で同じ判定）
  has(
    checkLines(["1号艇は必ず当たる"], focus1, null),
    "禁止表現「必ず当た」（guaranteed-hit）",
  );
  has(
    checkLines(["万舟券が出る"], focus1, null),
    "禁止表現「万舟券」（gambling-incitement）",
  );
  has(
    checkLines(["この選手は全国勝率で1位"], focus1, null),
    "型の禁止「この選手」",
  );
  has(checkLines(["1号艇は1位の項目が多い"], focus1, null), "ぼかし語「多い」");
}

/** verify から呼ぶ入口。env は verify 側の束縛（focus1） */
export function runFullPictureScene2A2(env) {
  ({ focus1 } = env);
  scene1();
  scene2();
}
