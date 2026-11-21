/**
 * verify-full-picture-scene2.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { connectedText } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { fake } from "./full-picture-scene2-a-2.js";
import {
  runFullPictureScene2A17,
  runFullPictureScene2A18,
  runFullPictureScene2A19,
} from "./full-picture-scene2-a-9.js";
import { runFullPictureScene2A14 } from "./full-picture-scene2-a-7.js";
import { runFullPictureScene2A15, runFullPictureScene2A16 } from "./full-picture-scene2-a-8.js";
import { runFullPictureScene2A20 } from "./full-picture-scene2-a-10.js";
import { childEnv, readAnonEnv } from "./full-picture-scene2-c-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, sp, ex;
let env, REQUIRED_SOURCES, llmUsage, withUsage, fileSeconds, withF01Fields;
export let F01_LONG_NAMES;

export const f01Fixture = (name, names = F01_LONG_NAMES) => {
  const mf = JSON.parse(
    gunzipSync(readFileSync(new URL(`${name}.json.gz`, FX))).toString("utf8"),
  );
  return withF01Fields(mf, names);
};

function scene1() {
  // 鍵の分け方: 子のプロセス（run-full と claude）に service key・Webhook を渡さない。claude の認証は残す
  // 通す名前を並べる方式（DATABASE_URL のような名前も渡らない）
  env = childEnv({
    PATH: "/bin",
    HOME: "/h",
    SUPABASE_SERVICE_KEY: "s",
    VITE_SUPABASE_ANON_KEY: "a",
    SLACK_WEBHOOK_URL: "w",
    LINEAR_API_KEY: "l",
    DATABASE_URL: "d",
    CLAUDE_CODE_OAUTH_TOKEN: "c",
    ANTHROPIC_API_KEY: "k",
    NODE_OPTIONS: "n",
    INTERNAL_API_KEY: "i",
  });
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "HOME",
      "NODE_OPTIONS",
      "PATH",
    ],
    "子のプロセスに /api の合言葉も渡さない（BOA-1110）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures） */
export function runFullPictureScene2C3(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures } = env);
  scene1();
}

function scene2() {
  wf2(
    envFile,
    'SUPABASE_SERVICE_KEY=secret\nVITE_SUPABASE_URL="https://x.supabase.co"\nVITE_SUPABASE_ANON_KEY=anon\nSLACK_WEBHOOK_URL=w\n',
  );
  assert.deepEqual(readAnonEnv(envFile), {
    VITE_SUPABASE_URL: "https://x.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon",
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile） */
export function runFullPictureScene2C4(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile } = env);
  scene2();
}

function scene3() {
  wf2(
    envFileKey,
    "SUPABASE_SERVICE_KEY=secret\nVITE_SUPABASE_URL=u\nVITE_SUPABASE_ANON_KEY=anon\nINTERNAL_API_KEY=k1\n",
  );
  assert.deepEqual(readAnonEnv(envFileKey), {
    VITE_SUPABASE_URL: "u",
    VITE_SUPABASE_ANON_KEY: "anon",
    INTERNAL_API_KEY: "k1",
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey） */
export function runFullPictureScene2C5(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey } = env);
  scene3();
}

function scene4() {
  for (const args of [
    ["--select", "--date", "2026/10/19", "--plan-only"],
    ["--select", "--date", "2026-10-19"],
    ["2026-10-19-19-10"],
    ["bad-id", "--out", "/tmp/x", "--bgm", "/tmp/x.mp3"],
    ["2026-10-19-19-10", "--out", "/tmp/x", "--bgm", envFile, "--variant", "c"],
  ]) {
    const r = runDaily(daily, args);
    assert.equal(r.status, 2, `使い方の誤りは exit 2: ${args.join(" ")}`);
    assert.equal(JSON.parse(r.stdout).status, "usage");
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily） */
export function runFullPictureScene2C6(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily } = env);
  scene4();
}

function scene5() {
  // 送信の鍵と一緒に起動されたら止める（--env-file=.env.local で起動した等）
  {
    const r = runDaily(
      daily,
      ["--select", "--date", "2026-10-19", "--plan-only"],
      { ...cleanEnv, SUPABASE_SERVICE_KEY: "s" },
    );
    assert.equal(r.status, 2, "送信の鍵があれば exit 2");
    assert.match(JSON.parse(r.stdout).reasons[0], /送信の鍵/);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily） */
export function runFullPictureScene2C7(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily } = env);
  scene5();
}

async function scene6() {
  // 予期しない例外でも標準出力に JSON 1つ（止まった段を残す）
  {
    const r = runDaily(daily, [
      "2026-10-19-19-10",
      "--out",
      "/dev/null/x",
      "--bgm",
      envFile,
    ]);
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.status, "stopped");
    assert.equal(j.stage, "materials");
    assert.ok(j.reasons.length > 0);
  }
  // 欠けたら止める材料（「全国」の値・場面3・6が黙って変わらないように）
  ({ REQUIRED_SOURCES } = await import(
    `${R}/scripts/full-picture/daily.mjs`
  ));
  for (const src of ["outcome.7", "races", "db.motor", "scenarioNA", "facts"])
    assert.ok(REQUIRED_SOURCES.test(src), `${src} が欠けたら止める`);
  assert.ok(
    !REQUIRED_SOURCES.test("db.racer1"),
    "1号艇の選手の成績は欠けても省いて続ける（選手が無い日がある）",
  );
  // LLM の usage を残す（claudeCli は { text, usage } を返す）
  ({ llmUsage } = await import(
    `${R}/scripts/full-picture/scene2-text.mjs`
  ));
  withUsage = connectedText(scene, () => ({
    text: fake(),
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 1000,
      output_tokens: 50,
    },
  }));
  assert.deepEqual(withUsage.llm, {
    calls: 1,
    tokens_in: 1110,
    tokens_out: 50,
  });
  assert.deepEqual(
    connectedText(scene, fake).llm,
    { calls: 1, tokens_in: null, tokens_out: null },
    "usage の無い返り値はトークン不明",
  );
  assert.deepEqual(llmUsage(null), {
    calls: 1,
    tokens_in: null,
    tokens_out: null,
  });
  // LLM が失敗した文の JSON は印を付け、使い回さない
  assert.ok(
    connectedText(scene, () => {
      throw new Error("x");
    }).llmError,
    "LLM の失敗に印",
  );
  assert.equal(connectedText(scene, fake).llmError, undefined);
  // ---- 後半の場面（verifyData/full-picture-scene2-a-7.js・full-picture-scene2-a-8.js） ----
  await runFullPictureScene2A14({ R, buildAll, readFileSync, gunzipSync, FX, fixtures });
  await runFullPictureScene2A15({ R, buildAll, readFileSync, gunzipSync, FX });
  // daily.mjs の video.full_s は送る MP4 の実際の尺（型 f01 で run-text.json の縦の型の尺 204〜228秒を書かない）
  ({ fileSeconds } = await import(`${R}/scripts/full-picture/daily.mjs`));
  assert.equal(
    fileSeconds("x.mp4", () => "612.3456\n"),
    612.3,
    "ffprobe の尺を小数1桁で",
  );
  assert.throws(() => fileSeconds("x.mp4", () => "N/A\n"), /尺を測れない/);
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily） */
export async function runFullPictureScene2C8(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily } = env);
  await scene6();
}

