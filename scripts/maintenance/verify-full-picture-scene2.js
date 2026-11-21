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
 * - 取得の stage=exhibition: 展示の後の材料（db.exhibition）を足し、欠けは null で出して missing に記録する。racecard の出力は変えない。
 *   艇ごとの選手の進入コースの成績（決まり手・期のコース別・進入の分布）と体重、会場のコース別の決まり手も写し、レースの日より後の集計を記録する
 */
import assert from "node:assert/strict";

import { VOICE } from "../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";



import { templateLines } from "../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";



import {
  overview,
  focus3,
  card,
  runFullPictureScene2A1,
  runFullPictureScene2A2,
} from "./verifyData/full-picture-scene2-a-1.js";
import { runFullPictureScene2A3, runFullPictureScene2A4 } from "./verifyData/full-picture-scene2-a-2.js";
import { runFullPictureScene2A9, runFullPictureScene2A10 } from "./verifyData/full-picture-scene2-a-4.js";

import {
  runFullPictureScene2A5,
  runFullPictureScene2A6,
  runFullPictureScene2A7,
  runFullPictureScene2A8,
} from "./verifyData/full-picture-scene2-a-3.js";
























import { runFullPictureScene2D1, runFullPictureScene2D2 } from "./verifyData/full-picture-scene2-d-1.js";
import { runFullPictureScene2D3, runFullPictureScene2D4 } from "./verifyData/full-picture-scene2-d-2.js";
import { runFullPictureScene2D5 } from "./verifyData/full-picture-scene2-d-3.js";
import {
  runFullPictureScene2D6,
  runFullPictureScene2D7,
  runFullPictureScene2D8,
} from "./verifyData/full-picture-scene2-d-4.js";
import {
  runFullPictureScene2D9,
  runFullPictureScene2D10,
  runFullPictureScene2D11,
  runFullPictureScene2D12,
  runFullPictureScene2D13,
} from "./verifyData/full-picture-scene2-d-5.js";
import {
  runFullPictureScene2D14,
  runFullPictureScene2D15,
  runFullPictureScene2D16,
  runFullPictureScene2D17,
  runFullPictureScene2D18,
  runFullPictureScene2D19,
  runFullPictureScene2D20,
  runFullPictureScene2D21,
  runFullPictureScene2D22,
  runFullPictureScene2D23,
} from "./verifyData/full-picture-scene2-d-6.js";

// ---- 後半の場面（verifyData/full-picture-scene2-a-1.js） ----
runFullPictureScene2A1();
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

// ---- 後半の場面（verifyData/full-picture-scene2-a-1.js・full-picture-scene2-a-2.js） ----
runFullPictureScene2A2({ focus1 });
runFullPictureScene2A3({ focus1 });

// つないだ版（2026-10-20 オーナー決定: LLM はつなぐ語だけ。比べる文は文型で固定）
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

// ---- 後半の場面（verifyData/full-picture-scene2-a-2.js・full-picture-scene2-a-3.js） ----
runFullPictureScene2A4({ focus1, scene });
await runFullPictureScene2A5();

// ---- 2026-10-20 全場面のレビュー（visual-designer P1・wording-editor P1）の再現テスト ----
const R = "../../sns-video-studio/remotion";
const {
  BEAT,
  readFrames,
  READ_CPS,
  answerWindows: answerWindows2,
} = await import(`${R}/src/fullPicture/scene2Timeline.js`);
const { stepTimeline, stepAnswerWindows } = await import(
  `${R}/src/fullPicture/stepTimeline.js`
);
const { fullPictureTimeline } = await import(
  `${R}/src/fullPicture/fullPictureTimeline.js`
);

// ---- 後半の場面（verifyData/full-picture-scene2-a-3.js） ----
await runFullPictureScene2A6({ R, answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows });
const { buildAll } = await import(`${R}/scripts/full-picture/build-all.mjs`);
const { entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N } =
  await import(`${R}/scripts/full-picture/entry.mjs`);

