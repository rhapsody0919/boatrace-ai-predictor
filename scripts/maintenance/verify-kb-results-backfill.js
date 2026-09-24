#!/usr/bin/env node
/**
 * verify-kb-results-backfill.js - K/Bアーカイブによる race_results 欠損補填CLI（BOA-403）の検証
 *
 * DB・ファイルシステムに接続しない（純関数のみ検証。CLIの引数パースはモジュールをimportして検証）。
 *
 * 検証観点:
 *   1. classifyMissingResult: found / venue_not_in_k / race_not_in_k_venue / venue_pending / no_k_day
 *   2. buildRaceFactsForDay + buildRaceResultRow: 通常レース・同着（着順のファイル出現順維持）・
 *      partial finish（有効着順3艇のみ）・艇番重複（異常）
 *   3. buildRaceResultRow: payout_trifecta/trioの命名逆転（raceResultAudit.js経由）、
 *      wide/popularityの複数件対応
 *   4. CLI: 引数のパース・検証（日付形式）
 */

import {
  classifyMissingResult,
  buildRaceFactsForDay,
  buildRaceResultRow,
  MISSING_STATUS,
} from "../lib/kbResultsBackfillRows.js";
import { _internal as cli } from "./backfill-kb-recent-results.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makeDay(date, venues) {
  return { schema: "kb-day/v1", date, k: { venues } };
}

/** buildRaceResultRow に渡す (fact, race) の組を、1件のレース定義から作る */
function factAndRace(date, venueCode, race) {
  const day = makeDay(date, [
    { venue_code: venueCode, status: "complete", races: [race] },
  ]);
  const raceId = `${date}-${String(venueCode).padStart(2, "0")}-${String(race.race_number).padStart(2, "0")}`;
  const fact = buildRaceFactsForDay(day).get(raceId);
  return { raceId, fact };
}

// ---------------------------------------------------------------------------
// 1. classifyMissingResult
// ---------------------------------------------------------------------------

{
  const race = { race_number: 3, rows: [], payouts: [] };
  const day = makeDay("2025-12-19", [
    { venue_code: 24, status: "complete", races: [race] },
  ]);
  const r = classifyMissingResult(day, 24, 3);
  check(
    "classifyMissingResult: 会場・レース番号が一致すればfound",
    r.status === MISSING_STATUS.FOUND && r.race === race,
  );
}
{
  const day = makeDay("2025-12-19", [
    { venue_code: 24, status: "complete", races: [] },
  ]);
  const r = classifyMissingResult(day, 12, 1);
  check(
    "classifyMissingResult: 会場ブロック自体が無ければvenue_not_in_k",
    r.status === MISSING_STATUS.VENUE_NOT_IN_K,
  );
}
{
  const day = makeDay("2025-12-19", [
    {
      venue_code: 24,
      status: "complete",
      races: [{ race_number: 1 }, { race_number: 2 }],
    },
  ]);
  const r = classifyMissingResult(day, 24, 9);
  check(
    "classifyMissingResult: 会場はあるがレース番号が無ければrace_not_in_k_venue",
    r.status === MISSING_STATUS.RACE_NOT_IN_K_VENUE,
  );
  check(
    "classifyMissingResult: race_not_in_k_venueはその会場の最大レース番号を返す",
    r.maxRaceNumberInVenue === 2,
    String(r.maxRaceNumberInVenue),
  );
}
{
  const day = makeDay("2025-12-19", [
    { venue_code: 24, status: "pending", races: [] },
  ]);
  const r = classifyMissingResult(day, 24, 1);
  check(
    "classifyMissingResult: 会場がpendingならvenue_pending",
    r.status === MISSING_STATUS.VENUE_PENDING,
  );
}
{
  const r = classifyMissingResult(null, 24, 1);
  check(
    "classifyMissingResult: dayが無ければno_k_day",
    r.status === MISSING_STATUS.NO_K_DAY,
  );
  const r2 = classifyMissingResult({ k: null }, 24, 1);
  check(
    "classifyMissingResult: kセクションが無ければno_k_day",
    r2.status === MISSING_STATUS.NO_K_DAY,
  );
}

// ---------------------------------------------------------------------------
// 2-3. buildRaceFactsForDay + buildRaceResultRow
// ---------------------------------------------------------------------------

