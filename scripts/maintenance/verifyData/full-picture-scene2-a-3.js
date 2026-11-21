/**
 * verify-full-picture-scene2.js の後半の場面（3/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { answerWindows, scene2Timeline } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";
import { frameInSafeArea, FRAME_PAD } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";
import { tl } from "./full-picture-scene2-a-2.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows;
let barsRow, statsRow, tableColsBox, tableRowBox, tableRowH, slitFormBox, axisButtonBox, followerRow, deepBox, BUTTON, sankeyLayout, sankeyNodeBox, sonarChipBox, triRowsBox, stepTimes, boxes, st, CARD, cardBarFrame, cardPairBox, slitFormOn, SLIT_FORM_ON_AT, buildScene8, tlLong, stLong, wa, tlRadar, s8Lines;
export let summaryLayout, statsBarRow, statsBarBox, STATS_BAR, restLines, s8, s8Lay;

const links = [
  [0, 1, 2, 300],
  [0, 1, 3, 100],
  [0, 2, 1, 50],
  [0, 6, 1, 1],
  [1, 2, 3, 200],
  [1, 3, 2, 151],
  [1, 1, 4, 99],
  [1, 1, 6, 1],
];

// 答えを読む時間: 長い答えの拍は伸びる（押す拍3.1秒で30〜44字だった）
const longLines = [
  "1号艇は平均ST（直近30走）0.12秒で1位",
  "2番手は2号艇の同じ0.12秒、ほか1項目も1位",
];

async function scene1() {
  // 答えを読める時間: 試作は1艇の拍で2.8秒（84フレーム）だった。次の拍で押すまで残して3秒以上にする
  for (const w of answerWindows(tl.beats))
    assert.ok(
      w.hold - w.start >= 90,
      `${w.kind}${w.index}: 答えが不透明で出ている時間 ${w.hold - w.start} フレーム`,
    );
  // 段の場面（場面1・2b・3〜8）の枠の箱: 画面内・右のボタン列の外・吹き出し（y1252〜）より上
  ({
    barsRow,
    statsRow,
    tableColsBox,
    tableRowBox,
    tableRowH,
    slitFormBox,
    axisButtonBox,
    followerRow,
    deepBox,
    BUTTON,
  } = await import("../../../sns-video-studio/remotion/src/fullPicture/pageLayout.js"));
  ({ sankeyLayout, sankeyNodeBox, sonarChipBox, triRowsBox } = await import("../../../sns-video-studio/remotion/src/fullPicture/sonarLayout.js"));
  ({ stepTimes } = await import("../../../sns-video-studio/remotion/src/fullPicture/stepTimeline.js"));
  boxes = [
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
  for (const node of sankeyLayout(links, 451).nodes.filter((x) => x.col < 2))
    boxes.push(sankeyNodeBox(node));
  for (const b of boxes) {
    assert.ok(
      frameInSafeArea(b),
      `段の場面の枠が画面内・右のボタン列の外: ${JSON.stringify(b)}`,
    );
    assert.ok(
      b.y + b.h + FRAME_PAD <= 1252,
      `段の場面の枠が吹き出しより上: ${JSON.stringify(b)}`,
    );
  }
  // 段の拍: 押す段は押す→変わる→0.5秒→枠→答え、枠を順に移す段は枠の数だけ伸びる、同時の枠は1拍
  st = stepTimes({ press: { x: 1, y: 1 }, frames: [{}, {}] }, false);
  assert.ok(
    st.press < st.changed &&
      st.changed + 15 === st.frames[0] &&
      st.frames[1] > st.frames[0] &&
      st.answer > st.frames[1],
    "段の拍の順",
  );
  assert.equal(
    stepTimes({ frames: [{}, {}], framesTogether: true }, true).frames[1],
    stepTimes({ frames: [{}, {}], framesTogether: true }, true).frames[0],
    "同時の枠",
  );
  assert.equal(
    stepTimes({ frames: [{}], samePage: true, len: 66 }, false).len,
    66,
    "短い段",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export async function runFullPictureScene2A5() {
  await scene1();
}

async function scene2() {
  ({ CARD, cardBarFrame, cardPairBox } = await import(
    `${R}/src/fullPicture/scene2Layout.js`
  ));
  ({
    slitFormOn,
    SLIT_FORM_ON_AT,
    summaryLayout,
    statsBarRow,
    statsBarBox,
    STATS_BAR,
  } = await import(`${R}/src/fullPicture/pageLayout.js`));
}

/** verify から呼ぶ入口。env は verify 側の束縛（answerWindows2・readFrames・READ_CPS・BEAT・stepTimeline・stepAnswerWindows） */
export async function runFullPictureScene2A6(env) {
  ({ answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows } = env);
  await scene2();
}

