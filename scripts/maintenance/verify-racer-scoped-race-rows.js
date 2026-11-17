/**
 * verify-racer-scoped-race-rows.js — 選手の走ごとの行（getRacerScopedRaceStats の返り値）の整形の回帰テスト。
 *
 * 対象は `src/services/racerScopedRaceRows.js` の `buildRacerScopedRaceRows`。
 * `getRacerScopedRaceStats`（`src/services/supabaseDataService.js`）の中の整形を手を加えずに
 * 移したもの（開発効率の計画 段3 の2件目、BOA-1022）。src の12ファイルがこの行を読む。
 * この整形には fix が5件あった（#962・#1010・#1029・#1107・BOA-333 の 927d46d11）ので、
 * それぞれの再現の入力を例に入れる。
 *
 * 期待値は2つに分ける（plan.md 3+2）:
 * - A. 旧の実装から取った値: 移す前の動きの固定。誤りも含めて写す
 * - B. 仕様の値: 公式の定義から決まる値（不成立は着順なし・返還は着順が有効・F は ST の
 *   平均に入れない・出遅れも平均に入れない・「欠」は欠場・展示の同タイムは同順位）
 * 食い違いは別の起票で直す（切り出しでは直さない）。
 *
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  useFakeSupabase as setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  R1,
  R2,
  R9,
  RACER,
  ROW_KEYS,
  check,
  checkAsync,
  checked,
  expectedServiceRows,
  only,
  run,
  S1,
  S2,
  SERVICE_TABLES,
  entry,
  ex,
  race,
  result,
  sixSt,
} from "./verifyData/racer-scoped-race-rows.js";
import { existsSync } from "node:fs";

// BOA-1501 で src/pure へ移す。移す前後のどちらでも本体を読む（移した後に元の場所の分岐は外す）
const BASIC_INFO_STATS = existsSync(
  new URL("../../src/pure/basicInfoStats.js", import.meta.url),
)
  ? "../../src/pure/basicInfoStats.js"
  : "../../src/components/race/basicInfoStats.js";
const { computeRates, getRecentRaces } = await import(BASIC_INFO_STATS);

console.log("A. 旧の実装から取った値");

check("A1 #1010（BOA-588）: 同じ日の2走を R の古い順に並べる", () => {
  const rows = run({
    entries: [entry(R2), entry(R9), entry(R1)],
    raceRows: [race(R1), race(R9), race(R2)],
    resultRows: [result(R1), result(R9), result(R2)],
    startTimingRows: [],
  });
  assert.deepEqual(
    rows.map((r) => r.raceId),
    [R1, R9, R2],
  );
});

check(
  "A2 #1107（BOA-477）: 不成立・rank1 null・結果なし・races なしの走は除く",
  () => {
    const ids = ["2026-10-03-04-01", "2026-10-03-04-02", "2026-10-03-04-03"];
    const rows = run({
      entries: [entry(R1), ...ids.map((id) => entry(id)), entry(R2)],
      // R2 は races の行が無い
      raceRows: [race(R1), ...ids.map(race)],
      resultRows: [
        result(R1, { race_status: "no_race" }),
        result(ids[0], { rank1: null }),
        // ids[1] は結果の行が無い
        result(ids[2], { race_status: null }),
        result(R2),
      ],
    });
    // race_status が null（未判定）は通す（raceOutcome.js の UNKNOWN）
    assert.deepEqual(
      rows.map((r) => r.raceId),
      [ids[2]],
    );
  },
);

check("A3 #962（BOA-504）: 着欄「欠」は欠場", () => {
  const row = only({
    startTimingRows: sixSt(R1, {
      1: { finish_mark: "欠", start_timing: null },
    }),
  });
  assert.equal(row.absent, true);
  assert.equal(row.finishMark, "欠");
});

check(
  "A4 #962（BOA-504）: 他の艇の本番 ST の行があり自艇だけ無い走は欠場（中岡正彦の件）",
  () => {
    const row = only({
      startTimingRows: sixSt(R1).filter((r) => r.boat_number !== 1),
    });
    assert.equal(row.absent, true);
    assert.equal(row.startTiming, null);
    assert.equal(row.finishMark, null);
  },
);

check("A5 #962: レースに本番 ST の行が1つも無い走は欠場にしない", () => {
  const row = only({ startTimingRows: [] });
  assert.equal(row.absent, false);
  assert.equal(row.isFlying, false);
});

check(
  "A6 #1029（BOA-583）: フライングの ST は startTiming に入れず flyingStartTiming に持つ",
  () => {
    const row = only({
      startTimingRows: sixSt(R1, {
        1: { is_flying: true, start_timing: 0.01 },
      }),
    });
    assert.equal(row.startTiming, null);
    assert.equal(row.flyingStartTiming, 0.01);
    assert.equal(row.isFlying, true);
    assert.equal(row.stForRank, null);
  },
);

check(
  "A7 #1029: フライングで ST が null なら両方 null、F でない走は flyingStartTiming が null",
  () => {
    const fly = only({
      startTimingRows: sixSt(R1, {
        1: { is_flying: true, start_timing: null },
      }),
    });
    assert.equal(fly.startTiming, null);
    assert.equal(fly.flyingStartTiming, null);
    const normal = only({});
    assert.equal(normal.startTiming, 0.11);
    assert.equal(normal.flyingStartTiming, null);
  },
);

check(
  "A8 BOA-333（927d46d11）: race_conditions の取得の失敗（null）は undefined、行なし（[]）は null",
  () => {
    const failed = only({ conditionRows: null });
    for (const k of ["waveHeight", "seriesDay", "isFinalDay"]) {
      assert.ok(k in failed, `${k} のキーは残る`);
      assert.equal(failed[k], undefined);
    }
    assert.equal(failed.raceTitle, null);
    assert.equal(failed.raceStage, null);
    const empty = only({ conditionRows: [] });
    assert.equal(empty.waveHeight, null);
    assert.equal(empty.seriesDay, null);
    assert.equal(empty.isFinalDay, null);
    const filled = only({
      conditionRows: [
        {
          race_id: R1,
          race_stage: "予選",
          race_title: "一般戦",
          wave_height: 0,
          series_day: 3,
          is_final_day: false,
        },
      ],
    });
    // 0・false を null に倒さない
    assert.deepEqual(
      [
        filled.raceStage,
        filled.raceTitle,
        filled.waveHeight,
        filled.seriesDay,
        filled.isFinalDay,
      ],
      ["予選", "一般戦", 0, 3, false],
    );
  },
);

check("A9 公式の着欄の記号: 数字と空文字は null、記号はそのまま", () => {
  const mark = (finish_mark) =>
    only({ startTimingRows: sixSt(R1, { 1: { finish_mark } }) }).finishMark;
  assert.equal(mark("落"), "落");
  assert.equal(mark("妨"), "妨");
  assert.equal(mark("1"), null);
  assert.equal(mark("２"), null);
  assert.equal(mark(""), null);
});

check(
  "A10 進入コース: 本番 ST の entry_course を先に、無ければ actual_course、actualCourse は結果だけ",
  () => {
    const withSt = only({
      startTimingRows: sixSt(R1, { 1: { entry_course: 3 } }),
    });
    assert.equal(withSt.entryCourse, 3);
    assert.equal(withSt.actualCourse, 1);
    const noSt = only({ startTimingRows: [] });
    assert.equal(noSt.entryCourse, 1);
    const none = only({
      startTimingRows: [],
      resultRows: [result(R1, { actual_course_1: null })],
    });
    assert.equal(none.entryCourse, null);
    assert.equal(none.actualCourse, null);
  },
);

check(
  "A11 展示: 同タイムは同順位、自艇の値が無ければ null、単独最速だけ isFastestExhibition",
  () => {
    const exRun = (rows, boat = 1) =>
      only({ entries: [entry(R1, boat)], exhibitionRows: rows });
    const tie = exRun([ex(R1, 1, 6.7), ex(R1, 2, 6.7), ex(R1, 3, 6.75)], 3);
    assert.equal(tie.exhibitionRank, 3);
    assert.equal(tie.isFastestExhibition, null);
    const sole = exRun([ex(R1, 1, 6.7), ex(R1, 2, 6.72)]);
    assert.deepEqual(
      [sole.exhibitionTime, sole.exhibitionRank, sole.isFastestExhibition],
      [6.7, 1, true],
    );
    const second = exRun([ex(R1, 1, 6.72), ex(R1, 2, 6.7), ex(R1, 3, null)]);
    assert.deepEqual(
      [second.exhibitionRank, second.isFastestExhibition],
      [2, false],
    );
    const mineMissing = exRun([ex(R1, 2, 6.7), ex(R1, 1, null)]);
    assert.deepEqual(
      [
        mineMissing.exhibitionTime,
        mineMissing.exhibitionRank,
        mineMissing.isFastestExhibition,
      ],
      [null, null, false],
    );
    const noRows = exRun([]);
    assert.deepEqual(
      [noRows.exhibitionRank, noRows.isFastestExhibition],
      [null, null],
    );
  },
);

check("A12 ST 考察の派生値: F を除いた ST 順位・最速・内側艇の最速", () => {
  const rows = run({
    entries: [entry(R1, 3)],
    startTimingRows: sixSt(R1, {
      1: { start_timing: 0.15 },
      2: { start_timing: 0.01, is_flying: true },
      3: { start_timing: 0.12 },
      4: { start_timing: 0.12 },
    }),
  });
  const r = rows[0];
  // 3号艇 0.12（4号艇と同タイム）。F の2号艇を除き、5号艇 0.15・6号艇 0.16 より速い
  assert.deepEqual(
    [r.stForRank, r.raceBestSt, r.stRank, r.innerMinSt],
    [0.12, 0.12, 1, 0.15],
  );
});

check(
  "A13 欠けた値: rank4〜6・race_grade・grade・f_count・決まり手・配当は null",
  () => {
    const row = only({
      entries: [{ race_id: R1, boat_number: 1 }],
      raceRows: [{ race_id: R1, race_date: "2026-10-01", venue_code: "04" }],
      resultRows: [
        { race_id: R1, rank1: 2, rank2: 1, rank3: 3, race_status: "normal" },
      ],
    });
    assert.deepEqual(
      [
        row.rank4,
        row.rank5,
        row.rank6,
        row.raceGrade,
        row.grade,
        row.fCount,
        row.winningTechnique,
        row.payoutWin,
      ],
      [null, null, null, null, null, null, null, null],
    );
  },
);

check(
  "A14 出力の行のキー（BOA-1052 の表示用キーを追加、35個、順を含む）",
  () => {
    assert.deepEqual(Object.keys(only({})), ROW_KEYS);
  },
);

check("A15 entries が空なら空配列", () => {
  assert.deepEqual(run({ entries: [] }), []);
});

console.log("B. 仕様の値");

check(
  "B1 不成立のレースは着順が無いので数えない、返還があったレースは着順が有効なので数える",
  () => {
    const ids = [R1, R2];
    const rows = run({
      entries: ids.map((id) => entry(id)),
      raceRows: ids.map(race),
      resultRows: [
        result(R1, { race_status: "no_race" }),
        result(R2, { race_status: "partial_refund" }),
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.raceId),
      [R2],
    );
  },
);

check("B2 フライングの ST は平均 ST に入れない（startTiming が null）", () => {
  const row = only({
    startTimingRows: sixSt(R1, { 1: { is_flying: true, start_timing: 0.02 } }),
  });
  assert.equal(row.startTiming, null);
});

check("B3 公式の着欄が「欠」の走は欠場", () => {
  const row = only({
    startTimingRows: sixSt(R1, { 1: { finish_mark: "欠" } }),
  });
  assert.equal(row.absent, true);
});

check("B4 展示タイムの順位は同タイムを同順位にする（1, 1, 3）", () => {
  const rank = (boat) =>
    only({
      entries: [entry(R1, boat)],
      exhibitionRows: [ex(R1, 1, 6.7), ex(R1, 2, 6.7), ex(R1, 3, 6.8)],
    }).exhibitionRank;
  assert.deepEqual([rank(1), rank(2), rank(3)], [1, 1, 3]);
});

check("B5 出遅れの ST は平均から除き、直近の走の表には残す（BOA-1052）", () => {
  const late = only({
    startTimingRows: sixSt(R1, {
      1: { start_timing: 1.99, is_late_start: true, finish_mark: "L" },
    }),
  });
  assert.equal(late.startTiming, null);
  assert.equal(late.lateStartTiming, 1.99);
  assert.equal(late.finishMark, "L");
  assert.equal(getRecentRaces([late])[0].startTiming, 1.99);
  const normal = only({});
  const rates = computeRates([normal, late]);
  assert.equal(rates.n, 2);
  assert.equal(rates.avgStN, 1);
  assert.equal(rates.avgSt, 0.11);
  assert.equal(computeRates([late]).avgSt, null);
});

check("B6 出遅れの ST 欠落・false・フラグ未取得は従来の扱い", () => {
  const missing = only({
    startTimingRows: sixSt(R1, {
      1: { start_timing: null, is_late_start: true, finish_mark: "L" },
    }),
  });
  assert.equal(missing.startTiming, null);
  assert.equal(missing.lateStartTiming, null);
  assert.equal(getRecentRaces([missing])[0].startTiming, null);
  for (const extra of [{}, { is_late_start: false }]) {
    const normal = only({ startTimingRows: sixSt(R1, { 1: extra }) });
    assert.equal(normal.startTiming, 0.11);
    assert.equal(normal.lateStartTiming, null);
  }
  const fly = only({
    startTimingRows: sixSt(R1, { 1: { is_flying: true, start_timing: 0.01 } }),
  });
  assert.equal(getRecentRaces([fly])[0].startTiming, 0.01);
});

console.log("C. 呼び出し（サービス層を偽の supabase の上で呼ぶ）");

registerFakeServiceSupabase();
installLocalStorage();
const { getRacerScopedRaceStats } =
  await import("../../src/services/racerQueries2.js");
const { clearCache, withCache } = await import("../../src/services/core.js");
const { racerHistoryCutoff } =
  await import("../../src/utils/racerVenueBoatStats.js");

const install = (tables = SERVICE_TABLES, failTables) => {
  clearCache();
  // order は記録だけで並べ替えない。失敗の表は await で例外になる
  return setFakeSupabase(
    createFakeSupabase(tables, {
      sortByOrder: false,
      failTables: new Map(
        [...(failTables ?? [])].map((t) => [t, new Error(`${t} 失敗`)]),
      ),
    }),
  );
};
await checkAsync(
  "C1 getRacerScopedRaceStats は取った表を buildRacerScopedRaceRows で組んだ行をそのまま返す",
  async () => {
    const fake = install();
    const rows = await getRacerScopedRaceStats(RACER);
    const expected = expectedServiceRows();
    assert.equal(expected.length, 2);
    assert.deepEqual(rows, expected);
    // 取る表: race_entries は選手・窓の始点で、他の5表は選手の走の race_id だけで
    const entryQ = fake.calls.find((q) => q.table === "race_entries");
    assert.deepEqual(entryQ.filters, [
      ["eq", "racer_id", RACER],
      ["gte", "race_id", racerHistoryCutoff()],
    ]);
    for (const table of [
      "races",
      "race_results",
      "race_start_timings",
      "exhibition_data",
      "race_conditions",
    ]) {
      const q = fake.calls.find((c) => c.table === table);
      assert.ok(q, `${table} を取っていない`);
      assert.deepEqual(q.filters, [["in", "race_id", [S1, S2]]]);
    }
  },
);

await checkAsync(
  "C1b race_conditions の取得に失敗しても例外にせず、conditionRows を null で整形する",
  async () => {
    install(SERVICE_TABLES, new Set(["race_conditions"]));
    const origError = console.error;
    console.error = () => {};
    let rows;
    try {
      rows = await getRacerScopedRaceStats(RACER);
    } finally {
      console.error = origError;
    }
    const expected = expectedServiceRows(null);
    assert.deepEqual(rows, expected);
  },
);

await checkAsync(
  "C2 出遅れフラグ（is_late_start）を含む列で race_start_timings を取り、結果は racer-scoped-race-stats-v12 のキャッシュに入る（旧版のキャッシュは使わない）",
  async () => {
    const fake = install();
    // 旧版（v11）のキャッシュに入っていた古い形の値は返さない
    const stale = [{ stale: true }];
    await withCache(`racer-scoped-race-stats-v11-${RACER}`, async () => stale);
    const rows = await getRacerScopedRaceStats(RACER);
    assert.notDeepEqual(rows, stale);
    const stq = fake.calls.find((q) => q.table === "race_start_timings");
    assert.equal(
      stq.select,
      "race_id, boat_number, start_timing, is_flying, is_late_start, finish_mark, entry_course",
    );
    assert.equal(rows.find((r) => r.raceId === S2).lateStartTiming, 1.99);
    // 結果は v12 のキーに入っている（取り直さずに同じ値が返る）
    const cached = await withCache(`racer-scoped-race-stats-v12-${RACER}`, () =>
      Promise.reject(new Error("v12 のキャッシュに無い")),
    );
    assert.deepEqual(cached, rows);
  },
);

console.log(`✅ racerScopedRaceRows: ${checked()} 件の例を確認`);
