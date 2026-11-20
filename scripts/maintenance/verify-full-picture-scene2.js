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

import {
  RANK_WORDS,
  SUB_MAX,
  VOICE,
  f01Check,
  f01Description,
  f01RacerCheck,
  f01Script,
  splitSubs,
  voiceText,
} from "../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";

import {
  NB,
  RIGHT,
  boatToday,
  emWidth,
  layoutRight,
  racersOf,
} from "../../sns-video-studio/remotion/src/fullPicture/f01Right.js";

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
import { scene2Timeline } from "../../sns-video-studio/remotion/src/fullPicture/scene2Timeline.js";
import { bubbleLine, bubbleFitSize } from "../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";
import {
  overview,
  focus3,
  card,
  has,
  runFullPictureScene2A1,
  runFullPictureScene2A2,
} from "./verifyData/full-picture-scene2-a-1.js";
import { fake, runFullPictureScene2A3, runFullPictureScene2A4 } from "./verifyData/full-picture-scene2-a-2.js";
import {
  sumWidth,
  runFullPictureScene2A9,
  runFullPictureScene2A10,
  runFullPictureScene2A11,
} from "./verifyData/full-picture-scene2-a-4.js";
import {
  F01_SHORT_NAMES,
  runFullPictureScene2A17,
  runFullPictureScene2A18,
  runFullPictureScene2A19,
} from "./verifyData/full-picture-scene2-a-9.js";
import {
  runFullPictureScene2A5,
  runFullPictureScene2A6,
  runFullPictureScene2A7,
  runFullPictureScene2A8,
} from "./verifyData/full-picture-scene2-a-3.js";
import { runFullPictureScene2A12 } from "./verifyData/full-picture-scene2-a-5.js";
import { runFullPictureScene2A13 } from "./verifyData/full-picture-scene2-a-6.js";
import { runFullPictureScene2A14 } from "./verifyData/full-picture-scene2-a-7.js";
import { runFullPictureScene2A15, runFullPictureScene2A16 } from "./verifyData/full-picture-scene2-a-8.js";
import { runFullPictureScene2A20, runFullPictureScene2A21 } from "./verifyData/full-picture-scene2-a-10.js";
import { runFullPictureScene2B1 } from "./verifyData/full-picture-scene2-b-1.js";
import { runFullPictureScene2B2 } from "./verifyData/full-picture-scene2-b-2.js";
import { runFullPictureScene2B3, runFullPictureScene2B4 } from "./verifyData/full-picture-scene2-b-3.js";
import { runFullPictureScene2B5 } from "./verifyData/full-picture-scene2-b-4.js";
import { runFullPictureScene2B6 } from "./verifyData/full-picture-scene2-b-5.js";
import { runFullPictureScene2B7 } from "./verifyData/full-picture-scene2-b-6.js";
import { runFullPictureScene2B8 } from "./verifyData/full-picture-scene2-b-7.js";
import { runFullPictureScene2B9 } from "./verifyData/full-picture-scene2-b-8.js";
import { runFullPictureScene2B10 } from "./verifyData/full-picture-scene2-b-9.js";
import { runFullPictureScene2B11 } from "./verifyData/full-picture-scene2-b-10.js";
import { runFullPictureScene2B12 } from "./verifyData/full-picture-scene2-b-11.js";
import { runFullPictureScene2B13 } from "./verifyData/full-picture-scene2-b-12.js";
import { runFullPictureScene2B14 } from "./verifyData/full-picture-scene2-b-13.js";

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
for (const f of fixtures) {
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
}

