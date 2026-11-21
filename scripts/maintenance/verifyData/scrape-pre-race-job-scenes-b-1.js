/**
 * verify-scrape-pre-race-job.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realRaceInfoRun } from "../../daily/update-race-info.js";
import { computeRaceInfoDigest } from "../../lib/scrapeJobs/preRaceDigest.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { CONFIRM_STREAK_THRESHOLD } from "../../lib/cancellationStatus.js";

let check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, freshDb, createFetcher, pagesHandler, raceOf, upsertsOf, writeCount, runRaceInfo;

/** shadow が書かないことの検証（変異検証で使うため関数にする） */
export async function raceInfoShadowWritesNothing(run) {
  const db = freshDb();
  const { result } = await runRaceInfo(run, db, { mode: "shadow" });
  return (
    result.outcome === "ok" &&
    typeof result.resultDigest === "string" &&
    result.rowsWritten === 0 &&
    result.changed === false &&
    writeCount(db) === 0
  );
}

/** 出走表だけを取り、直前情報を取らないことの検証 */
export async function raceInfoFetchesOnlyRacelist(run) {
  const db = freshDb();
  const { fetcher } = await runRaceInfo(run, db, { mode: "live" });
  return (
    fetcher.calls.length === 1 &&
    fetcher.calls[0].includes("/racelist?") &&
    !fetcher.calls.some((u) => u.includes("/beforeinfo?"))
  );
}

// ---------------------------------------------------------------------------
// (b) 展示 runForRaces
// ---------------------------------------------------------------------------
export async function runExhibition(run, db, options = {}, fetcher = null) {
  const f = fetcher ?? createFetcher(pagesHandler());
  const results = await run([raceOf(RACE)], {
    date: DATE,
    fetchFn: f,
    client: db,
    ...options,
  });
  return { results, result: results[0], fetcher: f };
}

