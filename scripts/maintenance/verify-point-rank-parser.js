#!/usr/bin/env node
/**
 * verify-point-rank-parser.js - FR-3（今節得点率、BOA-220/BOA-291）の
 * パーサー（scripts/lib/pointRankParser.js）と、取得ジョブの判定ロジック
 * （scripts/daily/scrape-point-rank.js）の回帰テスト。DBには接続しない。
 *
 * 実際にboatrace.jpから取得したpointrankページ（2026-09-19取得）をフィクスチャに使う。
 * - g1-day4-with-table.html: 徳山G1 hd=20260912（4日目。52名、賞典除外2・途中帰郷4を含む）
 * - g3-no-data.html: 宮島G3 hd=20260919（「データはありません」）
 * - g1-early-day-not-published.html: 徳山G1 hd=20260911（3日目。表もメッセージも無く、
 *   <title>も「得点率一覧」でない。SG/G1でも序盤は表が出ないことの実例）
 *
 * 2026-09-16〜18の3回、ジョブは success だが racer_series_points が0件だった。
 * 原因の1つ（対象日が翌日にずれる）を resolveTargetDate で再現し、
 * 0件を成功扱いにしない判定（judgeVenue）が期待通り動くことを検証する。
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import { parsePointRankTable } from "../lib/pointRankParser.js";
import { _internal } from "../daily/scrape-point-rank.js";

const FIXTURE_DIR = new URL("../lib/__fixtures__/pointRank/", import.meta.url);

function parseFixture(name) {
  const html = fs.readFileSync(new URL(`${name}.html`, FIXTURE_DIR), "utf8");
  return parsePointRankTable(cheerio.load(html));
}

let failures = 0;
function check(label, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    failures++;
    console.error(
      `❌ ${label}\n  expected: ${expectedJson}\n  actual:   ${actualJson}`,
    );
  } else {
    console.log(`✅ ${label}`);
  }
}

// --- パーサー ---
const day4 = parseFixture("g1-day4-with-table");
check("G1 4日目: 52名", day4?.length, 52);
check(
  "G1 4日目: racerIdが重複しない（upsertのキー衝突を防ぐ）",
  new Set(day4.map((r) => r.racerId)).size,
  52,
);
check("G1 4日目: 1位の行", day4[0], {
  rank: 1,
  racerId: 3897,
  playerName: "白井　　英治",
  grade: "A1",
  scoreRate: 8.33,
  placements: "１　１２３１４",
  totalPoints: 50,
  penaltyPoints: 0,
  remarks: null,
});
check(
  "G1 4日目: 賞典除外は順位・得点率がnull、減点99を生値のまま保持",
  day4.find((r) => r.racerId === 5112),
  {
    rank: null,
    racerId: 5112,
    playerName: "砂長　　知輝",
    grade: "A1",
    scoreRate: null,
    placements: "妨３２　２　１５",
    totalPoints: 34,
    penaltyPoints: 99,
    remarks: "賞典除外",
  },
);
check(
  "G1 4日目: 途中帰郷は4名",
  day4.filter((r) => r.remarks === "途中帰郷").length,
  4,
);
check("G3「データはありません」: null", parseFixture("g3-no-data"), null);
check(
  "G1序盤（表なしページ）: null",
  parseFixture("g1-early-day-not-published"),
  null,
);
check(
  "表はあるが行が無いHTML: 空配列（nullと区別する）",
  parsePointRankTable(cheerio.load("<table><tr><th>得点率</th></tr></table>")),
  [],
);

// --- 対象日の解決（GitHub Actionsのschedule遅延の再現） ---
const { resolveTargetDate, isTableExpected, judgeVenue, buildVenueGrades } =
  _internal;
check(
  "対象日: 22:00 JST定刻起動は当日",
  resolveTargetDate(new Date("2026-09-18T13:00:00Z")),
  "2026-09-18",
);
check(
  "対象日: 実際の遅延起動(2026-09-17 17:23Z=9/18 02:23 JST)は9/17分",
  resolveTargetDate(new Date("2026-09-17T17:23:23Z")),
  "2026-09-17",
);
check(
  "対象日: 実際の遅延起動(2026-09-18 16:51Z=9/19 01:51 JST)は9/18分",
  resolveTargetDate(new Date("2026-09-18T16:51:37Z")),
  "2026-09-18",
);
check(
  "対象日: 05:59 JSTは前日、06:00 JSTは当日",
  [
    resolveTargetDate(new Date("2026-09-18T20:59:59Z")),
    resolveTargetDate(new Date("2026-09-18T21:00:00Z")),
  ],
  ["2026-09-18", "2026-09-19"],
);

// --- 表の存在期待 ---
check("期待: G1の4日目は表あり期待", isTableExpected("G1", 4), true);
check("期待: SGの6日目は表あり期待", isTableExpected("SG", 6), true);
check("期待: G1の3日目は期待しない", isTableExpected("G1", 3), false);
check("期待: 一般戦は期待しない", isTableExpected("ippan", 5), false);
check("期待: G3は期待しない", isTableExpected("G3", 4), false);
check("期待: series_day不明は判定しない", isTableExpected("G1", null), false);

// --- 会場ごとの判定（0件を成功扱いにしない） ---
const table = { kind: "table", rows: day4 };
check(
  "判定: 表あり→書き込み",
  judgeVenue({ raceGrade: "G1", seriesDay: 4, fetched: table }),
  { write: true, failure: null, note: null },
);
check(
  "判定: G1の4日目に表なし→失敗",
  judgeVenue({ raceGrade: "G1", seriesDay: 4, fetched: { kind: "none" } })
    .failure !== null,
  true,
);
check(
  "判定: G1の3日目に表なし→成功（序盤の仕様）",
  judgeVenue({ raceGrade: "G1", seriesDay: 3, fetched: { kind: "none" } })
    .failure,
  null,
);
check(
  "判定: 一般戦に表なし→成功",
  judgeVenue({ raceGrade: "ippan", seriesDay: 2, fetched: { kind: "none" } })
    .failure,
  null,
);
check(
  "判定: 取得エラー→失敗",
  judgeVenue({
    raceGrade: "ippan",
    seriesDay: 2,
    fetched: { kind: "error", message: "HTTP 503" },
  }).failure,
  "取得失敗: HTTP 503",
);
check(
  "判定: 表はあるが行なし→失敗",
  judgeVenue({
    raceGrade: "G1",
    seriesDay: 4,
    fetched: { kind: "table", rows: [] },
  }).failure !== null,
  true,
);
check(
  "判定: 表ありでseries_day未取得→失敗（meet_start_dateを算出できない）",
  judgeVenue({ raceGrade: "G1", seriesDay: null, fetched: table }).failure !==
    null,
  true,
);

check(
  "判定: SG/G1でseries_day不明かつ表なし→失敗（正常か判定できない）",
  judgeVenue({ raceGrade: "SG", seriesDay: null, fetched: { kind: "none" } })
    .failure !== null,
  true,
);
check(
  "判定: 一般戦でseries_day不明かつ表なし→成功",
  judgeVenue({
    raceGrade: "ippan",
    seriesDay: null,
    fetched: { kind: "none" },
  }).failure,
  null,
);

// --- 会場グレード: NULL行で非NULLを上書きしない ---
check(
  "会場グレード: 最後の行がNULLでも非NULLを保持",
  [
    ...buildVenueGrades([
      { race_id: "2026-09-19-05-01", race_grade: "G1" },
      { race_id: "2026-09-19-05-02", race_grade: "G1" },
      { race_id: "2026-09-19-05-03", race_grade: null },
      { race_id: "2026-09-19-04-01", race_grade: null },
      { race_id: "2026-09-19-04-02", race_grade: "ippan" },
    ]),
  ],
  [
    [5, "G1"],
    [4, "ippan"],
  ],
);

if (failures > 0) {
  console.error(`\n${failures}件の検証に失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
