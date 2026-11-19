// /today の X 投稿の型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定）の再現テスト。外部接続なし
// - src/utils/todayCourseWin.js の buildCourseWinSheet（並べ・同率・送る時刻・除く行・K・線・指紋）
// - scripts/lib/snsTodayCourseWinPost.js の本文と機械の検査（通らなければ計画は型 a で送る）
// - scripts/lib/snsTodayVariants.js の比べの組（連続2日を1組、組の中で乱数、比べの外は a、組の日は型の列を使わない）
// - config/today-variants.json の型 b の行
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COURSE_WIN_VERSION,
  bonferroniLine,
  buildCourseWinSheet,
  fingerprint,
} from "../../src/utils/todayCourseWin.js";
import {
  COURSE_WIN_FOOT,
  buildCourseWinPost,
  checkCourseWinPost,
  xWeightedLength,
} from "../lib/snsTodayCourseWinPost.js";
import {
  normalizeTodayExperiment,
  pickExperimentSide,
  pickTodayPost,
} from "../lib/snsTodayVariants.js";
import { courseWinSheetUrl } from "../lib/snsTodayPlanner.js";
import {
  runTodayTypeBScenes1,
  runTodayTypeBScenes2,
  runTodayTypeBScenes3,
} from "./verifyData/today-type-b-scenes.js";

const D = "2026-10-26";
const cand = (o) => ({
  section: "c1",
  course: 1,
  boat_number: 1,
  venue_code: 4,
  race_number: 12,
  start_time: "16:14:00",
  grade: "A1",
  racer_name: "選手 一",
  z: 1,
  ...o,
});
const notesOf = (candidates) => ({
  v: COURSE_WIN_VERSION,
  status: "ok",
  window: { start: "2025-12-02", end: "2026-10-24", until: "2026-10-24" },
  baselines: {
    "A1|1": { runs: 16129, wins: 11456 },
    "A2|1": { runs: 13822, wins: 8353 },
    "B1|1": { runs: 19169, wins: 7685 },
    "A1|4": { runs: 11658, wins: 1867 },
    "A2|4": { runs: 11845, wins: 1474 },
  },
  candidates,
});
const NOTES = notesOf([
  cand({
    race_id: `${D}-04-12`,
    racer_id: 1,
    runs: 47,
    wins: 42,
    gap_pt: 7.5,
    z: 2.8,
    racer_name: "高橋 竜矢",
  }),
  cand({
    race_id: `${D}-24-10`,
    racer_id: 2,
    runs: 56,
    wins: 47,
    gap_pt: 7.5,
    z: 2.4,
    venue_code: 24,
    race_number: 10,
    start_time: "19:36:00",
  }),
  cand({
    race_id: `${D}-22-12`,
    racer_id: 3,
    runs: 42,
    wins: 33,
    gap_pt: 9.3,
    z: 2.4,
    grade: "A2",
    venue_code: 22,
  }),
  cand({
    race_id: `${D}-01-01`,
    racer_id: 4,
    runs: 60,
    wins: 59,
    gap_pt: 20,
    z: 5,
    start_time: "07:59:00",
  }),
  cand({
    race_id: `${D}-10-03`,
    racer_id: 5,
    runs: 40,
    wins: 20,
    gap_pt: -8,
    z: -1.5,
  }),
  cand({
    section: "c4",
    course: 4,
    boat_number: 4,
    race_id: `${D}-06-12`,
    racer_id: 6,
    runs: 45,
    wins: 14,
    gap_pt: 8,
    grade: "A2",
  }),
  cand({
    section: "c4",
    course: 4,
    boat_number: 4,
    race_id: `${D}-12-11`,
    racer_id: 7,
    runs: 41,
    wins: 9,
    gap_pt: 3,
    grade: "A1",
  }),
  cand({
    section: "c4",
    course: 4,
    boat_number: 4,
    race_id: `${D}-12-12`,
    racer_id: 8,
    runs: 50,
    wins: 8,
    gap_pt: -2,
    grade: "A1",
  }),
]);

