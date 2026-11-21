/**
 * verify-upset-win.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-upset-win.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  oneIn,
  lowestBoats,
  candidates,
  pickUpset,
  primaryOf,
  hookMetrics,
  weaknessesOf,
  tableMetrics,
  addDays,
  sumDays,
  dayCounts,
  READ_COLUMNS,
  shapeDay,
  headerText,
  descriptionOf,
  titleOf,
  screensOf,
} from "../../../sns-video-studio/remotion/src/upsetWin/model.js";
import { fetchDayRows, fetchRaceRows } from "../../../sns-video-studio/remotion/scripts/upset-win/materials.mjs";

let SAMPLE, check, clone, race;

function upw1Scene1() {
  test("およそ{1/p}回に1回: N/k の四捨五入、100以上は10の位で四捨五入。k=0・N<k・整数でない数は言えない（null）", () => {
    assert.equal(oneIn(51369, 5339), 10); // 9.62
    assert.equal(oneIn(51720, 2724), 19); // 18.99
    assert.equal(oneIn(1000, 7), 140); // 142.9
    assert.equal(oneIn(1000, 10), 100);
    assert.equal(oneIn(995, 10), 100); // 99.5 → 100 → 10の位で 100
    assert.equal(oneIn(100, 40), 3); // 2.5 → 3
    assert.equal(oneIn(10, 10), 1);
    assert.equal(oneIn(10, 0), null);
    assert.equal(oneIn(5, 6), null);
    assert.equal(oneIn(10.5, 2), null);
  });
  test("最下位（同値を含む）: 勝率・モーターは低い方、展示タイムは遅い方、展示 ST は F を負・L を一番遅いとして比べる。値の無い艇・0 があればその項目は比べない", () => {
    assert.deepEqual(
      lowestBoats(
        race({}, { 2: { win_rate: 3 }, 5: { win_rate: 3 } }),
        "win_rate",
      ),
      [2, 5],
    );
    assert.deepEqual(
      lowestBoats(race({}, { 3: { exhibition_time: 6.95 } }), "exhibition_time"),
      [3],
    );
    // F.12（-0.12）は F.03（-0.03）より早い。全艇 F なら F.03 が一番遅い
    const allF = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((b) => [
        b,
        { st_flag: "F", start_timing: b === 2 ? 0.03 : 0.12 },
      ]),
    );
    assert.deepEqual(lowestBoats(race({}, allF), "start_timing"), [2]);
    assert.deepEqual(
      lowestBoats(
        race(
          {},
          { 6: { st_flag: "L", start_timing: null }, 1: { start_timing: 0.4 } },
        ),
        "start_timing",
      ),
      [6],
    );
    assert.equal(
      lowestBoats(race({}, { 2: { motor_2rate: 0 } }), "motor_2rate"),
      null,
    );
    assert.equal(
      lowestBoats(race({}, { 2: { exhibition_time: null } }), "exhibition_time"),
      null,
    );
    assert.equal(
      lowestBoats(race({}, { 2: { start_timing: null } }), "start_timing"),
      null,
    );
  });
}

function upw1Scene2() {
  test("選び: 単勝10倍以上・弱さ1つ以上・決まり手あり。単勝の高い順 → 弱さの多い順 → グレードの高い順 → race_id。中止・不成立・欠場・単勝の欠け（0）は外す。該当なしは null（0本）", () => {
    const weak = { 4: { win_rate: 2 } };
    const a = race(
      { race_id: "2026-11-03-01-01" },
      { ...weak, 4: { win_rate: 2, odds: 30 } },
    );
    const b = race(
      { race_id: "2026-11-03-02-01" },
      { 4: { win_rate: 2, exhibition_time: 7.0, odds: 30 } },
    );
    const c = race(
      { race_id: "2026-11-03-03-01", grade: "SG" },
      { 4: { win_rate: 2, exhibition_time: 7.0, odds: 30 } },
    );
    const d = race(
      { race_id: "2026-11-03-04-01" },
      { 4: { win_rate: 2, odds: 50 } },
    );
    const low = race(
      { race_id: "2026-11-03-05-01" },
      { 4: { win_rate: 2, odds: 9.9 } },
    );
    const strong = race({ race_id: "2026-11-03-06-01" }, { 4: { odds: 80 } });
    const absent = race(
      { race_id: "2026-11-03-07-01", absent: true },
      { 4: { win_rate: 2, odds: 90 } },
    );
    const cancelled = race(
      { race_id: "2026-11-03-08-01", cancelled: true },
      { 4: { win_rate: 2, odds: 90 } },
    );
    const noRace = race(
      { race_id: "2026-11-03-09-01", no_race: true },
      { 4: { win_rate: 2, odds: 90 } },
    );
    const noOdds = race(
      { race_id: "2026-11-03-10-01" },
      { 4: { win_rate: 2, odds: 0 } },
    );
    const noTech = race(
      { race_id: "2026-11-03-11-01", technique: null },
      { 4: { win_rate: 2, odds: 90 } },
    );
    const list = candidates([
      a,
      b,
      c,
      d,
      low,
      strong,
      absent,
      cancelled,
      noRace,
      noOdds,
      noTech,
    ]);
    assert.deepEqual(
      list.map((x) => x.race.race_id),
      [
        "2026-11-03-04-01",
        "2026-11-03-03-01",
        "2026-11-03-02-01",
        "2026-11-03-01-01",
      ],
    );
    assert.equal(
      list.find((x) => x.race.race_id === "2026-11-03-05-01"),
      undefined,
      "9.9倍は外す",
    );
    assert.equal(pickUpset([low, strong, absent]), null);
    assert.equal(
      candidates([race({}, { 4: { win_rate: 2, odds: 10 } })]).length,
      1,
      "ちょうど10倍は入る",
    );
  });
}

function upw1Scene3() {
  test("3コマ目の項目（展示タイム → モーター → 勝率の最初）・1コマ目の項目（表に列のある弱さ、2つまで）・表の列。展示 ST は弱さに入れない", () => {
    assert.equal(primaryOf(["win_rate", "exhibition_time"]), "exhibition_time");
    assert.equal(primaryOf(["win_rate", "motor_2rate"]), "motor_2rate");
    assert.equal(primaryOf(["win_rate"]), "win_rate");
    assert.equal(primaryOf(["start_timing"]), null);
    assert.deepEqual(
      hookMetrics(["win_rate", "exhibition_time"], "exhibition_time"),
      ["win_rate", "exhibition_time"],
    );
    // 3つとも弱さ: 3コマ目は展示タイム、モーターは表に列が無いので1コマ目に出さない
    assert.deepEqual(
      hookMetrics(
        ["win_rate", "exhibition_time", "motor_2rate"],
        "exhibition_time",
      ),
      ["win_rate", "exhibition_time"],
    );
    assert.deepEqual(hookMetrics(["motor_2rate"], "motor_2rate"), [
      "motor_2rate",
    ]);
    assert.deepEqual(hookMetrics(["win_rate", "motor_2rate"], "motor_2rate"), [
      "win_rate",
      "motor_2rate",
    ]);
    // 展示 ST が最下位でも弱さにしない（F の記録が 2026-09 からしかそろっていない）
    const allF = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((b) => [
        b,
        { st_flag: null, start_timing: b === 4 ? 0.3 : 0.1 },
      ]),
    );
    assert.deepEqual(weaknessesOf(race({}, allF)), []);
    assert.deepEqual(tableMetrics("exhibition_time"), [
      "win_rate",
      "exhibition_time",
    ]);
    assert.deepEqual(tableMetrics("motor_2rate"), [
      "win_rate",
      "exhibition_time",
      "motor_2rate",
    ]);
  });
  test("直近1年: レースの日を含む365日の日ごとの [n, k] の和。1日でも欠けた・k>n・整数でない日は null。dayCounts は比べたレースと最下位の1着を項目ごとに数える", () => {
    const days = {};
    for (let d = "2025-11-04"; d <= "2026-11-03"; d = addDays(d, 1))
      days[d] = [100, 10];
    assert.deepEqual(sumDays(days, { from: "2025-11-04", to: "2026-11-03" }), {
      n: 36500,
      k: 3650,
    });
    assert.equal(
      sumDays(
        { ...days, "2026-01-01": undefined },
        { from: "2025-11-04", to: "2026-11-03" },
      ),
      null,
    );
    assert.equal(
      sumDays(
        { ...days, "2026-01-01": [1, 2] },
        { from: "2025-11-04", to: "2026-11-03" },
      ),
      null,
    );
    assert.equal(
      sumDays(
        { ...days, "2026-01-01": [1.5, 1] },
        { from: "2025-11-04", to: "2026-11-03" },
      ),
      null,
    );
    const c = dayCounts([
      race({}, { 4: { win_rate: 2 } }),
      race({ rank1: 1 }, { 4: { win_rate: 2 } }),
      race({ absent: true }, { 4: { win_rate: 2 } }),
      race({}, { 2: { motor_2rate: 0 } }),
    ]);
    // 1つ目は最下位の4号艇が1着、2つ目は1号艇が1着、3つ目は欠場で数えない、4つ目は1号艇が最下位で4号艇が1着
    assert.deepEqual(c.win_rate, [3, 1]);
    assert.deepEqual(c.motor_2rate, [2, 1]); // 0 の艇があるレースは比べない（2つ目は1号艇が最下位で1着）
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（SAMPLE・check・clone・race） */
export function runUpsetWinScenes1(env) {
  ({ SAMPLE, check, clone, race } = env);
  upw1Scene1();
  upw1Scene2();
  upw1Scene3();
}