function makeFullRace() {
  return {
    race_number: 1,
    technique: "逃げ",
    rows: [
      { boat_number: 1, rank: 1, course: 1, finish_raw: "01" },
      { boat_number: 3, rank: 2, course: 2, finish_raw: "02" },
      { boat_number: 6, rank: 3, course: 3, finish_raw: "03" },
      { boat_number: 2, rank: 4, course: 4, finish_raw: "04" },
      { boat_number: 4, rank: 5, course: 6, finish_raw: "05" }, // 前づけ（進入変化）の例
      { boat_number: 5, rank: 6, course: 5, finish_raw: "06" },
    ],
    payouts: [
      { kind: "win", combo: "1", amount: 300, popularity: null, special: null },
      {
        kind: "place",
        combo: "1",
        amount: 130,
        popularity: null,
        special: null,
      },
      {
        kind: "place",
        combo: "3",
        amount: 230,
        popularity: null,
        special: null,
      },
      {
        kind: "exacta",
        combo: "1-3",
        amount: 410,
        popularity: 1,
        special: null,
      },
      {
        kind: "quinella",
        combo: "1-3",
        amount: 270,
        popularity: 1,
        special: null,
      },
      { kind: "wide", combo: "1-3", amount: 210, popularity: 3, special: null },
      { kind: "wide", combo: "1-6", amount: 430, popularity: 7, special: null },
      {
        kind: "wide",
        combo: "3-6",
        amount: 690,
        popularity: 10,
        special: null,
      },
      {
        kind: "trifecta",
        combo: "1-3-6",
        amount: 3030,
        popularity: 9,
        special: null,
      },
      {
        kind: "trio",
        combo: "1-3-6",
        amount: 1530,
        popularity: 5,
        special: null,
      },
    ],
  };
}

