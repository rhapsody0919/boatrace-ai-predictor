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
{
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
  // 今節の走は facts の racers.boats[].meet_runs（固定の材料は racers を写していないので足す）。1号艇は2走（2走目は結果の行が無い）、3号艇は racers に無い
  // 進入の分布は facts の racers.boats[].course_entry（racer_aggregated_stats）。1号艇は全国と会場の分、2号艇は行が無い、
  // 4号艇は集計がこのレース以後の出走を含む（after_race）、5号艇はこの枠の進入が無い
  const courseEntry = {
    1: {
      since: "2025-10-11",
      calculated_at: "2026-10-11T14:23:07+00:00",
      all: { 1: { n: 36, courses: { 1: 35, 2: 1 } } },
      venue: { 1: { n: 3, courses: { 1: 3 } } },
    },
    5: {
      since: "2025-10-11",
      calculated_at: "2026-10-11T14:23:07+00:00",
      all: { 1: { n: 2, courses: { 1: 2 } } },
      venue: null,
    },
  };
  m.api.facts.racers = {
    meet_start: "2026-10-10",
    boats: [1, 2, 4, 5, 6].map((n) => ({
      boat_number: n,
      course_entry: courseEntry[n] ?? null,
      after_race: n === 4,
      meet_runs:
        n === 1
          ? [
              { race_id: "2026-10-11-01-03", boat_number: 2 },
              { race_id: "2026-10-10-01-05", boat_number: 4 },
              { race_id: "2026-10-12-01-02", boat_number: 1 },
            ]
          : [],
    })),
  };
  const startRows = [
    {
      race_id: "2026-10-10-01-05",
      boat_number: 4,
      finish_mark: "1",
      finish_rank: 1,
    },
    {
      race_id: "2026-10-11-01-03",
      boat_number: 2,
      finish_mark: "F",
      finish_rank: null,
    },
  ];
  const entryRows = [1, 2, 3, 4, 5].map((n) => ({
    boat_number: n,
    racer_id: 4000 + n,
    f_count: n === 1 ? 1 : n === 5 ? null : 0,
    grade: n === 2 ? "A1" : "B1",
  }));
  const technique = {
    venue_technique_period_stats: [
      {
        period_days: 90,
        winning_technique: "逃げ",
        race_count: 388,
        total_races: 660,
        period_from: "2026-07-27",
        period_to: "2026-10-24",
        last_updated: "2026-10-25",
      },
    ],
    // 1号艇の抜きは percentage の小さい行を先に置く（画面と同じく percentage の降順で主な決まり手を選ぶか）
    winning_technique_stats: [
      {
        boat_number: 1,
        winning_technique: "抜き",
        count_90days: 27,
        total_races: 412,
        percentage: 6.55,
        last_updated: "2026-10-25",
      },
      {
        boat_number: 1,
        winning_technique: "逃げ",
        count_90days: 385,
        total_races: 412,
        percentage: 93.45,
        last_updated: "2026-10-25",
      },
    ],
  };
  // 全国×枠（2026-10-26 hq 依頼、FT01）: 1着率は固定の材料の api.outcome（24会場）、決まり手は
  // winning_technique_stats の全会場の行（各会場 1号艇 逃げ10・抜き2、会場1だけ恵まれ1）
  const VENUES24 = Array.from({ length: 24 }, (_, i) => i + 1);
  let techAll = VENUES24.flatMap((venue_code) => [
    {
      venue_code,
      boat_number: 1,
      winning_technique: "逃げ",
      count_90days: 10,
      last_updated: "2026-10-11",
    },
    {
      venue_code,
      boat_number: 1,
      winning_technique: "抜き",
      count_90days: 2,
      last_updated: "2026-10-11",
    },
    ...(venue_code === 1
      ? [
          {
            venue_code,
            boat_number: 1,
            winning_technique: "恵まれ",
            count_90days: 1,
            last_updated: "2026-10-11",
          },
        ]
      : []),
  ]);
  // 選手のコース別の成績・会場のコース別の決まり手（2026-10-25 hq 依頼、FT01 優勝戦の思考の材料）。固定の材料の日は 2026-10-12
  const date = m.raceId.slice(0, 10);
  const tech = (racer_id, course, over = {}) => ({
    racer_id,
    course,
    window_start: "2025-12-02",
    window_end: "2026-10-11",
    window_days: 314,
    runs: 25,
    nige_count: course === 1 ? 10 : null,
    nige_rate: course === 1 ? 40 : null,
    nige_expected: 54.48,
    makuri_count: 2,
    makuri_rate: 8,
    makuri_expected: 0,
    nigashi_count: course === 1 ? null : 12,
    nigashi_rate: course === 1 ? null : 48,
    nigashi_expected: 50,
    runs_90d: 6,
    nige_rate_90d: course === 1 ? 50 : null,
    makuri_rate_90d: 0,
    nigashi_rate_90d: course === 1 ? null : 50,
    last_updated: "2026-10-12",
    ...over,
  });
  const cN = (c, v) =>
    Object.fromEntries(
      [
        "entries",
        "avg_st",
        "avg_start_rank",
        "f",
        "l0",
        "l1",
        "p1",
        "p2",
        "p3",
      ].map((f, i) => [
        `c${c}_${f}`,
        f === "avg_st" ? 0.15 + v / 100 : f === "avg_start_rank" ? 2.5 : v + i,
      ]),
    );
  const period = (racer_id, period_year, period_no, calc_to, v) => ({
    racer_id,
    period_year,
    period_no,
    calc_to,
    ...[1, 2, 3, 4, 5, 6].reduce(
      (o, c) => ({ ...o, ...cN(c, v * 10 + c) }),
      {},
    ),
  });
  const racerTables = {
    // 1号艇 1コース（欠けなし）、2号艇 2コースは行が無い、3号艇は展示の進入 4コース（レースの日を含む集計）、4号艇 3コース、5号艇は枠番の5コース
    racer_course_technique_stats: [
      tech(4001, 1),
      tech(4001, 2),
      tech(4003, 3),
      tech(4003, 4, { window_end: date }),
      tech(4004, 3),
      tech(4005, 5),
    ],
    // 1号艇は締めた期（2026-04-30）とレースの日より後に締めた期（2026-10-31）。後者は使わない。2号艇は期が無い
    racer_period_stats: [
      period(4001, 2026, 1, "2026-04-30", 1),
      period(4001, 2026, 2, "2026-10-31", 9),
      period(4001, 2025, 2, "2025-10-31", 2),
      period(4003, 2026, 1, "2026-04-30", 3),
      period(4004, 2026, 1, "2026-04-30", 4),
      period(4005, 2026, 1, "2026-04-30", 5),
    ],
  };
  const vRow = (race_grade, course, over = {}) => ({
    venue_code: m.venueCode,
    race_grade,
    course,
    runs: 136,
    nige_rate: course === 1 ? 62.2 : null,
    makuri_rate: course === 1 ? 0 : 5.1,
    nigashi_rate: course === 1 ? null : 62.2,
    window_start: "2025-12-02",
    window_end: "2026-10-11",
    last_updated: "2026-10-12",
    ...over,
  });
  // G1 は6コースが欠け、ALL は6コースそろう
  // 全国×コース: 他の23会場の ALL（runs 1000・逃げ50%・まくり10.1%・逃がし50%）と、会場2の G1 の6コース（runs 50・まくり4%・逃がし52%）
  const otherVenues = [
    ...[1, 2, 3, 4, 5, 6].flatMap((c) =>
      VENUES24.filter((v) => v !== m.venueCode).map((v) =>
        vRow("ALL", c, {
          venue_code: v,
          runs: 1000,
          nige_rate: c === 1 ? 50 : null,
          makuri_rate: 10.1,
          nigashi_rate: c === 1 ? null : 50,
        }),
      ),
    ),
    vRow("G1", 6, {
      venue_code: 2,
      runs: 50,
      makuri_rate: 4,
      nigashi_rate: 52,
    }),
  ];
  let baseline = [
    ...[1, 2, 3, 4, 5].map((c) => vRow("G1", c)),
    ...[1, 2, 3, 4, 5, 6].map((c) => vRow("ALL", c, { runs: 2103 })),
    ...otherVenues,
  ];
  // 超展開データの元（予想 standard の racerStats、保存されたままの形）。2026-10-25 hq 依頼（FT01）
  // 1号艇: 勝ち10で選手の値 / 2号艇: 全枠の勝ちが4で参考 / 3号艇: 勝ちが1で全国平均の% / 4号艇: 決まり手の内訳が全国の既定 /
  // 5号艇: 勝ちは5号艇2・1号艇3の計5 / 6号艇: racerStats に無い
  const { COURSE_DEFAULT_DISTRIBUTION } =
    await import("../lib/winningTechniques.js");
  const racerStatsRaw = [
    {
      boatNumber: 1,
      course: 1,
      avgST: 0.15,
      courseRaceCounts: { 1: { total: 20, wins: 10 } },
      attackDistribution: { 1: { nige: 0.9, nuki: 0.1 } },
      defenseDistribution: { 1: { sashi: 0.5, makuri: 0.3, makurizashi: 0.2 } },
    },
    {
      boatNumber: 2,
      course: 2,
      avgST: 0.15,
      courseRaceCounts: { 2: { total: 30, wins: 4 } },
      attackDistribution: {
        2: { sashi: 0.5, makuri: 0.25, makurizashi: 0.25 },
      },
      defenseDistribution: {},
    },
    {
      boatNumber: 3,
      course: 3,
      avgST: 0.15,
      courseRaceCounts: { 3: { total: 10, wins: 1 } },
      attackDistribution: { 3: { makuri: 1 } },
      defenseDistribution: {},
    },
    {
      boatNumber: 4,
      course: 4,
      avgST: 0.15,
      courseRaceCounts: { 4: { total: 25, wins: 5 } },
      attackDistribution: structuredClone(COURSE_DEFAULT_DISTRIBUTION),
      defenseDistribution: {},
    },
    {
      boatNumber: 5,
      course: 5,
      avgST: 0.15,
      courseRaceCounts: { 5: { total: 12, wins: 2 }, 1: { total: 3, wins: 3 } },
      attackDistribution: { 5: { makurizashi: 1 } },
      defenseDistribution: {},
    },
  ];
  let failRacer = null;
  let predictionRows = [
    { racerStats: racerStatsRaw, predicted_at: `${date}T00:10:00+00:00` },
  ];
  const stBaseline = [
    {
      course: 2,
      grade: "A1",
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      runs: 12000,
      stable_rate: 67.04,
      late_rate: 12.06,
      breakout_rate: 7.5,
    },
  ];
  // 2号艇の選手（4002）のこのレースより前の5走。どれも2号艇・2コース進入。1号艇の ST を並べてレースの最速を決める
  //   r1: 自 .15・最速 .12（差 .03 で安定） / r2: 自 .10・1号艇 .18（最速で安定、内より .08 早く抜出） / r3: F / r4: L（ST なし） /
  //   r5: 自 .30・最速 .14（差 .16 で出遅れ）。有効な ST は .15・.10・.30
  const pastIds = [
    "2026-10-01-01-01",
    "2026-10-02-01-01",
    "2026-10-03-01-01",
    "2026-10-04-01-01",
    "2026-10-05-01-01",
  ];
  const pastSt = [
    [0.15, 0.12],
    [0.1, 0.18],
    [0.02, 0.15],
    [null, 0.13],
    [0.3, 0.14],
  ];
  const scoped = {
    entries: pastIds.map((race_id) => ({
      race_id,
      boat_number: 2,
      grade: "A1",
      f_count: 0,
    })),
    races: pastIds.map((race_id) => ({
      race_id,
      race_date: race_id.slice(0, 10),
      venue_code: 1,
      race_grade: "ippan",
    })),
    results: pastIds.map((race_id) => ({
      race_id,
      rank1: 1,
      rank2: 3,
      rank3: 4,
      rank4: 5,
      rank5: 6,
      rank6: 2,
      race_status: null,
      actual_course_1: 1,
      actual_course_2: 2,
      actual_course_3: 3,
      actual_course_4: 4,
      actual_course_5: 5,
      actual_course_6: 6,
      winning_technique: "逃げ",
      payout_win: 150,
    })),
    st: pastIds.flatMap((race_id, i) => [
      {
        race_id,
        boat_number: 1,
        start_timing: pastSt[i][1],
        is_flying: false,
        finish_mark: "1",
        entry_course: 1,
      },
      {
        race_id,
        boat_number: 2,
        start_timing: pastSt[i][0],
        is_flying: i === 2,
        finish_mark: i === 3 ? "L" : i === 2 ? "F" : "6",
        entry_course: 2,
      },
    ]),
  };
  // 3号艇の選手（4003）の走（2026-10-25 hq 依頼、FT01 の PR A）。今節（会場1の10/10・10/11）と別の会場の1走
  //   10/10 5R: 3号艇・実進入2（前づけ）・ST .12・1着（差し）・F持ち（f_count 1）・風6m・波5cm・展示1位
  //   10/11 3R: 3号艇・実進入3（枠なり）・ST .16・2着・F無し（f_count 0）・風2m・波2cm
  //   9/01 1R（会場2）: 1号艇・実進入1・ST .11・1着・F数なし（null）・風7m・波0cm
  const r3 = {
    a: "2026-10-10-01-05",
    b: "2026-10-11-01-03",
    c: "2026-09-01-02-01",
  };
  const res = (race_id, over) => ({
    race_id,
    rank1: 1,
    rank2: 2,
    rank3: 4,
    rank4: 5,
    rank5: 6,
    rank6: 3,
    race_status: null,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 3,
    actual_course_4: 4,
    actual_course_5: 5,
    actual_course_6: 6,
    winning_technique: "逃げ",
    payout_win: 150,
    payout_place_1: 110,
    payout_place_2: 120,
    ...over,
  });
  const scoped3 = {
    entries: [
      { race_id: r3.c, boat_number: 1, grade: "B1", f_count: null },
      { race_id: r3.a, boat_number: 3, grade: "B1", f_count: 1 },
      { race_id: r3.b, boat_number: 3, grade: "B1", f_count: 0 },
    ],
    races: [r3.a, r3.b, r3.c].map((race_id) => ({
      race_id,
      race_date: race_id.slice(0, 10),
      venue_code: Number(race_id.slice(11, 13)),
      race_grade: "ippan",
    })),
    results: [
      res(r3.a, {
        rank1: 3,
        rank2: 1,
        rank3: 2,
        rank6: 4,
        actual_course_3: 2,
        actual_course_2: 3,
        winning_technique: "差し",
      }),
      res(r3.b, { rank2: 3, rank3: 2 }),
      res(r3.c, {}),
    ],
    st: [
      {
        race_id: r3.a,
        boat_number: 3,
        start_timing: 0.12,
        is_flying: false,
        finish_mark: "1",
        entry_course: 2,
      },
      {
        race_id: r3.b,
        boat_number: 3,
        start_timing: 0.16,
        is_flying: false,
        finish_mark: "2",
        entry_course: 3,
      },
      {
        race_id: r3.c,
        boat_number: 1,
        start_timing: 0.11,
        is_flying: false,
        finish_mark: "1",
        entry_course: 1,
      },
    ],
    ex: [
      { race_id: r3.a, boat_number: 3, exhibition_time: 6.7 },
      { race_id: r3.a, boat_number: 1, exhibition_time: 6.8 },
      { race_id: r3.b, boat_number: 3, exhibition_time: 6.75 },
    ],
    conditions: [
      {
        race_id: r3.a,
        race_stage: "予選",
        race_title: "x杯",
        weather: "晴",
        wind_speed: 6,
        wave_height: 5,
        series_day: 3,
        is_final_day: false,
      },
      {
        race_id: r3.b,
        race_stage: "予選",
        race_title: "x杯",
        weather: "曇り",
        wind_speed: 2,
        wave_height: 2,
        series_day: 4,
        is_final_day: false,
      },
      {
        race_id: r3.c,
        race_stage: "一般",
        race_title: "y杯",
        weather: "雨",
        wind_speed: 7,
        wave_height: 0,
        series_day: 1,
        is_final_day: false,
      },
    ],
  };
  let failConditions = false;
  let failExhibition = false;
  let accidentRows = [
    {
      racer_id: 4003,
      starts: 40,
      incidents: [
        { race_id: r3.c, code: "F", stage: null },
        { race_id: r3.a, code: "S2", stage: "予選" },
      ],
    },
  ];
  const rpcBodies = [];
  // オリジナル展示: 会場は 一周・まわり足・直線 の3項目（半周ラップが無い）。2号艇の直線は欠測、6号艇は値の行が無い
  let origHeader = [
    {
      measure_status: 1,
      item_count: 3,
      item_labels: "一周|まわり足|直線",
      updated_at: `${date}T06:50:00+00:00`,
    },
  ];
  let origValues = [1, 2, 3, 4, 5].flatMap((n) =>
    [
      ["一周", 37 + n / 10],
      ["まわり足", 5.5 + n / 100],
      ["直線", n === 2 ? null : 7 + n / 100],
    ].map(([kind, value]) => ({
      boat_number: n,
      kind,
      value: value === null ? null : String(value),
      updated_at: `${date}T06:50:00+00:00`,
    })),
  );
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
  // 優勝戦の成績・優出・優勝回数（2026-10-26 hq 依頼、FT01 の PR B の 5）。本体の優勝戦（固定の材料の日 2026-10-12 より前）:
  //   Y1 1/10: 4001 1号艇 1着 / 4002 2号艇 欠 / 4003 3号艇 F / 4005 5号艇 6着だが race_entries.is_absent
  //   Y2 3/05: 4001 3号艇 2着 / 4003 2号艇 着の表記なしで rank1=2（1着） / 4004 1号艇 L
  //   Y3 4/01 不成立（no_race） / Y4 5/01 中止（cancellation_status） / Y5 6/01 結果の行なし（いずれも 4001 1号艇）
  //   Y6 10/13（このレースの後）・Y0 2025-12-02（本体の窓の前、長期のアーカイブの日）は問い合わせの範囲の外
  // 長期のアーカイブ（既定は匿名で読めない 401）: K1 2024-05-05 は 4001 1号艇 01・4002 2号艇 S1・4003 4号艇 K0、K2 2023-01-01 は結果なし
  const Y = {
    y0: "2025-12-02-09-12",
    y1: "2026-01-10-01-12",
    y2: "2026-03-05-02-12",
    y3: "2026-04-01-03-12",
    y4: "2026-05-01-04-12",
    y5: "2026-06-01-05-12",
    y6: "2026-10-13-01-12",
  };
  const finals = {
    stage: Object.values(Y).map((race_id) => ({ race_id })),
    entries: [
      [Y.y0, 1, 4001],
      [Y.y1, 1, 4001],
      [Y.y1, 2, 4002],
      [Y.y1, 3, 4003],
      [Y.y1, 5, 4005, true],
      [Y.y2, 3, 4001],
      [Y.y2, 2, 4003],
      [Y.y2, 1, 4004],
      [Y.y3, 1, 4001],
      [Y.y4, 1, 4001],
      [Y.y5, 1, 4001],
      [Y.y6, 1, 4001],
    ].map(([race_id, boat_number, racer_id, is_absent = false]) => ({
      race_id,
      boat_number,
      racer_id,
      is_absent,
    })),
    results: [
      [Y.y0, 1],
      [Y.y1, 1],
      [Y.y2, 2],
      [Y.y3, null, "no_race"],
      [Y.y4, 1],
      [Y.y6, 1],
    ].map(([race_id, rank1, race_status = "normal"]) => ({
      race_id,
      rank1,
      race_status,
    })),
    races: Object.values(Y).map((race_id) => ({
      race_id,
      cancellation_status: race_id === Y.y4 ? "confirmed" : null,
    })),
    st: [
      [Y.y1, 1, "1"],
      [Y.y1, 2, "欠"],
      [Y.y1, 3, "F"],
      [Y.y1, 5, "6"],
      [Y.y2, 3, "2"],
      [Y.y2, 2, null],
      [Y.y2, 1, "L"],
    ].map(([race_id, boat_number, finish_mark]) => ({
      race_id,
      boat_number,
      finish_mark,
    })),
    kbRaces: [
      { race_id: "2024-05-05-06-12", has_result: true },
      { race_id: "2023-01-01-07-12", has_result: false },
    ],
    kbBoats: [
      ["2024-05-05-06-12", 1, 4001, "01"],
      ["2024-05-05-06-12", 2, 4002, "S1"],
      ["2024-05-05-06-12", 4, 4003, "K0"],
      ["2023-01-01-07-12", 1, 4001, null],
    ].map(([race_id, boat_number, racer_id, finish_raw]) => ({
      race_id,
      boat_number,
      racer_id,
      finish_raw,
    })),
    // 4001: 5期（2026-10-31 締めはレースの日の後で使わない、5期目の 2024-04-30 は4期の外）/ 4003: 2期だけ / 4004: finals の無い期 / 4005: 4期 / 4002: 期なし
    periods: [
      [4001, 2027, 1, "2026-05-01", "2026-10-31", 9, 9],
      [4001, 2026, 2, "2025-11-01", "2026-04-30", 3, 1],
      [4001, 2026, 1, "2025-05-01", "2025-10-31", 2, 0],
      [4001, 2025, 2, "2024-11-01", "2025-04-30", 1, 1],
      [4001, 2025, 1, "2024-05-01", "2024-10-31", 4, 2],
      [4001, 2024, 2, "2023-11-01", "2024-04-30", 7, 7],
      [4003, 2026, 2, "2025-11-01", "2026-04-30", 1, 0],
      [4003, 2026, 1, "2025-05-01", "2025-10-31", 0, 0],
      [4004, 2026, 2, "2025-11-01", "2026-04-30", null, null],
      [4005, 2026, 2, "2025-11-01", "2026-04-30", 0, 0],
      [4005, 2026, 1, "2025-05-01", "2025-10-31", 1, 0],
      [4005, 2025, 2, "2024-11-01", "2025-04-30", 0, 0],
      [4005, 2025, 1, "2024-05-01", "2024-10-31", 2, 1],
    ].map(
      ([racer_id, period_year, period_no, calc_from, calc_to, fin, wins]) => ({
        racer_id,
        period_year,
        period_no,
        calc_from,
        calc_to,
        starts: 100,
        finals: fin,
        wins,
      }),
    ),
  };
  let kbReadable = false;
  let failFinals = null;
  const seenQueries = [];
  const listParam = (v) => (v ?? "").replace(/^in\.\(|\)$/g, "").split(",");
  const inIds = (q) =>
    listParam(q.get("race_id")).map((x) =>
      decodeURIComponent(x).replace(/"/g, ""),
    );
  // 優勝戦の成績・期の表の問い合わせの偽物（PostgREST の絞り込みの代わり）。該当しなければ undefined
  const finalsResponse = (table, q) => {
    const sel = q.get("select") ?? "";
    const fail = { ok: false, status: 503, json: async () => ({}) };
    if (table === "race_conditions" && q.get("race_stage")) {
      seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
      if (failFinals === "stage") return fail;
      const [, gte, lt] =
        q
          .get("and")
          ?.match(/^\(race_id\.gte\.([^,]+),race_id\.lt\.([^)]+)\)$/) ?? [];
      return q.get("race_stage") === "eq.優勝戦"
        ? finals.stage.filter((r) => r.race_id >= gte && r.race_id < lt)
        : [];
    }
    const racers = listParam(q.get("racer_id")).map(Number);
    if (table === "race_entries" && /is_absent/.test(sel))
      return finals.entries.filter(
        (r) => inIds(q).includes(r.race_id) && racers.includes(r.racer_id),
      );
    if (table === "race_results" && sel === "race_id,rank1,race_status")
      return finals.results.filter((r) => inIds(q).includes(r.race_id));
    if (table === "races" && /cancellation_status/.test(sel))
      return finals.races.filter((r) => inIds(q).includes(r.race_id));
    if (
      table === "race_start_timings" &&
      sel === "race_id,boat_number,finish_mark"
    )
      return finals.st.filter((r) => inIds(q).includes(r.race_id));
    if (table === "kb_archive_races") {
      seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
      return kbReadable
        ? finals.kbRaces
        : {
            ok: false,
            status: 401,
            json: async () => ({
              message: "permission denied for table kb_archive_races",
            }),
          };
    }
    if (table === "kb_archive_boats")
      return finals.kbBoats.filter(
        (r) => inIds(q).includes(r.race_id) && racers.includes(r.racer_id),
      );
    if (table === "racer_period_stats" && /finals/.test(sel)) {
      seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
      if (failFinals === "periods") return fail;
      const [, lt, gte] =
        q
          .get("and")
          ?.match(/^\(calc_to\.lt\.([\d-]+),calc_to\.gte\.([\d-]+)\)$/) ?? [];
      return finals.periods
        .filter(
          (r) =>
            racers.includes(r.racer_id) && r.calc_to < lt && r.calc_to >= gte,
        )
        .sort(
          (a, b) =>
            a.racer_id - b.racer_id || b.calc_to.localeCompare(a.calc_to),
        );
    }
    return undefined;
  };
  const run = async ({
    conditions,
    startTime = "16:06:00",
    ex = exRows,
    stage = "exhibition",
    racers = m.api.facts.racers,
    grade = "G1",
  }) => {
    const facts = { ...m.api.facts, racers };
    const json = (v) => ({ ok: true, status: 200, json: async () => v });
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.hostname === "sb.invalid") {
        const table = u.pathname.split("/").pop();
        const q = u.searchParams;
        const fr = finalsResponse(table, q);
        if (fr !== undefined) return Array.isArray(fr) ? json(fr) : fr;
        if (table === "get_racer_accident_records") {
          rpcBodies.push(JSON.parse(init.body));
          return accidentRows === "fail"
            ? { ok: false, status: 503, json: async () => ({}) }
            : json(accidentRows);
        }
        if (table === "race_original_exhibition") return json(origHeader);
        if (table === "race_original_exhibition_values")
          return json(origValues);
        if (table === "losing_technique_stats") {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          return json(losingRows);
        }
        if (
          table === "exhibition_data" &&
          q.get("race_id") === `eq.${m.raceId}`
        )
          return json(ex);
        // 選手 4003 の走の展示は偽物だけ（固定の材料のモーターの展示に同じ race_id の実の行がある）
        if (table === "exhibition_data" && failExhibition)
          return { ok: false, status: 503, json: async () => ({}) };
        if (table === "exhibition_data")
          return json(
            [
              ...(m.db.motor?.exhibition ?? []).filter(
                (r) => !Object.values(r3).includes(r.race_id),
              ),
              ...scoped3.ex,
            ].filter((r) => inIds(q).includes(r.race_id)),
          );
        // 選手の走の race_conditions（in.(...)）と、このレースの気象（eq.）
        if (
          table === "race_conditions" &&
          q.get("race_id")?.startsWith("in.")
        ) {
          if (failConditions)
            return { ok: false, status: 503, json: async () => ({}) };
          return json(
            scoped3.conditions.filter((r) => inIds(q).includes(r.race_id)),
          );
        }
        if (table === "race_conditions")
          return json(conditions === undefined ? [] : [conditions]);
        if (table === "race_entries" && q.get("race_id") === `eq.${m.raceId}`)
          return json(ex.length ? entryRows : []);
        // ST考察の元（選手の730日の走）。select に start_timing を含む問い合わせだけ
        if (
          table === "race_start_timings" &&
          /start_timing/.test(q.get("select") ?? "")
        )
          return json(
            [...scoped.st, ...scoped3.st].filter((r) =>
              inIds(q).includes(r.race_id),
            ),
          );
        if (table === "race_start_timings") return json(startRows);
        if (table === "race_entries" && q.get("racer_id")) {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          if (
            q.get("racer_id") === failRacer &&
            /grade/.test(q.get("select") ?? "")
          )
            return { ok: false, status: 503, json: async () => ({}) };
          if (/grade/.test(q.get("select") ?? ""))
            return json(
              q.get("racer_id") === "eq.4002"
                ? scoped.entries
                : q.get("racer_id") === "eq.4003"
                  ? scoped3.entries
                  : [],
            );
        }
        if (table === "races" && /race_date/.test(q.get("select") ?? ""))
          return json(
            [...scoped.races, ...scoped3.races].filter((r) =>
              inIds(q).includes(r.race_id),
            ),
          );
        if (
          table === "race_results" &&
          /actual_course_1/.test(q.get("select") ?? "")
        )
          return json(
            [...scoped.results, ...scoped3.results].filter((r) =>
              inIds(q).includes(r.race_id),
            ),
          );
        if (table === "predictions") {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          return json(predictionRows);
        }
        if (table === "st_course_baseline") return json(stBaseline);
        if (table === "races" && q.get("race_id") === `eq.${m.raceId}`)
          return json([{ start_time: startTime, race_grade: grade }]);
        // 全会場の集計表（会場で絞らない問い合わせ）は全国×枠の元
        if (table === "winning_technique_stats" && !q.get("venue_code")) {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          return json(techAll);
        }
        if (technique[table]) return json(technique[table]);
        if (racerTables[table]) {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          const ids = listParam(q.get("racer_id")).map(Number);
          const [, lt, gte] =
            q
              .get("and")
              ?.match(/^\(calc_to\.lt\.([\d-]+),calc_to\.gte\.([\d-]+)\)$/) ??
            [];
          // PostgREST の絞り込みと並べ替えの代わり（and=(calc_to.lt.,calc_to.gte.)・order=calc_to.desc）
          const rows = racerTables[table].filter(
            (r) =>
              ids.includes(r.racer_id) &&
              (!lt || (r.calc_to < lt && r.calc_to >= gte)),
          );
          return json(
            table === "racer_period_stats"
              ? [...rows].sort((a, b) => b.calc_to.localeCompare(a.calc_to))
              : rows,
          );
        }
        if (table === "venue_course_technique_baseline") {
          seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
          return json(
            baseline.filter((r) =>
              listParam(q.get("race_grade")).includes(r.race_grade),
            ),
          );
        }
        const map = {
          race_entries: m.db.racer1?.entries ?? [],
          races: m.db.racer1?.races ?? [],
          motor_pretest_stats: m.db.motor?.pretest ?? [],
          venue_motor_stats: m.db.motor?.stats ?? [],
        };
        return json(map[table] ?? []);
      }
      const p = u.pathname;
      if (p.startsWith("/api/analogy/facts/")) return json(facts);
      if (p.startsWith("/api/analogy/similar/")) return json(m.api.similar);
      if (p.startsWith("/api/analogy/scenario/")) return json(m.api.scenario);
      if (p.startsWith("/api/predictions/"))
        return json({ races: m.api.races });
      if (p === "/api/outcome-distribution")
        return json(m.api.outcome[u.searchParams.get("venue_code")]);
      return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
      const { fetchMaterials } = await import(
        `${R}/scripts/full-picture/fetch-materials.mjs`
      );
      return await fetchMaterials(m.raceId, { stage });
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const pre = {
    weather: "曇り",
    wind_direction: "北",
    wind_speed: 1,
    wave_height: 2,
    weather_observed_at: `${date}T05:51:00+00:00`,
  };
  const got = await run({ conditions: pre });
  assert.deepEqual(validate(got), [], "展示の後の材料も契約に合う");
  const { boats, conditions, technique: tq } = got.db.exhibition;
  assert.deepEqual(
    boats.map((b) => b.boat_number),
    [1, 2, 3, 4, 5, 6],
    "1〜6号艇を必ず並べる",
  );
  assert.deepEqual(
    {
      course: boats[0].exhibition_course,
      st: boats[0].start_timing,
      flag: boats[0].start_flag,
      time: boats[0].exhibition_time,
      tilt: boats[0].tilt,
      parts: boats[0].parts_changed,
      prop: boats[0].propeller_change,
    },
    {
      course: 1,
      st: 0.01,
      flag: "F",
      time: 6.7,
      tilt: 0,
      parts: ["リング", "ピストン"],
      prop: null,
    },
    "進入・展示 ST と F 表記・展示タイム・チルト・部品交換を出す",
  );
  assert.equal(boats[1].propeller_change, "新", "プロペラ交換を出す");
  // 追加の依頼（hq 10/25）: F 数（出走表の期の F 数）と今節の着順の並び
  assert.deepEqual(
    boats.map((b) => b.f_count),
    [1, 0, 0, 0, null, null],
    "F 数は出走表の f_count、欠けは null",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.5.f_count" && x.reason === "値が無い",
    ),
    "F 数の欠けを記録",
  );
  assert.deepEqual(
    boats[0].meet_finishes,
    [
      { race_id: "2026-10-10-01-05", finish_mark: "1", finish_rank: 1 },
      { race_id: "2026-10-11-01-03", finish_mark: "F", finish_rank: null },
      { race_id: "2026-10-12-01-02", finish_mark: null, finish_rank: null },
    ],
    "今節の着順は時系列（race_id の順）で、着の無い表記（F 等）は finish_mark に残す",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.meet_finishes" &&
        /着順の無い走が1件/.test(x.reason),
    ),
    "結果の無い走を記録",
  );
  assert.deepEqual(
    boats[1].meet_finishes,
    [],
    "今節の走が無い艇は空の並び（初走）",
  );
  assert.equal(boats[2].meet_finishes, null, "racers に無い艇は null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.3.meet_finishes"),
    "racers に無い艇を記録",
  );
  assert.deepEqual(
    [boats[2].exhibition_course, boats[3].exhibition_course],
    [4, 3],
    "進入は展示の並び（枠番と違ってよい）",
  );
  assert.equal(boats[4].tilt, null, "欠けたチルトは null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.5.tilt"),
    "欠けた欄を missing に記録",
  );
  assert.deepEqual(
    Object.entries(boats[5]).filter(
      ([k]) =>
        ![
          "boat_number",
          "meet_finishes",
          "course",
          "course_source",
          "original_exhibition",
        ].includes(k),
    ),
    Object.keys(boats[0])
      .filter(
        (k) =>
          ![
            "boat_number",
            "meet_finishes",
            "course",
            "course_source",
            "original_exhibition",
          ].includes(k),
      )
      .map((k) => [k, null]),
    "行の無い艇は全欄 null（今節の着順は facts から、進入コースは枠番で、オリジナル展示は別の表から別に取る）",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.6"),
    "行の無い艇を missing に記録",
  );
  assert.ok(
    !got.missing.some((x) =>
      /\.(start_flag|parts_changed|propeller_change)$/.test(x.source),
    ),
    "印・交換の null は「表示なし」で欠けにしない",
  );
  assert.deepEqual(
    conditions,
    {
      weather: "曇り",
      wind_direction: "北",
      wind_speed: 1,
      wave_height: 2,
      observedAt: pre.weather_observed_at,
    },
    "締切より前の風・波を出す",
  );
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.conditions")),
    "発走前の値がそろえば欠けなし",
  );
  assert.deepEqual(
    tq,
    {
      byPeriod: technique.venue_technique_period_stats,
      byBoat: technique.winning_technique_stats,
    },
    "決まり手の過去の分布は会場の既存の集計表をそのまま写す",
  );
  // 選手のコース別の成績（既存の表を写すだけ）。進入コースは展示の進入、無ければ枠番
  assert.deepEqual(
    boats.map((b) => b.today_weight),
    [52.3, 50, 51, 53, null, null],
    "展示の体重を出し、欠けは null",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.5.today_weight"),
    "体重の欠けを記録",
  );
  assert.deepEqual(
    boats.map((b) => [b.racer_id, b.course, b.course_source]),
    [
      [4001, 1, "exhibition_course"],
      [4002, 2, "exhibition_course"],
      [4003, 4, "exhibition_course"],
      [4004, 3, "exhibition_course"],
      [4005, 5, "boat_number"],
      [null, 6, "boat_number"],
    ],
    "進入コースと引いた元",
  );
  assert.deepEqual(
    boats[0].course_technique,
    {
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      window_days: 314,
      runs: 25,
      nige_count: 10,
      nige_rate: 40,
      makuri_count: 2,
      makuri_rate: 8,
      nigashi_count: null,
      nigashi_rate: null,
      runs_90d: 6,
      nige_rate_90d: 50,
      makuri_rate_90d: 0,
      nigashi_rate_90d: null,
      last_updated: "2026-10-12",
    },
    "その選手のその進入コースの逃げ・まくり・逃がしの回数と率、90日の率",
  );
  assert.equal(
    boats[2].course_technique?.window_end,
    date,
    "3号艇は展示の進入（4コース）の行を引く（枠番の3コースでない）",
  );
  assert.equal(
    boats[4].course_technique?.runs,
    25,
    "進入の無い艇は枠番のコースで引く",
  );
  assert.equal(boats[1].course_technique, null, "行の無い選手・コースは null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.course_technique" &&
        /2コースの行が無い/.test(x.reason),
    ),
    "行の無いコースを記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.course_technique" &&
        /racer_course_technique_stats はレースの日.*より後の集計/.test(
          x.reason,
        ),
    ),
    "レースの日を含む集計を記録",
  );
  assert.ok(
    !got.missing.some(
      (x) => x.source === "db.exhibition.boats.1.course_technique",
    ),
    "レースの日より前の集計なら欠けなし",
  );
  assert.deepEqual(
    boats[0].period_course,
    {
      period_year: 2026,
      period_no: 1,
      calc_to: "2026-04-30",
      course: 1,
      entries: 11,
      avg_st: 0.26,
      avg_start_rank: 2.5,
      f: 14,
      l0: 15,
      l1: 16,
      p1: 17,
      p2: 18,
      p3: 19,
    },
    "calc_to < レースの日 の最新の期の、その進入コースの cN_*（レースの日より後に締めた期は使わない）",
  );
  assert.deepEqual(
    [boats[2].period_course?.course, boats[2].period_course?.entries],
    [4, 34],
    "期の成績も進入コースの列（c4_*）",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("racer_period_stats?") && x.includes(`calc_to.lt.${date}`),
    ),
    "期は calc_to < レースの日 で読む",
  );
  assert.equal(boats[1].period_course, null, "期の無い選手は null");
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.boats.2.period_course"),
    "期の無い選手を記録",
  );
  assert.deepEqual(
    boats[0].entry_tendency,
    {
      boat_number: 1,
      n: 36,
      courses: { 1: 35, 2: 1 },
      venue: { n: 3, courses: { 1: 3 } },
      since: "2025-10-11",
      calculated_at: "2026-10-11T14:23:07+00:00",
    },
    "その枠の進入の分布と since",
  );
  assert.equal(boats[4].entry_tendency, null, "その枠の進入が無ければ null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.5.entry_tendency" &&
        /5号艇の進入が無い/.test(x.reason),
    ),
    "枠の進入が無いことを記録",
  );
  assert.equal(
    boats[3].entry_tendency,
    null,
    "集計がこのレース以後の出走を含めば null（API と同じ）",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.4.entry_tendency" &&
        /racer_aggregated_stats はレースの日.*より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.entry_tendency" &&
        /racers にこの艇が無い/.test(x.reason),
    ),
    "racers に無い艇を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.entry_tendency" &&
        /全国の行が無い/.test(x.reason),
    ),
    "行の無い選手を記録",
  );
  for (const k of ["course_technique", "period_course", "entry_tendency"]) {
    assert.equal(boats[5][k], null, `選手の分からない艇の ${k} は null`);
    assert.ok(
      got.missing.some(
        (x) =>
          x.source === `db.exhibition.boats.6.${k}` &&
          /選手が分からない/.test(x.reason),
      ),
      `選手の分からない艇の ${k} を記録`,
    );
  }
  // 会場のコース別の決まり手（レースのグレードと ALL の6コース）
  const vc = got.db.exhibition.venueCourse;
  assert.equal(vc?.race_grade, "G1", "レースのグレードで引く");
  assert.deepEqual(
    vc.courses[0],
    {
      course: 1,
      runs: 136,
      nige_rate: 62.2,
      makuri_rate: 0,
      nigashi_rate: null,
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      last_updated: "2026-10-12",
    },
    "会場・グレードのコース別の逃げ率・まくり率・逃がし率と窓",
  );
  assert.deepEqual(
    [vc.courses.length, vc.courses[5], vc.all.map((r) => r.runs)],
    [6, null, [2103, 2103, 2103, 2103, 2103, 2103]],
    "6コース並べ、行の無いコースは null",
  );
  assert.ok(
    got.missing.some((x) => x.source === "db.exhibition.venueCourse.G1.6"),
    "行の無いコースを記録",
  );
  assert.ok(
    !got.missing.some((x) => x.source === "db.exhibition.venueCourse"),
    "レースの日より前の集計なら欠けなし",
  );
  // ---- 全国×コース・会場×枠・全国×枠（2026-10-26 hq 依頼、FT01 オーナー「会場の特性を分岐の判定に使う」）----
  const {
    nationalCourseOf,
    BASELINE_GRADES,
    pctRound2,
    outcomeRowsOf,
    boatTendencyOf,
  } = await import(`${R}/scripts/full-picture/fetch-materials.mjs`);
  const { placeRatesByBoat, nationalWinRateByBoat } =
    await import("../../src/utils/venuePlaceRates.js");
  const nc = got.db.exhibition.nationalCourse;
  assert.equal(nc?.race_grade, "G1", "全国もレースのグレードと ALL");
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("venue_course_technique_baseline?") &&
        !/venue_code=eq/.test(x) &&
        /order=venue_code,race_grade,course/.test(x),
    ),
    "全国は同じ表の24会場の行を1回で読む",
  );
  // 会場1の ALL 1コース: 62.2%×2103 → 1308回、他の23会場: 50%×1000 → 500回ずつ
  assert.deepEqual(
    nc.all[0],
    {
      course: 1,
      runs: 2103 + 23000,
      venues: 24,
      nige_count: 1308 + 11500,
      nige_rate: 51.02,
      makuri_count: 0 + 23 * 101,
      makuri_rate: 9.25,
      nigashi_count: null,
      nigashi_rate: null,
      window_start: "2025-12-02",
      window_end: "2026-10-11",
      last_updated: "2026-10-12",
    },
    "全国の ALL 1コースは24会場の回数と走数の合計（RPC と同じ小数2桁の%）",
  );
  assert.deepEqual(
    [
      nc.courses[5]?.runs,
      nc.courses[5]?.venues,
      nc.courses[5]?.makuri_count,
      nc.courses[5]?.nigashi_count,
      nc.courses[5]?.nigashi_rate,
      nc.courses[5]?.nige_rate,
    ],
    [50, 1, 2, 26, 52, null],
    "行のある会場だけを足す（G1 の6コースは会場2だけ）。2〜6コースは逃がし率",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.nationalCourse" &&
        /会場1 G1 2コースの makuri_rate 5\.1 から回数に戻せない/.test(x.reason),
    ),
    "率から回数に戻せない行を記録（固定の材料の会場1の行は作り物）",
  );
  assert.ok(
    !got.missing.some(
      (x) =>
        x.source === "db.exhibition.nationalCourse" &&
        /より後の集計|窓が違う|会場だけ/.test(x.reason),
    ),
    "窓がそろい24会場あり、レースの日より前なら欠けなし",
  );
  const vb = got.db.exhibition.venueBoat;
  const screenRates = placeRatesByBoat(m.api.outcome[m.venueCode]);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => [
      vb.by_boat[n].win_rate,
      vb.by_boat[n].top2_rate,
      vb.by_boat[n].top3_rate,
    ]),
    screenRates.map((r) =>
      [r.winRate, r.top2Rate, r.top3Rate].map((v) => Number(v.toFixed(1))),
    ),
    "会場×枠の1着率・2連率・3連率は会場特徴カード（placeRatesByBoat）と同じ値の1桁",
  );
  assert.equal(
    vb.total_races,
    m.api.outcome[m.venueCode].total_races,
    "会場の90日のレース数",
  );
  assert.deepEqual(
    vb.by_boat[1].top_technique,
    { technique: "逃げ", percentage: 93.45 },
    "主な決まり手は percentage の最大（カードの techniques[0]）",
  );
  assert.deepEqual(
    [vb.by_boat[1].technique_total, vb.by_boat[1].techniques],
    [
      412,
      [
        { technique: "逃げ", count: 385, share: 93.4 },
        { technique: "抜き", count: 27, share: 6.6 },
      ],
    ],
    "決まり手の内訳は techniqueBreakdown（固定の順・1着の回数の中の割合）",
  );
  assert.deepEqual(
    [
      vb.by_boat[2].top_technique,
      vb.by_boat[2].technique_total,
      vb.by_boat[2].techniques,
    ],
    [null, 0, []],
    "決まり手の行の無い枠は0件",
  );
  assert.equal(vb.technique_last_updated, "2026-10-25", "決まり手の集計の日");
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.venueBoat")),
    "会場の決まり手の集計の日は technique.byBoat に記録済みで重ねない（/code-review #6）",
  );
  const nb = got.db.exhibition.nationalBoat;
  // 全国の1着率を api.outcome から独立に数える（3連単の組の件数を1着の艇で足す）
  const byFirst = {};
  let pooledN = 0;
  for (const o of Object.values(m.api.outcome))
    for (const [first, ps] of Object.entries(o.data))
      for (const x of ps)
        ((byFirst[first] = (byFirst[first] ?? 0) + x.count),
          (pooledN += x.count));
  assert.deepEqual(
    [nb.count_total, nb.venues, nb.technique_venues, nb.total_races],
    [
      pooledN,
      24,
      24,
      Object.values(m.api.outcome).reduce((a, o) => a + o.total_races, 0),
    ],
    "全国は24会場のプール（分母は組の件数の合計）",
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => nb.by_boat[n].win_rate),
    [1, 2, 3, 4, 5, 6].map((n) =>
      Number(((byFirst[n] / pooledN) * 100).toFixed(1)),
    ),
    "全国×枠の1着率は全国平均の目盛りと同じ数え方の1桁",
  );
  assert.equal(
    nb.by_boat[1].win_rate,
    Number(nationalWinRateByBoat(outcomeRowsOf(m.api.outcome))[1].toFixed(1)),
    "画面の全国平均と同じ関数",
  );
  assert.ok(
    !seenQueries.some((x) => x.startsWith("outcome_distribution?")),
    "1着率は取得済みの api.outcome を使い、表を読み直さない（/code-review #3）",
  );
  assert.deepEqual(
    [nb.by_boat[1].technique_total, nb.by_boat[1].techniques],
    [
      289,
      [
        { technique: "逃げ", count: 240, share: 83 },
        { technique: "抜き", count: 48, share: 16.6 },
        { technique: "恵まれ", count: 1, share: 0.3 },
      ],
    ],
    "全国×枠の決まり手は24会場の回数を足した内訳",
  );
  assert.ok(
    !got.missing.some((x) => x.source.startsWith("db.exhibition.nationalBoat")),
    "24会場そろいレースの日より前の集計なら欠けなし",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("winning_technique_stats?") &&
        /order=venue_code,boat_number,winning_technique/.test(x),
    ),
    "全会場の決まり手は並べ替えて読む",
  );
  // 1会場の outcome-distribution が取れないと全国は23会場で、記録する
  const partial = boatTendencyOf(
    m.venueCode,
    { ...m.api.outcome, 5: null },
    technique.winning_technique_stats,
    techAll,
  );
  assert.equal(partial.nationalBoat.venues, 23, "取れなかった会場は数えない");
  // RPC（PostgreSQL の ROUND）と同じ四捨五入（/code-review #1: 23/160=14.375 を浮動小数で丸めると 14.37 になる）
  assert.deepEqual(
    [
      pctRound2(23, 160),
      pctRound2(1, 3),
      pctRound2(2, 3),
      pctRound2(1308, 2103),
    ],
    [14.38, 33.33, 66.67, 62.2],
    "回数/走数の%の2桁は半分を上へ",
  );
  assert.ok(
    !nationalCourseOf(
      [
        {
          venue_code: 1,
          race_grade: "ALL",
          course: 2,
          runs: 160,
          nige_rate: null,
          makuri_rate: 14.38,
          nigashi_rate: 50,
          window_start: "a",
          window_end: "b",
          last_updated: "c",
        },
      ],
      "ALL",
    ).problems.some((x) => /戻せない/.test(x)),
    "RPC の丸めの 14.38 は 23回に戻る",
  );
  // 純関数: 会場の行が欠けた・窓が違う・ALL が24会場にない
  const ncOnly = nationalCourseOf(
    [
      {
        venue_code: 3,
        race_grade: "ALL",
        course: 1,
        runs: 7,
        nige_rate: 57.14,
        makuri_rate: 0,
        nigashi_rate: null,
        window_start: "2025-12-02",
        window_end: "2026-10-11",
        last_updated: "2026-10-12",
      },
      {
        venue_code: 4,
        race_grade: "ALL",
        course: 1,
        runs: 3,
        nige_rate: 33.33,
        makuri_rate: 33.33,
        nigashi_rate: null,
        window_start: "2025-12-03",
        window_end: "2026-10-11",
        last_updated: "2026-10-13",
      },
    ],
    "ALL",
  );
  assert.deepEqual(
    [
      ncOnly.all[0].runs,
      ncOnly.all[0].nige_count,
      ncOnly.all[0].nige_rate,
      ncOnly.all[0].makuri_count,
      ncOnly.all[0].last_updated,
      ncOnly.courses === ncOnly.all,
      ncOnly.all[1],
    ],
    [10, 5, 50, 1, "2026-10-13", true, null],
    "4/7 と 1/3 を戻して 5/10、行の無いコースは null",
  );
  assert.ok(
    ["窓が違う", "ALL 2コースの行が1会場も無い", "2会場だけ"].every((w) =>
      ncOnly.problems.some((p) => p.includes(w)),
    ),
    "窓の食い違い・行の無いコース・会場の不足を書く",
  );
  // 契約の enum（出す値の race_grade がすべて契約にある）
  assert.deepEqual(
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties
      .nationalCourse.properties.race_grade.enum,
    BASELINE_GRADES,
    "全国×コースのグレードはすべて契約にある",
  );
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          nationalCourse: { ...nc, race_grade: "G4" },
        },
      },
    }),
    "SG|G1|G2|G3|ippan|ALL",
  );
  assert.ok(
    (got.db.exhibition.notes ?? []).some((x) =>
      /racer_course_technique_stats・venue_course_technique_baseline・racer_aggregated_stats は最新の値だけ/.test(
        x,
      ),
    ),
    "日付の無い表の注意を出力に書く",
  );
  // 画面と同じ定義の材料（2026-10-25 hq 依頼、FT01）。超展開データは画面と同じ関数（src/utils/attackDefenseCells.js）
  const adOf = (n) => boats[n - 1].attack_defense;
  const cellsOf = (n, key) =>
    Object.fromEntries(
      Object.entries(adOf(n).cells).map(([k, c]) => [k, c[key]]),
    );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("predictions?") &&
        /model_id=eq\.standard/.test(x) &&
        /order=predicted_at\.desc/.test(x) &&
        /limit=1/.test(x),
    ),
    "画面と同じ予想（standard の最新）の racerStats を読む",
  );
  assert.deepEqual(
    [adOf(1).role, adOf(1).wins, adOf(1).total, cellsOf(1, "value")],
    [
      "defense",
      10,
      20,
      {
        nige: "9/20",
        sashi: "5/20",
        makuri: "3/20",
        makurizashi: "2/20",
        other: "0/20",
      },
    ],
    "1号艇は逃げと差され・まくられ・捲差され（割合×直近365日の勝ち・負け数を丸めた回数／出走）",
  );
  assert.deepEqual(
    [cellsOf(2, "value"), cellsOf(2, "state")],
    [
      {
        nige: null,
        sashi: "2/30",
        makuri: "1/30",
        makurizashi: "1/30",
        other: "0/30",
      },
      {
        nige: "none",
        sashi: "reference",
        makuri: "reference",
        makurizashi: "reference",
        other: "reference",
      },
    ],
    "全枠の勝ちが2〜4は参考（画面の※）、2〜6号艇の逃げは「-」",
  );
  assert.deepEqual(
    [
      cellsOf(3, "value").sashi,
      cellsOf(3, "state").sashi,
      cellsOf(3, "screen_value").sashi,
    ],
    [null, "national_default", "12%"],
    "勝ちが2未満は画面が全国平均の%なので、選手の値として出さない（画面の文字は screen_value）",
  );
  assert.deepEqual(
    [
      cellsOf(4, "value").sashi,
      cellsOf(4, "state").sashi,
      cellsOf(4, "screen_value").sashi,
    ],
    [null, "national_default_distribution", "1/25"],
    "決まり手の内訳が全国の既定（全期間の勝ち5未満）なら、画面に回数が出ても選手の値として出さない",
  );
  assert.deepEqual(
    cellsOf(5, "value"),
    {
      nige: null,
      sashi: "0/12",
      makuri: "0/12",
      makurizashi: "2/12",
      other: "0/12",
    },
    "勝ちの合計は全枠（5号艇2＋1号艇3）で判定する",
  );
  assert.equal(adOf(6), null, "racerStats に無い艇は null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.6.attack_defense" &&
        /racerStats にこの艇が無い/.test(x.reason),
    ),
    "racerStats に無い艇を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.attack_defense" &&
        /sashi\(national_default\)/.test(x.reason),
    ),
    "全国平均の値を出さないことを記録",
  );
  assert.deepEqual(
    [
      adOf(3).exhibition_course_differs,
      adOf(1).exhibition_course_differs,
      adOf(3).basis,
    ],
    [true, false, "boat_number"],
    "展示の進入が枠と違う艇に印を付ける（値は枠番のまま）",
  );
  // ST考察（画面の computeStConsideration と同じ。course は枠番＝画面の枠なり想定）
  assert.deepEqual(
    boats[1].st_consideration,
    {
      course: 2,
      course_basis: "boat_number",
      grade: "A1",
      since: "2024-10-12",
      n: 3,
      small_sample: true,
      stable_rate: 66.7,
      late_rate: 33.3,
      breakout_count: 1,
      avg_st: 0.183,
      flying_count: 1,
      baseline: {
        stable_rate: 67,
        late_rate: 12.1,
        breakout_rate: 7.5,
        expected_breakout: 0.2,
        runs: 12000,
        window_start: "2025-12-02",
        window_end: "2026-10-11",
      },
    },
    "ST考察: F・ST の無い走を母数から外し、安定率（最速との差.05以内）・出遅率（.10以上遅い）・抜出（内より.07早い）と同コース・同級別の平均",
  );
  assert.deepEqual(
    boats[1].st_stability,
    {
      course: 2,
      course_basis: "boat_number",
      window_runs: 5,
      valid_runs: 3,
      st_stddev: 0.085,
      official_l_count: 1,
      since: "2026-10-01",
    },
    "ST の安定度: 窓の5走から F・L を除いた3走の母標準偏差と、公式の L の回数",
  );
  assert.deepEqual(
    [
      boats[0].st_consideration.n,
      boats[0].st_consideration.baseline,
      boats[0].st_stability.st_stddev,
    ],
    [0, null, null],
    "走の無い選手は n=0・平均の行なし・標準偏差なし",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.st_stability.st_stddev" &&
        /2走未満（0走）/.test(x.reason),
    ),
    "標準偏差が出せないことを記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.st_consideration.baseline" &&
        /1コース・B1の行が無い/.test(x.reason),
    ),
    "同コース・同級別の平均が無いことを記録",
  );
  assert.equal(boats[5].st_consideration, null, "選手が分からない艇は null");
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("race_entries?") &&
        /racer_id=eq\.4002/.test(x) &&
        /race_id\.lt\.2026-10-12/.test(x),
    ),
    "選手の走はこのレースより前だけ読む",
  );
  // /code-review（2026-10-25）の再現テスト
  // #2 1号艇の負けの内訳が無い（全期間の負け5未満で集計が {} を入れる）と画面は「0/N」と出すが、選手の値ではない
  // #4 内訳が全国の既定でも、その枠の勝ちが0なら「0/N」は実の値
  // #5 このレースの出走表に級別が無ければ、画面と同じく選手の直近の走の級別で平均を引く
  // #1 1人の選手の走が読めなくても、予想から出す超展開データと他の選手の値は残す
  const saved = structuredClone(racerStatsRaw);
  racerStatsRaw[0].defenseDistribution = {};
  racerStatsRaw[3].courseRaceCounts = {
    4: { total: 25, wins: 0 },
    1: { total: 5, wins: 5 },
  };
  entryRows[1].grade = null;
  failRacer = "eq.4001";
  const fixes = await run({ conditions: pre });
  const fb = fixes.db.exhibition.boats;
  // Codex の審査（#1905 P1）: no_distribution を含む材料も契約に合う（enum に無いと run-full が動画の前に止まる）
  assert.deepEqual(
    validate(fixes),
    [],
    "守りの内訳が無いセル（no_distribution）を含む材料も契約に合う",
  );
  assert.deepEqual(
    [
      fb[0].attack_defense.cells.sashi.value,
      fb[0].attack_defense.cells.sashi.state,
      fb[0].attack_defense.cells.sashi.screen_value,
      fb[0].attack_defense.cells.nige.value,
    ],
    [null, "no_distribution", "0/20", "9/20"],
    "#2 負けの内訳が無い「0/N」は null（逃げは攻めの内訳から出るので残す）",
  );
  assert.deepEqual(
    [
      fb[3].attack_defense.cells.sashi.value,
      fb[3].attack_defense.cells.sashi.state,
    ],
    ["0/25", "value"],
    "#4 勝ち0の「0/N」は既定の内訳でも実の値",
  );
  assert.deepEqual(
    [
      fb[1].st_consideration.grade,
      fb[1].st_consideration.baseline?.stable_rate,
    ],
    ["A1", 67],
    "#5 出走表の級別が無ければ直近の走の級別",
  );
  assert.ok(
    fb[0].attack_defense !== null &&
      fb[0].st_consideration === null &&
      fb[1].st_consideration?.n === 3,
    "#1 読めない選手の ST考察だけ null",
  );
  assert.ok(
    fixes.missing.some(
      (x) => x.source === "db.exhibition.boats.st_consideration.racer.4001",
    ),
    "#1 読めない選手を記録",
  );
  // /code-review（2026-10-26）#2: 選手の走が読めないとき、足した欄ごとにも欠けを記録する
  for (const k of [
    "condition_rows",
    "meet_results",
    "entry_distribution",
    "condition_stats",
  ]) {
    assert.ok(
      fixes.missing.some(
        (x) =>
          x.source === `db.exhibition.boats.1.${k}` &&
          /選手の走が読めない/.test(x.reason),
      ),
      `#2 読めない選手の ${k} を記録`,
    );
  }
  racerStatsRaw.splice(0, racerStatsRaw.length, ...saved);
  entryRows[1].grade = "A1";
  failRacer = null;
  // ---- 画面と同じ定義の材料の2（2026-10-25 hq 依頼、FT01 の PR A）----
  // 4. F持ち時・F無し時の平均ST と 11. 当地・波5cm以上（基本情報タブの条件別の表 buildConditionRows と同じ）
  const b3 = boats[2];
  assert.deepEqual(
    [b3.condition_rows.national, b3.condition_rows.local],
    [
      {
        n: 3,
        base_n: null,
        excluded_n: null,
        win_rate: 66.7,
        top2_rate: 100,
        top3_rate: 100,
        avg_st: 0.13,
        avg_st_n: 3,
      },
      {
        n: 2,
        base_n: null,
        excluded_n: null,
        win_rate: 50,
        top2_rate: 100,
        top3_rate: 100,
        avg_st: 0.14,
        avg_st_n: 2,
      },
    ],
    "条件別: 全国と当地（会場1の2走）。率は%の1桁、平均ST は2桁",
  );
  assert.deepEqual(
    [b3.condition_rows.fHolding, b3.condition_rows.fClean],
    [
      {
        n: 1,
        base_n: 2,
        excluded_n: null,
        win_rate: 100,
        top2_rate: 100,
        top3_rate: 100,
        avg_st: 0.12,
        avg_st_n: 1,
      },
      {
        n: 1,
        base_n: 2,
        excluded_n: null,
        win_rate: 0,
        top2_rate: 100,
        top3_rate: 100,
        avg_st: 0.16,
        avg_st_n: 1,
      },
    ],
    "F持ち時・F無し時: F数の取れた2走を分け合う（F数の無い走は母数に入れない）",
  );
  assert.deepEqual(
    b3.condition_rows.wave5,
    {
      n: 1,
      base_n: 3,
      excluded_n: 0,
      win_rate: 100,
      top2_rate: 100,
      top3_rate: 100,
      avg_st: 0.12,
      avg_st_n: 1,
    },
    "波5cm以上: 波の取れた3走のうち5cm以上の1走",
  );
  assert.deepEqual(
    Object.keys(b3.condition_rows),
    [
      "national",
      "local",
      "ippan",
      "sgg1",
      "firstDay",
      "finalDay",
      "wave5",
      "fHolding",
      "fClean",
    ],
    "条件別の表の全行",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.condition_rows.local" &&
        /走が0/.test(x.reason),
    ),
    "走の無い条件を記録",
  );
  // 11. 風5m以上・波5cm以上（選手ページのレース条件別の成績 aggregateRacerConditionStats と同じ。5走未満は出さない）
  assert.deepEqual(
    [
      b3.condition_stats.overall,
      b3.condition_stats.rows,
      b3.condition_stats.since,
    ],
    [
      { n: 3, win_rate: 66.7, top2_rate: 100, top3_rate: 100 },
      {},
      "2026-09-01",
    ],
    "選手ページの条件別: 3走では5走以上の条件が無い",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.condition_stats.windStrong" &&
        /5走未満/.test(x.reason),
    ),
    "風5m以上が出ないことを記録",
  );
  // 6. 今節の各走（今節タブ buildMeetResults・getRecentRaces と同じ。別の会場の9/01は今節でない）
  assert.deepEqual(
    b3.meet_results,
    [
      {
        race_id: r3.a,
        date: "2026-10-10",
        race_no: 5,
        boat_number: 3,
        entry_course: 2,
        start_timing: 0.12,
        is_flying: false,
        finish_rank: 1,
        finish_mark: null,
        absent: false,
        winning_technique: "差し",
        race_stage: "予選",
        race_title: "x杯",
        exhibition_time: 6.7,
        exhibition_rank: 1,
      },
      {
        race_id: r3.b,
        date: "2026-10-11",
        race_no: 3,
        boat_number: 3,
        entry_course: 3,
        start_timing: 0.16,
        is_flying: false,
        finish_rank: 2,
        finish_mark: null,
        absent: false,
        winning_technique: null,
        race_stage: "予選",
        race_title: "x杯",
        exhibition_time: 6.75,
        exhibition_rank: 1,
      },
    ],
    "今節: 進入・本番ST・着・決まり手（1着だけ）・レースの種別",
  );
  // 7. 前づけ%・枠なり進入率（直前情報タブ computeFrameEntryDistribution・枠情報タブ computeWakuNariRate と同じ）
  assert.deepEqual(
    b3.entry_distribution,
    {
      frame: 3,
      n: 2,
      counts: [0, 1, 1, 0, 0, 0],
      waku_rate: 50,
      inward_rate: 50,
      outward_rate: 0,
      waku_nari: { rate: 66.7, n: 3 },
    },
    "この枠（3号艇）からの進入: 2走のうち前づけ1・枠なり1。枠なり進入率は全枠の3走",
  );
  // 10. 事故率（RPC get_racer_accident_records ＋ computeAccidentStats。今期は 5/1 から、その日の走は含めない）
  assert.deepEqual(
    rpcBodies.at(-1),
    {
      p_racer_ids: [4001, 4002, 4003, 4004, 4005],
      p_from: "2026-05-01",
      p_to: date,
    },
    "画面と同じ RPC・同じ期間",
  );
  assert.deepEqual(
    b3.accident,
    {
      from: "2026-05-01",
      to: date,
      starts: 40,
      points: 35,
      rate: 0.87,
      need: 0,
      counts: { F: 1, L1: 0, K1: 0, S1: 0, S2: 1 },
      status: "over",
      settled: true,
      show_badge: true,
    },
    "事故率: F 20点＋妨害失格 15点 ÷ 40走",
  );
  assert.deepEqual(
    [
      boats[0].accident.starts,
      boats[0].accident.rate,
      boats[0].accident.status,
      boats[5].accident,
    ],
    [0, null, null, null],
    "RPC の行が無い選手は出走0（画面と同じ）、選手が分からない艇は null",
  );
  // 9. オリジナル展示（getRaceOriginalExhibition と同じ表と整形）。会場に無い項目は not_offered、欠測は no_value
  assert.deepEqual(
    boats[1].original_exhibition,
    {
      一周: { value: 37.2, status: "value" },
      半周ラップ: { value: null, status: "not_offered" },
      まわり足: { value: 5.52, status: "value" },
      直線: { value: null, status: "no_value" },
    },
    "オリジナル展示: 値・会場に無い項目・欠測を分ける",
  );
  assert.deepEqual(
    Object.values(boats[5].original_exhibition).map((x) => x.status),
    ["no_value", "not_offered", "no_value", "no_value"],
    "値の行が無い艇は欠け",
  );
  assert.deepEqual(
    got.db.exhibition.originalExhibition,
    {
      state: "published",
      measure_status: 1,
      item_labels: ["一周", "まわり足", "直線"],
      kinds: ["一周", "まわり足", "直線"],
      captured_at: `${date}T06:50:00+00:00`,
      last_written_at: `${date}T06:50:00+00:00`,
    },
    "オリジナル展示のレースの状態",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.original_exhibition.直線" &&
        /欠測/.test(x.reason),
    ),
    "欠測を記録",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition.kinds" &&
        /半周ラップ/.test(x.reason),
    ),
    "会場に無い項目を記録",
  );
  assert.ok(
    !got.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後/.test(x.reason),
    ),
    "締切の前の値なら記録しない",
  );
  // 3. 会場の負けの決まり手（losing_technique_stats、LosingTechniqueChart と同じまとめ）
  assert.deepEqual(
    got.db.exhibition.losingTechnique,
    {
      last_updated: "2026-10-25",
      by_boat: {
        1: {
          total_races: 80,
          techniques: [
            { technique: "差し", count: 30, percentage: 37.5 },
            { technique: "まくり", count: 20, percentage: 25 },
          ],
        },
        2: {
          total_races: 300,
          techniques: [{ technique: "逃げ", count: 50, percentage: 16.67 }],
        },
      },
    },
    "負けの決まり手: 枠ごとにまとめる",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("losing_technique_stats?") &&
        /venue_code=eq\.1/.test(x) &&
        /order=boat_number,percentage\.desc/.test(x),
    ),
    "画面と同じ並びで読む",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.losingTechnique" &&
        /より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録（値は残す）",
  );
  // ---- 5. 本人の優勝戦の成績・優出・優勝回数（2026-10-26 hq 依頼、FT01 の PR B）----
  const fin = (n) => got.db.exhibition.boats[n - 1].final_race_record;
  const windowsKbUnread = [
    { source: "races", from: "2025-12-03", to: null, read: true },
    { source: "kb_archive", from: null, to: "2025-12-02", read: false },
  ];
  assert.deepEqual(
    fin(1),
    {
      stage: "優勝戦",
      before: m.raceId,
      windows: windowsKbUnread,
      complete: false,
      runs: 2,
      wins: 1,
      win_rate: 50,
      boat1_runs: 1,
      boat1_wins: 1,
      boat1_win_rate: 100,
      fl_runs: 0,
      absent_runs: 0,
      excluded_races: { no_result: 1, no_race: 1, cancelled: 1 },
      rides: [
        { race_id: Y.y1, boat_number: 1, kind: "win", source: "races" },
        { race_id: Y.y2, boat_number: 3, kind: "run", source: "races" },
      ],
    },
    "優勝戦: 不成立・中止・結果なしを除き、このレースの後・本体の窓の前の走は数えない",
  );
  assert.deepEqual(
    [fin(2).runs, fin(2).absent_runs, fin(2).win_rate],
    [0, 1, null],
    "欠場は走数に入れない（走0なら率は null）",
  );
  assert.deepEqual(
    [
      fin(3).runs,
      fin(3).wins,
      fin(3).fl_runs,
      fin(3).boat1_runs,
      fin(3).boat1_win_rate,
    ],
    [2, 1, 1, 0, null],
    "F は走数に入れ1着にしない、着の表記が無い走は rank1 で1着を決める",
  );
  assert.deepEqual(
    [
      fin(4).runs,
      fin(4).boat1_runs,
      fin(4).boat1_wins,
      fin(4).boat1_win_rate,
      fin(4).fl_runs,
    ],
    [1, 1, 0, 0, 1],
    "1号艇の L は1号艇の走で1着でない",
  );
  assert.deepEqual(
    [fin(5).runs, fin(5).absent_runs],
    [0, 1],
    "race_entries.is_absent の走は欠場",
  );
  assert.equal(fin(6), null, "選手が分からない艇は null");
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.final_race_record.kb_archive" &&
        /本体の窓（2025-12-03〜）だけ/.test(x.reason),
    ),
    "kb_archive が読めないことをレースの単位で記録",
  );
  assert.equal(
    got.missing.filter((x) => x.source.includes("kb_archive")).length,
    1,
    "kb_archive の欠けは1件だけ（艇ごとに増やさない）",
  );
  assert.ok(
    got.missing.some(
      (x) => x.source === "db.exhibition.boats.6.final_race_record",
    ),
    "選手の分からない艇を記録",
  );
  // /code-review（2026-10-26）#1: 優勝戦の一覧は1000行を超えうるので、ページを並べ替えて読む（並べ替えないとページの境で行が抜け・重なる）
  assert.ok(
    seenQueries.some(
      (x) =>
        x ===
        `race_conditions?select=race_id&race_stage=eq.優勝戦&and=(race_id.gte.2025-12-03,race_id.lt.${m.raceId})&order=race_id`,
    ),
    "優勝戦は race_stage の完全一致、このレースより前、race_id の順で読む",
  );
  // #2: アーカイブもこのレースより前に限る（2025-12-02 より前のレースで取り直したとき、後の優勝戦を数えない）
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("kb_archive_races?") &&
        /stage=eq\.優勝戦/.test(x) &&
        /race_date=lte\.2025-12-02/.test(x) &&
        x.includes(`race_id=lt.${m.raceId}`) &&
        /order=race_id/.test(x),
    ),
    "アーカイブは stage の完全一致、2025-12-02 まで、このレースより前",
  );
  // 優出・優勝回数（racer_period_stats の finals・wins）
  const pf = (n) => got.db.exhibition.boats[n - 1].period_finals;
  assert.deepEqual(
    pf(1),
    {
      latest: {
        period_year: 2026,
        period_no: 2,
        calc_from: "2025-11-01",
        calc_to: "2026-04-30",
        starts: 100,
        finals: 3,
        wins: 1,
      },
      last4: {
        periods_count: 4,
        from: "2024-05-01",
        to: "2026-04-30",
        finals: 10,
        wins: 4,
        periods: [
          { period_year: 2026, period_no: 2 },
          { period_year: 2026, period_no: 1 },
          { period_year: 2025, period_no: 2 },
          { period_year: 2025, period_no: 1 },
        ],
      },
    },
    "前期はレースの日より前に締めた最新の期、直近4期の合計（5期目は入れない）",
  );
  // #9: 4期だけ要るので、締めが900日より前の期は読まない
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("racer_period_stats?") &&
        /finals,wins/.test(x) &&
        x.includes(`and=(calc_to.lt.${date},calc_to.gte.2024-04-25)`),
    ),
    "calc_to < レースの日 で、900日より前の期は読まない",
  );
  assert.deepEqual(
    [pf(3).last4.periods_count, pf(3).last4.finals],
    [2, 1],
    "期が4期そろわなければある分だけ",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.period_finals.last4" &&
        /2期だけ/.test(x.reason),
    ),
    "4期そろわないことを記録",
  );
  assert.deepEqual(
    [pf(4).latest.finals, pf(4).last4.finals],
    [null, null],
    "finals の無い期があれば合計は null",
  );
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.2.period_finals" &&
        /期が無い/.test(x.reason),
    ),
    "期の無い選手を記録",
  );
  assert.deepEqual(
    [pf(2).latest, pf(2).last4.finals, pf(5).last4.finals, pf(5).last4.wins],
    [null, null, 3, 1],
    "期の無い選手は latest が null",
  );
  // アーカイブが読めるとき（権限が付いたら）は窓を合わせる
  kbReadable = true;
  const withKb = await run({ conditions: pre });
  kbReadable = false;
  assert.deepEqual(
    validate(withKb),
    [],
    "アーカイブを合わせた材料も契約に合う",
  );
  const kb1 = withKb.db.exhibition.boats[0].final_race_record;
  assert.deepEqual(
    [
      kb1.complete,
      kb1.runs,
      kb1.wins,
      kb1.boat1_runs,
      kb1.boat1_wins,
      kb1.excluded_races.no_result,
      kb1.rides[0],
    ],
    [
      true,
      3,
      2,
      2,
      2,
      2,
      {
        race_id: "2024-05-05-06-12",
        boat_number: 1,
        kind: "win",
        source: "kb_archive",
      },
    ],
    "アーカイブの 01 は1着、結果なしは除く",
  );
  assert.deepEqual(
    [
      withKb.db.exhibition.boats[1].final_race_record.runs,
      withKb.db.exhibition.boats[1].final_race_record.wins,
      withKb.db.exhibition.boats[2].final_race_record.absent_runs,
    ],
    [1, 0, 1],
    "失格（S1）は走で1着でない、K0 は欠場",
  );
  assert.ok(
    !withKb.missing.some((x) => x.source.includes("kb_archive")),
    "読めれば記録しない",
  );
  // 読めないとき: 本体の優勝戦・期の表が読めなければその欄だけ null
  failFinals = "stage";
  const noStage = await run({ conditions: pre });
  failFinals = "periods";
  const noPeriods = await run({ conditions: pre });
  failFinals = null;
  assert.deepEqual(validate(noStage), [], "優勝戦が読めない材料も契約に合う");
  assert.ok(
    noStage.db.exhibition.boats.every((b) => b.final_race_record === null) &&
      noStage.db.exhibition.boats[0].period_finals?.latest?.finals === 3,
    "優勝戦が読めなければ成績だけ null",
  );
  assert.ok(
    noStage.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.final_race_record" &&
        /読めない/.test(x.reason),
    ),
    "読めない成績を艇ごとに記録",
  );
  assert.ok(
    noPeriods.db.exhibition.boats.every((b) => b.period_finals === null) &&
      noPeriods.db.exhibition.boats[0].final_race_record?.runs === 2,
    "期の表が読めなければ優出・優勝だけ null",
  );
  assert.ok(
    noPeriods.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.period_finals" &&
        /読めない/.test(x.reason),
    ),
    "読めない期を艇ごとに記録",
  );
  // 1走の分類（アーカイブの表記）と、出す値と契約の enum
  const { classifyFinalRide, FINAL_RIDE_KINDS, FINAL_RECORD_SOURCES } =
    await import(`${R}/scripts/full-picture/fetch-materials.mjs`);
  assert.deepEqual(
    ["01", "02", "06", "F", "L0", "L1", "K0", "K1", "S0", "S2", null].map(
      (finish) => classifyFinalRide({ source: "kb_archive", finish }),
    ),
    [
      "win",
      "run",
      "run",
      "fl",
      "fl",
      "fl",
      "absent",
      "absent",
      "run",
      "run",
      "absent",
    ],
    "アーカイブの成績コードの分類",
  );
  assert.deepEqual(
    ["1", "2", "F", "L", "欠", "転", "妨", null].map((finish) =>
      classifyFinalRide({ source: "races", finish, rank1: 3, boatNumber: 3 }),
    ),
    ["win", "run", "fl", "fl", "absent", "run", "run", "win"],
    "本体の着の表記の分類",
  );
  const frProps =
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties.boats.items
      .properties.final_race_record.properties;
  assert.deepEqual(
    frProps.rides.items.properties.kind.enum,
    FINAL_RIDE_KINDS,
    "1走の分類はすべて契約にある",
  );
  assert.deepEqual(
    [
      frProps.rides.items.properties.source.enum,
      frProps.windows.items.properties.source.enum,
    ],
    [FINAL_RECORD_SOURCES, FINAL_RECORD_SOURCES],
    "窓の元はすべて契約にある",
  );
  // 欠けの形: race_conditions が読めない・事故の RPC が読めない・オリジナル展示が未公開・締切の後の書き換え
  failConditions = true;
  accidentRows = "fail";
  const keepHeader = origHeader;
  const keepValues = origValues;
  origHeader = [];
  origValues = [];
  const gaps = await run({ conditions: pre });
  assert.deepEqual(validate(gaps), [], "欠けた材料も契約に合う");
  const g3 = gaps.db.exhibition.boats[2];
  assert.deepEqual(
    [
      g3.condition_rows.wave5,
      g3.condition_rows.firstDay,
      g3.condition_rows.local?.n,
      g3.condition_stats,
      g3.meet_results.length,
      g3.st_consideration?.n,
    ],
    [null, null, 2, null, 2, 1],
    "race_conditions が読めなければ波・日目の行と選手ページの条件別だけ null（画面も出さない）",
  );
  assert.ok(
    gaps.missing.some(
      (x) => x.source === "db.exhibition.boats.conditions.racer.4003",
    ),
    "読めない race_conditions を記録",
  );
  assert.ok(
    gaps.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.3.condition_rows.wave5" &&
        /未取得/.test(x.reason),
    ),
    "出さない行を記録",
  );
  assert.ok(
    gaps.db.exhibition.boats.every((b) => b.accident === null) &&
      gaps.missing.some((x) => x.source === "db.exhibition.boats.accident"),
    "事故の RPC が読めなければ null で記録",
  );
  assert.ok(
    gaps.missing.some((x) => x.source === "db.exhibition.boats.3.accident"),
    "事故率の欠けを艇ごとにも記録（/code-review 2026-10-26 #6）",
  );
  assert.ok(
    gaps.db.exhibition.boats.every((b) => b.original_exhibition === null) &&
      gaps.db.exhibition.originalExhibition.state === "no_row",
    "オリジナル展示の行が無ければ null・no_row",
  );
  assert.ok(
    gaps.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /行が無い/.test(x.reason),
    ),
    "未公開を記録",
  );
  failConditions = false;
  accidentRows = [];
  origHeader = [{ ...keepHeader[0], updated_at: `${date}T07:10:00+00:00` }];
  origValues = keepValues;
  const lateOrig = await run({ conditions: pre });
  assert.ok(
    lateOrig.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後/.test(x.reason),
    ),
    "締切の後に書いた値を記録（値は残す）",
  );
  assert.equal(
    lateOrig.db.exhibition.boats[0].original_exhibition.一周.value,
    37.1,
    "締切の後でも値は残す",
  );
  // /code-review（2026-10-26）#4: 時刻の表記が違っても最も遅い書き込みで判定する（文字の順では 16:05+09:00 が遅く見える）
  origHeader = [{ ...keepHeader[0], updated_at: `${date}T07:10:00+00:00` }];
  origValues = keepValues.map((v) => ({
    ...v,
    updated_at: `${date}T16:05:00+09:00`,
  }));
  const mixedTz = await run({ conditions: pre });
  assert.ok(
    mixedTz.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /締切の後（.*07:10/.test(x.reason),
    ),
    "#4 表記の違う時刻も数で比べる",
  );
  // #5: 既定・会場の項目に無い名前の項目の値も落とさない
  origHeader = [];
  origValues = [
    {
      boat_number: 1,
      kind: "展示周回",
      value: "36.5",
      updated_at: `${date}T06:50:00+00:00`,
    },
  ];
  const unknownKind = await run({ conditions: pre });
  assert.deepEqual(
    unknownKind.db.exhibition.boats[0].original_exhibition.展示周回,
    { value: 36.5, status: "value" },
    "#5 名前の違う項目の値を残す",
  );
  assert.deepEqual(
    validate(unknownKind),
    [],
    "#5 名前の違う項目を含む材料も契約に合う",
  );
  // #1: 選手の走の展示が読めなくても ST考察・条件別は残す
  origHeader = keepHeader;
  origValues = keepValues;
  failExhibition = true;
  const noEx = await run({ conditions: pre });
  failExhibition = false;
  assert.deepEqual(
    [
      noEx.db.exhibition.boats[1].st_consideration?.n,
      noEx.db.exhibition.boats[2].condition_rows?.local?.n,
      noEx.db.exhibition.boats[2].meet_results?.[0]?.exhibition_time,
    ],
    [3, 2, null],
    "#1 展示が読めなければ展示の値だけ null",
  );
  assert.ok(
    noEx.missing.some(
      (x) => x.source === "db.exhibition.boats.exhibition.racer.4003",
    ),
    "#1 読めない展示を記録",
  );
  origHeader = [{ ...keepHeader[0], measure_status: 2 }];
  origValues = [];
  const notMeasured = await run({ conditions: pre });
  assert.deepEqual(
    [
      notMeasured.db.exhibition.originalExhibition.state,
      notMeasured.db.exhibition.originalExhibition.measure_status,
    ],
    ["empty", 2],
    "計測不可は empty と measure_status=2",
  );
  assert.ok(
    notMeasured.missing.some(
      (x) =>
        x.source === "db.exhibition.originalExhibition" &&
        /計測不可/.test(x.reason),
    ),
    "計測不可を記録",
  );
  origHeader = keepHeader;
  origValues = keepValues;
  accidentRows = [{ racer_id: 4003, starts: 40, incidents: [] }];
  // 契約の enum の漏れ（#1905 の Codex P1 と同じ型の検査）: 出す値の状態がすべて契約にある
  const { ORIGINAL_EXHIBITION_STATUSES, conditionStatsOf } = await import(
    `${R}/scripts/full-picture/fetch-materials.mjs`
  );
  const oeProps =
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties.boats.items
      .properties;
  assert.deepEqual(
    oeProps.original_exhibition.additionalProperties.properties.status.enum,
    ORIGINAL_EXHIBITION_STATUSES,
    "オリジナル展示の状態はすべて契約にある",
  );
  assert.deepEqual(
    MATERIALS_SCHEMA.properties.db.properties.exhibition.properties
      .originalExhibition.properties.state.enum,
    ["published", "empty", "no_row"],
    "レースの状態はすべて契約にある",
  );
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          boats: got.db.exhibition.boats.map((b, i) =>
            i === 1
              ? {
                  ...b,
                  original_exhibition: {
                    ...b.original_exhibition,
                    一周: { value: 1, status: "x" },
                  },
                }
              : b,
          ),
        },
      },
    }),
    "value|no_value|not_offered",
  );
  has(
    validate({
      ...got,
      db: {
        ...got.db,
        exhibition: {
          ...got.db.exhibition,
          boats: got.db.exhibition.boats.map((b, i) =>
            i === 2 ? { ...b, accident: { ...b.accident, status: "bad" } } : b,
          ),
        },
      },
    }),
    "over|near|",
  );
  // 選手ページの条件別は、5走以上の条件を出す（率は%）
  const hist = [6, 6, 6, 2, 7].map((w, i) => ({
    raceId: `2026-10-0${i + 1}-02-01`,
    venueCode: 2,
    boatNumber: 1,
    rank1: i < 2 ? 1 : 2,
    rank2: i < 2 ? 2 : 1,
    rank3: 3,
    weather: "晴",
    windSpeed: w,
    waveHeight: 6,
    unranked: false,
  }));
  const cs = conditionStatsOf(hist);
  assert.deepEqual(
    [cs.rows.waveRough, cs.rows.windStrong, cs.rows.sunny.n],
    [
      {
        group: "波高",
        label: "波5cm以上",
        n: 5,
        win_rate: 40,
        top2_rate: 100,
        top3_rate: 100,
      },
      undefined,
      5,
    ],
    "5走以上の条件だけ出し、率は%の1桁（風5m以上は4走で出ない）",
  );

  // 予想が無い・読めないときも艇の材料は残す
  predictionRows = [];
  const noPred = await run({ conditions: pre });
  assert.deepEqual(validate(noPred), [], "予想の無い材料も契約に合う");
  assert.ok(
    noPred.db.exhibition.boats.every((b) => b.attack_defense === null) &&
      noPred.db.exhibition.boats[1].st_consideration?.n === 3,
    "予想が無ければ超展開データだけ null",
  );
  assert.ok(
    noPred.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.attack_defense" &&
        /standard の予想が無い/.test(x.reason),
    ),
    "予想が無いことを記録",
  );
  predictionRows = [
    { racerStats: racerStatsRaw, predicted_at: `${date}T00:10:00+00:00` },
  ];
  baseline = baseline.map((r) => ({ ...r, window_end: date }));
  const noGrade = await run({ conditions: pre, grade: null });
  assert.deepEqual(validate(noGrade), [], "グレードの無い材料も契約に合う");
  assert.ok(
    noGrade.missing.some(
      (x) =>
        x.source === "db.exhibition.venueCourse" &&
        /venue_course_technique_baseline はレースの日.*より後の集計/.test(
          x.reason,
        ),
    ),
    "会場の集計がレースの日を含めば記録",
  );
  assert.equal(
    noGrade.db.exhibition.venueCourse?.race_grade,
    "ippan",
    "グレードが無ければ ippan で引く",
  );
  assert.ok(
    noGrade.missing.some(
      (x) => x.source === "db.exhibition.venueCourse.race_grade",
    ),
    "グレードが無いことを記録",
  );
  assert.ok(
    seenQueries.some(
      (x) =>
        x.startsWith("venue_course_technique_baseline?") &&
        /race_grade=in\.\(ippan,ALL\)/.test(x),
    ),
    "ippan と ALL を読む",
  );
  // 既存の材料は展示の前と同じキーのまま（足すだけ）
  assert.ok(
    ["racer1", "motor"].every((k) => k in got.db) &&
      got.api.facts &&
      got.race.startTime === "16:06:00",
    "既存の材料はそのまま",
  );
  // 締切の後の観測（結果の取り込みで上書きされた値）は発走前の値でないので null
  const late = await run({
    conditions: { ...pre, weather_observed_at: `${date}T07:08:00+00:00` },
  });
  assert.deepEqual(
    [
      late.db.exhibition.conditions.wind_speed,
      late.db.exhibition.conditions.wave_height,
      late.db.exhibition.conditions.observedAt,
    ],
    [null, null, `${date}T07:08:00+00:00`],
    "締切の後の観測の風・波は null",
  );
  assert.ok(
    late.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" && /締切の後/.test(x.reason),
    ),
    "締切の後の観測を missing に記録",
  );
  // 観測時刻が無い（scrape-to-json の経路）・締切が無いと発走前か確かめられないので null（/code-review 2026-10-25 #1）
  const noObs = await run({
    conditions: { ...pre, weather_observed_at: null },
  });
  assert.equal(
    noObs.db.exhibition.conditions.wind_speed,
    null,
    "観測時刻の無い風は null",
  );
  assert.ok(
    noObs.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" &&
        /観測時刻が無く/.test(x.reason),
    ),
    "観測時刻が無いことを記録",
  );
  const noDeadline = await run({ conditions: pre, startTime: null });
  assert.equal(
    noDeadline.db.exhibition.conditions.wave_height,
    null,
    "締切の無いレースの波は null",
  );
  assert.ok(
    noDeadline.missing.some(
      (x) =>
        x.source === "db.exhibition.conditions" &&
        /締切の時刻が無く/.test(x.reason),
    ),
    "締切が無いことを記録",
  );
  // 決まり手の表は最新の集計だけ。レースの日より後の集計なら記録する（固定の材料は 10/12、表は 10/25。/code-review #2）
  assert.ok(
    got.missing.some(
      (x) =>
        x.source === "db.exhibition.technique.byPeriod" &&
        /より後の集計/.test(x.reason),
    ),
    "レースの日より後の集計を記録",
  );
  technique.venue_technique_period_stats =
    technique.venue_technique_period_stats.map((r) => ({
      ...r,
      last_updated: date,
    }));
  technique.winning_technique_stats = technique.winning_technique_stats.map(
    (r) => ({ ...r, last_updated: date }),
  );
  const sameDay = await run({ conditions: pre });
  assert.ok(
    !sameDay.missing.some((x) =>
      x.source.startsWith("db.exhibition.technique"),
    ),
    "レースの日の集計なら欠けなし",
  );
  // 展示前（行も気象も無い）・集計表が空でも止まらず、全部 null と missing で出す
  technique.venue_technique_period_stats = [];
  technique.winning_technique_stats = [];
  const empty = await run({ conditions: undefined, ex: [] });
  assert.deepEqual(validate(empty), [], "欠けた材料も契約に合う");
  const noRacers = await run({ conditions: pre, racers: null });
  assert.ok(
    noRacers.db.exhibition.boats.every((b) => b.meet_finishes === null),
    "facts に racers が無ければ今節の着順は null",
  );
  assert.ok(
    noRacers.missing.some(
      (x) => x.source === "db.exhibition.boats.meet_finishes",
    ),
    "racers が無いことを記録",
  );
  assert.ok(
    noRacers.db.exhibition.boats.every((b) => b.entry_tendency === null),
    "facts に racers が無ければ進入の分布は null",
  );
  assert.ok(
    noRacers.missing.some(
      (x) =>
        x.source === "db.exhibition.boats.1.entry_tendency" &&
        /racers が無い/.test(x.reason),
    ),
    "進入の分布の欠けを記録",
  );
  assert.ok(
    empty.db.exhibition.boats.every(
      (b) => b.exhibition_course === null && b.start_timing === null,
    ),
    "展示前は進入・ST が null",
  );
  assert.ok(
    empty.db.exhibition.boats.every(
      (b) =>
        b.course === b.boat_number &&
        b.course_source === "boat_number" &&
        b.course_technique === null,
    ),
    "展示前は枠番で引き、選手が分からなければ null",
  );
  assert.deepEqual(empty.db.exhibition.conditions, {
    weather: null,
    wind_direction: null,
    wind_speed: null,
    wave_height: null,
    observedAt: null,
  });
  for (const s of [
    "db.exhibition.boats.1",
    "db.exhibition.boats.6",
    "db.exhibition.conditions",
    "db.exhibition.technique.byPeriod",
    "db.exhibition.technique.byBoat",
  ]) {
    assert.ok(
      empty.missing.some((x) => x.source === s),
      `欠けを missing に記録: ${s}`,
    );
  }
  for (const [k, v] of [
    ["VITE_SUPABASE_URL", realEnv.url],
    ["VITE_SUPABASE_ANON_KEY", realEnv.key],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

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