test("並べ: 段ごとに「縮めた値−級の平均」の大きい順、同率は件数の多い方、上限 1コース3・4コース2、送る時刻より前の締切は除く", () => {
  const sheet = buildCourseWinSheet(NOTES, { sendAt: "08:00" });
  assert.equal(sheet.ok, true);
  assert.deepEqual(
    sheet.sections.map((s) => [s.key, s.rows.map((r) => r.racer_id)]),
    [
      ["c1", [3, 2, 1]],
      ["c4", [6, 7]],
    ],
  );
  // K は上限で切る前の、送る時刻より後の全員（率で絞らない。全国平均を下回る 5 も数える）
  assert.deepEqual(sheet.k, { c1: 4, c4: 3 });
  assert.equal(sheet.featured.racer_id, 3);
  // 割合は件数÷母数を1回だけ丸める
  assert.equal(sheet.featured.pct, 79);
  assert.equal(sheet.featured.baseline_pct, 60);
  assert.equal(sheet.line, Number(bonferroniLine(4).toFixed(3)));
  // 言い切りは正確な二項の上側確率（上田 33/42、A2 60.4%）が 0.025/K 以下のとき。0.0103 > 0.025/4
  assert.ok(Math.abs(sheet.tail - 0.01027) < 1e-4, String(sheet.tail));
  assert.equal(sheet.claim, false);
  assert.deepEqual(sheet.minRunsC4, { A1: 32, A2: 41 });
  assert.match(sheet.key, /^[0-9a-f]{8}$/);
});

test("除く行（欠場・中止）は外して後ろから補い、K も減る。指紋は中身・送る時刻で変わる", () => {
  const all = buildCourseWinSheet(NOTES, { sendAt: "08:00" });
  const less = buildCourseWinSheet(NOTES, {
    sendAt: "08:00",
    excluded: new Set([`${D}-22-12:1`]),
  });
  assert.deepEqual(
    less.sections[0].rows.map((r) => r.racer_id),
    [2, 1, 5],
  );
  assert.equal(less.k.c1, 3);
  assert.notEqual(less.key, all.key);
  assert.notEqual(buildCourseWinSheet(NOTES, { sendAt: "08:30" }).key, all.key);
  assert.equal(buildCourseWinSheet(NOTES, { sendAt: "08:00" }).key, all.key);
  assert.equal(fingerprint("a"), fingerprint("a"));
});

test("型 b を作れない: 材料なし・unavailable・版違い・1コースが0行。4コースだけの日も作らない。送る時刻の形が違えば投げる", () => {
  assert.deepEqual(buildCourseWinSheet(null, { sendAt: "08:00" }), {
    ok: false,
    reason: "no_course_win",
  });
  assert.equal(
    buildCourseWinSheet(
      { v: 1, status: "unavailable", reason: "rpc_missing" },
      { sendAt: "08:00" },
    ).reason,
    "rpc_missing",
  );
  assert.equal(
    buildCourseWinSheet({ ...NOTES, v: 9 }, { sendAt: "08:00" }).reason,
    "version_9",
  );
  const onlyC4 = notesOf(NOTES.candidates.filter((c) => c.section === "c4"));
  assert.equal(
    buildCourseWinSheet(onlyC4, { sendAt: "08:00" }).reason,
    "no_c1_rows",
  );
  assert.throws(() => buildCourseWinSheet(NOTES, { sendAt: "8:00" }), /HH:MM/);
});

const URL_B =
  "https://www.boat-ai.jp/today?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=2026-10-26-b";
const venueName = (code) => ({ 4: "平和島", 22: "福岡", 24: "大村" })[code];

