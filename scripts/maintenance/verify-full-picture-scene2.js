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
  MAX_WIDTH,
  allBeats,
  bannedIn,
  checkLines,
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
import { runFullPictureScene2A3, runFullPictureScene2A4 } from "./verifyData/full-picture-scene2-a-2.js";
import {
  sumWidth,
  runFullPictureScene2A9,
  runFullPictureScene2A10,
  runFullPictureScene2A11,
} from "./verifyData/full-picture-scene2-a-4.js";

import {
  runFullPictureScene2A5,
  runFullPictureScene2A6,
  runFullPictureScene2A7,
  runFullPictureScene2A8,
} from "./verifyData/full-picture-scene2-a-3.js";
import { runFullPictureScene2A12 } from "./verifyData/full-picture-scene2-a-5.js";
import { runFullPictureScene2A13 } from "./verifyData/full-picture-scene2-a-6.js";



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
import { runFullPictureScene2C1, runFullPictureScene2C2 } from "./verifyData/full-picture-scene2-c-1.js";
import {
  runFullPictureScene2C3,
  runFullPictureScene2C4,
  runFullPictureScene2C5,
  runFullPictureScene2C6,
  runFullPictureScene2C7,
  runFullPictureScene2C8,
  runFullPictureScene2C9,
} from "./verifyData/full-picture-scene2-c-2.js";
import { runFullPictureScene2C10, runFullPictureScene2C11 } from "./verifyData/full-picture-scene2-c-3.js";
import { runFullPictureScene2C12 } from "./verifyData/full-picture-scene2-c-4.js";
import { runFullPictureScene2C13 } from "./verifyData/full-picture-scene2-c-5.js";
import { runFullPictureScene2C14 } from "./verifyData/full-picture-scene2-c-6.js";

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
const { answerOf, scopeLabel } = await import(
  `${R}/scripts/full-picture/answer.mjs`
);
const { buildBundle } = await import(`${R}/scripts/full-picture/bundle.mjs`);
const { listTypes } = await import(`${R}/scripts/full-picture/type-spec.mjs`);
const {
  mkdtempSync: mkdtempSyncB1442,
  writeFileSync: wf4,
  readFileSync: rf4,
} = await import("node:fs");
const { tmpdir } = await import("node:os");
const { spawnSync: spawnSyncB1442 } = await import("node:child_process");
// 答えは形を問わない割合（予想の形の過去の差は今日に引き継がれない。BOA-1096）。評価の言葉は使わない
const tri = (k1, other) => ({ "1-2-3": k1, "2-1-3": other });

// ---- 後半の場面（verifyData/full-picture-scene2-c-1.js） ----
runFullPictureScene2C1({ R, answerOf, scopeLabel, buildBundle, tri });
// run-full --type-spec v2r1: 冒頭の答えの頁、入口版の結論は形を問わない着順の流れ（冒頭と同じ母数）
{
  const tmp = mkdtempSyncB1442(`${tmpdir()}/fp-v2r1-`);
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
  const r = spawnSyncB1442(
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-1.js・full-picture-scene2-c-2.js） ----
await runFullPictureScene2C2({ R, answerOf, scopeLabel, buildBundle, tri });
runFullPictureScene2C3({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures });
// .env.local からは材料の取得の匿名の2つだけを読む
const { mkdtempSync, writeFileSync: wf2 } = await import("node:fs");
const { tmpdir: td } = await import("node:os");
const envFile = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
runFullPictureScene2C4({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile });
// /api の合言葉（BOA-1110 段階1）があれば、それも読む（送信の鍵は読まないまま）
const envFileKey = `${mkdtempSync(`${td()}/fp-env-`)}/.env.local`;

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
runFullPictureScene2C5({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey });
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
runFullPictureScene2C6({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
runFullPictureScene2C7({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js） ----
await runFullPictureScene2C8({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily });
const { execFileSync: ex, spawnSync: sp } =
  await import("node:child_process");

// ---- 後半の場面（verifyData/full-picture-scene2-c-2.js・full-picture-scene2-c-3.js） ----
await runFullPictureScene2C9({ scene, R, buildAll, readFileSync, gunzipSync, FX, fixtures, wf2, envFile, envFileKey, daily, cleanEnv, runDaily, sp, ex });
runFullPictureScene2C10({ buildAll });
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-3.js・full-picture-scene2-c-4.js） ----
runFullPictureScene2C11({ buildAll });
await runFullPictureScene2C12();
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

// ---- 後半の場面（verifyData/full-picture-scene2-c-5.js・full-picture-scene2-c-6.js） ----
await runFullPictureScene2C13();
await runFullPictureScene2C14({ R, readFileSync, gunzipSync, FX, fixtures });

console.log("verify-full-picture-scene2: OK");
