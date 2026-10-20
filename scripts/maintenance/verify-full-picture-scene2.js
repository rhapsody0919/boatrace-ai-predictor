/**
 * 全貌動画 場面2 の答えの文・配置・拍の並びを確かめる（外部接続なし、LLM は偽物）。
 * - 文型の版（templateLines）が facts から決まった文を作り、1行は全角22字分以内で、その文が検査（checkLines）を通る
 * - 検査が facts に無い数値・艇番・材料名・順位、禁止表現（risk-rules.json が正本）、ぼかし語、幅、段の最初のつなぐ語を落とす
 * - 整えた版（polishedText）は、落ちた拍・出力に無い拍・LLM の失敗を文型の版に戻し、理由を残す（全体は止めない）
 * - 配置（scene2Layout）: 項目名と枠が画面内・右のボタン列の外にあり、頂点の札と重ならない。札の列は x940 まで。吹き出しは y1420 より上
 * - 拍の並び（scene2Timeline）と、答えを読める時間
 */
import assert from "node:assert/strict";
import { templateLines } from "../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import {
  MAX_WIDTH,
  checkLines,
  lineWidth,
  polishedText,
} from "../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import {
  answerWindows,
  scene2Timeline,
} from "../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";
import {
  BADGE_R,
  CHIP,
  FRAME_PAD,
  bubbleBottom,
  boxHitsCircle,
  chipX,
  frameInSafeArea,
  labelBox,
  vertex,
} from "../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";

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
  otherFirstItems: ["直近30走1着率", "平均ST（直近30走）"],
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

// 文型の版（項目＋値＋順位を1文に。2行目で比べる相手）
assert.deepEqual(templateLines(overview), [
  "2位以内の項目が最多は2号艇",
  "5項目中4、次は1号艇の3",
]);
assert.deepEqual(templateLines(focus1), [
  "1号艇は全国勝率8.06で1位",
  "2番手は2号艇の7.61、ほか2項目も1位",
]);
assert.deepEqual(templateLines(focus3), [
  "3号艇は当地勝率7.78で2位",
  "1位は2号艇の8.28",
]);
assert.deepEqual(templateLines(focusSt), [
  "1号艇は平均ST（直近30走）0.12秒で1位",
  "2番手は2号艇の同じ0.12秒、ほか1項目も1位",
]);
assert.deepEqual(templateLines(card), [
  "当地勝率3位の1着率69%",
  "全体の71.1%より2.1ポイント低い",
]);
// 「今日の順位を当てはめない」だけでは、カードの「今日 6艇中1位」と食い違って見えた（2026-10-20 オーケストレーター指摘）
assert.deepEqual(templateLines(cardFinal), [
  "今節の着順点 1位77%・6位64%",
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
has(
  checkLines(["全体の71.1%より2.1ポイント高い"], card, null),
  "向きが facts（低い）と逆",
);
// 10/15 丸亀10R の整えた版で通ってしまった言い方
has(
  checkLines(["2番手の2号艇7.61との差はわずか"], focus1, null),
  "ぼかし語「わずか」",
);
// 10/19 下関10R の整えた版の案（全角23.7字分）は1行に入らない
has(
  checkLines(["当地勝率3位の1号艇は1着率69%（1位74%、6位61%）"], card, null),
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
assert.deepEqual(Object.fromEntries(p.beats.map((b) => [b.id, b.source])), {
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

// 配置: 一番長い項目名・順位の行の幅で、5軸・6軸とも
const approx = (s, size) =>
  [...s].reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.6 : 1), 0) * size;
const names = [
  "全国勝率",
  "当地勝率",
  "直近30走1着率",
  "モーター2連率",
  "平均ST",
  "今節の着順点",
];
for (const n of [5, 6]) {
  for (let i = 0; i < n; i++) {
    const w = Math.max(approx(`${names[i]} ▼`, 40), approx("6号艇 5〜6位", 36));
    const box = labelBox(i, n, w);
    // 10/15 丸亀10R（6軸）で「直近30走1着率」と枠が x1080 を越えた
    assert.ok(
      frameInSafeArea(box),
      `${n}軸 ${names[i]}: 枠が画面内・右のボタン列の外 ${JSON.stringify(box)}`,
    );
    // 10/19 下関10R で枠が頂点の札「2」を横切った
    for (let j = 0; j < n; j++) {
      const [x, y] = vertex(j, n);
      assert.ok(
        !boxHitsCircle(box, x, y, BADGE_R),
        `${n}軸 ${names[i]}: 枠が頂点${j}の札と重ならない`,
      );
    }
    assert.ok(
      box.y + box.h + FRAME_PAD < CHIP.y,
      `${n}軸 ${names[i]}: 札の列より上`,
    );
  }
}
assert.ok(
  chipX(6) + CHIP.w <= 940,
  "6号艇の札は Shorts の右のボタン列（x960〜）にかからない",
);
assert.ok(bubbleBottom([46, 40]) <= 1420, "2行の吹き出しの下端は y1420 より上");

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
assert.equal(
  tl.total,
  150 + 6 * 135 + 24 + 2 * 150 + 15,
  "尺は変えない（1艇4.5秒、2026-10-20 オーナー決定）",
);
assert.equal(
  scene2Timeline({ radar: { focus: [{}] }, cards: { items: [] } }).beats.at(-1)
    .kind,
  "empty",
);
// 答えを読める時間: 試作は1艇の拍で2.8秒（84フレーム）だった。次の拍で押すまで残して3秒以上にする
for (const w of answerWindows(tl.beats))
  assert.ok(
    w.hold - w.start >= 90,
    `${w.kind}${w.index}: 答えが不透明で出ている時間 ${w.hold - w.start} フレーム`,
  );

console.log("verify-full-picture-scene2: OK");