test("本文: 線を通らない日は2つの値を並べるだけ、通った日だけ差を書く。加重280以内・名前は画像と同じ表記", () => {
  const sheet = {
    ...buildCourseWinSheet(NOTES, { sendAt: "08:00" }),
    claim: false,
  };
  const text = buildCourseWinPost(sheet, { venueName, url: URL_B });
  assert.equal(
    text,
    [
      "42回中33回。",
      "",
      "今日の福岡12R、1号艇 選手 一が",
      "1コースに入ったときに1着になった数。",
      "A2級の全国平均は60%。",
      "",
      "今日走る選手のコース別1着率を1枚に。",
      "締切前に見返すなら保存を。",
      "",
      `全レースの一覧 → ${URL_B}`,
      COURSE_WIN_FOOT,
    ].join("\n"),
  );
  assert.deepEqual(
    checkCourseWinPost(text, sheet, { imageKey: sheet.key, url: URL_B }),
    [],
  );
  assert.ok(xWeightedLength(text) <= 280, String(xWeightedLength(text)));
  const claimed = { ...sheet, claim: true };
  const claimText = buildCourseWinPost(claimed, { venueName, url: URL_B });
  assert.match(claimText, /A2級の全国平均 60% を上回る。/);
  assert.doesNotMatch(claimText, /大きく/);
  assert.deepEqual(
    checkCourseWinPost(claimText, claimed, { imageKey: sheet.key, url: URL_B }),
    [],
  );
  // 名前・会場が長い日でも 280 以内（最長の名前は全角5字＋空白、会場は3字）
  const longSheet = {
    ...sheet,
    featured: {
      ...sheet.featured,
      racer_name: "長名前長 名前長名",
      race_number: 12,
      runs: 999,
      wins: 999,
    },
  };
  longSheet.sections = [
    { ...sheet.sections[0], rows: [longSheet.featured] },
    sheet.sections[1],
  ];
  const long = buildCourseWinPost(
    { ...longSheet, claim: true },
    { venueName: () => "びわこ", url: URL_B },
  );
  assert.ok(xWeightedLength(long) <= 280, String(xWeightedLength(long)));
});

test("機械の検査: どれか1つでも外れたら理由を返す（計画は型 a で送る）", () => {
  const sheet = {
    ...buildCourseWinSheet(NOTES, { sendAt: "08:00" }),
    claim: false,
  };
  const ok = buildCourseWinPost(sheet, { venueName, url: URL_B });
  const check = (text, s = sheet, imageKey = sheet.key) =>
    checkCourseWinPost(text, s, { imageKey, url: URL_B });
  assert.deepEqual(check(ok, sheet, "00000000"), ["image_key_mismatch"]);
  assert.deepEqual(check(ok.replace("33回", "◯回")), ["placeholder_left"]);
  assert.deepEqual(check(ok.replace("福岡", "undefined")), [
    "placeholder_left",
  ]);
  assert.ok(check(`${ok.slice(0, 3)}1位${ok.slice(3)}`).includes("rank_claim"));
  // 線を通らない日に差を書いた
  assert.deepEqual(
    check(ok.replace("全国平均は60%。", "全国平均 60% を上回る。")),
    ["diff_without_line"],
  );
  // 本文の人が画像の1コースの段の1行目でない
  const other = { ...sheet, featured: sheet.sections[0].rows[1] };
  assert.ok(
    check(buildCourseWinPost(other, { venueName, url: URL_B }), other).includes(
      "featured_not_first_c1_row",
    ),
  );
  // 名前の空白が画像の表記（半角1つ）と違う
  const spaced = {
    ...sheet,
    featured: { ...sheet.featured, racer_name: "選手　一" },
  };
  spaced.sections = [{ ...sheet.sections[0], rows: [spaced.featured] }];
  assert.ok(
    check(
      buildCourseWinPost(spaced, { venueName, url: URL_B }),
      spaced,
    ).includes("name_spacing"),
  );
  assert.ok(
    check(ok.replace(URL_B, "https://example.com")).includes("link_missing"),
  );
  assert.ok(check(`${ok}\n追記`).includes("foot_missing"));
  assert.ok(check(`${"長".repeat(200)}\n${ok}`).includes("too_long"));
  const bad = { ...sheet, featured: { ...sheet.featured, wins: 50 } };
  bad.sections = [{ ...sheet.sections[0], rows: [bad.featured] }];
  assert.ok(
    check(buildCourseWinPost(bad, { venueName, url: URL_B }), bad).includes(
      "value_invalid",
    ),
  );
});

