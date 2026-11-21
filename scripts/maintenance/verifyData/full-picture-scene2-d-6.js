/**
 * verify-full-picture-scene2.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { runFullPictureScene2C2 } from "./full-picture-scene2-c-1.js";
import {
  runFullPictureScene2C3,
  runFullPictureScene2C4,
  runFullPictureScene2C5,
  runFullPictureScene2C6,
  runFullPictureScene2C7,
  runFullPictureScene2C8,
  runFullPictureScene2C9,
} from "./full-picture-scene2-c-2.js";
import { runFullPictureScene2C10, runFullPictureScene2C11 } from "./full-picture-scene2-c-3.js";
import { runFullPictureScene2C12 } from "./full-picture-scene2-c-4.js";
import { runFullPictureScene2C13 } from "./full-picture-scene2-c-5.js";
import { runFullPictureScene2C14 } from "./full-picture-scene2-c-6.js";
import { answerOf, scopeLabel, buildBundle, tri } from "./full-picture-scene2-d-5.js";

let scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex;
let j, r2, r3, lt;

async function scene1() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-1.js・full-picture-scene2-c-2.js） ----
  await runFullPictureScene2C2({ R, answerOf, scopeLabel, buildBundle, tri });
  runFullPictureScene2C3({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2D14(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene1();
}

function scene2() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
  runFullPictureScene2C4({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile） */
export function runFullPictureScene2D15(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile } = env);
  scene2();
}

function scene3() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
  runFullPictureScene2C5({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey） */
export function runFullPictureScene2D16(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey } = env);
  scene3();
}

function scene4() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
  runFullPictureScene2C6({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily） */
export function runFullPictureScene2D17(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily } = env);
  scene4();
}

function scene5() {
  wf2(
    specFile,
    JSON.stringify({
      id: "e07-voice-character",
      attributes: { hook: "キャラ声" },
    }),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile） */
export function runFullPictureScene2D18(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile } = env);
  scene5();
}

function scene6() {
  assert.equal(r.status, 1);
  j = JSON.parse(r.stdout);
  assert.equal(j.stage, "type-spec");
  assert.deepEqual(j.reasons, [
    "type_unsupported:hook（型 e07-voice-character は龍神の表に無い）",
  ]);
  assert.deepEqual(j.content_type, { id: "e07-voice-character" });
  r2 = runDaily(daily, [
    "2026-10-19-19-10",
    "--out",
    "/tmp/x",
    "--bgm",
    envFile,
    "--type-spec",
    "/nonexistent.json",
  ]);
  assert.equal(r2.status, 2, "型の json が無ければ使い方の誤り");
  // 型の表を外に出す（hq の pdca_daily.py は載る型だけを割り当てる。system-architect P1-2）
  r3 = runDaily(daily, ["--list-types"]);
  assert.equal(r3.status, 0);
  lt = JSON.parse(r3.stdout);
  assert.deepEqual(
    lt.types.map((x) => x.id),
    ["v2r1-answer-fill-explain", "f01-landscape-voice-full"],
    "型の表は関門を通った型だけ",
  );
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
  runFullPictureScene2C7({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile・r） */
export function runFullPictureScene2D19(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r } = env);
  scene6();
}

async function scene7() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
  await runFullPictureScene2C8({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile・r） */
export async function runFullPictureScene2D20(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r } = env);
  await scene7();
}

async function scene8() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-2.js・full-picture-scene2-c-3.js） ----
  await runFullPictureScene2C9({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, sp, ex });
  runFullPictureScene2C10({ buildAll });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile・r・sp・ex） */
export async function runFullPictureScene2D21(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex } = env);
  await scene8();
}

async function scene9() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-3.js・full-picture-scene2-c-4.js） ----
  runFullPictureScene2C11({ buildAll });
  await runFullPictureScene2C12();
  // 終了画面（オーナー 11/2「最後がバグっぽい」）: 締めの声・字幕が終わってから出す（字幕と重ならない）、終了画面では章の札を出さない、
  // YouTube Data API では終了画面の要素を設定できないので置き場の点線の枠を描かない
  {
    const { f01Timeline } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const cl = [
      "まだ押していない軸がある。",
      "もし4号艇を軸にしたら、相手はどう変わるか。",
      "思考アシストで、残りの軸もこのレースのまま押せる。",
      "ページは、説明欄の一番上に。",
    ];
    const vc = {
      lines: cl.map((sub, i) => ({
        chapter: "close",
        i,
        sub,
        file: `e${i}.wav`,
        sec: 3,
      })),
    };
    const shotsC = {
      close: {
        file: "/x/close.png",
        clip: { x: 0, y: 0, w: 400, h: 150 },
        scale: 2.8,
        minFontPx: 29.8,
      },
    };
    const { props } = f01Timeline(
      {
        chapters: [
          { id: "close", name: "締め", tag: "思考アシスト ＞ 相手", subs: cl },
        ],
      },
      vc,
      shotsC,
    );
    const close = props.chapters.find((c) => c.id === "close");
    const lastSub = Math.max(...props.subs.map((x) => x.to));
    assert.ok(
      props.end.from >= lastSub,
      `終了画面（${props.end.from}）は最後の字幕の終わり（${lastSub}）より後`,
    );
    assert.equal(
      close.tagUntil,
      props.end.from - close.from,
      "終了画面から章の札を出さない",
    );
    assert.equal(
      props.total - props.end.from,
      5 * 30,
      "終了画面は5秒（オーナー 11/2「短くして」、YouTube の終了画面の要素の最短）",
    );
    // 章: 最後の章も10秒以上のときだけ残す（短ければ前の章に含める）。尺の検査（chaptersOk）と同じ条件
    const { f01Chapters } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const { chaptersOk } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/bundle.mjs");
    const marksA = [
      { name: "冒頭", at: 0 },
      { name: "6艇の差", at: 30 },
      { name: "相手", at: 100 },
      { name: "締め", at: 130 },
    ];
    assert.equal(
      f01Chapters(marksA, 138),
      "0:00 冒頭\n0:30 6艇の差\n1:40 相手\n",
      "8秒の締めは前の章に含める",
    );
    assert.equal(
      f01Chapters(marksA, 145),
      "0:00 冒頭\n0:30 6艇の差\n1:40 相手\n2:10 締め\n",
    );
    for (const tot of [138, 145])
      assert.ok(
        chaptersOk(f01Chapters(marksA, tot), tot),
        `章が自動チャプターの条件を満たす（${tot}秒）`,
      );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile・r・sp・ex） */
export async function runFullPictureScene2D22(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex } = env);
  await scene9();
}

async function scene10() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-5.js・full-picture-scene2-c-6.js） ----
  await runFullPictureScene2C13();
  await runFullPictureScene2C14({ R, readFileSync, gunzipSync, FX, fixtures });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・R・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・specFile・r・sp・ex） */
export async function runFullPictureScene2D23(env) {
  ({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex } = env);
  await scene10();
}