// ---- 後半の場面（verifyData/full-picture-scene2-a-3.js） ----
await runFullPictureScene2A7({ R, answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows });
const { MATERIALS_SCHEMA, validate } = await import(
  `${R}/scripts/full-picture/materials-contract.mjs`
);
const { readFileSync, readdirSync } = await import("node:fs");
const { gunzipSync } = await import("node:zlib");

// ---- 後半の場面（verifyData/full-picture-scene2-a-3.js・full-picture-scene2-a-4.js） ----
runFullPictureScene2A8({ R, answerWindows2, readFrames, READ_CPS, BEAT, stepTimeline, stepAnswerWindows });
await runFullPictureScene2A9({ R, buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync });
const FX = new URL(`${R}/scripts/full-picture/fixtures/`, import.meta.url);
const fixtures = readdirSync(FX)
  .filter((f) => f.endsWith(".json.gz"))
  .sort();

// ---- 後半の場面（verifyData/full-picture-scene2-a-4.js） ----
runFullPictureScene2A10({ R, buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures });

// ---- 後半の場面（verifyData/full-picture-scene2-d-1.js） ----
await runFullPictureScene2D1({ R, answerWindows2, readFrames, stepAnswerWindows, stepTimeline, fullPictureTimeline, buildAll, entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N, validate, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures });
const losingRows = [
  {
    boat_number: 1,
    losing_technique: "差し",
    count_90days: 30,
    total_losses_90days: 80,
    percentage: 37.5,
    last_updated: "2026-10-25",
  },
  {
    boat_number: 1,
    losing_technique: "まくり",
    count_90days: 20,
    total_losses_90days: 80,
    percentage: 25,
    last_updated: "2026-10-25",
  },
  {
    boat_number: 2,
    losing_technique: "逃げ",
    count_90days: 50,
    total_losses_90days: 300,
    percentage: 16.67,
    last_updated: "2026-10-25",
  },
];

// ---- 後半の場面（verifyData/full-picture-scene2-d-1.js・full-picture-scene2-d-2.js） ----
await runFullPictureScene2D2({ R, answerWindows2, readFrames, stepAnswerWindows, stepTimeline, fullPictureTimeline, buildAll, entryScenes, ENTRY_MAX_FRAMES, CONCLUSION_QUESTION, HERO_MIN_N, validate, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures, losingRows });
await runFullPictureScene2D3({ R, buildAll, entryScenes, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, validate, readFileSync, gunzipSync, FX, fixtures });
const riskRules = JSON.parse(
  readFileSync(new URL(`${R}/risk-rules.json`, import.meta.url), "utf8"),
).rules;

// ---- 後半の場面（verifyData/full-picture-scene2-d-2.js） ----
await runFullPictureScene2D4({ R, buildAll, entryScenes, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, validate, readFileSync, gunzipSync, FX, fixtures, riskRules });
{
  const runner = readFileSync(
    new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url),
    "utf8",
  );
  assert.match(runner, /seriesDayText: m\.race\?\.seriesDayText/);
  assert.match(runner, /raceTitle: m\.race\?\.raceTitle/);
}

// ---- 後半の場面（verifyData/full-picture-scene2-d-3.js・full-picture-scene2-d-4.js） ----
runFullPictureScene2D5({ buildAll, entryScenes, fixtures, riskRules });
runFullPictureScene2D6({ R, readFileSync, fixtures });

// run-full: 省略禁止の場面4の材料が無い・材料が契約に合わないときは終了コード1で止める（文だけの実行で確かめる）
const { execFileSync } = await import("node:child_process");
const { mkdtempSync: mkdtempSyncB439, writeFileSync: wf } = await import("node:fs");
const { tmpdir: tmpdirB439 } = await import("node:os");
const tmpB439 = mkdtempSyncB439(`${tmpdirB439()}/fp-`);
const runFull = (m) => {
  wf(`${tmpB439}/m.json`, JSON.stringify(m));
  try {
    execFileSync(
      process.execPath,
      [
        new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url)
          .pathname,
        `${tmpB439}/m.json`,
        `${tmpB439}/out`,
        "--text",
        "template",
        "--no-video",
      ],
      { stdio: "pipe" },
    );
    return 0;
  } catch (err) {
    return err.status;
  }
};

