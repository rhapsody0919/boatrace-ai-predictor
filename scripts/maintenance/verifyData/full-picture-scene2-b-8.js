/**
 * verify-full-picture-scene2.js の後半の場面（8/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { boats, got, run, pre } from "./full-picture-scene2-b-4.js";
import { seenQueries } from "./full-picture-scene2-b-3.js";
import { racerStatsRaw } from "./full-picture-scene2-b-2.js";
import { entryRows, live } from "./full-picture-scene2-b-1.js";

let validate;
let saved, fixes, fb;
export let b3;

async function scene1() {
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
  saved = structuredClone(racerStatsRaw);
  racerStatsRaw[0].defenseDistribution = {};
  racerStatsRaw[3].courseRaceCounts = {
    4: { total: 25, wins: 0 },
    1: { total: 5, wins: 5 },
  };
  entryRows[1].grade = null;
  live.failRacer = "eq.4001";
  fixes = await run({ conditions: pre });
  fb = fixes.db.exhibition.boats;
  // Codex の審査（#1905 P1）: no_distribution を含む材料も契約に合う（enum に無いと run-full が動画の前に止まる）
  assert.deepEqual(
    validate(fixes),
    [],
    "守りの内訳が無いセル（no_distribution）を含む材料も契約に合う",
  );
}

function scene2() {
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
  live.failRacer = null;
  // ---- 画面と同じ定義の材料の2（2026-10-25 hq 依頼、FT01 の PR A）----
  // 4. F持ち時・F無し時の平均ST と 11. 当地・波5cm以上（基本情報タブの条件別の表 buildConditionRows と同じ）
  b3 = boats[2];
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
}

function scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（validate） */
export async function runFullPictureScene2B9(env) {
  ({ validate } = env);
  await scene1();
  scene2();
  scene3();
}