test("撮影用のページの URL は日付・送る時刻・除く行だけ（数字を渡さない）", () => {
  assert.equal(
    courseWinSheetUrl(D, "08:00", [`${D}-22-12:1`, `${D}-04-12:1`]),
    `https://www.boat-ai.jp/share/today-sheet?date=${D}&from=08%3A00&skip=${D}-04-12%3A1%2C${D}-22-12%3A1`,
  );
});

// ---- 後半の場面（verifyData/today-type-b-scenes.js） ----
runTodayTypeBScenes1({ notesOf, NOTES, URL_B });
const dayOf = (start, i) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000)
    .toISOString()
    .slice(0, 10);

// ---- 後半の場面（verifyData/today-type-b-scenes.js） ----
runTodayTypeBScenes2({ notesOf, NOTES, URL_B, dayOf });

// 2026-10-28 オーナー決定（hq）: 10/29 から毎日 b。2026-11-04 オーナー決定（BOA-1314）で比べ（TT03）を取り下げ、11/4 で終える
// （experiment は消さずに days を7にする。消すと日の偶奇に戻る）。11/5 からは今の型 v3（current）で、型 a・b は送らない
test("リポジトリの config: all_b は 10/29〜11/4 の7日で終わり、b の日は mode・day を記録し、型の列を使わない。前後の日は今の型 v3", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../../config/today-variants.json", import.meta.url),
      "utf8",
    ),
  );
  const exp = normalizeTodayExperiment(config.experiment);
  assert.deepEqual(exp, {
    id: "today-v2-course-win",
    mode: "all_b",
    start: "2026-10-29",
    days: 7,
  });
  for (let i = 0; i < 7; i += 1) {
    const date = dayOf("2026-10-29", i);
    assert.deepEqual(pickExperimentSide(exp, date), {
      side: "b",
      pair: null,
      slot: null,
      day: i,
    });
    const p = pickTodayPost(config, date);
    assert.equal(p.body, "course_win", date);
    assert.equal(p.content_type.side, "b");
    assert.equal(p.content_type.mode, "all_b");
    assert.equal(p.content_type.day, i);
    assert.equal(p.content_type.experiment, "today-v2-course-win");
  }
  assert.equal(dayOf("2026-10-29", 6), "2026-11-04");
  for (const date of ["2026-10-28", "2026-11-05", "2026-11-27", "2027-01-01"]) {
    assert.deepEqual(pickExperimentSide(exp, date), {
      side: "a",
      pair: null,
      slot: null,
    });
    const p = pickTodayPost(config, date);
    assert.equal(p.body, "digest_v3", date);
    assert.equal(p.content_type.id, "today-c-digest");
    assert.equal(p.content_type.side, "c");
    assert.equal(p.variant.id, "c");
    assert.equal(p.content_type.mode, undefined);
    // 型の列の行があっても v3（列は見出しの型 a の口）
    const row = {
      day: date,
      type_id: "t03-x",
      post: { heading: "別の型（{date}）" },
    };
    const withRow = pickTodayPost(config, date, { row });
    assert.equal(withRow.body, "digest_v3", date);
    assert.equal(withRow.content_type.fallback_reason, "current_type");
  }
  const row = {
    day: "2026-10-30",
    type_id: "t03-x",
    post: { heading: "別の型（{date}）" },
  };
  const withRow = pickTodayPost(config, "2026-10-30", { row });
  assert.equal(withRow.body, "course_win");
  assert.equal(withRow.content_type.fallback_reason, "experiment_all_b");
  // days が壊れていれば既定の 10日
  assert.equal(
    normalizeTodayExperiment({ mode: "all_b", start: "2026-10-29", days: 0 })
      .days,
    10,
  );
});

// ---- 後半の場面（verifyData/today-type-b-scenes.js） ----
runTodayTypeBScenes3({ notesOf, NOTES, URL_B, dayOf });