{
  const race = makeFullRace();
  const { raceId, fact } = factAndRace("2025-12-19", 24, race);
  check(
    "buildRaceFactsForDay: 着順どおりの艇番配列（finisherBoats）を返す",
    same(fact.finisherBoats, [1, 3, 6, 2, 4, 5]),
    JSON.stringify(fact.finisherBoats),
  );

  const { row, valid } = buildRaceResultRow(raceId, fact, race);
  check("buildRaceResultRow: 6艇通常レースはvalid", valid);
  check(
    "buildRaceResultRow: rank1〜6が着順どおり",
    row.rank1 === 1 &&
      row.rank2 === 3 &&
      row.rank3 === 6 &&
      row.rank4 === 2 &&
      row.rank5 === 4 &&
      row.rank6 === 5,
    JSON.stringify(row),
  );
  check(
    "buildRaceResultRow: payout_trifecta/trioは本体テーブルの命名逆転を再現する（raceResultAudit.js経由。trifecta列=3連複=1530、trio列=3連単=3030）",
    row.payout_trifecta === 1530 && row.payout_trio === 3030,
    `trifecta=${row.payout_trifecta} trio=${row.payout_trio}`,
  );
  check(
    "buildRaceResultRow: popularity_trifecta/trioも同じ逆転（trifecta列=3連複の人気=5、trio列=3連単の人気=9）",
    row.popularity_trifecta === 5 && row.popularity_trio === 9,
  );
  check(
    "buildRaceResultRow: payout_place_1/2は複勝の1着目・2着目の順",
    row.payout_place_1 === 130 && row.payout_place_2 === 230,
  );
  check(
    "buildRaceResultRow: payout_wide_1〜3はファイル出現順",
    row.payout_wide_1 === 210 &&
      row.payout_wide_2 === 430 &&
      row.payout_wide_3 === 690,
  );
  check(
    "buildRaceResultRow: actual_course_Nは艇番Nの進入コース（前づけを含む）",
    row.actual_course_4 === 6 &&
      row.actual_course_5 === 5 &&
      row.actual_course_1 === 1,
    JSON.stringify([
      row.actual_course_1,
      row.actual_course_4,
      row.actual_course_5,
    ]),
  );
  check(
    "buildRaceResultRow: is_cancelled/is_no_raceは常にfalse",
    row.is_cancelled === false && row.is_no_race === false,
  );
  check(
    "buildRaceResultRow: course_1〜6・result_at・race_time_1〜6は意図的に含めない（既知の癖・偽装しない列）",
    !("course_1" in row) && !("result_at" in row) && !("race_time_1" in row),
  );
  check(
    "buildRaceResultRow: winning_techniqueをそのまま渡す",
    row.winning_technique === "逃げ",
  );
}
{
  // 同着（Kファイルはラベルを繰り返し次のラベルを1つ飛ばす。raceResultAudit.jsのfinisherBoatsは
  // ファイル出現順=着順のためrank値で再ソートしない）
  const race = {
    race_number: 2,
    technique: null,
    rows: [
      { boat_number: 2, rank: 1, course: 2, finish_raw: "01" },
      { boat_number: 5, rank: 1, course: 5, finish_raw: "01" },
      { boat_number: 1, rank: 3, course: 1, finish_raw: "03" },
      { boat_number: 3, rank: null, course: null, finish_raw: "F" },
      { boat_number: 4, rank: null, course: null, finish_raw: "L" },
      { boat_number: 6, rank: 4, course: 6, finish_raw: "04" },
    ],
    payouts: [],
  };
  const { raceId, fact } = factAndRace("2025-12-19", 24, race);
  const { row, boatsInOrder } = buildRaceResultRow(raceId, fact, race);
  check(
    "buildRaceResultRow: 同着はファイル出現順をそのまま保持する",
    same(boatsInOrder, [2, 5, 1, 6]) &&
      row.rank1 === 2 &&
      row.rank2 === 5 &&
      row.rank3 === 1 &&
      row.rank4 === 6,
    JSON.stringify({ boatsInOrder, row }),
  );
}
{
  // 有効な着順が3艇のみ（NOT NULL制約ぎりぎり）でも組み立てられる
  const race = {
    race_number: 3,
    technique: null,
    rows: [
      { boat_number: 1, rank: 1, course: 1, finish_raw: "01" },
      { boat_number: 2, rank: 2, course: 2, finish_raw: "02" },
      { boat_number: 3, rank: 3, course: 3, finish_raw: "03" },
      { boat_number: 4, rank: null, course: null, finish_raw: "K0" },
      { boat_number: 5, rank: null, course: null, finish_raw: "K0" },
      { boat_number: 6, rank: null, course: null, finish_raw: "K0" },
    ],
    payouts: [],
  };
  const { raceId, fact } = factAndRace("2025-12-19", 24, race);
  const { row, valid, boatsInOrder } = buildRaceResultRow(raceId, fact, race);
  check(
    "buildRaceResultRow: 有効着順3艇はrank1〜3のみ埋めて挿入可能",
    valid &&
      row &&
      row.rank1 === 1 &&
      row.rank2 === 2 &&
      row.rank3 === 3 &&
      row.rank4 === null,
    JSON.stringify({ valid, row, boatsInOrder }),
  );
}
{
  // 有効な着順が2艇のみ（rank1〜3のNOT NULL制約を満たせない）はrow=null
  const race = {
    race_number: 4,
    rows: [
      { boat_number: 1, rank: 1, course: 1, finish_raw: "01" },
      { boat_number: 2, rank: 2, course: 2, finish_raw: "02" },
      { boat_number: 3, rank: null, course: null, finish_raw: "K0" },
      { boat_number: 4, rank: null, course: null, finish_raw: "K0" },
      { boat_number: 5, rank: null, course: null, finish_raw: "K0" },
      { boat_number: 6, rank: null, course: null, finish_raw: "K0" },
    ],
    payouts: [],
  };
  const { raceId, fact } = factAndRace("2025-12-19", 24, race);
  const { row, valid } = buildRaceResultRow(raceId, fact, race);
  check(
    "buildRaceResultRow: 有効着順2艇以下はrow=null（NOT NULL制約を満たせないため呼び出し側が除外する）",
    row === null && valid === true,
  );
}
{
  // fact が無い（該当レースが日に存在しない）場合もrow=null
  const { row, valid, boatsInOrder } = buildRaceResultRow("x", undefined, {});
  check(
    "buildRaceResultRow: factが無ければrow=null",
    row === null && valid === false && same(boatsInOrder, []),
  );
}

// ---------------------------------------------------------------------------
// 4. CLI引数
// ---------------------------------------------------------------------------

{
  const opts = cli.parseArgs(["plan", "--from=2025-12-03", "--to=2026-03-31"]);
  check(
    "parseArgs: from/toを受け取る",
    opts.from === "2025-12-03" &&
      opts.to === "2026-03-31" &&
      opts.command === "plan",
  );
  const validated = cli.validateOptions({ ...opts });
  check("validateOptions: 正常な日付は例外を投げない", !!validated);
}
{
  let threw = false;
  try {
    cli.validateOptions({ from: "2026-01-01", to: "2025-01-01" });
  } catch {
    threw = true;
  }
  check("validateOptions: fromがtoより後なら例外", threw);
}
{
  let threw = false;
  try {
    cli.validateOptions({ from: "not-a-date", to: "2026-01-01" });
  } catch {
    threw = true;
  }
  check("validateOptions: 日付形式が不正なら例外", threw);
}
{
  const opts = cli.parseArgs(["load", "--apply"]);
  check(
    "parseArgs: --applyフラグ",
    opts.apply === true && opts.command === "load",
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "✅ 全て成功" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