function upw1Scene4() {
  test("締切・日目・大会名を材料から文へ渡す。締切の無い候補は次へ進む", async () => {
    assert.ok(READ_COLUMNS.races.split(",").includes("start_time"));
    const condition = {
      race_id: SAMPLE.race_id,
      series_day: 3,
      is_final_day: false,
      race_title: "ルーキーシリーズ第２１戦スカパー！・ＪＬＣ杯",
    };
    const rows = {
      races: [{
        race_id: SAMPLE.race_id,
        race_date: SAMPLE.race_date,
        venue_code: 17,
        race_number: 10,
        race_grade: "ippan",
        start_time: "14:32:00",
      }],
      race_conditions: [condition],
    };
    const shaped = shapeDay(rows)[0];
    const b = { ...clone(SAMPLE), ...shaped, boats: SAMPLE.boats, rank1: SAMPLE.rank1 };
    assert.equal(headerText(b), "11/3（火）宮島10R 3日目 締切14:32");
    assert.equal(headerText({ ...b, series_day: null }), "11/3（火）宮島10R 締切14:32");
    assert.equal(headerText({ ...b, series_day: 1 }), "11/3（火）宮島10R 初日 締切14:32");
    assert.match(headerText({ ...b, is_final_day: true }), /最終日 締切14:32$/);
    assert.equal(descriptionOf(b).split("\n")[1], "");
    for (const grade of ["SG", "G1"]) {
      assert.equal(descriptionOf({ ...b, grade }).split("\n")[1], condition.race_title.normalize("NFKC"));
    }
    for (const grade of ["G2", "G3", "ippan"]) assert.equal(descriptionOf({ ...b, grade }).split("\n")[1], "");
    assert.ok(titleOf(b).length <= 100);
    const changed = { ...clone(SAMPLE), start_time: "23:59", series_day: 12 };
    changed.texts = screensOf(changed);
    changed.youtube = { title: titleOf(changed), description: descriptionOf(changed) };
    assert.deepEqual(check(changed), []);
    assert.ok(check({ ...clone(SAMPLE), start_time: null }).length > 0);
    const good = race({}, { 4: { win_rate: 1, odds: 34.7 } });
    for (const start_time of [null, "", "invalid", "25:00"]) {
      const missing = { ...good, start_time };
      assert.equal(pickUpset([missing]), null);
      assert.equal(pickUpset([missing, good]).race, good);
    }
    for (const fetchRows of [fetchDayRows, fetchRaceRows]) {
      const calls = [];
      const arg = fetchRows === fetchDayRows ? SAMPLE.race_date : SAMPLE.race_id;
      const fetched = await fetchRows(arg, {
        get: async (table, query) => {
          calls.push([table, query]);
          return table === "race_conditions" ? [condition] : [];
        },
      });
      assert.deepEqual(fetched.race_conditions, [condition]);
      const query = calls.find(([table]) => table === "race_conditions")[1];
      assert.ok(query.includes("select=race_id,series_day,is_final_day,race_title"));
      assert.ok(query.includes(fetchRows === fetchDayRows ? `race_id=like.${SAMPLE.race_date}-*` : `race_id=eq.${SAMPLE.race_id}`));
      await assert.rejects(fetchRows(arg, {
        get: async (table) => {
          if (table === "race_conditions") throw new Error("conditions failed");
          return [];
        },
      }), /conditions failed/);
    }
  });
  test("締切を外したヘッダ・題・説明欄は bundle の照合で止まる", () => {
    for (const part of ["header", "title", "description"]) {
      const b = clone(SAMPLE);
      if (part === "header") b.texts.header = b.texts.header.replace(" 締切14:32", "");
      else b.youtube[part] = b.youtube[part].replace(" 締切14:32", "");
      assert.match(check(b).join(), /値から作った文と違う/, part);
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（SAMPLE・check・clone・race） */
export function runUpsetWinScenes2(env) {
  ({ SAMPLE, check, clone, race } = env);
  upw1Scene4();
}
