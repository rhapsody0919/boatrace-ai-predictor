/**
 * verify-race-result-parser.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realParser from "../../lib/raceResultParser.js";
import * as realRows from "../../lib/raceResultRows.js";
import { payoutRowSatisfiesDdl } from "./race-result-parser-cases.js";
import { NEW_TIMING_COLUMNS, NEW_RESULT_COLUMNS, PAYOUT_COLUMNS } from "./race-result-parser-scenes-2.js";
import { CASES } from "./race-result-parser-scenes-1.js";

let check, show, same, full, sql;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const stripComments = (s) => s.replace(/--[^\n]*/g, "");
  const addedColumns = (s) =>
    [...stripComments(s).matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map(
      (m) => m[1],
    );
  const inList = (s, name) => {
    const m = new RegExp(`${name}\\s+IN\\s*\\(([^)]*)\\)`, "i").exec(
      stripComments(s),
    );
    return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).sort() : null;
  };
  const s077 = sql("077_race_start_timings_boat_result.sql");
  const s078 = sql("078_race_results_status_refund.sql");
  const s079 = sql("079_race_payouts.sql");
  check(
    "DDL 077: 追加する列が、コードが書く艇別の新しい列（finish_mark・finish_rank・entry_course・race_seconds）と一致",
    same(addedColumns(s077).sort(), [...NEW_TIMING_COLUMNS].sort()),
  );
  check(
    "DDL 078: 追加する列が、コードが書く race_results の新しい列と一致",
    same(addedColumns(s078).sort(), [...NEW_RESULT_COLUMNS].sort()),
  );
  const createBody =
    /CREATE TABLE IF NOT EXISTS race_payouts \(([\s\S]*?)\n\);/.exec(
      stripComments(s079),
    )[1];
  const ddlPayoutColumns = createBody
    .split("\n")
    .map((l) =>
      /^\s{2}(\w+)\s+(varchar|text|smallint|integer|timestamptz)/.exec(l),
    )
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
  check(
    "DDL 079: race_payouts の列が、コードが書く払戻明細の行のキーと一致",
    same(ddlPayoutColumns, [...PAYOUT_COLUMNS].sort()),
  );
  check(
    "DDL 079: bet_type のCHECKの値が、パーサーの勝式（BET_TYPE_BY_LABEL）と一致",
    same(
      inList(s079, "bet_type"),
      Object.values(realParser.BET_TYPE_BY_LABEL).sort(),
    ),
  );
  const producedStatuses = new Set(
    CASES.flatMap((c) =>
      realRows
        .buildPayoutRows("R", realRows.toLegacyResult(full(c.file)))
        .map((r) => r.payout_status),
    ),
  );
  const ddlStatuses = inList(s079, "payout_status");
  check(
    "DDL 079: payout_status のCHECKの値が、フィクスチャから作れる4状態（paid・special・no_amount・no_race）と一致",
    same(ddlStatuses, ["no_amount", "no_race", "paid", "special"]) &&
      [...producedStatuses].every((s) => ddlStatuses.includes(s)) &&
      producedStatuses.size === 4,
    show([...producedStatuses]),
  );
  check(
    "DDL 078: race_status のCHECKの値が、classifyRaceStatus の出力（normal・partial_refund・no_race）と一致",
    same(inList(s078, "race_status"), [
      "no_race",
      "normal",
      "partial_refund",
    ]) &&
      same([...new Set(CASES.map((c) => full(c.file).race_status))].sort(), [
        "no_race",
        "normal",
        "partial_refund",
      ]),
  );
  return { stripComments, s077, s078, s079 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ stripComments, s077, s078, s079 }) {
  check(
    "DDL 079: 新規テーブルはRLS有効・anon/authenticated の権限を剥奪・書き込みポリシーなし（ポリシー自体を作らない）",
    /ENABLE ROW LEVEL SECURITY/.test(s079) &&
      /REVOKE ALL ON race_payouts FROM anon, authenticated/.test(s079) &&
      !/CREATE POLICY/i.test(stripComments(s079)),
  );
  check(
    "DDL 077〜079: 列の追加は NULL可・DEFAULTなし（メタデータのみの変更。race_results の追加で trg_update_predictions が発火しない）",
    ![s077, s078].some((s) => /ADD COLUMN[^;]*DEFAULT/i.test(stripComments(s))),
  );
  const apply079Negative = {
    bet_type: "win",
    seq: 1,
    combination: "1",
    payout: null,
    payout_status: "paid",
  };
  check(
    "DDL 079のCHECKの意味（ミラー）: paid で払戻NULLは違反、no_race で組番ありは違反",
    !payoutRowSatisfiesDdl(apply079Negative) &&
      !payoutRowSatisfiesDdl({
        bet_type: "win",
        seq: 1,
        combination: "1",
        payout: null,
        payout_status: "no_race",
      }),
  );
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・full・sql） */
export function runRaceResultParserScenes7(env) {
  ({ check, show, same, full, sql } = env);
  scene3();
}
