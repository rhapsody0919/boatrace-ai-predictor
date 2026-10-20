/**
 * 全貌動画 場面2（試作）の答えの文の検査と、拍の並びを確かめる（外部接続なし、LLM は偽物）。
 * - 文型の版（templateLines）が facts から決まった文を作り、その文が検査（checkLines）を通る
 * - 検査が facts に無い数値・艇番・材料名・順位、禁止表現、ぼかし語、幅、段の最初のつなぐ語を落とす
 * - 整えた版（polishedText）は、落ちた拍・出力に無い拍・LLM の失敗を文型の版に戻し、理由を残す（全体は止めない）
 * - 拍の並び（scene2Timeline）は材料から決まる
 */
import assert from "node:assert/strict";
import { templateLines } from "../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import {
  checkLines,
  polishedText,
} from "../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { scene2Timeline } from "../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";

const overview = {
  kind: "overview",
  leaders: [2],
  maxTop2: 4,
  axesCount: 5,
  withinRank: 2,
  runner: { boats: [1], count: 3 },
};
const focus1 = {
  kind: "focus",
  boat: 1,
  item: "全国勝率",
  value: "8.06",
  rank: "1位",
  tie: false,
  otherFirstItems: ["直近30走1着率", "平均ST"],
  otherFirstCount: 2,
  compare: {
    role: "2番手",
    boats: [{ boat: 2, value: "7.61", sameDisplay: false }],
  },
  top2Count: 3,
  axesCount: 5,
};
const focus3 = {
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
const card = {
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
};

// 文型の版
assert.deepEqual(templateLines(overview), [
  "2位以内の項目が最多は2号艇（5項目中4）",
  "次は1号艇の3",
]);
assert.deepEqual(templateLines(focus1), [
  "1号艇は全国勝率で1位、ほか2項目も1位",
  "全国勝率8.06、2番手は2号艇の7.61",
]);
assert.deepEqual(templateLines(focus3), [
  "3号艇の一番上は当地勝率の2位",
  "7.78、1位は2号艇の8.28",
]);
assert.deepEqual(templateLines(card), [
  "当地勝率3位の1着率69%（1位74%・6位61%）",
  "全体の71.1%より2.1ポイント低い",
]);
for (const f of [overview, focus1, focus3, card])
  assert.deepEqual(
    checkLines(templateLines(f), f, null),
    [],
    `文型の版が検査を通る: ${f.kind}`,
  );

// 検査が落とすもの
const has = (why, s) =>
  assert.ok(
    why.some((w) => w.includes(s)),
    `「${s}」で落ちる: ${why.join(" | ")}`,
  );
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
has(checkLines(["1号艇は必ず1着"], focus1, null), "禁止表現「必ず」");
has(
  checkLines(["この選手は全国勝率で1位"], focus1, null),
  "禁止表現「この選手」",
);
has(checkLines(["1号艇は1位の項目が多い"], focus1, null), "ぼかし語「多い」");
has(
  checkLines(["全体の71.1%より2.1ポイント高い"], card, null),
  "向きが facts（低い）と逆",
);
// 10/15 丸亀10R の整えた版で通ってしまった言い方（再現テスト）
has(
  checkLines(["2番手の2号艇7.61との差はわずか"], focus1, null),
  "ぼかし語「わずか」",
);
has(
  checkLines(
    ["1号艇は全国勝率で1位、ほか2項目も1位、2番手は2号艇の7.61"],
    focus1,
    null,
  ),
  "幅",
);
has(
  checkLines(["一方、1号艇は全国勝率で1位"], focus1, null),
  "段の最初の拍でつなぐ語「一方」",
);
has(
  checkLines(["同じく3号艇は当地勝率の2位"], focus3, focus1),
  "前の拍と材料が違う",
);
assert.deepEqual(
  checkLines(["一方、3号艇は当地勝率の2位"], focus3, focus1),
  [],
  "段の途中のつなぐ語は通る",
);
has(checkLines(["a", "b", "c"], focus1, null), "行の数");

// 整えた版: 合格した拍だけ LLM の文、ほかは文型の版に戻す
const scene = {
  radar: {
    overview: {
      id: "overview",
      facts: overview,
      lines: templateLines(overview),
    },
    focus: [
      { id: "focus-1", boat: 1, facts: focus1, lines: templateLines(focus1) },
      { id: "focus-3", boat: 3, facts: focus3, lines: templateLines(focus3) },
    ],
  },
  cards: {
    items: [{ id: "card-loc_win", facts: card, answer: templateLines(card) }],
    empty: null,
  },
};
const fake = () =>
  `前置き ${JSON.stringify({
    beats: [
      { id: "overview", lines: ["2位以内が最多は2号艇の5項目中4"] },
      { id: "focus-1", lines: ["1号艇はかなり強い"] },
      {
        id: "card-loc_win",
        lines: ["当地勝率3位の1着率69%", "全体の71.1%より2.1ポイント低い"],
      },
    ],
  })}`;
const p = polishedText(scene, fake);
const src = Object.fromEntries(p.beats.map((b) => [b.id, b.source]));
assert.deepEqual(src, {
  overview: "llm",
  "focus-1": "template",
  "focus-3": "template",
  "card-loc_win": "llm",
});
assert.deepEqual(p.answers["focus-1"], templateLines(focus1));
has(p.beats.find((b) => b.id === "focus-1").reasons, "ぼかし語「かなり」");
has(p.beats.find((b) => b.id === "focus-3").reasons, "出力にこの拍が無い");
const broken = polishedText(scene, () => {
  throw new Error("接続できない");
});
assert.ok(
  broken.beats.every(
    (b) => b.source === "template" && b.reasons[0].includes("接続できない"),
  ),
  "LLM の失敗は全拍を文型の版に戻す",
);

// 拍の並び
const tl = scene2Timeline({
  radar: { focus: [{}, {}, {}, {}, {}, {}] },
  cards: { items: [{}, {}] },
});
assert.deepEqual(
  tl.beats.map((b) => b.kind),
  [
    "overview",
    "focus",
    "focus",
    "focus",
    "focus",
    "focus",
    "focus",
    "toCards",
    "card",
    "card",
  ],
);
assert.equal(tl.total, 150 + 6 * 135 + 24 + 2 * 150 + 15);
assert.equal(
  scene2Timeline({ radar: { focus: [{}] }, cards: { items: [] } }).beats.at(-1)
    .kind,
  "empty",
);

console.log("verify-full-picture-scene2: OK");