// ---- 後半の場面（verifyData/full-picture-scene2-d-4.js） ----
await runFullPictureScene2D7({ R, readFileSync, fixtures, tmpB439, runFull });
const {
  mkdtempSync: mkdtempSyncB1211,
  writeFileSync: wf3,
  existsSync: ex3,
} = await import("node:fs");
const { tmpdir: tmpdirB1211 } = await import("node:os");
const { spawnSync: spawnSyncB1211 } = await import("node:child_process");

// ---- 後半の場面（verifyData/full-picture-scene2-d-4.js・full-picture-scene2-d-5.js） ----
runFullPictureScene2D8({ R, readFileSync, fixtures, tmpB439, runFull });
runFullPictureScene2D9({ R, readFileSync, gunzipSync, FX, fixtures });
// run-full --type-spec: 今の表では、どの型も描く前に exit 1・標準エラーに type_unsupported:<項目>（daily.mjs が拾う形）
{
  const tmp = mkdtempSyncB1211(`${tmpdirB1211()}/fp-type-`);
  wf3(
    `${tmp}/m.json`,
    gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
  );
  wf3(
    `${tmp}/t.json`,
    JSON.stringify({
      id: "e03-one-point-30s",
      attributes: { structure: "要点1つ", length_s: "25〜30" },
    }),
  );
  const r = spawnSyncB1211(
    process.execPath,
    [
      new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url)
        .pathname,
      `${tmp}/m.json`,
      `${tmp}/out`,
      "--text",
      "template",
      "--no-video",
      "--type-spec",
      `${tmp}/t.json`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /^type_unsupported:structure（型 e03-one-point-30s は龍神の表に無い）$/m,
  );
  assert.ok(
    !ex3(`${tmp}/out/post-entry.txt`),
    "止めたら本文を書かない（今の型で作らない）",
  );
}

// ---- 後半の場面（verifyData/full-picture-scene2-d-5.js） ----
await runFullPictureScene2D10({ R, readFileSync, gunzipSync, FX, fixtures });
const {
  mkdtempSync: mkdtempSyncB1442,
  writeFileSync: wf4,
  readFileSync: rf4,
} = await import("node:fs");
const { tmpdir } = await import("node:os");
const { spawnSync: spawnSyncB1442 } = await import("node:child_process");

// ---- 後半の場面（verifyData/full-picture-scene2-d-5.js） ----
runFullPictureScene2D11({ R, readFileSync, gunzipSync, FX, fixtures, wf4, rf4 });
// run-full --type-spec v2r1: 冒頭の答えの頁、入口版の結論は形を問わない着順の流れ（冒頭と同じ母数）
const tmp = mkdtempSyncB1442(`${tmpdir()}/fp-v2r1-`);

// ---- 後半の場面（verifyData/full-picture-scene2-d-5.js） ----
runFullPictureScene2D12({ R, readFileSync, gunzipSync, FX, fixtures, wf4, rf4, tmp });
const rB1451 = spawnSyncB1442(
  process.execPath,
  [
    new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url)
      .pathname,
    `${tmp}/m.json`,
    `${tmp}/out`,
    "--text",
    "template",
    "--no-video",
    "--type-spec",
    `${tmp}/t.json`,
  ],
  { encoding: "utf8" },
);

