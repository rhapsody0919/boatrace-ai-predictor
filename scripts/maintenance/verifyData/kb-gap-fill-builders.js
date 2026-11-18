/**
 * verify-kb-gap-fill.js の検査の続き（kb-gap-fill-builders.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { DAY, R1, R2, R3, same, show } from "./kb-gap-fill-fixtures.js";

export function evaluateBuilders(g) {
  const { failed, expect } = evaluateBuildersPart1(g);
  return evaluateBuildersPart2(g, failed, expect);
}

export function evaluateBuildersPart1(g) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  // (a) R2 は既に行がある、R3 は races に無い
  const st = g.buildStartTimingRows(DAY, {
    raceIds: new Set([R1, R2]),
    withRows: new Set([R2]),
  });
  expect(
    "(a) スタート: R1 の進入のある2艇だけ（欠場艇・行のある R2・races に無い R3 は作らない）",
    same(
      st.map((r) => `${r.race_id}#${r.boat_number}`),
      [`${R1}#1`, `${R1}#2`],
    ),
    show(st),
  );
  const f = st.find((r) => r.boat_number === 2);
  expect(
    "(a) フライングの ST は正の値（0.03）で is_flying=true",
    f?.start_timing === 0.03 && f?.is_flying === true,
    show(f),
  );
  expect(
    "(a) 列は race_id・boat_number・start_timing・is_flying・is_late_start・entry_course だけ",
    st.every(
      (r) =>
        Object.keys(r).sort().join() ===
        "boat_number,entry_course,is_flying,is_late_start,race_id,start_timing",
    ),
  );
  // (b) R1 は行なし、R2 は1号艇に展示タイムあり（上書きしない）、R3 は行があるが展示タイム NULL（展示STだけの行）
  const ex = g.buildExhibitionRows(DAY, {
    raceIds: new Set([R1, R2, R3]),
    timeByKey: new Map([
      [`${R2}|1`, 6.81],
      [`${R3}|1`, null],
    ]),
  });
  expect(
    "(b) 展示タイム: 行の無い R1・NULL の R3 は書き、既存の値のある R2 は書かない。欠場艇は作らない。列は exhibition_time だけ",
    same(
      ex.map((r) => `${r.race_id}#${r.boat_number}`),
      [`${R1}#1`, `${R1}#2`, `${R3}#1`],
    ) &&
      ex.every(
        (r) =>
          Object.keys(r).sort().join() ===
          "boat_number,exhibition_time,race_id",
      ),
    show(ex),
  );
  return { failed, expect };
}

export function evaluateBuildersPart2(g, failed, expect) {
  // (c) R1 は全部 NULL、R2 は天候だけ既存（"曇り"）、R3 は全部埋まっている
  const cond = g.buildConditionsRows(
    DAY,
    new Map([
      [
        R1,
        {
          race_id: R1,
          weather: null,
          wind_direction: null,
          wind_speed: null,
          wave_height: null,
          race_stage: null,
        },
      ],
      [
        R2,
        {
          race_id: R2,
          weather: "曇り",
          wind_direction: null,
          wind_speed: null,
          wave_height: null,
          race_stage: null,
        },
      ],
      [
        R3,
        {
          race_id: R3,
          weather: "晴",
          wind_direction: "東",
          wind_speed: 1,
          wave_height: 1,
          race_stage: "一般",
        },
      ],
    ]),
  );
  const c2 = cond.find((r) => r.race_id === R2);
  expect(
    "(c) 気象: 変化の無い R3 は書かず、R2 の既存の天候（曇り）は上書きしない",
    same(
      cond.map((r) => r.race_id),
      [R1, R2],
    ) &&
      c2?.weather === "曇り" &&
      c2?.wind_speed === 5,
    show(cond),
  );
  const c1 = cond.find((r) => r.race_id === R1);
  expect(
    "(c) ステージは付記（進入固定）を落とした原文。風向は書かない（K と DB で方位の基準が違う）",
    c1?.race_stage === "予選" &&
      !("wind_direction" in (c1 ?? {})) &&
      g.normalizeKStage({ stage_raw: "ドラドキ３" }) === "ドラドキ３" &&
      g.normalizeKStage({ stage_raw: "" }) === null,
    show(c1),
  );
  // (d) 1号艇は NULL、2号艇は登録番号違い、3号艇は全国2連率だけ既存
  const rate = g.buildRate2Rows(
    DAY,
    new Map([
      [`${R1}|1`, { racer_id: 4001, global_2rate: null, local_2rate: null }],
      [`${R1}|2`, { racer_id: 4002, global_2rate: null, local_2rate: null }],
      [`${R1}|3`, { racer_id: 4003, global_2rate: 55.5, local_2rate: null }],
    ]),
  );
  expect(
    "(d) 2連率: 登録番号が一致する艇だけ。既存の値（3号艇の全国 55.5）は上書きしない",
    same(rate, [
      { race_id: R1, boat_number: 1, global_2rate: 40.5, local_2rate: 38.2 },
      { race_id: R1, boat_number: 3, global_2rate: 55.5, local_2rate: 21.0 },
    ]),
    show(rate),
  );
  // assertColumnSet
  let threw = false;
  try {
    g.assertColumnSet(
      [{ race_id: R1, a: 1 }, { race_id: R1 }],
      ["race_id", "a"],
    );
  } catch {
    threw = true;
  }
  expect("(e) 列の集合が違う行があれば例外", threw);
  return failed;
}