// ---- 後半の場面（verifyData/full-picture-scene2-a-4.js・full-picture-scene2-a-5.js） ----
runFullPictureScene2A11({ R, buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures });
await runFullPictureScene2A12({ R, validate, readFileSync, gunzipSync, FX, fixtures });
// 展示の後（stage=exhibition）の材料: 進入・展示 ST・チルト・部品交換・展示タイム・風と波・決まり手の過去の分布を足す。
// 欠けは null で出し、missing に記録する（Supabase は偽物。2026-10-25 hq 依頼、優勝戦・準優の投稿の材料）
const m = JSON.parse(
  gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
);
const realFetch = globalThis.fetch;
const realEnv = {
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.VITE_SUPABASE_ANON_KEY,
};
process.env.VITE_SUPABASE_URL = "https://sb.invalid";
process.env.VITE_SUPABASE_ANON_KEY = "x";
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
// 1号艇は F 表記・部品交換、2号艇はプロペラ交換、3・4号艇は進入が入れ替わり、5号艇はチルトが欠け、6号艇は行が無い
// 5号艇は進入と体重も欠ける（選手のコース別の成績は枠番で引く）
const exRows = [
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

// ---- 後半の場面（verifyData/full-picture-scene2-b-3.js・full-picture-scene2-b-4.js・full-picture-scene2-b-5.js・full-picture-scene2-b-6.js・full-picture-scene2-b-7.js・full-picture-scene2-b-8.js・full-picture-scene2-b-9.js・full-picture-scene2-b-10.js・full-picture-scene2-b-11.js・full-picture-scene2-b-12.js・full-picture-scene2-b-13.js） ----
runFullPictureScene2B4({ m, losingRows });
await runFullPictureScene2B5({ R, validate, m, realFetch, exRows });
runFullPictureScene2B6();
await runFullPictureScene2B7({ R, m });
runFullPictureScene2B8({ MATERIALS_SCHEMA, validate, m });
await runFullPictureScene2B9({ validate });
runFullPictureScene2B10({ m });
await runFullPictureScene2B11({ validate, m });
await runFullPictureScene2B12({ R, MATERIALS_SCHEMA, validate });
await runFullPictureScene2B13({ R, validate, MATERIALS_SCHEMA });
await runFullPictureScene2B14({ validate, realEnv });

// ---- 後半の場面（verifyData/full-picture-scene2-a-6.js） ----
await runFullPictureScene2A13({ R, buildAll, entryScenes, ENTRY_MAX_FRAMES, validate, readFileSync, gunzipSync, FX, fixtures });

// ---- 送信の道に渡す bundle（2026-10-20 オーケストレーターの分担 a・b・c、送信レーンとの Shorts の契約 bundle_version 2）----
{
  const {
    buildBundle,
    checkBundle,
    chaptersOk,
    raceHeader,
    utmUrl,
    jaWidth,
    fullLine1,
    FULL_URL_SLOT,
    BUNDLE_VERSION,
  } = await import(`${R}/scripts/full-picture/bundle.mjs`);
  const { checkFullPicture } = await import("../sns/push-full-picture.js");
  const riskRules = JSON.parse(
    readFileSync(new URL(`${R}/risk-rules.json`, import.meta.url), "utf8"),
  ).rules;
  assert.ok(riskRules.length > 0, "禁止表現の規則を読めた");
  const load = (f) =>
    JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));
  const VENUE = { "01": "桐生", 15: "丸亀", 24: "大村", 19: "下関" };
  const qaAll = {
    contract: true,
    text: true,
    post: true,
    entry_max59s: true,
    full_size: true,
    shorts_vertical: true,
    shorts_max_60s: true,
    shorts_size: true,
    full_min185s: true,
    chapters: true,
  };
  const CH = "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開";
  // 締切・グレードは固定の材料に無い（BOA-989 より前の写し）ので、ここで足す
  const RACE = { "2026-10-12-01-12": { startTime: "16:40:00", grade: "G1" } };
  const bundleOf = (f, qa = qaAll) => {
    const m = load(f);
    const race = RACE[m.raceId] ?? null;
    const [, mo, da, vc, rn] = m.raceId.split("-");
    const scenes = buildAll(m);
    const facts = {
      venue90:
        scenes
          .find((x) => x.id === "scene1")
          .data.steps.find((st) => st.id === "s1-venue90")?.facts ?? null,
      overview: scenes.find((x) => x.id === "scene2").data.radar.overview.facts,
      conclusion:
        scenes.find((x) => x.id === "scene4").data.conclusion?.facts ?? null,
    };
    return buildBundle({
      raceId: m.raceId,
      venue: VENUE[vc],
      raceNo: Number(rn),
      month: Number(mo),
      day: Number(da),
      round: m.api.facts.today.round,
      grade: race?.grade ?? null,
      deadline: race?.startTime ?? null,
      facts,
      chapters: CH,
      fullSeconds: 211,
      qa,
    });
  };
  // BOA-1313: 追加語の優先順と、追加前から超過する本文の互換性。
  {
    const { default: twitterText } = await import("twitter-text");
    const weighted = (s) => twitterText.parseTweet(s).weightedLength;
    const input = {
      raceId: "202611040212",
      venue: "福岡",
      raceNo: 12,
      month: 11,
      day: 4,
      round: "yusho",
      grade: "G1",
      deadline: "16:44:00",
      facts: {},
      chapters: CH,
      fullSeconds: 211,
      qa: qaAll,
    };
    const extra = {
      seriesDayText: "最終日",
      raceTitle: "第68回 ボートレースダービー",
    };
    const old = buildBundle(input);
    const b = buildBundle({ ...input, ...extra });
    assert.equal(
      b.youtube_shorts.title,
      "G1 福岡12R 優勝戦 11/4（水）締切16:44 1号艇は堅い？ 同じ並びの過去の着順",
    );
    assert.equal(b.x_text.split("\n")[1], "11/4（水）最終日 締切16:44");
    assert.equal(b.x_text.split("\n")[2], extra.raceTitle);
    assert.ok(weighted(b.x_text) <= 280);
    for (const k of ["youtube_full", "youtube_shorts"]) {
      assert.ok(
        b[k].description.includes(
          "ボートレース 11/4（水）最終日 福岡12R 優勝戦 締切16:44",
        ),
      );
      const rows = b[k].description.split("\n");
      assert.equal(
        rows[rows.findIndex((r) => r.startsWith("ボートレース 11/4")) + 1],
        extra.raceTitle,
      );
    }
    assert.equal(
      b.youtube_full.title,
      old.youtube_full.title,
      "完全版の題は変えない",
    );
    assert.equal(
      old.youtube_shorts.title,
      "福岡12R 優勝戦（11/4）1号艇は堅い？ 同じ並びの過去の着順",
      "省略した呼び出しは旧題",
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 11,
        day: 4,
        venue: "福岡",
        raceNo: 12,
        round: "yusho",
        deadline: "16:44:00",
      }),
      "11/4（水）福岡12R 優勝戦 締切16:44",
      "f01 の見出しは従来どおり",
    );
    for (const grade of ["SG", "G1", "G2", "G3", "ippan"]) {
      const v = buildBundle({ ...input, ...extra, grade });
      assert.equal(
        v.youtube_shorts.title.startsWith(`${grade} `),
        grade !== "ippan",
      );
      assert.equal(
        v.x_text.includes(extra.raceTitle),
        ["SG", "G1"].includes(grade),
      );
      for (const k of ["youtube_full", "youtube_shorts"])
        assert.equal(
          v[k].description.includes(extra.raceTitle),
          ["SG", "G1"].includes(grade),
        );
    }
    const none = buildBundle({
      ...input,
      seriesDayText: null,
      raceTitle: null,
    });
    assert.equal(
      none.x_text,
      old.x_text,
      "日目・大会名が null なら X は旧本文",
    );
    const longName = buildBundle({
      ...input,
      ...extra,
      raceTitle: "あ".repeat(80),
    });
    assert.ok(!longName.x_text.includes("あ".repeat(80)), "大会名を先に落とす");
    assert.ok(
      longName.x_text.includes("最終日"),
      "大会名を落としても日目は残す",
    );
    assert.ok(weighted(longName.x_text) <= 280);
    // 日目だけで超過する境界を作る（既存の本文は上限以内）。
    let near = null;
    for (let n = 1; n < 100; n++) {
      const v = {
        ...input,
        facts: {
          conclusion: {
            form: "あ".repeat(n),
            n: 1000,
            boat: 1,
            count: 700,
            pct: 70,
          },
        },
      };
      const w = weighted(buildBundle(v).x_text);
      if (w <= 280 && w + 7 > 280) {
        near = v;
        break;
      }
    }
    assert.ok(near, "日目の有無で上限をまたぐ仮入力");
    assert.equal(
      buildBundle({ ...near, ...extra }).x_text,
      buildBundle(near).x_text,
      "大会名の次に日目を落とす",
    );
    const over = {
      ...input,
      facts: {
        venue90: {
          venue: "福岡",
          races: 600,
          rate: 60,
          national: 54,
          diffPt: 6,
          direction: "高い",
        },
        conclusion: { form: "123456", n: 1000, boat: 1, count: 700, pct: 70 },
      },
    };
    assert.ok(weighted(buildBundle(over).x_text) > 280);
    assert.equal(
      buildBundle({ ...over, ...extra }).x_text,
      buildBundle(over).x_text,
      "元から超過する本文は一字一句同じ（新しい停止を足さない）",
    );
    // 100字の直前・直後: グレード→レース名→後半の順。
    const titleOf = (n) =>
      buildBundle({
        ...input,
        ...extra,
        facts: { hero: { title: "あ".repeat(n) } },
      }).youtube_shorts.title;
    const prefix = "G1 福岡12R 優勝戦 11/4（水）締切16:44 1号艇は堅い？ ";
    const n = 100 - prefix.length;
    assert.equal(titleOf(n).length, 100);
    assert.equal(
      titleOf(n + 1),
      prefix.replace("G1 ", "") + "あ".repeat(n + 1),
      "グレードを先に落とす",
    );
    assert.equal(
      titleOf(n + 4),
      prefix.replace("G1 ", "").replace(" 優勝戦", "") + "あ".repeat(n + 4),
      "次にレース名を落とす",
    );
    assert.ok(titleOf(200).length <= 100);
    assert.match(titleOf(200), /11\/4（水）締切16:44 1号艇は堅い？ /);
    assert.ok(titleOf(200).endsWith("…"));
    const runner = readFileSync(
      new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url),
      "utf8",
    );
    assert.match(runner, /seriesDayText: m\.race\?\.seriesDayText/);
    assert.match(runner, /raceTitle: m\.race\?\.raceTitle/);
  }
  for (const f of fixtures) {
    const b = bundleOf(f);
    assert.deepEqual(checkBundle(b), [], `${f}: bundle の形`);
    // 送信の道の受け取りの検査をそのまま通る（評価役の P0 は hq が足す。ここでは 0 を入れて確かめる）
    assert.deepEqual(
      checkFullPicture({ ...b, review: { p0_count: 0 } }, riskRules),
      [],
      `${f}: push-full-picture の検査を通る`,
    );
    assert.equal(b.bundle_version, BUNDLE_VERSION);
    assert.equal(
      b.youtube_shorts.description.split(FULL_URL_SLOT).length - 1,
      1,
      `${f}: Shorts の説明文に完全版の URL の置き場所が1つ`,
    );
    assert.notEqual(
      b.youtube_full.title,
      b.youtube_shorts.title,
      `${f}: 完全版と Shorts の題名は別の文`,
    );
    assert.ok(
      b.youtube_full.description.includes("結果を保証するものではありません"),
      `${f}: 説明文に免責`,
    );
    assert.ok(
      /^0:00 /m.test(b.youtube_full.description),
      `${f}: 説明文に章（0:00 から）`,
    );
    for (const txt of [
      b.x_text,
      b.youtube_full.title,
      b.youtube_full.description,
      b.youtube_shorts.title,
      b.youtube_shorts.description,
    ]) {
      assert.deepEqual(bannedIn(txt), [], `${f}: 禁止表現が無い`);
      assert.ok(!/null|undefined|NaN/.test(txt), `${f}: 欠けた値が無い`);
      assert.ok(!/ほぼ|多い|少ない/.test(txt), `${f}: ぼかし語が無い`);
    }
    // wording-editor P1: 会場の1着率に期間と件数。P2: 結論に条件と「N件中」。X にも免責
    assert.match(
      b.x_text,
      /過去90日の[\d,]+レースで/,
      `${f}: 会場の1着率に期間と件数`,
    );
    assert.match(
      b.x_text,
      /スタートの形が.+だった過去[\d,]+件中、1着最多は/,
      `${f}: 結論に条件と N件中`,
    );
    assert.ok(
      b.x_text.includes("結果を保証するものではありません"),
      `${f}: X にも免責`,
    );
    // youtube-channel P2: 題名・説明文の1行目に「ボートレース」とその日の向き、章の名前は実際の章から
    assert.match(
      b.youtube_full.title,
      /^【(?:(?:SG|G[123]) )?.+\d+R(?: .+)?｜\d+\/\d+】1号艇は堅い？ /,
      `${f}: 完全版の題名（hq 2026-10-21 の形）`,
    );
    // BOA-995: X・YouTube のリンクに UTM（X は x、YouTube は youtube と utm_term）
    assert.ok(
      b.x_text.includes(
        `?utm_source=x&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}`,
      ),
      `${f}: X の URL に UTM`,
    );
    assert.ok(
      b.youtube_full.description.includes(
        `?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}&utm_term=full`,
      ),
      `${f}: 完全版の説明文の URL に UTM`,
    );
    assert.ok(
      b.youtube_shorts.description.includes(
        `?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}&utm_term=shorts`,
      ),
      `${f}: Shorts の説明文の URL に UTM`,
    );
    // BOA-989: X の1行目は完全版の題名と同じ頭、X・説明文にレースの日時（曜日）とレース名
    const xHead = b.x_text.split("\n")[0];
    assert.ok(
      b.youtube_full.title.startsWith(xHead.slice(0, xHead.indexOf("】") + 1)),
      `${f}: X の1行目は題名と同じ頭`,
    );
    for (const txt of [
      b.youtube_full.description,
      b.youtube_shorts.description,
    ])
      assert.match(
        txt,
        /\d+\/\d+（[日月火水木金土]）.+\d+R/,
        `${f}: 日付・曜日・会場・R`,
      );
    assert.match(
      b.x_text.split("\n")[1],
      /^\d+\/\d+（[日月火水木金土]）(締切\d{1,2}:\d{2})?$/,
      `${f}: X の2行目は日付・曜日・締切だけ（hq 2026-10-23）`,
    );
    // C1（hq 契約 10/24）: 1行目に結論の数字と「（ボートレース {見出し}）」、2・3行目に龍神ソナー・思考アシストへの導線、タグ
    const fl = b.youtube_full.description.split("\n");
    // C3: 1行目は「{結論の数字}｜ボートレース {会場}{R}」で全角換算40字以内、4行目に日付・締切の見出し
    assert.match(
      fl[0],
      /^(.+｜)?ボートレース .+\d+R$/,
      `${f}: 説明文の1行目: ${fl[0]}`,
    );
    assert.ok(
      jaWidth(fl[0]) <= 40,
      `${f}: 1行目は40字以内（${jaWidth(fl[0])}）`,
    );
    assert.match(
      fl[3],
      /^ボートレース \d+\/\d+（[日月火水木金土]）.+\d+R/,
      `${f}: 4行目に見出し: ${fl[3]}`,
    );
    assert.ok(
      fl[1].startsWith(
        "類似レースの着順の流れは龍神ソナー: https://www.boat-ai.jp/race/",
      ) &&
        fl[1].includes(
          `?tab=sonar&utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}/sonar&utm_term=full`,
        ),
      `${f}: 2行目にソナー: ${fl[1]}`,
    );
    assert.ok(
      fl[2].startsWith("軸・相手を自分で読むなら思考アシスト: ") &&
        fl[2].endsWith(
          `/race/${b.race_id}/assist?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=${b.race_id}/assist&utm_term=full`,
        ),
      `${f}: 3行目に思考アシスト: ${fl[2]}`,
    );
    assert.deepEqual(
      b.youtube_full.tags,
      ["ボートレース", "龍神ソナー", "思考アシスト"],
      `${f}: 完全版のタグ`,
    );
    assert.ok(
      b.youtube_full.description.endsWith(
        "#ボートレース #龍神ソナー #思考アシスト",
      ),
      `${f}: 末尾のハッシュタグ`,
    );
    assert.ok(
      b.youtube_full.description.includes(
        "条件・6艇比較・類似レース・展開の順に見る動画です。",
      ),
      `${f}: 章の名前から作った順`,
    );
    assert.ok(
      b.youtube_shorts.description.includes("完全版の動画（約3分半）"),
      `${f}: 完全版の長さ`,
    );
  }
  // BOA-989: レース名（round）・グレード・締切。固定の材料 0 は桐生12R 優勝戦（G1 を足した）、round=other は名前を書かない
  {
    const b = bundleOf(fixtures[0]);
    assert.equal(b.race_id, "2026-10-12-01-12");
    assert.ok(
      b.youtube_full.title.startsWith(
        "【G1 桐生12R 優勝戦｜10/12】1号艇は堅い？ ",
      ),
      b.youtube_full.title,
    );
    assert.ok(
      b.youtube_shorts.title.startsWith("桐生12R 優勝戦（10/12）1号艇は堅い？"),
      b.youtube_shorts.title,
    );
    for (const txt of [
      b.youtube_full.description,
      b.youtube_shorts.description,
    ])
      assert.ok(txt.includes("10/12（月）桐生12R 優勝戦 締切16:40"), txt);
    assert.ok(
      b.x_text.startsWith(
        "【G1 桐生12R 優勝戦｜10/12】1号艇は堅い？\n10/12（月）締切16:40\n",
      ),
      b.x_text,
    );
    const other = bundleOf(
      fixtures.find((f) => f.startsWith("2026-10-15-15-10")),
    );
    assert.ok(
      other.youtube_full.title.startsWith("【丸亀10R｜10/15】"),
      `round=other・一般は名前もグレードも書かない: ${other.youtube_full.title}`,
    );
    assert.ok(
      other.x_text.includes("\n10/15（木）\n"),
      "締切が無ければ書かない",
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "junyu",
        deadline: "16:44:00",
        short: true,
      }),
      "10/22（木）締切16:44",
    );
    const junyu = bundleOf(
      fixtures.find((f) => f.startsWith("2026-10-19-19-10")),
    );
    assert.ok(
      junyu.youtube_full.title.startsWith("【下関10R 準優勝戦｜10/19】"),
      junyu.youtube_full.title,
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "junyu",
        deadline: "16:44:00",
      }),
      "10/22（木）児島12R 準優勝戦 締切16:44",
    );
    assert.equal(
      raceHeader({
        year: 2026,
        month: 10,
        day: 22,
        venue: "児島",
        raceNo: 12,
        round: "nazo",
        deadline: null,
      }),
      "10/22（木）児島12R",
      "対応に無い値は書かない",
    );
    assert.equal(
      utmUrl("2026-10-22-16-12", "youtube", "shorts"),
      "https://www.boat-ai.jp/race/2026-10-22-16-12?utm_source=youtube&utm_medium=social&utm_campaign=race-full&utm_content=2026-10-22-16-12&utm_term=shorts",
    );
  }
  // 入口版 v2: Shorts の題は「レース名＋問い＋冒頭の数字」（冒頭の数字と同じ値）
  {
    const m = load(fixtures[0]);
    const scenes = buildAll(m);
    const e = entryScenes(scenes, templateText(allBeats(scenes)).answers, {
      race: "桐生12R",
    });
    assert.ok(e.hero, "前提: 冒頭の数字がある");
    const b = buildBundle({
      raceId: m.raceId,
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      round: "yusho",
      facts: { venue90: null, overview: null, conclusion: null, hero: e.hero },
      chapters: CH,
      fullSeconds: 211,
      qa: qaAll,
    });
    assert.equal(
      b.youtube_shorts.title,
      `桐生12R 優勝戦（10/12）1号艇は堅い？ ${e.hero.title}`,
    );
    assert.ok(
      b.youtube_shorts.title.includes(e.hero.value),
      "題の数字は冒頭の数字と同じ値",
    );
    assert.deepEqual(
      checkBundle(b),
      [],
      "v2 の題でも束の形を通る（100字以内）",
    );
    assert.equal(
      b.youtube_full.description.split("\n")[0],
      `${e.hero.title}｜ボートレース 桐生12R`,
      "完全版の1行目は冒頭の数字の文（C3）",
    );
  }
  const b0 = bundleOf(fixtures[0]);
  // C3: 1行目は40字を越えたら止めずに「ボートレース {会場}{R}」へ落とす
  {
    assert.equal(jaWidth("ab12"), 2, "半角は0.5");
    assert.equal(jaWidth("全角"), 2);
    const hero = "同じ並びの過去1,857件で1号艇の1着72.0%";
    assert.equal(
      fullLine1(hero, "住之江11R"),
      `${hero}｜ボートレース 住之江11R`,
      "収まる日はそのまま",
    );
    // 越えたら間の短い形を作らず、会場と R だけにする（条件の語を落として数字だけ残さない。youtube-channel P2-1）
    const long =
      "同じ並びの過去12,345件で1号艇の1着率は72.0%、2着は3号艇、3着は4号艇が多い";
    assert.ok(jaWidth(`${long}｜ボートレース 平和島12R`) > 40, "前提: 越える");
    assert.equal(fullLine1(long, "平和島12R"), "ボートレース 平和島12R");
    assert.equal(
      fullLine1(null, "平和島12R"),
      "ボートレース 平和島12R",
      "冒頭の数字が無い日",
    );
    const fl = b0.youtube_full.description.split("\n");
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: ["あ".repeat(41), ...fl.slice(1)].join("\n"),
        },
      }),
      "40字を越える",
    );
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: ["", ...fl.slice(1)].join("\n"),
        },
      }),
      "1行目が空",
    );
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [
            fl[0],
            fl[1].replace(
              "龍神ソナー:",
              "龍神ソナーを使ってください、とても長い文:",
            ),
            ...fl.slice(2),
          ].join("\n"),
        },
      }),
      "20字を越える",
    );
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [...fl.slice(0, -1), "#a #b #c #d"].join("\n"),
        },
      }),
      "3つを越える",
    );
  }
  // C1: 2・3行目の機能への導線が無ければ落ちる
  {
    const fl = b0.youtube_full.description.split("\n");
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [fl[0], fl[2], fl[1], ...fl.slice(3)].join("\n"),
        },
      }),
      "龍神ソナーへの導線",
    );
    has(
      checkBundle({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [fl[0], fl[1], "x", ...fl.slice(3)].join("\n"),
        },
      }),
      "思考アシストへの導線",
    );
  }
  has(
    checkBundle({ ...b0, x_text: b0.x_text.replace(/\?utm_[^\s]+/, "") }),
    "UTM つき",
  );
  has(
    checkBundle({
      ...b0,
      youtube_full: {
        ...b0.youtube_full,
        description: b0.youtube_full.description.replace(/\?utm_[^\s]+/, ""),
      },
    }),
    "youtube_full.description",
  );
  has(
    checkBundle({
      ...b0,
      youtube_shorts: { ...b0.youtube_shorts, title: b0.youtube_full.title },
    }),
    "題名が同じ",
  );
  has(
    checkBundle({
      ...b0,
      youtube_shorts: { ...b0.youtube_shorts, description: "x" },
    }),
    "ちょうど1つ無い",
  );
  has(
    checkBundle({
      ...b0,
      youtube_shorts: {
        ...b0.youtube_shorts,
        description: `${FULL_URL_SLOT} ${FULL_URL_SLOT}`,
      },
    }),
    "ちょうど1つ無い",
  );
  has(checkBundle({ ...b0, x_text: "URL なし" }), "URL がちょうど1つ無い");
  // 全国との差が出せない日は、題名に「差は1ポイント未満」と書かず既定の文にする
  {
    const m = load(fixtures[0]);
    const b = buildBundle({
      raceId: m.raceId,
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      facts: {
        venue90: {
          venue: "桐生",
          rate: 51.3,
          national: null,
          races: 600,
          diffPt: null,
          direction: null,
        },
        overview: null,
        conclusion: null,
      },
      chapters: CH,
      fullSeconds: 211,
      qa: qaAll,
    });
    assert.ok(
      !b.youtube_full.title.includes("1ポイント未満"),
      b.youtube_full.title,
    );
  }
  has(
    checkBundle(bundleOf(fixtures[0], { ...qaAll, full_size: false })),
    "機械の検査",
  );
  has(
    checkBundle(bundleOf(fixtures[0], { ...qaAll, full_min185s: false })),
    "機械の検査",
  );
  // 自動チャプターの条件: 0:00 から・3つ以上・各章10秒以上（実ファイルの尺で）
  assert.equal(chaptersOk(CH, 211), true);
  assert.equal(chaptersOk(CH, 110), false, "最後の章が10秒未満");
  assert.equal(
    chaptersOk("0:00 条件\n0:22 6艇比較", 211),
    false,
    "章が3つ未満",
  );
  assert.equal(
    chaptersOk("0:05 条件\n0:22 6艇比較\n1:07 類似レース", 211),
    false,
    "0:00 から始まらない",
  );

  // run-full: 省略禁止の場面4の材料が無い・材料が契約に合わないときは終了コード1で止める（文だけの実行で確かめる）
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync: wf } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(`${tmpdir()}/fp-`);
  const runFull = (m) => {
    wf(`${tmp}/m.json`, JSON.stringify(m));
    try {
      execFileSync(
        process.execPath,
        [
          new URL(`${R}/scripts/full-picture/run-full.mjs`, import.meta.url)
            .pathname,
          `${tmp}/m.json`,
          `${tmp}/out`,
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
  const mOk = load(fixtures[0]);
  assert.equal(runFull(mOk), 0, "固定の材料なら文だけの実行は通る");
  // BOA-989: 冒頭の場面（完全版・入口版の最初の問い）と X の本文にレースの日時・レース名・締切
  assert.equal(
    runFull({ ...mOk, race: { startTime: "16:40:00", grade: "ippan" } }),
    0,
    "締切つきの材料でも通る",
  );
  {
    const HEADER = "10/12（月）桐生12R 優勝戦 締切16:40";
    const sc = JSON.parse(readFileSync(`${tmp}/out/scenes.json`, "utf8"));
    assert.equal(
      sc.scenes.find((x) => x.id === "scene1").data.steps[0].question,
      `${HEADER} 1号艇は堅い？`,
      "完全版の冒頭の問いに見出し",
    );
    const post = readFileSync(`${tmp}/out/post-entry.txt`, "utf8");
    assert.ok(
      post.startsWith(
        "【桐生12R 優勝戦｜10/12】1号艇は堅い？\n10/12（月）締切16:40\n",
      ),
      post,
    );
  }
  assert.equal(
    runFull({ ...mOk, api: { ...mOk.api, scenario: null } }),
    1,
    "場面4の材料が無ければ止める",
  );
  assert.equal(
    runFull({ ...mOk, schemaVersion: "full-picture-materials/0" }),
    1,
    "契約に合わなければ止める",
  );
}

// ---- 投稿の型（hq PD02、type-spec.mjs・daily.mjs --type-spec）----
// 型の表は今は空（オーナー 10/25: 中身を固めて試作を見てから載せる）。仕組みは試験用の表で確かめる
{
  const {
    resolveType,
    lengthRange,
    lengthReason,
    listTypes,
    TYPE_IMPL,
    reviewReasons,
  } = await import(`${R}/scripts/full-picture/type-spec.mjs`);
  const { buildBundle, checkBundle } = await import(
    `${R}/scripts/full-picture/bundle.mjs`
  );
  const {
    mkdtempSync,
    writeFileSync: wf3,
    existsSync: ex3,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  // 型の表に載せるのは関門を通った型だけ。各型に審査の記録と変えてよい幅を持たせる（docs/design/full-picture-type-gate/spec.md の 7）
  assert.deepEqual(Object.keys(TYPE_IMPL), [
    "v2r1-answer-fill-explain",
    "f01-landscape-voice-full",
  ]);
  for (const [id, impl] of Object.entries(TYPE_IMPL))
    assert.deepEqual(reviewReasons(id, impl), [], `${id}: 審査の記録`);
  // 段5の記録は P0 審査1件（2026-10-27〜）。伏せた比較（blindCompare）は段8を回す型だけの任意
  const base = {
    approved: { structure: "x" },
    range: {},
    review: { direction: "d", owner: "o" },
  };
  assert.deepEqual(
    reviewReasons("t", {
      ...base,
      review: {
        ...base.review,
        p0Review: {
          role: "youtube-channel",
          verdict: "P0 0件",
          date: "2026-10-28",
        },
      },
    }),
    [],
    "P0 審査1件で足りる（伏せた比較なし）",
  );
  assert.ok(
    reviewReasons("t", base).some((w) => w.includes("段5の記録")),
    "段5の記録が無ければ落ちる",
  );
  assert.ok(
    reviewReasons("t", {
      ...base,
      review: { ...base.review, p0Review: { role: "x", verdict: "P0 0件" } },
    }).some((w) => w.includes("P0 審査の記録")),
    "日付が無ければ落ちる",
  );
  assert.ok(
    reviewReasons("t", {
      ...base,
      review: { ...base.review, channels: "c" },
      approved: {},
    }).some((w) => w.includes("承認した文")),
  );
  assert.ok(
    reviewReasons("t", { ...base, review: { owner: "o", channels: "c" } }).some(
      (w) => w.includes("direction"),
    ),
  );
  assert.deepEqual(
    listTypes().map((x) => x.id),
    ["v2r1-answer-fill-explain", "f01-landscape-voice-full"],
  );
  // 型 f01: hq の文のまま渡せば完全版を f01 で作る印（full）が付く。length_s は完全版の尺の文で、入口版の尺の検査に使わない（run-full）
  {
    const f01t = resolveType(
      listTypes().find((x) => x.id === "f01-landscape-voice-full"),
    );
    assert.deepEqual(f01t.reasons, []);
    assert.equal(f01t.impl.full, "f01");
    assert.equal(
      lengthRange(f01t.attributes.length_s),
      null,
      "f01 の length_s は秒の範囲として読めない（入口版には当てない）",
    );
  }
  // 試験用の表: 受け持つ項目と承認した文
  const T = {
    "t-test": {
      attrs: ["structure", "length_s"],
      approved: { structure: "要点1つ", length_s: "25〜30" },
    },
  };
  const ok = {
    id: "t-test",
    attributes: { structure: "要点1つ", length_s: "25〜30" },
  };
  assert.deepEqual(resolveType(ok, T).reasons, []);
  assert.deepEqual(listTypes(T), [
    { id: "t-test", attributes: T["t-test"].approved },
  ]);
  // 表に無い型は、渡された項目ごとに type_unsupported（黙って今の型で作らない）
  assert.deepEqual(
    resolveType(
      {
        id: "e06-data-cheatsheet",
        attributes: { structure: "早見表", thumb: "表" },
      },
      T,
    ).reasons,
    [
      "type_unsupported:structure（型 e06-data-cheatsheet は龍神の表に無い）",
      "type_unsupported:thumb（型 e06-data-cheatsheet は龍神の表に無い）",
    ],
  );
  assert.deepEqual(
    resolveType({ ...ok, attributes: { ...ok.attributes, thumb: "表" } }, T)
      .reasons,
    ["type_unsupported:thumb"],
    "表の型でも実装していない項目は止める",
  );
  assert.deepEqual(
    resolveType(
      { ...ok, attributes: { ...ok.attributes, structure: "要点2つ" } },
      T,
    ).reasons,
    ["type_unsupported:structure（文が変わった）"],
    "同じ id で文が変わった項目は止める（system-architect P2）",
  );
  // voice は hq が 10/27 に type_attrs へ足した（型 f01）。知らない項目の例は bgm
  assert.deepEqual(
    resolveType({ id: "x", attributes: { bgm: "a" } }, T).reasons,
    ["type_unsupported:bgm（知らない項目）"],
  );
  assert.deepEqual(
    resolveType({ id: "x", attributes: { voice: "a" } }, T).reasons,
    ["type_unsupported:voice（型 x は龍神の表に無い）"],
  );
  assert.match(
    resolveType({ id: "t-test", attributes: {} }, T).reasons[0],
    /^type_spec_invalid/,
  );
  assert.ok(resolveType(ok).reasons.length > 0, "表に無い型は止まる");
  assert.deepEqual(lengthRange("25〜30"), [25, 30]);
  assert.equal(lengthRange("短め"), null);
  assert.equal(lengthReason({ length_s: "25〜30" }, 26), null);
  // 理由は固定の文、実測は detail（hq は reasons[0] で起票の重複を判定する。system-architect P1-1）
  assert.deepEqual(lengthReason({ length_s: "25〜30" }, 38.4), {
    reason: "type_unsupported:length_s",
    detail: "入口版 38.4秒が範囲 25〜30秒の外",
  });
  assert.equal(
    lengthReason({ structure: "x" }, 99),
    null,
    "length_s が無ければ尺は見ない",
  );
  // 束: 型の id を content_type に。無ければ書かない
  {
    const base = {
      raceId: "2026-10-12-01-12",
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      round: "yusho",
      facts: { venue90: null, overview: null, conclusion: null, hero: null },
      chapters: "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開",
      fullSeconds: 211,
      qa: { a: true },
    };
    const b = buildBundle({ ...base, contentType: "t-test" });
    assert.deepEqual(b.content_type, { id: "t-test" });
    assert.deepEqual(checkBundle(b), []);
    assert.equal(
      buildBundle(base).content_type,
      undefined,
      "型が無ければ書かない",
    );
  }
  // run-full --type-spec: 今の表では、どの型も描く前に exit 1・標準エラーに type_unsupported:<項目>（daily.mjs が拾う形）
  {
    const tmp = mkdtempSync(`${tmpdir()}/fp-type-`);
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
    const r = spawnSync(
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
}

// ---- v2r1（今の型の直し、入口版の冒頭に言葉の答え。docs/design/full-picture-type-gate/candidates/v2r1-answer-fill-explain/script.md）----
{
  const { answerOf, scopeLabel } = await import(
    `${R}/scripts/full-picture/answer.mjs`
  );
  const { buildBundle } = await import(`${R}/scripts/full-picture/bundle.mjs`);
  const { listTypes } = await import(`${R}/scripts/full-picture/type-spec.mjs`);
  const {
    mkdtempSync,
    writeFileSync: wf4,
    readFileSync: rf4,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  // 答えは形を問わない割合（予想の形の過去の差は今日に引き継がれない。BOA-1096）。評価の言葉は使わない
  const tri = (k1, other) => ({ "1-2-3": k1, "2-1-3": other });
  const sc = {
    cells: {
      waku: {
        forms: {
          any: { n: 242, tri: tri(137, 105) },
          wall: { n: 49, tri: tri(30, 19) },
        },
      },
    },
    period: ["2019-04-01", "2026-10-22"],
  };
  const a = answerOf(sc, "wall");
  assert.equal(a.ok, true);
  assert.deepEqual([a.n0, a.k0, a.p0], [242, 137, 56.6]);
  assert.equal(a.label, "この組み合わせの過去で、1号艇の1着は約6割");
  assert.deepEqual(a.labelLines, [
    "この組み合わせの過去で",
    "1号艇の1着は約6割",
  ]);
  assert.ok(
    !/堅い|崩れ|いつも/.test(a.label + a.small),
    "評価の言葉を使わない",
  );
  assert.deepEqual(
    a.form,
    { key: "wall", n: 49, k: 30, p: 61.2 },
    "形は事実として持つだけ",
  );
  assert.equal(
    answerOf(sc, null).ok,
    true,
    "形が無くても作る（段 N、オーナー 10/25 (b)→(1)）",
  );
  // データが薄いレース（この組み合わせの過去が30件未満）は作らない。固定の語 thin_data（hq が日ごとの減りを数える）
  const thin = answerOf(
    { cells: { waku: { forms: { any: { n: 25, tri: tri(15, 10) } } } } },
    null,
  );
  assert.deepEqual([thin.ok, thin.kind], [false, "thin_data"]);
  assert.equal(
    scopeLabel("VC:12:2-2-2-0:1A2", ["2019-04-01", "2026-10-22"], "住之江"),
    "住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なり",
  );
  assert.equal(
    scopeLabel("NC:2-2-2-0:1A2", null, "びわこ"),
    "全国・同じ級別の組み合わせ・枠なり",
  );
  // 本文: 答えの1文と、条件・件数・注記の行に分ける。形の行（結論の行）は出さない（入口版の結論も同じ母数にそろえた）
  const answer = {
    label: a.label,
    n0: 242,
    k0: 137,
    p0: 56.6,
    scope: "住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なり",
  };
  const conclusion = {
    form: "内3艇そろう",
    n: 49,
    boat: 1,
    count: 30,
    pct: 61.2,
  };
  const b = buildBundle({
    raceId: "2026-10-23-12-11",
    venue: "住之江",
    raceNo: 11,
    month: 10,
    day: 23,
    round: "junyu",
    facts: {
      venue90: null,
      overview: null,
      conclusion,
      hero: { title: a.label },
    },
    chapters: "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開",
    fullSeconds: 211,
    qa: { a: true },
    answer,
  });
  const xl = b.x_text.split("\n");
  assert.equal(xl[2], "この組み合わせの過去で、1号艇の1着は約6割");
  assert.equal(
    xl[3],
    "（住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なりの過去242件中137件・56.6%。過去の割合で、今日の結果を示すものではない）",
  );
  assert.ok(
    !b.x_text.includes("61.2%"),
    "形の行は出さない（冒頭と結論の数字を分けない）",
  );
  assert.ok(b.youtube_shorts.description.includes("過去242件中137件・56.6%"));
  // run-full --type-spec v2r1: 冒頭の答えの頁、入口版の結論は形を問わない着順の流れ（冒頭と同じ母数）
  {
    const tmp = mkdtempSync(`${tmpdir()}/fp-v2r1-`);
    wf4(
      `${tmp}/m.json`,
      gunzipSync(
        readFileSync(
          new URL(
            fixtures.find((f) => f.startsWith("2026-10-19")),
            FX,
          ),
        ),
      ).toString("utf8"),
    );
    wf4(`${tmp}/t.json`, JSON.stringify(listTypes()[0]));
    const r = spawnSync(
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
    assert.equal(r.status, 0, r.stderr.slice(-500));
    const post = rf4(`${tmp}/out/post-entry.txt`, "utf8");
    assert.match(
      post.split("\n")[2],
      /^この組み合わせの過去で、1号艇の1着は約\d割$/,
      post,
    );
    assert.match(
      post.split("\n")[3],
      /^（.+・同じ級別の組み合わせ.+の過去[\d,]+件中[\d,]+件・\d+\.\d%。過去の割合で、今日の結果を示すものではない）$/,
      post,
    );
  }
}

// ---- 毎日の実行（daily.mjs、hq の切替案 v2 §9）と LLM の usage ----
{
  const {
    selectRaces,
    childEnv,
    readAnonEnv,
    SELECT_RULE,
    withVariant,
    VARIANTS,
    typeFailure,
  } = await import(`${R}/scripts/full-picture/daily.mjs`);
  // run-full が型で止まったときは stage=type-spec・固定の文の reasons・実測の detail（system-architect P1-1）
  assert.deepEqual(
    typeFailure(
      "[省いた要素] x\ntype_unsupported:length_s\ntype_detail: 入口版 38.4秒が範囲 25〜30秒の外\n",
    ),
    {
      reasons: ["type_unsupported:length_s"],
      detail: ["入口版 38.4秒が範囲 25〜30秒の外"],
    },
  );
  assert.equal(
    typeFailure("Error: 描画に失敗\n    at x"),
    null,
    "描画の失敗は型の失敗にしない",
  );
  const race = (n, t, stage, cancel = null) => ({
    raceId: `2026-10-19-19-${String(n).padStart(2, "0")}`,
    raceNumber: n,
    startTime: t,
    raceStage: stage,
    cancellationStatus: cancel,
  });
  const day = [
    race(9, "21:23", "一般"),
    race(10, "21:51", "準優勝戦"),
    race(11, "22:20", "準優勝戦"),
    race(12, "22:45", "一般"),
  ];
  // 締切 21:58 前の優勝戦・準優勝戦のうち一番遅いもの（22:20 の11R は締切を過ぎるので外す）
  assert.deepEqual(selectRaces(day, "2026-10-19"), [
    {
      race_id: "2026-10-19-19-10",
      deadline: "2026-10-19T12:51:00.000Z",
      race_stage: "準優勝戦",
    },
  ]);
  // plan の各行に race_stage（race_conditions.race_stage の文字列そのまま。hq SQ08 v5）。12R の代わりの行も、無ければ null
  assert.deepEqual(
    selectRaces([race(12, "21:30", "一般")], "2026-10-19").map(
      (x) => x.race_stage,
    ),
    ["一般"],
  );
  assert.deepEqual(
    selectRaces([race(12, "21:30", null)], "2026-10-19").map(
      (x) => x.race_stage,
    ),
    [null],
  );
  // 札（--variant a|b）は bundle の full_picture_variant.id に書く。無ければ bundle はそのまま
  assert.deepEqual(VARIANTS, ["a", "b"]);
  assert.deepEqual(withVariant({ race_id: "x" }, "b"), {
    race_id: "x",
    full_picture_variant: { id: "b" },
  });
  assert.deepEqual(withVariant({ race_id: "x" }, null), { race_id: "x" });
  // 中止なら外す。優勝戦・準優勝戦が無ければ 12R の一番遅いもの
  const other = [
    race(12, "16:40", "一般"),
    { ...race(12, "17:10", "一般"), raceId: "2026-10-19-01-12" },
    race(10, "15:50", "一般"),
  ];
  assert.deepEqual(
    selectRaces(other, "2026-10-19").map((x) => x.race_id),
    ["2026-10-19-01-12"],
  );
  assert.deepEqual(
    selectRaces(
      [race(10, "21:51", "準優勝戦", "confirmed"), race(12, "21:30", "一般")],
      "2026-10-19",
    ).map((x) => x.race_id),
    ["2026-10-19-19-12"],
    "中止は外す",
  );
  assert.deepEqual(
    selectRaces(day, "2026-10-19", 2).map((x) => x.race_id),
    ["2026-10-19-19-10"],
    "規則に合うのが1つなら1つ",
  );
  assert.equal(SELECT_RULE.deadlineBefore, "21:58");
  // 鍵の分け方: 子のプロセス（run-full と claude）に service key・Webhook を渡さない。claude の認証は残す
  // 通す名前を並べる方式（DATABASE_URL のような名前も渡らない）
  const env = childEnv({
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
  // .env.local からは材料の取得の匿名の2つだけを読む
  const { mkdtempSync, writeFileSync: wf2 } = await import("node:fs");
  const { tmpdir: td } = await import("node:os");
  const envFile = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;
  wf2(
    envFile,
    'SUPABASE_SERVICE_KEY=secret\nVITE_SUPABASE_URL="https://x.supabase.co"\nVITE_SUPABASE_ANON_KEY=anon\nSLACK_WEBHOOK_URL=w\n',
  );
  assert.deepEqual(readAnonEnv(envFile), {
    VITE_SUPABASE_URL: "https://x.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon",
  });
  // /api の合言葉（BOA-1110 段階1）があれば、それも読む（送信の鍵は読まないまま）
  const envFileKey = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;
  wf2(
    envFileKey,
    "SUPABASE_SERVICE_KEY=secret\nVITE_SUPABASE_URL=u\nVITE_SUPABASE_ANON_KEY=anon\nINTERNAL_API_KEY=k1\n",
  );
  assert.deepEqual(readAnonEnv(envFileKey), {
    VITE_SUPABASE_URL: "u",
    VITE_SUPABASE_ANON_KEY: "anon",
    INTERNAL_API_KEY: "k1",
  });
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
  // --type-spec: 作れない型は材料を取る前に止め、reasons に type_unsupported:<項目>（hq PD02）
  {
    const specFile = `${mkdtempSync(`${td()}/fp-spec-`)}/t.json`;
    wf2(
      specFile,
      JSON.stringify({
        id: "e07-voice-character",
        attributes: { hook: "キャラ声" },
      }),
    );
    const r = runDaily(daily, [
      "2026-10-19-19-10",
      "--out",
      `${mkdtempSync(`${td()}/fp-out-`)}`,
      "--bgm",
      envFile,
      "--type-spec",
      specFile,
    ]);
    assert.equal(r.status, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.stage, "type-spec");
    assert.deepEqual(j.reasons, [
      "type_unsupported:hook（型 e07-voice-character は龍神の表に無い）",
    ]);
    assert.deepEqual(j.content_type, { id: "e07-voice-character" });
    const r2 = runDaily(daily, [
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
    const r3 = runDaily(daily, ["--list-types"]);
    assert.equal(r3.status, 0);
    const lt = JSON.parse(r3.stdout);
    assert.deepEqual(
      lt.types.map((x) => x.id),
      ["v2r1-answer-fill-explain", "f01-landscape-voice-full"],
      "型の表は関門を通った型だけ",
    );
  }
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
  const { REQUIRED_SOURCES } = await import(
    `${R}/scripts/full-picture/daily.mjs`
  );
  for (const src of ["outcome.7", "races", "db.motor", "scenarioNA", "facts"])
    assert.ok(REQUIRED_SOURCES.test(src), `${src} が欠けたら止める`);
  assert.ok(
    !REQUIRED_SOURCES.test("db.racer1"),
    "1号艇の選手の成績は欠けても省いて続ける（選手が無い日がある）",
  );
  // LLM の usage を残す（claudeCli は { text, usage } を返す）
  const { llmUsage } = await import(
    `${R}/scripts/full-picture/scene2-text.mjs`
  );
  const withUsage = connectedText(scene, () => ({
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
}

// ---- 後半の場面（verifyData/full-picture-scene2-a-7.js・full-picture-scene2-a-8.js） ----
await runFullPictureScene2A14({ R, buildAll, readFileSync, gunzipSync, FX, fixtures });
await runFullPictureScene2A15({ R, buildAll, readFileSync, gunzipSync, FX });
// daily.mjs の video.full_s は送る MP4 の実際の尺（型 f01 で run-text.json の縦の型の尺 204〜228秒を書かない）
{
  const { fileSeconds } = await import(`${R}/scripts/full-picture/daily.mjs`);
  assert.equal(
    fileSeconds("x.mp4", () => "612.3456\n"),
    612.3,
    "ffprobe の尺を小数1桁で",
  );
  assert.throws(() => fileSeconds("x.mp4", () => "N/A\n"), /尺を測れない/);
  const { execFileSync: ex, spawnSync: sp } =
    await import("node:child_process");
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
}

// ---- 後半の場面（verifyData/full-picture-scene2-a-8.js・full-picture-scene2-a-9.js） ----
runFullPictureScene2A16({ R, buildAll, readFileSync, gunzipSync, FX });
runFullPictureScene2A17({ buildAll, readFileSync, gunzipSync, FX });

// 型 f01 の写しの材料は build が読んだ所だけで、出走表の名前は1艇目だけ・級は無い（make-fixture.mjs が落とす）。
// 名前と級・日目・締切の埋め方は f01-fixture.mjs（verify-sns-makers.js と共用、ADR-0105）
const { F01_LONG_NAMES, withF01Fields } =
  await import("../../sns-video-studio/remotion/scripts/full-picture/f01-fixture.mjs");

// ---- 後半の場面（verifyData/full-picture-scene2-a-9.js） ----
runFullPictureScene2A18({ buildAll, readFileSync, gunzipSync, FX });
const f01Fixture = (name, names = F01_LONG_NAMES) => {
  const mf = JSON.parse(
    gunzipSync(readFileSync(new URL(`${name}.json.gz`, FX))).toString("utf8"),
  );
  return withF01Fields(mf, names);
};

// ---- 後半の場面（verifyData/full-picture-scene2-a-9.js・full-picture-scene2-a-10.js） ----
await runFullPictureScene2A19({ buildAll, readFileSync, gunzipSync, FX, f01Fixture });
await runFullPictureScene2A20({ R, readFileSync, gunzipSync, FX, fixtures, f01Fixture });

// 型 f01-landscape-voice-full（関門の段4の試作）: 順位の語は線を通ったときだけ・字幕の幅・声の読みの辞書・説明欄のクレジット・左の画面の照合
{
  for (const name of [
    "2026-10-12-01-12",
    "2026-10-15-15-10",
    "2026-10-16-24-11",
    "2026-10-19-19-10",
  ]) {
    const mf = f01Fixture(name);
    const s = f01Script(mf);
    assert.ok(s.ok, `${name}: ${s.reason}`);
    for (const c of s.chapters) {
      const sig = c.facts?.secRank?.rankSig || c.facts?.swap;
      if (RANK_WORDS.test(c.voice))
        assert.ok(sig, `${name} ${c.id}: 線を通らない順位の語: ${c.voice}`);
      for (const l of c.subs)
        assert.ok(
          l.length <= SUB_MAX + 2,
          `${name} ${c.id}: 字幕 ${l.length}字`,
        );
    }
    assert.equal(s.chapters[0].id, "open");
    assert.equal(
      s.chapters[0].subs.length,
      0,
      "冒頭は字幕を出さない（見本の「最も多く…次が」は線を通らない）",
    );
    const desc = f01Description(s, "0:00 冒頭\n");
    // 今の完全版の説明文の約束（1行目40字以内・2/3行目に機能への導線・URL の utm_term=full）
    assert.ok(
      desc.split("\n")[1].includes("tab=sonar") &&
        desc.split("\n")[2].includes("/assist?") &&
        desc.includes("utm_term=full"),
      desc,
    );
    assert.ok(desc.includes(VOICE.credit));
    assert.ok(
      f01Check(s, {
        desc: desc.replace(VOICE.credit, ""),
        kana: {},
        shots: {},
      }).some((w) => w.includes("VOICEVOX")),
      "クレジットが無ければ落とす",
    );
  }
  assert.equal(voiceText("313件・今節"), "313けん・こんせつ");
  assert.deepEqual(splitSubs("あ。い、う"), ["あ。", "い、う"]);
  // 照合: 左の画面に右の列の数字が無ければ落とす。読みの辞書: 件がゲンと読まれたら落とす
  const s0 = {
    chapters: [{ id: "c2", voice: "", subs: [], expect: ["313件"] }],
  };
  assert.ok(
    f01Check(s0, {
      desc: VOICE.credit,
      kana: {},
      shots: { c2: { text: "1号艇 78% 31 3件" } },
    }).length === 0,
    "空白の違いは同じとみなす",
  );
  assert.ok(
    f01Check(s0, {
      desc: VOICE.credit,
      kana: {},
      shots: { c2: { text: "1号艇 78% 312件" } },
    }).some((w) => w.includes("313件")),
  );
  assert.ok(
    f01Check(
      { chapters: [] },
      {
        desc: VOICE.credit,
        kana: { "c2-1": "サンビャクジュウサン/ゲン" },
        shots: {},
      },
    ).some((w) => w.includes("ゲン")),
  );
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
  // ②の1着の件数は画面と同じ数え方（1〜3着がそろった類似レースだけ）。着順の欠けたレースを数えると画面と食い違い、照合で止まった（10/30 児島10R 293 対 291）
  {
    const mf = f01Fixture("2026-10-19-19-10");
    const nb = mf.api.similar?.similar?.neighbors;
    if (nb?.length) {
      nb[0] = { ...nb[0], finish: [nb[0].finish?.[0] ?? 1] }; // 1着だけ分かっているレース
      const c2 = f01Script(mf).chapters.find((c) => c.id === "c2");
      const flow = buildAll(mf)
        .find((x) => x.id === "scene2b")
        .data.steps.find((x) => x.id === "s2b-flow-1");
      assert.ok(c2 && flow, "類似レースの章と着順の流れがある");
      assert.equal(
        c2.facts.counts.reduce((a, b) => a + b, 0),
        flow.page.n,
        "1着の件数の和は着順のそろった件数（画面の棒と同じ）",
      );
    }
  }
  // 字の小ささ（hq 11d 節、10/30 に7章が 13.5〜21px）: 線を下回る撮った物の章・最初のカットを撮れなかった章は出さない。
  // ④は「軸のボタン → 2着の棒 → 軸のボタン（カーソル）→ 押した後 → 2着の棒」の順に、声の行に合わせて切り替える
  {
    const {
      f01SmallChapters,
      f01LayoutChapters,
      f01Timeline,
      MIN_FONT_PX,
      MIN_FONT_BY_CHAPTER,
      PLAN,
    } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const sh = (k, px, clip = { x: 0, y: 0, w: 400, h: 150 }) => ({
      file: `/x/${k}.png`,
      clip,
      scale: 2.8,
      minFontPx: px,
    });
    const s1 = {
      chapters: [{ id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }],
    };
    const shots1 = {
      c2: sh("c2", 26.4),
      c3: sh("c3", MIN_FONT_BY_CHAPTER.c3 - 0.1),
      c4: sh("c4", 29.8),
      c4b: sh("c4b", 31.1, { x: 8, y: 0, w: 380, h: 170 }),
    };
    assert.deepEqual(
      f01SmallChapters(s1, shots1).map((x) => x.id),
      ["c3", "c5"],
      "線の下（c3）と撮れなかった章（c5）を省く",
    );
    assert.deepEqual(
      PLAN.c4.map((p) => p.k),
      ["c4", "c4b", "c4", "c42", "c42b"],
    );
    // オーナー 11/2「22.4px の章は2カットに分けて」: 線は 24px。着順の流れは押した後を上・下、形の札は図と名前の2カット
    assert.equal(MIN_FONT_PX, 24);
    // ②も 11/2 18-10 の形（1着の棒 → 着順の流れの全体の押す前・押した後）。上・下の2カットは座標の決め打ちだったので外した（docs/design/f01-stable-capture/）
    assert.deepEqual(
      PLAN.c2.map((p) => p.k),
      ["c2", "c2-pre", "c22"],
    );
    assert.equal(MIN_FONT_BY_CHAPTER.c2, 22);
    // ③は 11/2 18-10 の形（形の札1枚 → 着順の流れの全体）に戻した（オーナー 11/4。#2087 の2カットは 11/3 の4本で崩れた）。線は 22px
    assert.deepEqual(
      PLAN.c3.map((p) => p.k),
      ["c3", "c3-pre", "c32"],
    );
    assert.equal(MIN_FONT_BY_CHAPTER.c3, 22);
    assert.deepEqual(
      f01SmallChapters(
        { chapters: [{ id: "c3" }] },
        {
          c3: sh("c3", 22.4),
          "c3-pre": sh("c3-pre", 22.4),
          c32: sh("c32", 22.5),
        },
      ),
      [],
      "18-10 の③（22.4px）は線の上",
    );
    assert.deepEqual(
      f01SmallChapters(
        { chapters: [{ id: "c4" }] },
        { c4: sh("c4", 22.4), c4b: sh("c4b", 31.1) },
      ).map((x) => x.id),
      ["c4"],
      "③の例外はほかの章に効かない",
    );
    // 左の画面の形の崩れ（11/3 の③の実測）: 札の図 38%×43%・名前と件数の帯 100%×18%・着順の流れの上だけ。18-10 の形は通る
    {
      const at = (k, w, h, extra = {}) => ({
        file: `/x/${k}.png`,
        clip: { x: 0, y: 0, w, h },
        scale: 1,
        minFontPx: 30,
        ...extra,
      });
      const W = 1136;
      const H = 838;
      const broken = {
        c3i: at("c3i", W * 0.38, H * 0.43),
        c3: at("c3", W, H * 0.18),
        "c3-pre": at("c3-pre", W, H * 0.72, { crop: "top" }),
        c32: at("c32", W, H * 0.72, { crop: "top" }),
      };
      const r = f01LayoutChapters({ chapters: [{ id: "c3" }] }, broken);
      assert.equal(r.length, 1);
      assert.ok(
        /c3 が左の枠の 100%×18%/.test(r[0].reason) &&
          /c3-pre は部品の上だけ/.test(r[0].reason),
        r[0].reason,
      );
      const ok = {
        c3: at("c3", W, H * 0.58),
        "c3-pre": at("c3-pre", W * 0.74, H),
        c32: at("c32", W * 0.74, H),
      };
      assert.deepEqual(
        f01LayoutChapters({ chapters: [{ id: "c3" }] }, ok),
        [],
        "18-10 の③は通る",
      );
      // 小さな図（右半分以上が空く）
      assert.equal(
        f01LayoutChapters(
          { chapters: [{ id: "c3" }] },
          { ...ok, c3: at("c3", W * 0.38, H * 0.43) },
        ).length,
        1,
        "札の図だけが小さいと止める",
      );
      // ②の着順の流れの全体（18-10 の形）・④・締め（100%×52%）は通る。部品の一部だけ（crop）は ② でも止める
      const c2 = {
        c2: at("c2", W, H * 0.73),
        "c2-pre": at("c2-pre", W * 0.74, H),
        c22: at("c22", W * 0.74, H),
      };
      assert.ok(
        /c22 は部品の上だけ/.test(
          f01LayoutChapters(
            { chapters: [{ id: "c2" }] },
            { ...c2, c22: at("c22", W, H * 0.72, { crop: "top" }) },
          )[0]?.reason ?? "",
        ),
        "②も部品の一部だけは止める",
      );
      // 同じ部品のいちばん小さい倍率で描く（f01Timeline）ので、その倍率で測る（自分の倍率では届いても、描くと小さい）
      const g2 = {
        c3: at("c3", 400, 120, { scale: 2.9 }),
        "c3-pre": at("c3-pre", 400, 130, { scale: 1.2 }),
        c32: at("c32", 400, 130, { scale: 2.9 }),
      };
      assert.ok(
        /c3 が左の枠の/.test(
          f01LayoutChapters({ chapters: [{ id: "c3" }] }, g2)[0]?.reason ?? "",
        ),
        "同じ部品の小さい倍率で測る",
      );
      assert.deepEqual(
        f01LayoutChapters(
          { chapters: [{ id: "c2" }, { id: "c4" }] },
          {
            ...c2,
            c4: at("c4", W, H * 0.52),
            c4b: at("c4b", W, H * 0.61),
            c42: at("c42", W, H * 0.52),
            c42b: at("c42b", W, H * 0.61),
          },
        ),
        [],
      );
    }
    // 押す前のカットのカーソルは、撮影用の頁が返したそのカットの座標（押す1着の四角）を指す。
    // 撮る側の組（group）でそろえる倍率は、切り抜きの位置・大きさが違っても同じ組の中のいちばん小さい倍率
    {
      const full = { x: 0, y: 0, w: 440, h: 440 };
      const band = { x: 61, y: 300, w: 24, h: 90 };
      const shots3 = {
        c2: sh("c2", 26.4),
        "c2-pre": {
          ...sh("c2-pre", 22.5, full),
          cursor: band,
          group: "flow-similar",
          scale: 1.9,
        },
        c22: {
          ...sh("c22", 22.5, { ...full, h: 470 }),
          cursor: band,
          group: "flow-similar",
          scale: 1.78,
        },
      };
      const l3 = [
        "次に、類似レースのタブ。",
        "1号艇が勝った313件では、2着は2号艇が137件で最も多い。",
      ];
      const v3 = {
        lines: l3.map((sub, i) => ({
          chapter: "c2",
          i,
          sub,
          file: `w${i}.wav`,
          sec: 4,
        })),
      };
      const cuts3 = f01Timeline(
        { chapters: [{ id: "c2", name: "類似レース", subs: l3 }] },
        v3,
        shots3,
      ).props.chapters[0].cuts;
      const pre = cuts3.find((c) => c.file === "c2-pre.png");
      assert.ok(
        pre.cursor.y === band.y && pre.cursor.x === band.x,
        `カーソルが押す前のカットの中の1着の四角を指す（y=${pre.cursor.y}）`,
      );
      assert.deepEqual(
        cuts3.filter((c) => c.file !== "c2.png").map((c) => c.scale),
        [1.78, 1.78],
        "同じ組は同じ倍率",
      );
    }
    assert.deepEqual(
      f01SmallChapters(
        { chapters: [{ id: "c2" }] },
        {
          c2: sh("c2", 26.4),
          "c2-pre": sh("c2-pre", 22.5),
          c22: sh("c22", 22.4),
        },
      ),
      [],
      "18-10 の②（着順の流れ 22.4px）は線の上",
    );
    assert.deepEqual(
      f01SmallChapters(
        { chapters: [{ id: "c2" }] },
        {
          c2: sh("c2", 26.4),
          "c2-pre": sh("c2-pre", 22.5),
          c22: sh("c22", 21.9),
        },
      ).map((x) => x.id),
      ["c2"],
      "22px を下回る着順の流れは省く",
    );
    const lines = [
      "ここからは思考アシスト。",
      "軸を選ぶと、相手の割合が出る。",
      "大村で1号艇が1着の11,160件では、",
      "2着は2号艇が34.7%。",
      "軸を4号艇に変えると、1,375件で、",
      "2着は1号艇が37%に入れ替わる。",
    ];
    const voice = {
      lines: lines.map((sub, i) => ({
        chapter: "c4",
        i,
        sub,
        file: `v${i}.wav`,
        sec: 2,
      })),
    };
    const shots2 = {
      ...shots1,
      c42: { ...sh("c42", 29.8), cursorFrom: { x: 1, y: 1, w: 10, h: 10 } },
      c42b: sh("c42b", 31.1, { x: 8, y: 0, w: 380, h: 170 }),
    };
    const { props } = f01Timeline(
      { chapters: [{ id: "c4", name: "相手", subs: lines }] },
      voice,
      shots2,
    );
    const cuts = props.chapters[0].cuts;
    assert.deepEqual(
      cuts.map((c) => c.file),
      ["c4.png", "c4b.png", "c4.png", "c42.png", "c42b.png"],
    );
    assert.ok(
      cuts.every((c, i) => i === 0 || c.from >= cuts[i - 1].from),
      "切り替えは時刻の順",
    );
    assert.ok(
      cuts[2].cursor && cuts[3].from === cuts[2].from + 15,
      "押す前の画面でカーソルを動かし、0.5秒後に押した後へ",
    );
    assert.equal(
      cuts[0].boxH,
      cuts[3].boxH,
      "同じ部品（軸のボタン）は同じ箱の高さ（切り替えで位置がずれない）",
    );
    // 章を省いても（声は voice.lines に残る）動画の時間の並びを作れる（Codex P1 #2075: audio.find が undefined で落ちた）
    const voice2 = {
      lines: [
        ...voice.lines,
        { chapter: "c3", i: 0, sub: "省いた章の声", file: "c3-0.wav", sec: 3 },
      ],
    };
    const r2 = f01Timeline(
      { chapters: [{ id: "c4", name: "相手", subs: lines }] },
      voice2,
      shots2,
    );
    assert.ok(
      r2.props.total > 0 && !r2.props.audio.some((x) => x.file === "c3-0.wav"),
      "省いた章の声は置かない",
    );
  }
  // 照合は桁区切りを比べない（画面「1,553件」・台本「1553件」で 11/01 14-10 が止まった）
  {
    const s4 = {
      chapters: [
        {
          id: "c3",
          voice: "",
          subs: [],
          expect: ["横一線"],
          expect2: ["1553件"],
        },
      ],
    };
    assert.deepEqual(
      f01Check(s4, {
        desc: VOICE.credit,
        kana: {},
        shots: { c3: { text: "横一線" }, c32: { text: "1 1,553件 2 512件" } },
      }),
      [],
    );
    const s5 = {
      chapters: [{ id: "c3", voice: "", subs: [], expect2: ["1,553件"] }],
    };
    assert.deepEqual(
      f01Check(s5, {
        desc: VOICE.credit,
        kana: {},
        shots: { c32: { text: "1553件" } },
      }),
      [],
    );
    assert.ok(
      f01Check(s5, {
        desc: VOICE.credit,
        kana: {},
        shots: { c32: { text: "1,552件" } },
      }).length === 1,
      "違う数は落とす",
    );
  }
  // 終了画面（オーナー 11/2「最後がバグっぽい」）: 締めの声・字幕が終わってから出す（字幕と重ならない）、終了画面では章の札を出さない、
  // YouTube Data API では終了画面の要素を設定できないので置き場の点線の枠を描かない
  {
    const { f01Timeline } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
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
      await import("../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const { chaptersOk } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/bundle.mjs");
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
    const jsx = readFileSync(
      new URL(
        "../../sns-video-studio/remotion/src/fullPicture/F01.jsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.ok(!/dashed/.test(jsx), "終了画面の置き場の点線の枠を描かない");
  }
  // 禁止表現・回収率・章の条件（Orchestrate 11/2）: わざと落ちる入力で、f01 の実行時の検査が落とすことを固定する
  {
    const { NO_RETURN_RATE } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
    const { chaptersOk } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/bundle.mjs");
    const base = {
      title: "ボートレース大村10R 準優勝戦 10/26｜1号艇を崩す材料はどの艇に？",
      chapters: [
        {
          id: "c2",
          voice: "類似レースの1着は1号艇が313件。",
          subs: ["類似レースの1着は1号艇が313件。"],
          answer: "1着 1号艇 313件",
        },
      ],
    };
    const ok = (s6, desc = VOICE.credit) =>
      f01Check(s6, { desc, kana: {}, shots: {} });
    assert.deepEqual(ok(base), [], "ふつうの文は通る");
    // banned: risk-rules.json の禁止表現（「稼げる」は既存の「稼げ」で当たる）を、声・字幕・右の列・題・説明欄のどこに入れても落とす
    for (const w of ["必ず当たる", "稼げる", "万舟券", "儲かる"]) {
      assert.ok(
        ok({
          ...base,
          chapters: [{ ...base.chapters[0], voice: `${w}レース。` }],
        }).some((x) => x.startsWith("c2: 禁止表現")),
        `声の「${w}」`,
      );
      assert.ok(
        ok({ ...base, chapters: [{ ...base.chapters[0], answer2: w }] }).some(
          (x) => x.startsWith("c2: 禁止表現"),
        ),
        `右の列の「${w}」`,
      );
      assert.ok(
        ok({ ...base, title: `${base.title}${w}` }).some((x) =>
          x.startsWith("題: 禁止表現"),
        ),
        `題の「${w}」`,
      );
      assert.ok(
        ok(base, `${VOICE.credit}\n${w}`).some((x) =>
          x.startsWith("説明欄: 禁止表現"),
        ),
        `説明欄の「${w}」`,
      );
    }
    // no-return-rate: 回収率を出さない
    assert.ok(NO_RETURN_RATE.test("回収率"));
    assert.ok(
      ok({
        ...base,
        chapters: [{ ...base.chapters[0], subs: ["回収率は120%。"] }],
      }).some((x) => x.includes("回収率を出さない")),
      "字幕の回収率",
    );
    assert.ok(
      ok(base, `${VOICE.credit}\n回収率`).some((x) =>
        x.includes("回収率を出さない"),
      ),
      "説明欄の回収率",
    );
    // chapters: 0:00 から・3つ以上・各10秒以上でなければ落とす（run-full の qa.chapters。f01Chapters は短い最後の章を前に含める）
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n1:00 締め\n", 80),
      true,
    );
    assert.equal(
      chaptersOk("0:05 冒頭\n0:30 類似レース\n1:00 締め\n", 80),
      false,
      "0:00 から始まらない",
    );
    assert.equal(chaptersOk("0:00 冒頭\n0:30 締め\n", 80), false, "3つ未満");
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n0:35 締め\n", 80),
      false,
      "10秒未満の章",
    );
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n1:00 締め\n", 68),
      false,
      "最後の章が10秒未満",
    );
  }
  // 撮影の時間切れは1回だけ撮り直す（オーナー 11/2）。時間切れ以外はやり直さない、2回とも時間切れなら止める
  {
    const { retryOnTimeout } =
      await import("../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const timeout = () =>
      Object.assign(new Error("locator.click: Timeout 30000ms exceeded."), {
        name: "TimeoutError",
      });
    let n = 0;
    const warned = [];
    const r1 = await retryOnTimeout(
      async () => {
        n += 1;
        if (n === 1) throw timeout();
        return "shots";
      },
      (e) => warned.push(e.message),
    );
    assert.deepEqual(
      [r1.value, r1.retries, n, warned.length],
      ["shots", 1, 2, 1],
      "1回目が時間切れ・2回目が通る",
    );
    n = 0;
    await assert.rejects(
      retryOnTimeout(async () => {
        n += 1;
        throw timeout();
      }),
      (e) => e.name === "TimeoutError" && e.retries === 1 && n === 2,
      "2回とも時間切れなら止める（やり直しは1回だけ）",
    );
    n = 0;
    await assert.rejects(
      retryOnTimeout(async () => {
        n += 1;
        throw new Error("類似レースの1着の棒の行が見つからない");
      }),
      () => n === 1,
      "時間切れ以外はやり直さない",
    );
    assert.deepEqual(await retryOnTimeout(async () => "ok"), {
      value: "ok",
      retries: 0,
    });
  }
  // 選手名を声で読まない
  assert.ok(
    f01Check(
      { chapters: [{ id: "c1", voice: "西村は", subs: [] }] },
      { desc: VOICE.credit, kana: {}, shots: {}, names: ["西村"] },
    ).some((w) => w.includes("選手名")),
  );

  // 右の列と冒頭の棒に、艇番の隣の「フルネーム 級」（オーナーの恒久の決まり 2026-11-01。10/30 丸亀9R の f01.json では名前も級も0件だった）
  {
    for (const name of [
      "2026-10-12-01-12",
      "2026-10-15-15-10",
      "2026-10-16-24-11",
      "2026-10-19-19-10",
    ]) {
      const mf = f01Fixture(name);
      const s = f01Script(mf);
      const { racers } = racersOf(mf);
      assert.deepEqual(
        f01RacerCheck(s, racers),
        [],
        `${name}: 名前と級が出走表と一致し、6字の名前でも右の列に収まる`,
      );
      let named = 0;
      for (const id of ["open", "c1", "c2", "c3", "c4", "c5"]) {
        const c = s.chapters.find((x) => x.id === id);
        if (!c) continue;
        const texts = c.open
          ? c.open.bars.map((b) => `${b.boat}号艇${NB}${b.name}${NB}${b.grade}`)
          : [c.scope, c.answer, c.answer2].filter(Boolean);
        const boats = texts.join(" ").match(/\d号艇/g) ?? [];
        named += boats.length;
        // 今日の6艇の属性（c1・c5・冒頭の棒）は「N号艇 名前 級」、過去の集計（c2〜c4）は「N号艇（今日は名前 級）」
        const form = (b) =>
          ["c2", "c3", "c4"].includes(id)
            ? `${b}（今日は${racers[b[0]].name}${NB}${racers[b[0]].grade}）`
            : `${b}${NB}${racers[b[0]].name}${NB}${racers[b[0]].grade}`;
        for (const b of boats)
          assert.ok(
            texts.join(" ").includes(form(b)),
            `${name} ${id}: ${b}の隣に名前と級`,
          );
        // 範囲の行に名前を入れない（集計が個人の成績に読まれる。x-channel P0 #2079）
        for (const r of Object.values(racers))
          assert.ok(
            !(c.scope ?? "").includes(r.name),
            `${name} ${id}: 範囲の行に名前`,
          );
        // 行ごとの幅（見積りは Noto Sans JP の実測以上。2026-11-01 に Chromium で 10 種を測って確かめた）
        if (c.right)
          for (const k of ["scope", "answer", "answer2"])
            for (const l of c.right[k].lines)
              assert.ok(
                emWidth(l) * c.right[k].size <= RIGHT.w,
                `${name} ${id}: 「${l}」が幅を越える`,
              );
      }
      assert.ok(
        named >= 3,
        `${name}: 右の列に名前と級の付いた艇が出る（${named}）`,
      );
      // 声は艇番だけ（名前は読まない）
      for (const c of s.chapters)
        for (const n of F01_LONG_NAMES)
          assert.ok(!c.voice.includes(n), `${name} ${c.id}: 声に名前`);
    }
    // 短い名前（2〜3字）でも、艇と、その艇の数字を別の行に分けない（行末が級・行頭が数字だと、数字が次の艇のものに読める。/code-review #2079）
    for (const name of [
      "2026-10-12-01-12",
      "2026-10-15-15-10",
      "2026-10-16-24-11",
      "2026-10-19-19-10",
    ]) {
      const ms = f01Fixture(name, F01_SHORT_NAMES);
      const s = f01Script(ms);
      assert.deepEqual(f01RacerCheck(s, racersOf(ms).racers), [], name);
      for (const c of s.chapters.filter((x) => x.right?.ok))
        for (const k of ["answer2"])
          for (const l of c.right[k].lines)
            assert.ok(
              !/^[\d,.]+(件|項目|%)(・|$)/.test(l),
              `${name} ${c.id} ${k}: 「${l}」が数字から始まる（前の行の艇の数字が落ちた）`,
            );
    }
    // 艇と数字の組（例: c3 の2着の3艇）は、どの名前の長さでも同じ行
    {
      const lines = layoutRight({
        answer2: `2着${NB}2号艇${NB}西村${NB}A1${NB}1,041件・3号艇${NB}山田${NB}A1${NB}30件・4号艇${NB}佐藤${NB}A1${NB}20件`,
        path: "p",
      }).answer2.lines;
      assert.ok(
        lines.every((l) =>
          /号艇\u00a0[^\u00a0]+\u00a0[AB][12]\u00a0[\d,]+件$/.test(l),
        ),
        JSON.stringify(lines),
      );
    }
    // 出走表の読み方（艇番の対応、名前の空白を詰める、級が A1〜B2 でなければ欠け）
    {
      const r = racersOf({
        raceId: "x",
        api: {
          races: [
            {
              raceId: "x",
              entries: [
                { number: 2, name: "篠崎　　仁志", grade: "A1" },
                { number: 1, name: "梶原　　　正", grade: "B1" },
                { number: 3, name: "西村 拓也", grade: "x" },
              ],
            },
          ],
        },
      });
      assert.deepEqual(r.racers, {
        1: { name: "梶原正", grade: "B1" },
        2: { name: "篠崎仁志", grade: "A1" },
      });
      assert.deepEqual(r.missing, [3, 4, 5, 6]);
    }
    const mf = f01Fixture("2026-10-19-19-10");
    const s = f01Script(mf);
    const { racers } = racersOf(mf);
    // 範囲の行に名前を入れたら落とす。過去の集計の形「（今日は名前 級）」も出走表と照合する
    assert.ok(
      f01RacerCheck(
        {
          chapters: [
            {
              id: "c4",
              scope: `丸亀の全期間 3号艇${NB}${racers[3].name}${NB}${racers[3].grade}が1着`,
              answer: `軸 3号艇（今日は${racers[3].name}${NB}${racers[3].grade}）`,
              right: { ok: true, minFontPx: 32 },
            },
          ],
        },
        racers,
      ).some((w) => w.includes("範囲の行に選手名")),
    );
    assert.ok(
      f01RacerCheck(
        {
          chapters: [
            {
              id: "c4",
              answer: `軸 3号艇（今日は別人${NB}A1）`,
              right: { ok: true, minFontPx: 32 },
            },
          ],
        },
        racers,
      ).some((w) => w.includes("出走表")),
    );
    // 出走表と違う名前・級は落とす
    assert.ok(
      f01RacerCheck(s, {
        ...racers,
        1: { ...racers[1], grade: racers[1].grade === "A1" ? "A2" : "A1" },
      }).some((w) => w.includes("出走表")),
      "級の違いを落とす",
    );
    assert.ok(
      f01RacerCheck(s, { ...racers, 1: { ...racers[1], name: "別人" } }).some(
        (w) => w.includes("出走表"),
      ),
      "名前の違いを落とす",
    );
    // 艇番だけ（名前と級が隣に無い）を落とす
    const bare = {
      chapters: [
        {
          id: "c2",
          scope: "x",
          answer: "1着 1号艇 322件",
          right: layoutRight({ answer: "1着 1号艇 322件", path: "p" }),
        },
      ],
    };
    assert.ok(
      f01RacerCheck(bare, racers).some((w) => w.includes("名前と級が無い")),
      "艇番だけを落とす",
    );
    // 欠けたら作らない（黙って空にしない）
    for (const drop of [{ grade: null }, { name: "" }, { grade: "C1" }]) {
      const m2 = f01Fixture("2026-10-19-19-10");
      const race = m2.api.races.find((r) => r.raceId === m2.raceId);
      Object.assign(race.entries[2], drop);
      const r2 = f01Script(m2);
      assert.equal(r2.ok, false, JSON.stringify(drop));
      assert.equal(r2.kind, "racer_name_grade");
      assert.ok(r2.reason.includes("3号艇"));
    }
    // 右の列: 収まらなければ字を縮め、縮めても下の線を越えたら ok=false（その章は検査で落ちる）
    const six = [1, 2, 3, 4, 5, 6]
      .map((b) => `${b}号艇${NB}${F01_LONG_NAMES[b - 1]}${NB}A1`)
      .join("・");
    const lo = layoutRight({
      tag: "龍神ソナー ＞ 差がつく材料",
      scope: "今日の6艇・5項目",
      answer: `${six}\nそれぞれ 2項目`,
      answer2: "5項目のうち2位以内に入った数",
      path: "p",
    });
    assert.ok(
      !lo.ok || lo.answer.size < 64,
      "6艇が並ぶと字を縮めるか、収まらない",
    );
    const huge = layoutRight({
      answer: `${six}・${six}`,
      answer2: six,
      path: "p",
    });
    assert.equal(huge.ok, false, "下の線を越えたら収まらない");
    assert.ok(
      f01RacerCheck(
        { chapters: [{ id: "c1", answer: "x", right: huge }] },
        racers,
      ).some((w) => w.includes("右の列が収まらない")),
    );
    // 名前と級の塊は折り返さない（「品川二千翔」と「A1」が別の行に分かれない）
    const one = layoutRight({
      answer: `2着 1号艇${NB}${F01_LONG_NAMES[0]}${NB}A1 41.9%`,
      path: "p",
    });
    assert.ok(
      one.ok &&
        one.answer.lines.some((l) =>
          l.includes(`1号艇${NB}${F01_LONG_NAMES[0]}${NB}A1`),
        ),
    );
    // 本番の c4 の形（艇と割合の間も折り返さない空白）。名前5字＋割合が小数1桁の「2着 1号艇（今日は吉田凌太朗 A1） 38.5%」は
    // 最小の字（40px）でも1行が幅を越えた（2026-11-03 の 19-10、type_unsupported:f01_check）。割合の前で折れば収まる
    const racers19 = {
      1: { name: "吉田凌太朗", grade: "A1" },
      4: { name: "伊藤喜智", grade: "A2" },
    };
    const c4 = {
      tag: "思考アシスト ＞ 相手",
      scope: "下関の全期間・全選手 4号艇が1着 1,234件",
      path: "アシスト → 相手 → 軸",
      answer: `軸 ${boatToday(racers19, 4)}\n2着${NB}${boatToday(racers19, 1)}${NB}38.5%`,
      answer2: `軸 ${boatToday(racers19, 1)}なら\n2着${NB}${boatToday(racers19, 4)}${NB}38.5%`,
    };
    const lc4 = layoutRight(c4);
    assert.ok(lc4.ok, `${lc4.reason}`);
    assert.ok(
      lc4.wrapped && lc4.answer.lines.includes("38.5%"),
      "割合の前で折る",
    );
    assert.ok(
      lc4.answer.lines.every((l) => emWidth(l) * lc4.answer.size <= RIGHT.w),
    );
    // 収まる日の見た目は変えない（折らない）
    const short4 = layoutRight({
      ...c4,
      answer: `軸 ${boatToday(racers19, 4)}\n2着${NB}${boatToday(racers19, 4)}${NB}38.5%`,
    });
    assert.ok(short4.ok && !short4.wrapped);
  }
}

// ---- 後半の場面（verifyData/full-picture-scene2-a-10.js） ----
await runFullPictureScene2A21({ R, readFileSync, gunzipSync, FX, fixtures, f01Fixture });

console.log("verify-full-picture-scene2: OK");