// ---- 後半の場面（verifyData/full-picture-scene2-d-5.js・full-picture-scene2-d-6.js） ----
runFullPictureScene2D13({ R, readFileSync, gunzipSync, FX, fixtures, wf4, rf4, tmp, rB1451 });
await runFullPictureScene2D14({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures });
// .env.local からは材料の取得の匿名の2つだけを読む
const { mkdtempSync, writeFileSync: wf2 } = await import("node:fs");
const { tmpdir: td } = await import("node:os");
const envFile = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
runFullPictureScene2D15({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile });
// /api の合言葉（BOA-1110 段階1）があれば、それも読む（送信の鍵は読まないまま）
const envFileKey = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
runFullPictureScene2D16({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey });
// 使い方の誤りは exit 2、標準出力は JSON 1つ
const { spawnSync } = await import("node:child_process");
const daily = new URL(`${R}/scripts/full-picture/daily.mjs`, import.meta.url)
  .pathname;
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
const runDaily = (file, args, env = cleanEnv) =>
  spawnSync(process.execPath, [file, ...args, "--anon-env", envFile], {
    encoding: "utf8",
    env,
  });

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
runFullPictureScene2D17({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
// --type-spec: 作れない型は材料を取る前に止め、reasons に type_unsupported:<項目>（hq PD02）
const specFile = `${mkdtempSync(`${td()}/fp-spec-`)}/t.json`;

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
runFullPictureScene2D18({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile });
const r = runDaily(daily, [
  "2026-10-19-19-10",
  "--out",
  `${mkdtempSync(`${td()}/fp-out-`)}`,
  "--bgm",
  envFile,
  "--type-spec",
  specFile,
]);

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
runFullPictureScene2D19({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r });
// シンボリックリンク・空白を含むパスから起動しても動く（何もせず exit 0 になっていた。代わりの審査 P2）
{
  const { symlinkSync, mkdtempSync: mk } = await import("node:fs");
  const dir = mk(`${td()}/fp link `);
  symlinkSync(daily, `${dir}/daily.mjs`);
  const r = runDaily(`${dir}/daily.mjs`, [
    "--select",
    "--date",
    "bad",
    "--plan-only",
  ]);
  assert.equal(r.status, 2, "リンクから起動しても使い方の誤りは exit 2");
  assert.equal(JSON.parse(r.stdout).status, "usage");
}

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
await runFullPictureScene2D20({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r });
const { execFileSync: ex, spawnSync: sp } =
  await import("node:child_process");

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
await runFullPictureScene2D21({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex });
// --bundle-only は作り済みの f01 を読む（読めないと voice_credit が false になり bundle が落ちた。Codex P1 #2011）
{
  const { loadF01 } =
    await import("../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
  const { mkdtempSync, writeFileSync: wf } = await import("node:fs");
  const { tmpdir: td } = await import("node:os");
  const dir = mkdtempSync(`${td()}/f01-`);
  assert.deepEqual(
    loadF01(dir).reasons,
    ["type_unsupported:f01_missing"],
    "作り済みが無ければ止める（今の型で代えない）",
  );
  for (const f of ["f01.mp4", "thumb.png"]) wf(`${dir}/${f}`, "x");
  wf(`${dir}/f01.json`, JSON.stringify({ title: "題", seconds: 137.6 }));
  wf(`${dir}/description.txt`, `1行目\n音声: ${VOICE.credit}`);
  wf(`${dir}/chapters.txt`, "0:00 冒頭\n");
  const r = loadF01(dir);
  assert.deepEqual(r.reasons, []);
  assert.ok(
    r.description.includes(VOICE.credit) &&
      r.title === "題" &&
      r.thumb.endsWith("thumb.png"),
  );
}

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
await runFullPictureScene2D22({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex });
{
  const jsx = readFileSync(
    new URL(
      "../../sns-video-studio/remotion/src/fullPicture/F01.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(!/dashed/.test(jsx), "終了画面の置き場の点線の枠を描かない");
}

// ---- 後半の場面（verifyData/full-picture-scene2-d-6.js） ----
await runFullPictureScene2D23({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, specFile, r, sp, ex });

console.log("verify-full-picture-scene2: OK");
