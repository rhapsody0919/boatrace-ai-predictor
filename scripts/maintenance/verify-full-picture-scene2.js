/**
 * 全貌動画（Remotion）の文・配置・拍の並び・材料の契約を確かめる（外部接続なし、LLM は偽物）。
 * - 文型の版（templateLines）が facts から決まった文を作り、1行は全角22字分以内で、その文が検査（checkLines）を通る
 * - 検査が facts に無い数値・艇番・材料名・順位、禁止表現（risk-rules.json が正本）、ぼかし語、幅、段の最初のつなぐ語、
 *   差1ポイント未満の向きを落とす
 * - つないだ版（connectedText）: LLM はつなぐ語を選ぶだけで文型の文は変わらない。落ちた拍・LLM の失敗はつなぐ語なし
 * - 配置（scene2Layout・pageLayout）: 枠・カード・まとめカードが画面内・右のボタン列の外・下の帯より上
 * - 拍の並び（scene2Timeline・stepTimeline）: 答えを毎秒8字で読める長さ
 * - 固定の材料（scripts/full-picture/fixtures、4レースの最小の写し）: 材料の契約（materials.schema.json）に合う、
 *   取得（fetch-materials.mjs）の出力も合う、全場面の文が検査を通り読める、入口版が59秒以内
 */
import assert from "node:assert/strict";
import { templateLines } from "../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import {
  MAX_WIDTH,
  allBeats,
  bannedIn,
  checkLines,
  connectedText,
  lineWidth,
  templateText,
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
// 10/19 下関10R の整えた版で、facts に無い主張「6艇で差がつく」が通り、本文の1行目に入った（2026-10-20 オーケストレーター指摘）
has(checkLines(["2位以内の項目が最多は2号艇", "次は1号艇の3、6艇で差がつく"], overview, null), "facts に無い言い回し「つく」");
has(checkLines(["1号艇は全国勝率8.06で1位、狙い目"], focus1, null), "facts に無い言い回し「狙い目」");
assert.deepEqual(checkLines(["2位以内の項目は2号艇が5項目中4", "次点は1号艇の3項目"], overview, null), [], "決まった語の言い換えは通る");
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

// 差1ポイント未満は向きを言わない（10/15 丸亀10R の整えた版「0.2ポイント高い」。wording-editor 2026-10-20 P1）
has(checkLines(["全体の71.1%より0.2ポイント高い"], { ...card, usualDiffPt: 0.2, direction: "高い" }, null), "差1ポイント未満");
has(checkLines(["全国の72.0%より0.4ポイント低い"], { kind: "venue90", diffPt: 0.4, direction: "低い" }, null), "差1ポイント未満");
// 「同じく」は段の場面では facts の種類で見る（item の無い段同士で通っていた）
has(checkLines(["同じく1号艇は2連率50.0%"], { kind: "place" }, { kind: "venue90" }), "前の拍と材料が違う");

// つないだ版（2026-10-20 オーナー決定: LLM はつなぐ語だけ。比べる文は文型で固定）
const scene = {
  radar: {
    overview: { id: "overview", facts: overview, lines: templateLines(overview) },
    focus: [
      { id: "focus-1", boat: 1, facts: focus1, lines: templateLines(focus1) },
      { id: "focus-3", boat: 3, facts: focus3, lines: templateLines(focus3) },
    ],
  },
  cards: { items: [{ id: "card-loc_win", facts: card, answer: templateLines(card) }], empty: null },
};
const fake = () =>
  `前置き ${JSON.stringify({
    beats: [
      { id: "overview", connector: "一方" },
      { id: "focus-1", connector: "続いて" },
      { id: "focus-3", connector: "かなり" },
      { id: "card-loc_win", connector: null },
    ],
  })}`;