async function scene3() {
  ({ restLines } = await import(
    `${R}/scripts/full-picture/scenes/scene5.mjs`
  ));
  ({ buildScene8 } = await import(
    `${R}/scripts/full-picture/scenes/scene8.mjs`
  ));
}

/** verify から呼ぶ入口。env は verify 側の束縛（answerWindows2・readFrames・READ_CPS・BEAT・stepTimeline・stepAnswerWindows） */
export async function runFullPictureScene2A7(env) {
  ({ answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows } = env);
  await scene3();
}

function scene4() {
  tlLong = scene2Timeline({
    radar: {
      overview: { id: "o", lines: ["a"] },
      focus: [
        { id: "f1", lines: longLines },
        { id: "f2", lines: ["b"] },
      ],
    },
    cards: { items: [] },
  });
  for (const w of answerWindows2(tlLong.beats).filter((x) => x.kind === "focus"))
    assert.ok(
      w.hold - w.start >= (w.index === 0 ? readFrames(longLines) : 0),
      `場面2の長い答えを毎秒${READ_CPS}字で読める`,
    );
  stLong = stepTimeline({
    steps: [
      { id: "a", lines: longLines, press: { x: 1, y: 1 }, frames: [{}] },
      { id: "b", lines: ["c"], frames: [{}] },
    ],
  });
  wa = stepAnswerWindows(stLong.beats)[0];
  assert.ok(
    wa.hold - wa.start >= readFrames(longLines),
    "段の場面の長い答えを毎秒8字で読める",
  );
  // 入口版（重ね図だけ）はカードの頁へ送らない
  tlRadar = scene2Timeline({
    radarOnly: true,
    radar: { overview: { id: "o", lines: ["a"] }, focus: [{}, {}] },
    cards: { items: [{}, {}] },
  });
  assert.deepEqual(
    tlRadar.beats.map((b) => b.kind),
    ["overview", "focus", "focus"],
    "入口版の場面2は重ね図だけ",
  );
  assert.ok(
    answerWindows2(tlRadar.beats).at(-1).hold ===
      tlRadar.beats.at(-1).from + tlRadar.beats.at(-1).len,
    "入口版の最後の艇の答えは場面の終わりまで",
  );
  // 場面2のカードは x40〜960（6位の枠が Shorts の右のボタン列にかかっていた）
  assert.ok(CARD.left + CARD.width <= 960, "カードは x960 まで");
  for (let i = 0; i < 6; i++)
    for (const pct of [0, 0.3, 1]) {
      const b = cardBarFrame(i, pct, 1);
      assert.ok(
        frameInSafeArea(b),
        `カードの棒${i + 1}（${pct}）の枠が右のボタン列の外 ${JSON.stringify(b)}`,
      );
    }
  for (const i of [0, 1])
    assert.ok(
      cardPairBox(i).x + cardPairBox(i).w <= CARD.left + CARD.width - 30,
      "上の2つの箱はカードの内側",
    );
  // s4-slit: 形の札は押す前・数字が出る前に選ばれて見えない（答えの先出し）。枠と同時に選ぶ
  assert.equal(slitFormOn(true, -20), false, "押す前は選ばない");
  assert.equal(
    slitFormOn(true, SLIT_FORM_ON_AT - 1),
    false,
    "数字が出てから0.5秒までは選ばない",
  );
  assert.equal(slitFormOn(true, SLIT_FORM_ON_AT), true, "枠と同時に選ぶ");
  assert.equal(slitFormOn(false, 999), false);
  assert.equal(SLIT_FORM_ON_AT, BEAT.pause, "枠と同じ時刻");
  // s8: まとめカードの CTA まで y1420 より上（Shorts の下の帯 y1450〜 に隠れていた）
  s8 = buildScene8({ api: {} }).steps[0].page;
  // 締めの行数で数える（2行の締めの下端 1430 を1行ぶんの計算で見逃していた。visual-designer 2026-10-24 P2）
  s8Lines = [s8.footer].flat().filter(Boolean).length;
  assert.equal(s8Lines, 2, "前提: 場面8 の締めは2行");
  s8Lay = summaryLayout(s8.groups, s8Lines);
  assert.ok(
    s8Lay.footerBottom <= 1420,
    `まとめカードの CTA の下端 ${s8Lay.footerBottom}`,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（answerWindows2・readFrames・READ_CPS・BEAT・stepTimeline・stepAnswerWindows） */
export function runFullPictureScene2A8(env) {
  ({ answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows } = env);
  scene4();
}
