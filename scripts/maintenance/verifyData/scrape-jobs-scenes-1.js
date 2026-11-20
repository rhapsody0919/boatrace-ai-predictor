/**
 * verify-scrape-jobs.js の後半の場面（1/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { windowJobNames, slotDefsFor, SOFT_DEADLINE_MARGIN_SEC } from "../../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../../lib/scrapeJobs/dailyJob.js";
import { applyZeroRowGuard, isFinalOutcome, truncateError } from "../../lib/scrapeJobs/outcomes.js";
import { isScrapeSchemaMissingError } from "../../lib/scrapeJobs/schemaErrors.js";

let check, same, show, ORIGINAL_TZ;

function scene1() {
  check(
    "窓型のジョブ名",
    same(windowJobNames().sort(), [
      "boatcast_oriten",
      "exhibition",
      "odds",
      "odds_final",
      "pcexpect",
      "pit_reports",
      "pseudo",
      "race_info",
      "result",
    ]),
  );
  {
    const defs = slotDefsFor(["odds", "result"]);
    check(
      "ensure用の定義: oddsは6窓（-60だけ許容幅30、他は3）、resultは1窓（+10分、許容幅80）",
      defs.length === 7 &&
        defs
          .filter((d) => d.job === "odds")
          .every((d) => d.grace_min === (d.offset_min === -60 ? 30 : 3)) &&
        defs.find((d) => d.job === "result").offset_min === 10 &&
        defs.find((d) => d.job === "result").grace_min === 80,
      show(defs),
    );
    let threw = false;
    try {
      slotDefsFor(["point_rank"]);
    } catch {
      threw = true;
    }
    check("窓型ではないジョブの ensure 定義は例外", threw);
  }
  check(
    `ソフトデッドラインの余白は ${SOFT_DEADLINE_MARGIN_SEC}秒`,
    SOFT_DEADLINE_MARGIN_SEC === 30,
  );
}

function scene2() {
  // ---------------------------------------------------------------------------
  // (c) resolveTargetDate
  // ---------------------------------------------------------------------------
  {
    const jst = (date, hhmm) => new Date(`${date}T${hhmm}:00+09:00`);
    const cases = [
      // [now(JST), 指定時刻, 期待する対象日, 説明]
      [jst("2026-09-18", "22:00"), "22:00", "2026-09-18", "指定時刻ちょうど"],
      [
        jst("2026-09-18", "22:30"),
        "22:00",
        "2026-09-18",
        "指定後の定刻に近い起動",
      ],
      [
        jst("2026-09-19", "01:51"),
        "22:00",
        "2026-09-18",
        "GitHub Actionsのように約4時間遅れて翌日に起動しても対象日は前日",
      ],
      [
        jst("2026-09-18", "21:59"),
        "22:00",
        "2026-09-17",
        "指定時刻の1分前は前日",
      ],
      [
        jst("2026-09-18", "23:41"),
        "20:00",
        "2026-09-18",
        "20:00指定が23:41に起動",
      ],
      [
        jst("2026-09-19", "00:21"),
        "20:00",
        "2026-09-18",
        "20:00指定が翌日00:21に起動（G2の0件）",
      ],
      [
        jst("2026-09-19", "08:04"),
        "06:00",
        "2026-09-19",
        "06:00指定が08:04に起動",
      ],
      [
        jst("2026-09-19", "02:07"),
        "23:10",
        "2026-09-18",
        "23:10指定が翌日02:07に起動",
      ],
      [jst("2026-10-01", "00:30"), "22:00", "2026-09-30", "月をまたぐ"],
    ];
    for (const [now, target, expected, label] of cases) {
      const got = resolveTargetDate(now, target);
      check(
        `resolveTargetDate: ${label}`,
        got === expected,
        `${got} != ${expected}`,
      );
    }
    for (const tz of ["UTC", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      check(
        `resolveTargetDate [TZ=${tz}]: 翌01:51 JST の起動でも前日`,
        resolveTargetDate(jst("2026-09-19", "01:51"), "22:00") === "2026-09-18",
      );
    }
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    let threw = false;
    try {
      resolveTargetDate(new Date(), "9:00");
    } catch {
      threw = true;
    }
    check("指定時刻が HH:MM でなければ例外", threw);
  }
  // ---------------------------------------------------------------------------
  // (d) 0件エラー・outcome
  // ---------------------------------------------------------------------------
  check(
    "期待>0で解析0件の ok は error になる",
    applyZeroRowGuard({ outcome: "ok", rowsExpected: 6, rowsParsed: 0 })
      .outcome === "error",
  );
}

function scene3() {
  check(
    "期待>0で解析>0（書き込み0件＝変更なし）の ok は ok のまま",
    applyZeroRowGuard({
      outcome: "ok",
      rowsExpected: 6,
      rowsParsed: 6,
      rowsWritten: 0,
    }).outcome === "ok",
  );
  check(
    "期待件数を返さない結果は判定しない",
    applyZeroRowGuard({ outcome: "ok", rowsParsed: 0 }).outcome === "ok",
  );
  check(
    "期待0（開催なしの日など）で解析0件は正常",
    applyZeroRowGuard({ outcome: "ok", rowsExpected: 0, rowsParsed: 0 })
      .outcome === "ok",
  );
  check(
    "ok以外（no_values等）はそのまま",
    applyZeroRowGuard({ outcome: "no_values", rowsExpected: 6, rowsParsed: 0 })
      .outcome === "no_values",
  );
  check(
    "完了として扱う outcome は ok・skipped_have_data のみ",
    isFinalOutcome("ok") &&
      isFinalOutcome("skipped_have_data") &&
      !isFinalOutcome("partial") &&
      !isFinalOutcome("no_values") &&
      !isFinalOutcome("error") &&
      !isFinalOutcome("breaker_open"),
  );
  check(
    "last_error は500字で切る",
    truncateError("x".repeat(1000)).length === 500 &&
      truncateError(new Error("boom")) === "boom" &&
      truncateError(null) === null,
  );
  // ---------------------------------------------------------------------------
  // (e) スキーマ未適用エラーの判定
  // ---------------------------------------------------------------------------
  check(
    "PostgREST: テーブルが無い（PGRST205）",
    isScrapeSchemaMissingError({
      code: "PGRST205",
      message:
        "Could not find the table 'public.scrape_job_state' in the schema cache",
    }),
  );
  check(
    "PostgREST: 関数が無い（PGRST202）",
    isScrapeSchemaMissingError({
      code: "PGRST202",
      message:
        "Could not find the function public.claim_scrape_slots(p_job, p_limit) in the schema cache",
    }),
  );
  check(
    "PostgreSQL: relation/function does not exist（42P01・42883）",
    isScrapeSchemaMissingError({
      code: "42P01",
      message: 'relation "public.scrape_slots" does not exist',
    }) &&
      isScrapeSchemaMissingError({
        code: "42883",
        message: "function ensure_scrape_slots(date, jsonb) does not exist",
      }),
  );
  check(
    "無関係なテーブル・関数の不在は、予定表の未適用とみなさない",
    !isScrapeSchemaMissingError({
      code: "PGRST205",
      message: "Could not find the table 'public.races' in the schema cache",
    }) &&
      !isScrapeSchemaMissingError({
        code: "PGRST202",
        message:
          "Could not find the function public.get_today_races() in the schema cache",
      }),
  );
  check(
    "接続エラー・権限エラー・名前の部分一致は、予定表の未適用とみなさない",
    !isScrapeSchemaMissingError({
      code: "57014",
      message: "canceling statement (scrape_slots)",
    }) &&
      !isScrapeSchemaMissingError({
        code: "42P01",
        message: 'relation "my_scrape_slots_backup" does not exist',
      }) &&
      !isScrapeSchemaMissingError(null),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・show・ORIGINAL_TZ） */
export function runScrapeJobsScenes1(env) {
  ({ check, same, show, ORIGINAL_TZ } = env);
  scene1();
  scene2();
  scene3();
}
