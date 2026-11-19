/**
 * verify-meet-exclusion.js の B 節（仕様の値: 外すか外さないか）の場面。verify ではない。
 * 判定と期待値は分ける前の verify-meet-exclusion.js と同じ。check・件数は ./meet-exclusion.js の物を共に使う。
 */
import assert from "node:assert/strict";
import * as seriesPoints from "../../../src/pure/seriesPoints.js";
import { check, entry, excluded, run, st } from "./meet-exclusion.js";

/** B 節の場面を順に check へ渡す */
export function checkSpecValues() {
  console.log("B. 仕様の値（外すか外さないか）");

  check("B1 予選中に切った今節Fは賞典除外で順位から外す", () => {
    const out = run({
      meetRows: [
        entry("2026-10-01-04-02", 4, 5400),
        entry("2026-10-02-04-01", 4, 5400),
      ],
      meetStarts: [st("2026-10-01-04-02", 4, { is_flying: true })],
    });
    assert.ok(excluded(out).has(5400));
  });

  check(
    "B2 得点率・順位は予選終了で確定する。予選の後のFでは順位を動かさない",
    () => {
      const out = run({
        date: "2026-10-03",
        meetRows: [
          entry("2026-10-02-04-02", 1, 5410),
          entry("2026-10-03-04-01", 1, 5410),
          entry("2026-10-03-04-02", 1, 5410),
        ],
        meetStarts: [st("2026-10-03-04-01", 1, { is_flying: true })],
      });
      assert.ok(!excluded(out).has(5410));
    },
  );

  check("B3 途中帰郷した選手は順位を付けない", () => {
    const out = run({
      date: "2026-10-02",
      meetRows: [
        entry("2026-10-01-04-01", 1, 5420),
        entry("2026-10-02-04-01", 2, 5421),
      ],
    });
    assert.ok(excluded(out).has(5420));
    assert.ok(!excluded(out).has(5421));
  });

  check("B4 公式が賞典除外・途中帰郷とした選手は順位を付けない", () => {
    const out = run({
      usesOfficialSeries: true,
      date: "2026-10-03",
      officialSeries: [
        { racer_id: 5430, remarks: "賞典除外" },
        { racer_id: 5431, remarks: "途中帰郷" },
        { racer_id: 5432, remarks: null },
      ],
    });
    assert.deepEqual(
      [...excluded(out)].sort((a, b) => a - b),
      [5430, 5431],
    );
  });

  check(
    "B5 フライングは即日帰郷ではない（Fの選手を途中帰郷の理由にしない）",
    () => {
      const out = run({
        meetRows: [
          entry("2026-10-01-04-01", 1, 5440),
          entry("2026-10-02-04-01", 1, 5440),
        ],
        meetStarts: [st("2026-10-01-04-01", 1, { is_flying: true })],
      });
      assert.equal(out.exclusionReasonByRacer[5440], "flying");
    },
  );

  // BOA-1072: L1 のみ賞典除外。旧の試験の入力・期待値は維持する。
  check("B6 L1 は lateStart、L0・責任不明のL・他の成績コードは外さない", () => {
    const codes = ["L1", "L0", null, undefined, "01", "K1"];
    const meetRows = codes.map((_, i) =>
      entry("2026-10-02-04-01", i + 1, 5500 + i),
    );
    const out = run({
      meetRows,
      meetStarts: codes.map((code, i) =>
        st("2026-10-02-04-01", i + 1, {
          finish_mark: "L",
          official_finish_code: code,
        }),
      ),
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5500],
      exclusionReasonByRacer: { 5500: "lateStart" },
    });
  });

  check("B7 L1 は予選終了のレースまで、予選後のL1では外さない", () => {
    const out = run({
      date: "2026-10-03",
      meetRows: [
        entry("2026-10-02-04-02", 1, 5510),
        entry("2026-10-03-04-01", 2, 5511),
        entry("2026-10-03-04-02", 1, 5510),
      ],
      meetStarts: [
        st("2026-10-02-04-02", 1, { official_finish_code: "L1" }),
        st("2026-10-03-04-01", 2, { official_finish_code: "L1" }),
      ],
    });
    assert.deepEqual(out.exclusionReasonByRacer, { 5510: "lateStart" });
  });

  check("B8 公式の備考があればL1の推定も使わない", () => {
    const out = run({
      usesOfficialSeries: true,
      officialSeries: [{ racer_id: 5520, remarks: "途中帰郷" }],
      meetRows: [entry("2026-10-02-04-01", 1, 5521)],
      meetStarts: [st("2026-10-02-04-01", 1, { official_finish_code: "L1" })],
    });
    assert.deepEqual(out, {
      withdrawnRacerIds: [5520],
      exclusionReasonByRacer: { 5520: "officialWithdrawn" },
    });
  });

  check("B9 FとL1の両方なら、発生順にかかわらずflyingを優先", () => {
    for (const codes of [
      ["F", "L1"],
      ["L1", "F"],
    ]) {
      const out = run({
        meetRows: [
          entry("2026-10-02-04-01", 1, 5530),
          entry("2026-10-02-04-02", 2, 5530),
        ],
        meetStarts: codes.map((code, i) =>
          st(`2026-10-02-04-0${i + 1}`, i + 1, {
            finish_mark: code === "F" ? "F" : "L",
            official_finish_code: code,
          }),
        ),
      });
      assert.deepEqual(out.exclusionReasonByRacer, { 5530: "flying" });
    }
  });

  check("B10 L1の理由は不在・前夜の途中帰郷で上書きしない", () => {
    const out = run({
      meetRows: [
        entry("2026-10-01-04-01", 1, 5540),
        entry("2026-10-02-04-01", 2, 5541),
      ],
      meetStarts: [st("2026-10-01-04-01", 1, { official_finish_code: "L1" })],
      prelimOfficial: { withdrawnRacerIds: [5540] },
    });
    assert.deepEqual(out.exclusionReasonByRacer, { 5540: "lateStart" });
  });

  check("B11 予選の締めが不明でも、入力されたL1は対象", () => {
    const out = run({
      conditions: [],
      meetRows: [entry("2026-10-02-04-01", 1, 5550)],
      meetStarts: [st("2026-10-02-04-01", 1, { official_finish_code: "L1" })],
    });
    assert.deepEqual(out.exclusionReasonByRacer, { 5550: "lateStart" });
  });

  check("B12 L1の純関数はレースと艇番で結合し、重複・不明な選手を除く", () => {
    const race = "2026-10-02-04-01";
    const starts = [1, 1, 2, 3, 4].map((boat) =>
      st(race, boat, { official_finish_code: "L1" }),
    );
    const entries = [
      entry(race, 1, 5560),
      entry("2026-10-01-04-01", 2, 5561),
      entry(race, 3, null),
      entry(race, 4, undefined),
    ];
    const before = JSON.stringify({ starts, entries });
    assert.deepEqual(
      seriesPoints.lateStartL1RacerIdsInMeet(starts, entries),
      [5560],
    );
    assert.equal(JSON.stringify({ starts, entries }), before);
    assert.deepEqual(seriesPoints.lateStartL1RacerIdsInMeet(null, null), []);
    assert.deepEqual(seriesPoints.lateStartL1RacerIdsInMeet([], []), []);
  });
}