export async function exhibitionShadowWritesNothing(run) {
  const db = freshDb();
  const { result } = await runExhibition(run, db, { mode: "shadow" });
  return (
    result.outcome === "ok" &&
    typeof result.resultDigest === "string" &&
    result.rowsWritten === 0 &&
    result.changed === false &&
    writeCount(db) === 0
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function sprjb1Scene1() {
  const db = freshDb();
  const first = await runRaceInfo(realRaceInfoRun, db, { mode: "live" });
  const r = first.result;
  const entries = upsertsOf(db, "race_entries").flatMap((u) => u.rows);
  const conditions = upsertsOf(db, "race_conditions").flatMap((u) => u.rows);
  check(
    "A1 live: 出走表を取得・解析し、race_entries（6艇）・race_conditions を書く（outcome=ok・changed）",
    r.outcome === "ok" &&
      r.rowsParsed === 6 &&
      r.rowsWritten > 0 &&
      r.changed === true &&
      entries.length === 6 &&
      conditions.length === 1 &&
      conditions[0].race_id === RACE,
    show({ r, entries: entries.length, conditions: conditions.length }),
  );
  check(
    "A1 live: race_conditions に気象の列を含めない（気象は展示側。既存の気象を null で上書きしない）",
    conditions.length === 1 &&
      !("weather" in conditions[0]) &&
      !("wind_speed" in conditions[0]) &&
      !("weather_observed_at" in conditions[0]),
    show(conditions[0]),
  );
  check(
    "A1 live（D2の解消）: 出走表（racelist）だけを1回取得し、直前情報（beforeinfo）は取得しない",
    await raceInfoFetchesOnlyRacelist(realRaceInfoRun),
    show(first.fetcher.calls),
  );
  const startTimeUpdates = db.state.updates.filter(
    (u) => "start_time" in u.values,
  );
  check(
    "A1 live: 締切予定時刻が朝の値と違うレース（8R: 12:04→12:05）だけ races.start_time を更新する（日中の追従）",
    startTimeUpdates.length === 1 &&
      startTimeUpdates[0].value === `${DATE}-23-08` &&
      startTimeUpdates[0].values.start_time === "12:05:00",
    show(startTimeUpdates),
  );
  const writesBefore = writeCount(db);
  const second = await runRaceInfo(realRaceInfoRun, db, { mode: "live" });
  check(
    "A1 live: 同じ内容をもう一度処理しても、書き込み0件（変更の無い行は書かない。outcome=ok・changed=false）",
    second.result.outcome === "ok" &&
      second.result.rowsWritten === 0 &&
      second.result.changed === false &&
      writeCount(db) === writesBefore,
    show(second.result),
  );
  // shadow: 一切書かない。live が書いた行から計算したダイジェストと一致する
  const shadowDb = freshDb();
  const shadow = await runRaceInfo(realRaceInfoRun, shadowDb, {
    mode: "shadow",
  });
  return { db, first, shadow };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function sprjb1Scene2({ db, first, shadow }) {
  check(
    "A1 shadow: 取得・解析のみで、DBへ一切書かない（upsert・update とも0件）。resultDigest を返し、rowsWritten=0・changed=false",
    (await raceInfoShadowWritesNothing(realRaceInfoRun)) &&
      shadow.result.rowsParsed === 6,
    show(shadow.result),
  );
  const dbDigest = computeRaceInfoDigest({
    entries: db.state.tables.race_entries.filter((e) => e.race_id === RACE),
    condition: db.state.tables.race_conditions.find((c) => c.race_id === RACE),
    raceGrade: db.state.tables.races.find((c) => c.race_id === RACE).race_grade,
  });
  check(
    "A1 ダイジェスト: shadow が記録するダイジェストは、live が書いた DB の行から同じ関数で計算したダイジェストと一致する（比較の前提）",
    shadow.result.resultDigest === dbDigest &&
      first.result.resultDigest === dbDigest,
    `${shadow.result.resultDigest} / ${first.result.resultDigest} / ${dbDigest}`,
  );
  // includeWeather=true は、従来の run と同じく beforeinfo も取り、気象を書く
  const weatherDb = freshDb();
  const weather = await runRaceInfo(realRaceInfoRun, weatherDb, {
    mode: "live",
    includeWeather: true,
  });
  const weatherRows = upsertsOf(weatherDb, "race_conditions").flatMap(
    (u) => u.rows,
  );
  check(
    "A1 includeWeather=true: beforeinfo も取得し、気象の列を race_conditions に含める（従来の run と同じ動作の選択肢）",
    weather.fetcher.calls.some((u) => u.includes("/beforeinfo?")) &&
      weatherRows.some((row) => "weather" in row),
    show(weather.fetcher.calls),
  );
}

async function sprjb1Scene3() {
  {
    const s1 = await sprjb1Scene1();
    await sprjb1Scene2(s1);
  }
  // 選手0人（中止・未公開の可能性）: no_values。中止・順延の暫定検知の連続回数を進める（3回で暫定）
  {
    const emptyHandler = pagesHandler({ list: "<html><body></body></html>" });
    const db = freshDb();
    const outcomes = [];
    for (let i = 0; i < CONFIRM_STREAK_THRESHOLD; i++) {
      const { result } = await runRaceInfo(
        realRaceInfoRun,
        db,
        { mode: "live" },
        createFetcher(emptyHandler),
      );
      outcomes.push(result.outcome);
    }
    const race = db.state.tables.races.find((r) => r.race_id === RACE);
    check(
      "A1 選手0人: outcome=no_values（再試行）。書き込みは無く、中止・順延の暫定検知の連続回数が進み、3回で tentative になる",
      outcomes.every((o) => o === "no_values") &&
        race.cancellation_check_streak === CONFIRM_STREAK_THRESHOLD &&
        race.cancellation_status === "tentative" &&
        upsertsOf(db, "race_entries").length === 0,
      show({ outcomes, race }),
    );
    const shadowDb = freshDb();
    await runRaceInfo(
      realRaceInfoRun,
      shadowDb,
      { mode: "shadow" },
      createFetcher(emptyHandler),
    );
    check(
      "A1 選手0人（shadow）: 中止・順延の暫定検知も書かない",
      writeCount(shadowDb) === 0 &&
        shadowDb.state.tables.races.find((r) => r.race_id === RACE)
          .cancellation_check_streak === 0,
    );
  }
}

async function sprjb1Scene4() {
  // 通信・HTTPエラー・ブレーカー・書き込みの失敗
  {
    const db500 = freshDb();
    const http = await runRaceInfo(
      realRaceInfoRun,
      db500,
      { mode: "live" },
      createFetcher(() => 500),
    );
    check(
      "A1 HTTP 500: outcome=error（再試行）。書き込みも、中止・順延の暫定検知の連続回数の更新もしない（取得先の失敗を中止と取り違えない）",
      http.result.outcome === "error" &&
        /HTTP 500/.test(http.result.error) &&
        writeCount(db500) === 0,
      show(http.result),
    );
    const dbNet = freshDb();
    const net = await runRaceInfo(
      realRaceInfoRun,
      dbNet,
      { mode: "live" },
      createFetcher(() => new Error("ECONNRESET")),
    );
    check(
      "A1 通信エラー: outcome=error（例外にせず、原因を残す）",
      net.result.outcome === "error" &&
        /ECONNRESET/.test(net.result.error) &&
        writeCount(dbNet) === 0,
      show(net.result),
    );
    const until = NOW.getTime() + 60000;
    const dbBrk = freshDb();
    const brk = await runRaceInfo(
      realRaceInfoRun,
      dbBrk,
      { mode: "live" },
      createFetcher(() => new BreakerOpenError("host:boatrace.jp", until)),
    );
    check(
      "A1 ブレーカーが開いている: outcome=breaker_open。再試行の時刻（retryAt）を返す。書き込まない",
      brk.result.outcome === "breaker_open" &&
        brk.result.retryAt instanceof Date &&
        brk.result.retryAt.getTime() === until &&
        writeCount(dbBrk) === 0,
      show(brk.result),
    );
    const dbFail = freshDb({ failUpsert: { race_entries: true } });
    const fail = await runRaceInfo(realRaceInfoRun, dbFail, { mode: "live" });
    check(
      "A1 書き込みの失敗: outcome=error（表名つきのメッセージ）。完了にしない",
      fail.result.outcome === "error" && /race_entries/.test(fail.result.error),
      show(fail.result),
    );
    // 1件の失敗で他のレースを止めない
    const dbMix = freshDb();
    const mixFetcher = createFetcher((url) =>
      url.includes("rno=11&") ? 500 : LIST_HTML,
    );
    const mix = await realRaceInfoRun([raceOf(RACE_11), raceOf(RACE)], {
      date: DATE,
      mode: "live",
      fetchFn: mixFetcher,
      client: dbMix,
      concurrency: 2,
    });
    check(
      "A1 複数レース: 1件の失敗（11R: HTTP 500）で他のレース（12R）を止めない。結果は入力と同じ順序",
      mix.length === 2 &&
        mix[0].race_id === RACE_11 &&
        mix[0].outcome === "error" &&
        mix[1].race_id === RACE &&
        mix[1].outcome === "ok",
      show(mix),
    );
    let threw = "";
    try {
      await realRaceInfoRun([raceOf(RACE)], { date: DATE, mode: "dry" });
    } catch (error) {
      threw = error.message;
    }
    check(
      "A1 入力の検査: mode が不正なら、取得せずに例外（メッセージ付き）",
      /mode/.test(threw),
      threw,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・LIST_HTML・DATE・RACE・RACE_11・NOW・freshDb・createFetcher・pagesHandler・raceOf・upsertsOf・writeCount・runRaceInfo） */
export async function runScrapePreRaceJobScenesB1(env) {
  ({ check, show, LIST_HTML, DATE, RACE, RACE_11, NOW, freshDb, createFetcher, pagesHandler, raceOf, upsertsOf, writeCount, runRaceInfo } = env);
  await sprjb1Scene3();
  await sprjb1Scene4();
}
