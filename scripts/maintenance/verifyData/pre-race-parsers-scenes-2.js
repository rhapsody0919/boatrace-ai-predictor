/**
 * verify-pre-race-parsers.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-pre-race-parsers.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as cheerio from "cheerio";
import * as realListParser from "../../lib/raceListParser.js";
import * as realBeforeParser from "../../lib/beforeInfoParser.js";
import * as realRows from "../../lib/preRaceRows.js";
import { PRE_RACE_SCHEMA_TARGETS } from "../../lib/preRaceSchema.js";
import { legacyScrapeRacers, legacyScrapeRaceMeta } from "../../lib/__fixtures__/raceInfo/legacyRaceListParser.js";
import { legacyScrapeExhibitionData } from "../../lib/__fixtures__/beforeinfo/legacyExhibitionParser.js";
import { scrapeExhibitionData } from "../../daily/scrape-exhibition-data.js";

let check, same, readFixture, listFixtures;

// ---------------------------------------------------------------------------
// (d) 書き込み経路
// ---------------------------------------------------------------------------
export const LEGACY_ENTRY_KEYS = [
  "race_id",
  "boat_number",
  "racer_id",
  "player_name",
  "grade",
  "age",
  "win_rate",
  "local_win_rate",
  "global_2rate",
  "local_2rate",
  "global_3rate",
  "local_3rate",
  "motor_number",
  "motor_2rate",
  "motor_3rate",
  "boat_number_id",
  "boat_2rate",
  "boat_3rate",
];

export const NEW_ENTRY_KEYS = PRE_RACE_SCHEMA_TARGETS.raceEntries.columns;

export const NEW_CONDITION_KEYS = PRE_RACE_SCHEMA_TARGETS.raceConditions.columns;

export const NEW_EXHIBITION_KEYS = PRE_RACE_SCHEMA_TARGETS.exhibition.columns;

export const ALL_NEW_COLUMNS = {
  race_entries: NEW_ENTRY_KEYS,
  race_conditions: NEW_CONDITION_KEYS,
  exhibition_data: NEW_EXHIBITION_KEYS,
};

export const jstDate = (hm) => new Date(`2026-09-16T${hm}:00+09:00`);

export const hmOf = (date) => realRows.formatJstHm(date);

function scene1() {
  // ---------------------------------------------------------------------------
  // (b) 旧解析との互換
  // ---------------------------------------------------------------------------
  {
    const mismatches = [];
    const listFiles = listFixtures("raceInfo");
    for (const file of listFiles) {
      const html = readFixture("raceInfo", file);
      const $ = cheerio.load(html);
      const legacyRacers = legacyScrapeRacers($);
      const legacyMeta = legacyScrapeRaceMeta($);
      const page = realListParser.parseRaceListPage(html);
      const camel = page.entries.map((e) => ({
        boatNumber: e.boat_number,
        racerId: e.racer_id,
        playerName: e.player_name,
        grade: e.grade,
        age: e.age,
        winRate: e.win_rate,
        localWinRate: e.local_win_rate,
        global2Rate: e.global_2rate,
        local2Rate: e.local_2rate,
        global3Rate: e.global_3rate,
        local3Rate: e.local_3rate,
        motorNumber: e.motor_number,
        motor2Rate: e.motor_2rate,
        motor3Rate: e.motor_3rate,
        boatNumberId: e.boat_number_id,
        boat2Rate: e.boat_2rate,
        boat3Rate: e.boat_3rate,
      }));
      if (!same(camel, legacyRacers)) mismatches.push(`${file}: 選手`);
      const meta = {
        raceGrade: page.meta.raceGrade,
        raceTitle: page.meta.raceTitle,
        raceStage: page.meta.raceStage,
        seriesDay: page.meta.seriesDay,
        isFinalDay: page.meta.isFinalDay,
      };
      if (!same(meta, legacyMeta)) mismatches.push(`${file}: メタ`);
      // 旧実装の update-race-info.js の行の組み立て（凍結）と、旧形式の行が同じ
      const legacyRows = legacyRacers.map((racer) => ({
        race_id: "R",
        boat_number: racer.boatNumber,
        racer_id: racer.racerId,
        player_name: racer.playerName,
        grade: racer.grade,
        age: racer.age,
        win_rate: racer.winRate,
        local_win_rate: racer.localWinRate,
        global_2rate: racer.global2Rate,
        local_2rate: racer.local2Rate,
        global_3rate: racer.global3Rate,
        local_3rate: racer.local3Rate,
        motor_number: racer.motorNumber,
        motor_2rate: racer.motor2Rate,
        motor_3rate: racer.motor3Rate,
        boat_number_id: racer.boatNumberId,
        boat_2rate: racer.boat2Rate,
        boat_3rate: racer.boat3Rate,
      }));
      if (!same(realRows.buildRaceEntryRows("R", page.entries), legacyRows)) {
        mismatches.push(`${file}: race_entries の行`);
      }
      const legacyCondition = {
        race_id: "R",
        series_day: legacyMeta.seriesDay,
        is_final_day: legacyMeta.isFinalDay,
        race_title: legacyMeta.raceTitle,
        race_stage: legacyMeta.raceStage,
      };
      if (
        !same(realRows.buildRaceConditionRow("R", page.meta), legacyCondition)
      ) {
        mismatches.push(`${file}: race_conditions の行`);
      }
    }
    check(
      `出走表の旧解析との互換: 旧実装（凍結）と、選手・メタ・race_entries/race_conditions の行が同じ（${listFiles.length}件）`,
      mismatches.length === 0,
      mismatches.join(" / "),
    );
  }
}

function scene2() {
  {
    const mismatches = [];
    const files = [
      ...listFixtures("beforeinfo").map((f) => ["beforeinfo", f]),
      ...listFixtures("weather", (f) => f.startsWith("beforeinfo-")).map((f) => [
        "weather",
        f,
      ]),
    ];
    const NEW_KEYS = [
      "exhibitionCourse",
      "startFlag",
      "prevFinishMark",
      "isAbsent",
    ];
    for (const [dir, file] of files) {
      const html = readFixture(dir, file);
      const legacy = legacyScrapeExhibitionData(cheerio.load(html));
      const now = scrapeExhibitionData(cheerio.load(html));
      const stripped = {
        ...now,
        data: now.data
          ? now.data.map((e) =>
              Object.fromEntries(
                Object.entries(e).filter(([k]) => !NEW_KEYS.includes(k)),
              ),
            )
          : now.data,
      };
      if (!same(stripped, legacy)) mismatches.push(`${dir}/${file}`);
      // 旧実装の scrape-exhibition-data.js の行の組み立て（凍結）と、旧形式の行が同じ
      if (legacy.data) {
        const legacyRows = [];
        for (const ex of legacy.data) {
          if (ex.exhibitionTime != null || ex.startTiming != null) {
            legacyRows.push({
              race_id: "R",
              boat_number: ex.boatNumber,
              exhibition_time: ex.exhibitionTime,
              start_timing: ex.startTiming,
              tilt: ex.tilt,
              propeller_change: ex.propellerChange,
              parts_changed: ex.partsChanged,
              adjustment_weight: ex.adjustmentWeight,
              today_weight: ex.todayWeight,
              prev_race_no: ex.prevRaceNo,
              prev_entry_course: ex.prevEntryCourse,
              prev_start_timing: ex.prevStartTiming,
              prev_finish_rank: ex.prevFinishRank,
            });
          }
        }
        const page = realBeforeParser.parseBeforeInfoPage(html);
        if (!same(realRows.buildExhibitionRows("R", page.boats), legacyRows)) {
          mismatches.push(`${dir}/${file}: exhibition_data の行`);
        }
      }
    }
    check(
      `直前情報の旧解析との互換: 旧実装（凍結）と、展示データ・理由・exhibition_data の行が同じ（${files.length}件。気象だけの6ページを含む）`,
      mismatches.length === 0,
      mismatches.join(" / "),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・readFixture・listFixtures） */
export function runPreRaceParsersScenes2(env) {
  ({ check, same, readFixture, listFixtures } = env);
  scene1();
  scene2();
}