const c = connectedText(scene, fake);
assert.deepEqual(Object.fromEntries(c.beats.map((b) => [b.id, b.source])), {
  overview: "template",
  "focus-1": "connected",
  "focus-3": "template",
  "card-loc_win": "template",
});
has(c.beats.find((b) => b.id === "overview").reasons, "段の最初の拍でつなぐ語「一方」");
has(c.beats.find((b) => b.id === "focus-3").reasons, "決まったつなぐ語でない「かなり」");
assert.deepEqual(c.answers["focus-1"], [`続いて、${templateLines(focus1)[0]}`, templateLines(focus1)[1]], "文型の文は変えずに頭に足すだけ");
for (const b of c.beats) {
  const tpl = scene.radar.focus.find((f) => f.id === b.id)?.lines ?? (b.id === "overview" ? scene.radar.overview.lines : scene.cards.items[0].answer);
  assert.deepEqual(b.lines.slice(1), tpl.slice(1), `${b.id}: 2行目は文型のまま`);
  assert.ok(b.lines[0].endsWith(tpl[0]), `${b.id}: 1行目は文型の文で終わる`);
}
const broken = connectedText(scene, () => {
  throw new Error("接続できない");
});
assert.ok(
  broken.beats.every((b) => b.source === "template" && b.reasons[0].includes("接続できない")),
  "LLM の失敗は全拍をつなぐ語なし（文型の版）にする",
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
  "答えが短ければ決まった長さ（1艇4.5秒、2026-10-20 オーナー決定）",
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

// 段の場面（場面1・2b・3〜8）の枠の箱: 画面内・右のボタン列の外・吹き出し（y1252〜）より上
const {
  barsRow, statsRow, tableColsBox, tableRowBox, tableRowH, slitFormBox, axisButtonBox, followerRow, deepBox, BUTTON,
} = await import("../../sns-video-studio/remotion/src/fullPicture/pageLayout.js");
const { sankeyLayout, sankeyNodeBox, sonarChipBox, triRowsBox } = await import("../../sns-video-studio/remotion/src/fullPicture/sonarLayout.js");
const { stepTimes } = await import("../../sns-video-studio/remotion/src/fullPicture/stepTimeline.js");
const boxes = [
  ...[0, 1, 2, 3, 4, 5].map(barsRow),
  ...[0, 1, 2].map(statsRow),
  tableColsBox([1, 2, 3], 3),
  tableColsBox([1], 2),
  tableColsBox([2], 2),
  ...[0, 1, 2, 3, 4, 5].map((i) => tableRowBox(i)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => tableRowBox(i, tableRowH(8))),
  ...[0, 1, 2, 3, 4, 5, 6].map(slitFormBox),
  ...[0, 1, 2, 3, 4].map(followerRow),
  ...[1, 2, 3, 4, 5, 6].map(axisButtonBox),
  ...[1, 2, 3, 4, 5, 6].map(sonarChipBox),
  triRowsBox(3),
  deepBox(1),
  BUTTON,
];
const links = [[0, 1, 2, 300], [0, 1, 3, 100], [0, 2, 1, 50], [0, 6, 1, 1], [1, 2, 3, 200], [1, 3, 2, 151], [1, 1, 4, 99], [1, 1, 6, 1]];
for (const node of sankeyLayout(links, 451).nodes.filter((x) => x.col < 2)) boxes.push(sankeyNodeBox(node));
for (const b of boxes) {
  assert.ok(frameInSafeArea(b), `段の場面の枠が画面内・右のボタン列の外: ${JSON.stringify(b)}`);
  assert.ok(b.y + b.h + FRAME_PAD <= 1252, `段の場面の枠が吹き出しより上: ${JSON.stringify(b)}`);
}
// 段の拍: 押す段は押す→変わる→0.5秒→枠→答え、枠を順に移す段は枠の数だけ伸びる、同時の枠は1拍
const st = stepTimes({ press: { x: 1, y: 1 }, frames: [{}, {}] }, false);
assert.ok(st.press < st.changed && st.changed + 15 === st.frames[0] && st.frames[1] > st.frames[0] && st.answer > st.frames[1], "段の拍の順");
assert.equal(stepTimes({ frames: [{}, {}], framesTogether: true }, true).frames[1], stepTimes({ frames: [{}, {}], framesTogether: true }, true).frames[0], "同時の枠");
assert.equal(stepTimes({ frames: [{}], samePage: true, len: 66 }, false).len, 66, "短い段");

// ---- 2026-10-20 全場面のレビュー（visual-designer P1・wording-editor P1）の再現テスト ----
const R = "../../sns-video-studio/remotion";
const { BEAT, readFrames, READ_CPS, answerWindows: answerWindows2 } = await import(`${R}/src/fullPicture/scene2Timeline.js`);
const { stepTimeline, stepAnswerWindows } = await import(`${R}/src/fullPicture/stepTimeline.js`);
const { fullPictureTimeline } = await import(`${R}/src/fullPicture/fullPictureTimeline.js`);
const { CARD, cardBarFrame, cardPairBox } = await import(`${R}/src/fullPicture/scene2Layout.js`);
const { slitFormOn, SLIT_FORM_ON_AT, summaryLayout, statsBarRow, statsBarBox, STATS_BAR } = await import(`${R}/src/fullPicture/pageLayout.js`);
const { buildAll } = await import(`${R}/scripts/full-picture/build-all.mjs`);
const { entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION } = await import(`${R}/scripts/full-picture/entry.mjs`);
const { restLines } = await import(`${R}/scripts/full-picture/scenes/scene5.mjs`);
const { buildScene8 } = await import(`${R}/scripts/full-picture/scenes/scene8.mjs`);
const { MATERIALS_SCHEMA, validate } = await import(`${R}/scripts/full-picture/materials-contract.mjs`);
const { readFileSync, readdirSync } = await import("node:fs");
const { gunzipSync } = await import("node:zlib");

// 答えを読む時間: 長い答えの拍は伸びる（押す拍3.1秒で30〜44字だった）
const longLines = ["1号艇は平均ST（直近30走）0.12秒で1位", "2番手は2号艇の同じ0.12秒、ほか1項目も1位"];
const tlLong = scene2Timeline({ radar: { overview: { id: "o", lines: ["a"] }, focus: [{ id: "f1", lines: longLines }, { id: "f2", lines: ["b"] }] }, cards: { items: [] } });
for (const w of answerWindows2(tlLong.beats).filter((x) => x.kind === "focus"))
  assert.ok(w.hold - w.start >= (w.index === 0 ? readFrames(longLines) : 0), `場面2の長い答えを毎秒${READ_CPS}字で読める`);
const stLong = stepTimeline({ steps: [{ id: "a", lines: longLines, press: { x: 1, y: 1 }, frames: [{}] }, { id: "b", lines: ["c"], frames: [{}] }] });
const wa = stepAnswerWindows(stLong.beats)[0];
assert.ok(wa.hold - wa.start >= readFrames(longLines), "段の場面の長い答えを毎秒8字で読める");
// 入口版（重ね図だけ）はカードの頁へ送らない
const tlRadar = scene2Timeline({ radarOnly: true, radar: { overview: { id: "o", lines: ["a"] }, focus: [{}, {}] }, cards: { items: [{}, {}] } });
assert.deepEqual(tlRadar.beats.map((b) => b.kind), ["overview", "focus", "focus"], "入口版の場面2は重ね図だけ");
assert.ok(answerWindows2(tlRadar.beats).at(-1).hold === tlRadar.beats.at(-1).from + tlRadar.beats.at(-1).len, "入口版の最後の艇の答えは場面の終わりまで");

// 場面2のカードは x40〜960（6位の枠が Shorts の右のボタン列にかかっていた）
assert.ok(CARD.left + CARD.width <= 960, "カードは x960 まで");
for (let i = 0; i < 6; i++)
  for (const pct of [0, 0.3, 1]) {
    const b = cardBarFrame(i, pct, 1);
    assert.ok(frameInSafeArea(b), `カードの棒${i + 1}（${pct}）の枠が右のボタン列の外 ${JSON.stringify(b)}`);
  }
for (const i of [0, 1]) assert.ok(cardPairBox(i).x + cardPairBox(i).w <= CARD.left + CARD.width - 30, "上の2つの箱はカードの内側");

// s4-slit: 形の札は押す前・数字が出る前に選ばれて見えない（答えの先出し）。枠と同時に選ぶ
assert.equal(slitFormOn(true, -20), false, "押す前は選ばない");
assert.equal(slitFormOn(true, SLIT_FORM_ON_AT - 1), false, "数字が出てから0.5秒までは選ばない");
assert.equal(slitFormOn(true, SLIT_FORM_ON_AT), true, "枠と同時に選ぶ");
assert.equal(slitFormOn(false, 999), false);
assert.equal(SLIT_FORM_ON_AT, BEAT.pause, "枠と同じ時刻");

// s8: まとめカードの CTA まで y1420 より上（Shorts の下の帯 y1450〜 に隠れていた）
const s8 = buildScene8({ api: {} }).steps[0].page;
assert.ok(summaryLayout(s8.groups).footerBottom <= 1420, `まとめカードの CTA の下端 ${summaryLayout(s8.groups).footerBottom}`);

// s3-rough: 棒は欄の幅いっぱい、値は棒の上、全国の値は棒の下（「全国 55.2%」が棒に重なっていた）
const row = statsBarRow(0);
const bar = statsBarBox(0);
assert.ok(row.y + 20 + 36 * 1.3 + 72 * 1.2 <= bar.y, "値の行は棒より上");
assert.ok(row.y + STATS_BAR.markLabelTop >= bar.y + bar.h + 12, "全国の値は棒（目印の線を含む）より下");
assert.ok(row.y + STATS_BAR.markLabelTop + 36 * 1.3 <= row.y + row.h, "全国の値は欄の中");
assert.ok(bar.w >= 800, "棒は大きく");
assert.ok(frameInSafeArea(row) && row.y + row.h + FRAME_PAD <= 1252, "枠が画面内・吹き出しより上");

// s5: 重点でない艇は答えを出さず、最後に1枚にまとめる（拍2.2秒で答え0.8秒だった）
assert.deepEqual(restLines([{ axis: 3, second: 1 }, { axis: 4, second: 1 }, { axis: 5, second: 1 }, { axis: 6, second: 1 }]), ["3・4・5・6号艇が1着なら2着は1号艇"]);
assert.deepEqual(restLines([{ axis: 3, second: 1 }, { axis: 4, second: 2 }, { axis: 5, second: 1 }]), ["3・5号艇が1着なら2着は1号艇", "4号艇が1着なら2着は2号艇"]);
assert.deepEqual(restLines([{ axis: 2, second: 1 }, { axis: 4, second: 2 }, { axis: 5, second: 3 }]), ["1着→2着の最多（号艇）", "2→1・4→2・5→3"]);

// ---- 固定の材料（4レースの最小の写し）----
const { MATERIALS_VERSION } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`);
assert.equal(MATERIALS_SCHEMA.properties.schemaVersion.const, MATERIALS_VERSION, "Schema の版と取得の版が同じ（形を変えたら両方上げる）");
assert.equal(MATERIALS_SCHEMA.$id, MATERIALS_VERSION);
const FX = new URL(`${R}/scripts/full-picture/fixtures/`, import.meta.url);
const fixtures = readdirSync(FX).filter((f) => f.endsWith(".json.gz")).sort();
assert.ok(fixtures.length >= 3, "固定の材料は3レース以上");
const sumWidth = (ls) => (ls ?? []).reduce((w, l) => w + lineWidth(l), 0);
for (const f of fixtures) {
  const m = JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));
  assert.deepEqual(validate(m), [], `${f}: 材料の契約に合う`);
  const scenes = buildAll(m);
  const beats = allBeats(scenes);
  const text = templateText(beats);
  beats.forEach((b, i) => {
    for (const l of b.template) assert.ok(lineWidth(l) <= MAX_WIDTH, `${f} ${b.id}: 1行は全角${MAX_WIDTH}字分以内「${l}」`);
    assert.deepEqual(checkLines(b.template, b.facts, null), [], `${f} ${b.id}: 文型の版が検査を通る`);
    void i;
  });
  // 全場面の答えを毎秒8字で読める（full の拍の並びで）
  for (const x of scenes) {
    if (!x.data) continue;
    if (x.kind === "scene2") {
      const sc = { ...x.data, answers: text.answers };
      for (const w of answerWindows2(scene2Timeline(sc).beats)) {
        const id = w.kind === "overview" ? sc.radar.overview.id : w.kind === "focus" ? sc.radar.focus[w.index].id : w.kind === "card" ? sc.cards.items[w.index].id : sc.cards.empty?.id;
        assert.ok(w.hold - w.start >= readFrames(text.answers[id]), `${f} ${id}: 答えを読める（${sumWidth(text.answers[id]).toFixed(1)}字・${((w.hold - w.start) / 30).toFixed(1)}秒）`);
      }
    } else {
      const sc = { ...x.data, answers: text.answers };
      for (const w of stepAnswerWindows(stepTimeline(sc).beats)) {
        const st = sc.steps[w.index];
        const ls = text.answers[st.id] ?? st.lines;
        assert.ok(w.hold - w.start >= readFrames(ls), `${f} ${st.id}: 答えを読める（${sumWidth(ls).toFixed(1)}字・${((w.hold - w.start) / 30).toFixed(1)}秒）`);
      }
    }
  }
  // s3-rough: 「全国・」を省かず、範囲と件数を1行目に（2026-10-21 オーナー決定 3。省くと母数が分からない）
  const rough = scenes.find((x) => x.id === "scene3").data.steps.find((st) => st.id === "s3-rough");
  if (rough) {
    assert.ok(rough.lines[0].startsWith("全国・") && /\d件$/.test(rough.lines[0]), `${f}: s3-rough の1行目は「全国・…N件」: ${rough.lines[0]}`);
    assert.ok(rough.lines[1].startsWith("1着"), `${f}: s3-rough の2行目は1着率と全国の比較: ${rough.lines[1]}`);
  }
  // s5: 重点でない艇の段は答えなし、まとめの段がある
  const s5 = scenes.find((x) => x.id === "scene5").data;
  const short = s5.steps.filter((s) => /^s5-axis-\d$/.test(s.id) && !s.facts.key);
  assert.ok(short.every((s) => s.lines.length === 0), `${f}: 重点でない艇の段は答えを出さない`);
  if (short.length) assert.ok(s5.steps.at(-1).id === "s5-axis-rest" && s5.steps.at(-1).lines.length > 0, `${f}: 最後にまとめの1枚`);
  // 入口版: 条件（会場＋今日の条件）＋6艇の重ね図＋結論1拍で59秒以内
  const e = entryScenes(scenes, text.answers, { race: "下関10R（10/19）" });
  assert.ok(e.total <= ENTRY_MAX_FRAMES, `${f}: 入口版 ${(e.total / 30).toFixed(1)}秒は59秒以内`);
  assert.deepEqual(e.scenes.map((x) => x.id), ["scene1", "scene2", "conclusion"], `${f}: 入口版の型`);
  assert.equal(e.scenes[0].data.steps[0].id, "s1-venue90", `${f}: 条件の1つ目は会場の1着率`);
  assert.ok(e.scenes[1].data.radarOnly, `${f}: 入口版の場面2は重ね図だけ`);
  assert.deepEqual(e.scenes[2].data.steps.map((s) => s.id), ["s4-conclusion"], `${f}: 結論は1拍`);
  // 最初の画面にレース名と問い、結論は「過去」と書く（今日の結果と読まれない。x-channel・youtube-channel 2026-10-20 P1）
  assert.ok(e.scenes[0].data.steps[0].question.startsWith("下関10R（10/19）"), `${f}: 最初の問いにレース名`);
  const conc = e.scenes[2].data.steps[0];
  assert.equal(conc.question, CONCLUSION_QUESTION);
  assert.ok(!/結果/.test(conc.question) && conc.lines[0].includes("過去"), `${f}: 結論は過去の集計と分かる`);
  assert.deepEqual(checkLines(conc.lines, conc.facts, null), [], `${f}: 結論の文が検査を通る`);
  assert.ok(fullPictureTimeline(scenes, text.answers).total > ENTRY_MAX_FRAMES, `${f}: 完全版は削らない（59秒を越えてよい）`);
}
// 入口版は59秒を越えたら条件の2つ目を外し、それでも越えたら止める
{
  const m = JSON.parse(gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"));
  const scenes = buildAll(m);
  // どの答えも2行いっぱい（全角44字分）でも、入口版は59秒以内に収まるか、止まる（越えた MP4 を作らない）
  const ids = [...allBeats(scenes).map((b) => b.id), "s4-conclusion"];
  const long = Object.fromEntries(ids.map((id) => [id, ["あ".repeat(22), "い".repeat(22)]]));
  let worst = null;
  try {
    worst = entryScenes(scenes, long);
  } catch (err) {
    assert.match(String(err), /59秒を越える/);
  }
  if (worst) assert.ok(worst.total <= ENTRY_MAX_FRAMES, `最長の答えでも入口版は59秒以内（${(worst.total / 30).toFixed(1)}秒）`);
  // 重ね図の艇が多くて越えるなら、条件の2つ目を外し、それでも越えれば止める
  const s2 = scenes.find((x) => x.id === "scene2");
  const many = scenes.map((x) => (x === s2 ? { ...x, data: { ...x.data, radar: { ...x.data.radar, focus: [...x.data.radar.focus, ...x.data.radar.focus] } } } : x));
  assert.throws(() => entryScenes(many, long), /59秒を越える/, "どうしても越えるなら止める（投稿しない）");
}
// 契約: 形が変わったら落ちる
{
  const m = JSON.parse(gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"));
  has(validate({ ...m, schemaVersion: "full-picture-materials/0" }), "full-picture-materials/1");
  has(validate({ ...m, api: { ...m.api, facts: { ...m.api.facts, today: undefined } } }), "today");
  has(validate({ ...m, api: { ...m.api, races: [{ raceId: "x", raceNumber: "10", entries: [] }] } }), "型が integer でない");
  has(validate({ ...m, db: { motor: null } }), "racer1 が無い");
}
// 取得（fetch-materials.mjs）の出力も契約に合う（API・Supabase は偽物。固定の材料を返す）
{
  const m = JSON.parse(gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"));
  const keys = m.api.facts.today.scope_keys["1"];
  const scopeOf = { [keys.NC]: "scenarioNC", [keys.NCR]: "scenarioNCR", [keys.NA]: "scenarioNA", [keys.VA]: "scenarioVA" };
  const realFetch = globalThis.fetch;
  process.env.VITE_SUPABASE_URL = "https://sb.invalid";
  process.env.VITE_SUPABASE_ANON_KEY = "x";
  const json = (v) => ({ ok: true, status: 200, json: async () => v });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === "sb.invalid") {
      const table = u.pathname.split("/").pop();
      const map = { race_entries: m.db.racer1?.entries ?? [], races: m.db.racer1?.races ?? [], race_results: m.db.racer1?.results ?? [], race_start_timings: m.db.racer1?.st ?? [], motor_pretest_stats: m.db.motor?.pretest ?? [], venue_motor_stats: m.db.motor?.stats ?? [], exhibition_data: m.db.motor?.exhibition ?? [] };
      return json(map[table] ?? []);
    }
    const p = u.pathname;
    if (p.startsWith("/api/analogy/facts/")) return json(m.api.facts);
    if (p.startsWith("/api/analogy/similar/")) return json(m.api.similar);
    if (p.startsWith("/api/analogy/scenario/")) return json(m.api[scopeOf[u.searchParams.get("scope")] ?? "scenario"]);
    if (p.startsWith("/api/predictions/")) return json({ races: m.api.races });
    if (p === "/api/outcome-distribution") return json(m.api.outcome[u.searchParams.get("venue_code")]);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const { fetchMaterials } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`);
    const got = await fetchMaterials(m.raceId);
    assert.deepEqual(validate(got), [], "取得の出力が材料の契約に合う");
    assert.equal(got.schemaVersion, MATERIALS_VERSION);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- 代わりの審査・/code-review（2026-10-20）の再現テスト ----
{
  const { checkAnswers, checkPost } = await import(`${R}/scripts/full-picture/scene2-text.mjs`);
  const { NO_DATA } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`);
  const load = (f) => JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));
  const raceOf = (m) => m.api.races.find((r) => r.raceId === m.raceId);
  // 各レースの段の並び（正解の写し）。build の退行で段が消えたら落ちる
  const GOLDEN = {
    "2026-10-12-01-12": "scene1:venue90,place,day,wind scene2:6/4 scene2b:sonar,flow,flow-1,tri scene3:rough,venue,return scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-15-15-10": "scene1:venue90,place,day,wind scene2:6/2 scene2b:sonar,flow,flow-1,tri scene3:rough,venue,return scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-4,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-16-24-11": "scene1:venue90,place,day,wind scene2:6/5 scene2b:sonar,flow,flow-1,tri scene3:rough,return scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-19-19-10": "scene1:venue90,place,day,wind scene2:6/2 scene2b:sonar,flow,flow-1,tri scene3:rough,venue,return scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
  };
  const shape = (scenes) => scenes.map((x) => (x.kind === "scene2" ? `${x.id}:${x.data.radar.focus.length}/${x.data.cards.items.length}` : `${x.id}:${x.data.steps.map((st) => st.id.replace(/^s\d+b?-/, "")).join(",")}`)).join(" ");
  for (const f of fixtures) assert.equal(shape(buildAll(load(f))), GOLDEN[f.replace(".json.gz", "")], `${f}: 段の並びが正解の写しと同じ`);

  const m0 = load(fixtures.at(-1));
  const allText = (scenes) => Object.values(templateText(allBeats(scenes)).answers).flat().join("\n");
  // F1: モーターの2連率・機番が無いと「null%」「null号機」が出た
  {
    const m = structuredClone(m0);
    for (const e of raceOf(m).entries) e.motor2Rate = null;
    const sc = buildAll(m);
    assert.ok(!/null/.test(allText(sc)), "2連率が無くても文に null が出ない");
    assert.ok(sc.find((x) => x.id === "scene6").data.omitted.some((o) => o.reason.includes("2連率")), "2連率の無い鍵の艇は omitted に記録");
  }
  // F4: 今節の展示タイムが全艇無いと落ちた
  {
    const m = structuredClone(m0);
    m.db.motor.exhibition = [];
    const sc = buildAll(m);
    assert.ok(!sc.find((x) => x.id === "scene6").data.steps.some((st) => st.id === "s6-exhibit"), "展示タイムが無ければ段を省く");
  }
  // F8: 類似レースの着順が無いと落ちた
  {
    const m = structuredClone(m0);
    for (const n of m.api.similar.similar.neighbors) n.finish = null;
    const sc = buildAll(m);
    assert.ok(sc.find((x) => x.id === "scene2b").data.omitted.some((o) => o.where === "scene2b.flow"), "着順が無ければ着順の流れを省く");
  }
  // F3: facts が null（契約は許す）だと allBeats が落ちた。材料の無い応答は null にする
  {
    const m = structuredClone(m0);
    m.api.facts = null;
    assert.deepEqual(validate(m), [], "facts が null の材料も契約に合う");
    assert.doesNotThrow(() => allBeats(buildAll(m)), "facts が null でも文を作れる");
    assert.deepEqual(NO_DATA, ["not_saved", "absent", "empty_layer"]);
  }
  // F12: 深掘りの集計が無いと「全体0.0%」と出た
  assert.ok(!/全体0\.0%/.test(allText(buildAll(m0))), "比べる値の無い深掘りで全体0.0%と書かない");
  // F2: 毎日の実行で文と本文を検査して止める（幅・禁止表現・欠けた値）
  has(checkAnswers({ a: ["4号艇の59号機は2連率null%で1位"] }), "欠けた値");
  has(checkAnswers({ a: ["あ".repeat(23)] }), "幅");
  has(checkAnswers({ a: ["競艇の1号艇"] }), "禁止表現");
  has(checkPost("下関10R\n1着率NaN%"), "欠けた値");
  assert.deepEqual(checkAnswers(templateText(allBeats(buildAll(m0))).answers), [], "固定の材料の文は通る");
  // 1位が3艇で並ぶ艇の文が全角31字分になった（fitFirst のどの候補も入らない）
  assert.deepEqual(
    templateLines({ ...focus3, item: "平均ST（直近30走）", value: "0.13秒", rank: "4〜6位", compare: { role: "1位", boats: [2, 3, 5].map((b) => ({ boat: b, value: "0.11秒", sameDisplay: false })) } }).every((l) => lineWidth(l) <= MAX_WIDTH),
    true,
    "1位が3艇で並んでも1行に入る",
  );
  // F6: 文の JSON は同じ文型のときだけ使い回す（つないだ版の1行の答えを別物と見て、LLM を呼び直していた）
  const { sameAsTemplate } = await import(`${R}/scripts/full-picture/scene2-text.mjs`);
  assert.ok(sameAsTemplate(["続いて、3・4号艇が1着なら2着は1号艇"], ["3・4号艇が1着なら2着は1号艇"]), "つなぐ語つきの1行の答えは同じ文型");
  assert.ok(sameAsTemplate(["続いて、a", "b"], ["a", "b"]));
  assert.ok(!sameAsTemplate(["a", "c"], ["a", "b"]), "2行目が違えば別の文");
  assert.ok(!sameAsTemplate(["x"], ["a", "b"]), "行の数が違えば別の文");
  // F10: 「逆に」は前の拍と向きが逆のときだけ
  has(checkLines(["逆に、1号艇は2連率50.0%"], { kind: "place", direction: "高い" }, { kind: "venue90", direction: "高い" }), "「逆に」だが");
  assert.deepEqual(checkLines(["逆に、全国の72.0%より6.1ポイント低い"], { kind: "place", direction: "低い", diffPt: 6.1 }, { kind: "venue90", direction: "高い" }).filter((w) => w.includes("逆に")), []);
  // F7: 入口版は59秒を越えたら条件の2つ目を外す（外して収まる長さを作る）
  {
    const scenes = buildAll(m0);
    const ans = templateText(allBeats(scenes)).answers;
    // 重ね図の艇の拍を足して、条件2つでは越え、1つなら収まる並びを作る
    const s2 = scenes.find((x) => x.id === "scene2");
    const one = s2.data.radar.focus[0];
    let hit = null;
    for (let k = 1; k <= 12 && !hit; k++) {
      const more = scenes.map((x) => (x === s2 ? { ...x, data: { ...x.data, radar: { ...x.data.radar, focus: [...x.data.radar.focus, ...Array.from({ length: k }, () => one)] } } } : x));
      try {
        const e = entryScenes(more, ans);
        if (e.omitted.some((o) => o.where === "entry.scene1")) hit = e;
      } catch {
        break;
      }
    }
    assert.ok(hit, "条件の2つ目を外す経路を通った");
    assert.equal(hit.scenes[0].data.steps.length, 1, "条件の2つ目を外した");
    assert.ok(hit.total <= ENTRY_MAX_FRAMES, "外して59秒以内");
  }
}

// ---- 送信の道に渡す bundle（2026-10-21 オーケストレーターの分担 a・b・c、送信レーンとの Shorts の契約 bundle_version 2）----
{
  const { buildBundle, checkBundle, chaptersOk, FULL_URL_SLOT, BUNDLE_VERSION } = await import(`${R}/scripts/full-picture/bundle.mjs`);
  const { checkFullPicture } = await import("../sns/push-full-picture.js");
  const riskRules = JSON.parse(readFileSync(new URL(`${R}/risk-rules.json`, import.meta.url), "utf8")).rules;
  assert.ok(riskRules.length > 0, "禁止表現の規則を読めた");
  const load = (f) => JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));
  const VENUE = { "01": "桐生", 15: "丸亀", 24: "大村", 19: "下関" };
  const qaAll = { contract: true, text: true, post: true, entry_max59s: true, full_size: true, shorts_vertical: true, shorts_max_60s: true, shorts_size: true, full_min185s: true, chapters: true };
  const CH = "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開";
  const bundleOf = (f, qa = qaAll) => {
    const m = load(f);
    const [, mo, da, vc, rn] = m.raceId.split("-");
    const scenes = buildAll(m);
    const ans = templateText(allBeats(scenes)).answers;
    const e = entryScenes(scenes, ans, { race: `${VENUE[vc]}${Number(rn)}R（${Number(mo)}/${Number(da)}）` });
    const facts = {
      venue90: scenes.find((x) => x.id === "scene1").data.steps.find((st) => st.id === "s1-venue90")?.facts ?? null,
      overview: scenes.find((x) => x.id === "scene2").data.radar.overview.facts,
      conclusion: scenes.find((x) => x.id === "scene4").data.conclusion?.facts ?? null,
    };
    return buildBundle({ raceId: m.raceId, venue: VENUE[vc], raceNo: Number(rn), month: Number(mo), day: Number(da), facts, entryFirstQuestion: e.scenes[0].data.steps[0].question, chapters: CH, fullSeconds: 211, qa });
  };
  for (const f of fixtures) {
    const b = bundleOf(f);
    assert.deepEqual(checkBundle(b), [], `${f}: bundle の形`);
    // 送信の道の受け取りの検査をそのまま通る（評価役の P0 は hq が足す。ここでは 0 を入れて確かめる）
    assert.deepEqual(checkFullPicture({ ...b, review: { p0_count: 0 } }, riskRules), [], `${f}: push-full-picture の検査を通る`);
    assert.equal(b.bundle_version, BUNDLE_VERSION);
    assert.equal(b.youtube_shorts.description.split(FULL_URL_SLOT).length - 1, 1, `${f}: Shorts の説明文に完全版の URL の置き場所が1つ`);
    assert.notEqual(b.youtube_full.title, b.youtube_shorts.title, `${f}: 完全版と Shorts の題名は別の文`);
    assert.ok(b.youtube_full.description.includes("結果を保証するものではありません"), `${f}: 説明文に免責`);
    assert.ok(/^0:00 /m.test(b.youtube_full.description), `${f}: 説明文に章（0:00 から）`);
    for (const txt of [b.x_text, b.youtube_full.title, b.youtube_full.description, b.youtube_shorts.title, b.youtube_shorts.description]) {
      assert.deepEqual(bannedIn(txt), [], `${f}: 禁止表現が無い`);
      assert.ok(!/null|undefined|NaN/.test(txt), `${f}: 欠けた値が無い`);
      assert.ok(!/ほぼ|多い|少ない/.test(txt), `${f}: ぼかし語が無い`);
    }
    // wording-editor P1: 会場の1着率に期間と件数。P2: 結論に条件と「N件中」。X にも免責
    assert.match(b.x_text, /過去90日の[\d,]+レースで/, `${f}: 会場の1着率に期間と件数`);
    assert.match(b.x_text, /スタートの形が.+だった過去[\d,]+件中、1着最多は/, `${f}: 結論に条件と N件中`);
    assert.ok(b.x_text.includes("結果を保証するものではありません"), `${f}: X にも免責`);
    // youtube-channel P2: 題名・説明文の1行目に「ボートレース」とその日の向き、章の名前は実際の章から
    assert.match(b.youtube_full.title, /^【.+ボートレース】1号艇は堅い？ /, `${f}: 完全版の題名`);
    assert.ok(b.youtube_full.description.startsWith("ボートレース "), `${f}: 説明文の1行目`);
    assert.ok(b.youtube_full.description.includes("条件・6艇比較・類似レース・展開の順に見る動画です。"), `${f}: 章の名前から作った順`);
    assert.ok(b.youtube_shorts.description.includes("完全版の動画（約3分半）"), `${f}: 完全版の長さ`);
  }
  const b0 = bundleOf(fixtures[0]);
  has(checkBundle({ ...b0, youtube_shorts: { ...b0.youtube_shorts, title: b0.youtube_full.title } }), "題名が同じ");
  has(checkBundle({ ...b0, youtube_shorts: { ...b0.youtube_shorts, description: "x" } }), "ちょうど1つ無い");
  has(checkBundle({ ...b0, youtube_shorts: { ...b0.youtube_shorts, description: `${FULL_URL_SLOT} ${FULL_URL_SLOT}` } }), "ちょうど1つ無い");
  has(checkBundle({ ...b0, x_text: "URL なし" }), "URL がちょうど1つ無い");
  has(checkBundle(bundleOf(fixtures[0], { ...qaAll, full_size: false })), "機械の検査");
  has(checkBundle(bundleOf(fixtures[0], { ...qaAll, full_min185s: false })), "機械の検査");
  // 自動チャプターの条件: 0:00 から・3つ以上・各章10秒以上（実ファイルの尺で）
  assert.equal(chaptersOk(CH, 211), true);
  assert.equal(chaptersOk(CH, 110), false, "最後の章が10秒未満");
  assert.equal(chaptersOk("0:00 条件\n0:22 6艇比較", 211), false, "章が3つ未満");
  assert.equal(chaptersOk("0:05 条件\n0:22 6艇比較\n1:07 類似レース", 211), false, "0:00 から始まらない");

  // run-full: 省略禁止の場面4の材料が無い・材料が契約に合わないときは終了コード1で止める（文だけの実行で確かめる）
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync: wf } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(`${tmpdir()}/fp-`);
  const runFull = (m) => {
    wf(`${tmp}/m.json`, JSON.stringify(m));
    try {
      execFileSync(process.execPath, [new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url).pathname, `${tmp}/m.json`, `${tmp}/out`, "--text", "template", "--no-video"], { stdio: "pipe" });
      return 0;
    } catch (err) {
      return err.status;
    }
  };
  const mOk = load(fixtures[0]);
  assert.equal(runFull(mOk), 0, "固定の材料なら文だけの実行は通る");
  assert.equal(runFull({ ...mOk, api: { ...mOk.api, scenario: null } }), 1, "場面4の材料が無ければ止める");
  assert.equal(runFull({ ...mOk, schemaVersion: "full-picture-materials/0" }), 1, "契約に合わなければ止める");
}

console.log("verify-full-picture-scene2: OK");
