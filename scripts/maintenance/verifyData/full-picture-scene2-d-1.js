/**
 * verify-full-picture-scene2.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { allBeats, templateText, lineWidth, MAX_WIDTH, checkLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { scene2Timeline } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";
import { bubbleFitSize, bubbleLine } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";
import { sumWidth, runFullPictureScene2A11 } from "./full-picture-scene2-a-4.js";
import { runFullPictureScene2A12 } from "./full-picture-scene2-a-5.js";
import { runFullPictureScene2B1 } from "./full-picture-scene2-b-1.js";
import { runFullPictureScene2B2 } from "./full-picture-scene2-b-2.js";
import { runFullPictureScene2B3, runFullPictureScene2B4 } from "./full-picture-scene2-b-3.js";
import { runFullPictureScene2B5 } from "./full-picture-scene2-b-4.js";
import { runFullPictureScene2B6 } from "./full-picture-scene2-b-5.js";
import { runFullPictureScene2B7 } from "./full-picture-scene2-b-6.js";
import { runFullPictureScene2B8 } from "./full-picture-scene2-b-7.js";
import { runFullPictureScene2B9 } from "./full-picture-scene2-b-8.js";
import { runFullPictureScene2B10 } from "./full-picture-scene2-b-9.js";
import { runFullPictureScene2B11 } from "./full-picture-scene2-b-10.js";

let R, answerWindows2, readFrames, stepAnswerWindows, stepTimeline, fullPictureTimeline, buildAll, entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N, validate, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures, losingRows;
let m, realFetch, exRows;
export let realEnv;

// for (const f of …) の中身の 1/3（分ける前と同じ文・順。後へ渡す名前を返す）
const scenesOfFixtureA = (f) => {
  const m = JSON.parse(
    gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"),
  );
  assert.deepEqual(validate(m), [], `${f}: 材料の契約に合う`);
  const scenes = buildAll(m);
  const beats = allBeats(scenes);
  const text = templateText(beats);
  beats.forEach((b, i) => {
    for (const l of b.template)
      assert.ok(
        lineWidth(l) <= MAX_WIDTH,
        `${f} ${b.id}: 1行は全角${MAX_WIDTH}字分以内「${l}」`,
      );
    assert.deepEqual(
      checkLines(b.template, b.facts, null),
      [],
      `${f} ${b.id}: 文型の版が検査を通る`,
    );
    void i;
  });
  // 全場面の答えを毎秒8字で読める（full の拍の並びで）
  for (const x of scenes) {
    if (!x.data) continue;
    if (x.kind === "scene2") {
      const sc = { ...x.data, answers: text.answers };
      for (const w of answerWindows2(scene2Timeline(sc).beats)) {
        const id =
          w.kind === "overview"
            ? sc.radar.overview.id
            : w.kind === "focus"
              ? sc.radar.focus[w.index].id
              : w.kind === "card"
                ? sc.cards.items[w.index].id
                : sc.cards.empty?.id;
        assert.ok(
          w.hold - w.start >= readFrames(text.answers[id]),
          `${f} ${id}: 答えを読める（${sumWidth(text.answers[id]).toFixed(1)}字・${((w.hold - w.start) / 30).toFixed(1)}秒）`,
        );
      }
    } else {
      const sc = { ...x.data, answers: text.answers };
      for (const w of stepAnswerWindows(stepTimeline(sc).beats)) {
        const st = sc.steps[w.index];
        const ls = text.answers[st.id] ?? st.lines;
        assert.ok(
          w.hold - w.start >= readFrames(ls),
          `${f} ${st.id}: 答えを読める（${sumWidth(ls).toFixed(1)}字・${((w.hold - w.start) / 30).toFixed(1)}秒）`,
        );
      }
    }
  }
  // s3-rough: 「全国・」を省かず、範囲と件数を1行目に（2026-10-20 オーナー決定 3。省くと母数が分からない）
  const rough = scenes
    .find((x) => x.id === "scene3")
    .data.steps.find((st) => st.id === "s3-rough");
  return { scenes, text, rough };
};

// for (const f of …) の中身の 2/3（分ける前と同じ文・順。後へ渡す名前を返す）
const scenesOfFixtureB = (f, { scenes, text, rough }) => {
  if (rough) {
    assert.ok(
      rough.lines[0].startsWith("全国・") && /\d件$/.test(rough.lines[0]),
      `${f}: s3-rough の1行目は「全国・…N件」: ${rough.lines[0]}`,
    );
    assert.ok(
      rough.lines[1].startsWith("1着") &&
        rough.lines[1].includes("全国の1号艇"),
      `${f}: s3-rough の2行目は1着率と全国の比較: ${rough.lines[1]}`,
    );
    // 答えの行（1着率）を大きく、範囲の行を小さく（範囲の行が答えより目立っていた。2026-10-20 オーケストレーター段階1）
    assert.equal(rough.lead, 1, `${f}: s3-rough は2行目が答えの行`);
    // 縮めた後の大きさで比べる（長い答えの行は 46px から縮み、範囲の行とほぼ同じ大きさになっていた）
    const [s0, s1] = [0, 1].map((i) =>
      bubbleFitSize(rough.lines[i], i, rough.lead),
    );
    assert.ok(
      s1 / s0 >= 1.25,
      `${f}: 答えの行（${s1}px）が範囲の行（${s0}px）の1.25倍以上（visual-designer 2026-10-20 P2）`,
    );
    assert.ok(
      bubbleLine(1, 1).weight - bubbleLine(0, 1).weight >= 200,
      `${f}: 太さにも差`,
    );
    assert.ok(
      bubbleLine(0, 1).size >= 36,
      "最小の字の大きさ 36px より下げない",
    );
    assert.equal(
      rough.accent,
      "全国",
      `${f}: 比べる基準の「全国」を目印の色で結び付ける`,
    );
    assert.ok(
      rough.lines[1].includes("全国") && !rough.lines[1].includes("全国・"),
      `${f}: 2行目の全国は基準の意味だけ`,
    );
  }
  // s5: 重点でない艇の段は答えなし、まとめの段がある
  const s5 = scenes.find((x) => x.id === "scene5").data;
  const short = s5.steps.filter(
    (s) => /^s5-axis-\d$/.test(s.id) && !s.facts.key,
  );
  assert.ok(
    short.every((s) => s.lines.length === 0),
    `${f}: 重点でない艇の段は答えを出さない`,
  );
  if (short.length)
    assert.ok(
      s5.steps.at(-1).id === "s5-axis-rest" && s5.steps.at(-1).lines.length > 0,
      `${f}: 最後にまとめの1枚`,
    );
  // 入口版 v2（hq 契約 10/24）: 冒頭の数字 →（会場の棒は全国と比べられる日）→ 今日の条件 → 重ね図（艇は3つまで）→ 結論の再掲 → 完全版への案内
  const e = entryScenes(scenes, text.answers, { race: "下関10R（10/19）" });
  assert.ok(
    e.total <= ENTRY_MAX_FRAMES,
    `${f}: 入口版 ${(e.total / 30).toFixed(1)}秒は59秒以内`,
  );
  assert.ok(
    e.total >= 34 * 30 && e.total <= 45 * 30,
    `${f}: 入口版 ${(e.total / 30).toFixed(1)}秒は34〜45秒（hq 契約 v2）`,
  );
  assert.deepEqual(
    e.scenes.map((x) => x.id),
    ["scene1", "scene2", "conclusion"],
    `${f}: 入口版の型`,
  );
  const st1 = e.scenes[0].data.steps;
  return { scenes, text, e, st1 };
};

// for (const f of …) の中身の 3/3（分ける前と同じ文・順）
const scenesOfFixtureC = (f, { scenes, text, e, st1 }) => {
  assert.equal(st1[0].id, "entry-hero", `${f}: 冒頭は数字`);
  assert.equal(st1[0].page.kind, "hero");
  assert.ok(
    e.hero.source === "conclusion"
      ? e.hero.value ===
          `${scenes.find((x) => x.id === "scene4").data.conclusion.facts.pct}%`
      : true,
    `${f}: 冒頭の数字は結論の割合と同じ値`,
  );
  const vf = scenes
    .find((x) => x.id === "scene1")
    .data.steps.find((st) => st.id === "s1-venue90")?.facts;
  assert.equal(
    st1.some((st) => st.id === "s1-venue90"),
    Boolean(vf) && vf.diffPt !== null && !vf.few,
    `${f}: 会場の棒は全国と比べられる日に出す（|z| の線は使わない。2026-11-01）`,
  );
  assert.ok(e.scenes[1].data.radarOnly, `${f}: 入口版の場面2は重ね図だけ`);
  const fb = e.scenes[1].data.radar.focus.map((x) => x.boat);
  assert.ok(
    fb.length <= 3 && fb[0] === 1,
    `${f}: 重ね図の艇は1号艇を含め3つまで（${fb}）`,
  );
  assert.deepEqual(
    e.scenes[2].data.steps.map((s) => s.id),
    ["s4-conclusion", "entry-cta"],
    `${f}: 結論の再掲と案内`,
  );
  assert.deepEqual(e.scenes[2].data.steps[1].page.lines, [
    "チャンネルの完全版へ",
  ]);
  // 最初の画面にレース名と問い、結論は「過去」と書く（今日の結果と読まれない。x-channel・youtube-channel 2026-10-20 P1）
  assert.ok(
    st1[0].question.startsWith("下関10R（10/19）"),
    `${f}: 最初の問いにレース名`,
  );
  const conc = e.scenes[2].data.steps[0];
  assert.equal(conc.question, CONCLUSION_QUESTION);
  assert.ok(
    !/結果/.test(conc.question) && conc.lines[0].includes("過去"),
    `${f}: 結論は過去の集計と分かる`,
  );
  assert.deepEqual(
    checkLines(conc.lines, conc.facts, null),
    [],
    `${f}: 結論の文が検査を通る`,
  );
  assert.ok(
    fullPictureTimeline(scenes, text.answers).total > ENTRY_MAX_FRAMES,
    `${f}: 完全版は削らない（59秒を越えてよい）`,
  );
};

const row = (n, over = {}) => ({
  boat_number: n,
  exhibition_course: n,
  start_timing: 0.1 + n / 100,
  start_flag: null,
  exhibition_time: 6.7,
  tilt: 0,
  parts_changed: null,
  propeller_change: null,
  is_absent: false,
  updated_at: "2026-10-25T06:39:35+00:00",
  ...over,
});

async function scene1() {
  for (const f of fixtures) scenesOfFixtureC(f, scenesOfFixtureB(f, scenesOfFixtureA(f)));
  // ---- 後半の場面（verifyData/full-picture-scene2-a-4.js・full-picture-scene2-a-5.js） ----
  runFullPictureScene2A11({ R, buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures });
  await runFullPictureScene2A12({ R, validate, readFileSync, gunzipSync, FX, fixtures });
  // 展示の後（stage=exhibition）の材料: 進入・展示 ST・チルト・部品交換・展示タイム・風と波・決まり手の過去の分布を足す。
  // 欠けは null で出し、missing に記録する（Supabase は偽物。2026-10-25 hq 依頼、優勝戦・準優の投稿の材料）
  m = JSON.parse(
    gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
  );
  realFetch = globalThis.fetch;
  realEnv = {
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_ANON_KEY,
  };
  process.env.VITE_SUPABASE_URL = "https://sb.invalid";
  process.env.VITE_SUPABASE_ANON_KEY = "x";
  // 1号艇は F 表記・部品交換、2号艇はプロペラ交換、3・4号艇は進入が入れ替わり、5号艇はチルトが欠け、6号艇は行が無い
  // 5号艇は進入と体重も欠ける（選手のコース別の成績は枠番で引く）
  exRows = [
    row(1, {
      start_flag: "F",
      start_timing: 0.01,
      parts_changed: ["リング", "ピストン"],
      today_weight: 52.3,
    }),
    row(2, { propeller_change: "新", today_weight: 50 }),
    row(3, { exhibition_course: 4, today_weight: 51 }),
    row(4, { exhibition_course: 3, today_weight: 53 }),
    row(5, { tilt: null, exhibition_course: null, today_weight: null }),
  ];
  // ---- 後半の場面（verifyData/full-picture-scene2-b-1.js・full-picture-scene2-b-2.js・full-picture-scene2-b-3.js） ----
  await runFullPictureScene2B1({ m });
  runFullPictureScene2B2();
  runFullPictureScene2B3({ m });
}

/** verify から呼ぶ入口。env は verify 側の束縛（R・answerWindows2・readFrames・stepAnswerWindows・stepTimeline・fullPictureTimeline・buildAll・entryScenes・ENTRY_MAX_FRAMES・CONCLUSION_QUESTION・HERO_MIN_N・validate・MATERIALS_SCHEMA・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2D1(env) {
  ({ R, answerWindows2, readFrames, stepAnswerWindows, stepTimeline, fullPictureTimeline, buildAll, entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N, validate, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene1();
}

async function scene2() {
  // ---- 後半の場面（verifyData/full-picture-scene2-b-3.js・full-picture-scene2-b-4.js・full-picture-scene2-b-5.js・full-picture-scene2-b-6.js・full-picture-scene2-b-7.js・full-picture-scene2-b-8.js・full-picture-scene2-b-9.js・full-picture-scene2-b-10.js・full-picture-scene2-b-11.js・full-picture-scene2-b-12.js・full-picture-scene2-b-13.js） ----
  runFullPictureScene2B4({ m, losingRows });
  await runFullPictureScene2B5({ R, validate, m, realFetch, exRows });
  runFullPictureScene2B6();
  await runFullPictureScene2B7({ R, m });
  runFullPictureScene2B8({ MATERIALS_SCHEMA, validate, m });
  await runFullPictureScene2B9({ validate });
  runFullPictureScene2B10({ m });
  await runFullPictureScene2B11({ validate, m });
}

/** verify から呼ぶ入口。env は verify 側の束縛（R・answerWindows2・readFrames・stepAnswerWindows・stepTimeline・fullPictureTimeline・buildAll・entryScenes・ENTRY_MAX_FRAMES・CONCLUSION_QUESTION・HERO_MIN_N・validate・MATERIALS_SCHEMA・readFileSync・gunzipSync・FX・fixtures・losingRows） */
export async function runFullPictureScene2D2(env) {
  ({ R, answerWindows2, readFrames, stepAnswerWindows, stepTimeline, fullPictureTimeline, buildAll, entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N, validate, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures, losingRows } = env);
  await scene2();
}
