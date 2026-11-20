/**
 * verify-full-picture-scene2.js の後半の場面（2/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { templateLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import { checkLines, connectedText } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { scene2Timeline } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";
import {
  labelBox,
  frameInSafeArea,
  vertex,
  boxHitsCircle,
  BADGE_R,
  FRAME_PAD,
  CHIP,
  chipX,
  bubbleBottom,
  bubbleLine,
} from "../../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";
import { has, card, overview, focus3 } from "./full-picture-scene2-a-1.js";

let focus1, scene;
let c, broken;
export let tl;

export const fake = () =>
  `前置き ${JSON.stringify({
    beats: [
      { id: "overview", connector: "一方" },
      { id: "focus-1", connector: "続いて" },
      { id: "focus-3", connector: "かなり" },
      { id: "card-loc_win", connector: null },
    ],
  })}`;

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

function scene1() {
  has(
    checkLines(["全体の71.1%より2.1ポイント高い"], card, null),
    "向きが facts（低い）と逆",
  );
  // 10/19 下関10R の整えた版で、facts に無い主張「6艇で差がつく」が通り、本文の1行目に入った（2026-10-20 オーケストレーター指摘）
  has(
    checkLines(
      ["2位以内の項目が最多は2号艇", "次は1号艇の3、6艇で差がつく"],
      overview,
      null,
    ),
    "facts に無い言い回し「つく」",
  );
  has(
    checkLines(["1号艇は全国勝率8.06で1位、狙い目"], focus1, null),
    "facts に無い言い回し「狙い目」",
  );
  assert.deepEqual(
    checkLines(
      ["2位以内の項目は2号艇が5項目中4", "次点は1号艇の3項目"],
      overview,
      null,
    ),
    [],
    "決まった語の言い換えは通る",
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
  // 差1ポイント未満は向きを言わない（10/15 丸亀10R の整えた版「0.2ポイント高い」。wording-editor 2026-10-20 P1）
  has(
    checkLines(
      ["全体の71.1%より0.2ポイント高い"],
      { ...card, usualDiffPt: 0.2, direction: "高い" },
      null,
    ),
    "差1ポイント未満",
  );
  has(
    checkLines(
      ["全国の72.0%より0.4ポイント低い"],
      { kind: "venue90", diffPt: 0.4, direction: "低い" },
      null,
    ),
    "差1ポイント未満",
  );
  // 「同じく」は段の場面では facts の種類で見る（item の無い段同士で通っていた）
  has(
    checkLines(
      ["同じく1号艇は2連率50.0%"],
      { kind: "place" },
      { kind: "venue90" },
    ),
    "前の拍と材料が違う",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（focus1） */
export function runFullPictureScene2A3(env) {
  ({ focus1 } = env);
  scene1();
}

function scene2() {
  c = connectedText(scene, fake);
  assert.deepEqual(Object.fromEntries(c.beats.map((b) => [b.id, b.source])), {
    overview: "template",
    "focus-1": "connected",
    "focus-3": "template",
    "card-loc_win": "template",
  });
  has(
    c.beats.find((b) => b.id === "overview").reasons,
    "段の最初の拍でつなぐ語「一方」",
  );
  has(
    c.beats.find((b) => b.id === "focus-3").reasons,
    "決まったつなぐ語でない「かなり」",
  );
  assert.deepEqual(
    c.answers["focus-1"],
    [`続いて、${templateLines(focus1)[0]}`, templateLines(focus1)[1]],
    "文型の文は変えずに頭に足すだけ",
  );
  for (const b of c.beats) {
    const tpl =
      scene.radar.focus.find((f) => f.id === b.id)?.lines ??
      (b.id === "overview"
        ? scene.radar.overview.lines
        : scene.cards.items[0].answer);
    assert.deepEqual(
      b.lines.slice(1),
      tpl.slice(1),
      `${b.id}: 2行目は文型のまま`,
    );
    assert.ok(b.lines[0].endsWith(tpl[0]), `${b.id}: 1行目は文型の文で終わる`);
  }
  broken = connectedText(scene, () => {
    throw new Error("接続できない");
  });
  assert.ok(
    broken.beats.every(
      (b) => b.source === "template" && b.reasons[0].includes("接続できない"),
    ),
    "LLM の失敗は全拍をつなぐ語なし（文型の版）にする",
  );
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
  assert.deepEqual(
    [0, 1].map((i) => bubbleLine(i).size),
    [46, 40],
    "既定は1行目が答えの行",
  );
  // 拍の並び
  tl = scene2Timeline({
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
}

function scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（focus1・scene） */
export function runFullPictureScene2A4(env) {
  ({ focus1, scene } = env);
  scene2();
  scene3();
}