async function scene7() {
  if (sp("ffmpeg", ["-version"]).status === 0) {
    const { mkdtempSync: mt } = await import("node:fs");
    const { tmpdir: td2 } = await import("node:os");
    const f = `${mt(`${td2()}/fp-sec-`)}/t.mp4`;
    ex("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=2.5:r=10",
      "-pix_fmt",
      "yuv420p",
      "-y",
      f,
    ]);
    assert.ok(Math.abs(fileSeconds(f) - 2.5) <= 0.1, "実ファイルの尺");
  }
  // ---- 後半の場面（verifyData/full-picture-scene2-a-8.js・full-picture-scene2-a-9.js） ----
  runFullPictureScene2A16({ R, buildAll, readFileSync, gunzipSync, FX });
  runFullPictureScene2A17({ buildAll, readFileSync, gunzipSync, FX });
  // 型 f01 の写しの材料は build が読んだ所だけで、出走表の名前は1艇目だけ・級は無い（make-fixture.mjs が落とす）。
  // 名前と級・日目・締切の埋め方は f01-fixture.mjs（verify-sns-makers.js と共用、ADR-0105）
  ({ F01_LONG_NAMES, withF01Fields } = await import("../../../sns-video-studio/remotion/scripts/full-picture/f01-fixture.mjs"));
  // ---- 後半の場面（verifyData/full-picture-scene2-a-9.js） ----
  runFullPictureScene2A18({ buildAll, readFileSync, gunzipSync, FX });
  // ---- 後半の場面（verifyData/full-picture-scene2-a-9.js・full-picture-scene2-a-10.js） ----
  await runFullPictureScene2A19({ buildAll, readFileSync, gunzipSync, FX, f01Fixture });
  await runFullPictureScene2A20({ R, readFileSync, gunzipSync, FX, fixtures, f01Fixture });
}

/** verify から呼ぶ入口。env は verify 側の束縛（scene・buildAll・readFileSync・gunzipSync・FX・fixtures・wf2・envFile・envFileKey・daily・cleanEnv・runDaily・sp・ex） */
export async function runFullPictureScene2C9(env) {
  ({ scene, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, sp, ex } = env);
  await scene7();
}
