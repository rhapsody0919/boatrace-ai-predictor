/**
 * verify-scrape-pre-race-job.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-pre-race-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces as realExhibitionRun } from "../../daily/scrape-exhibition-data.js";
import { computeExhibitionDigest } from "../../lib/scrapeJobs/preRaceDigest.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { runExhibition, writeCount, upsertsOf, RACE, createFetcher, BEFORE_UNPUBLISHED_HTML, BEFORE_ST_ONLY_HTML } from "./scrape-pre-race-job-scenes-b-1.js";

let check, show, NOW, freshDb, pagesHandler;

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
async function sprjb2Scene1() {
  const db = freshDb();
  const first = await runExhibition(realExhibitionRun, db, { mode: "live" });
  const r = first.result;
  const rows = upsertsOf(db, "exhibition_data").flatMap((u) => u.rows);
  const conditions = upsertsOf(db, "race_conditions").flatMap((u) => u.rows);
  check(
    "A2 live: beforeinfo を1回だけ取得し、展示データ（欠場艇を含む6行）と気象（race_conditions）を書く。outcome=ok・changed",
    r.outcome === "ok" &&
      r.changed === true &&
      r.rowsWritten === 6 &&
      first.fetcher.calls.length === 1 &&
      first.fetcher.calls[0].includes("/beforeinfo?") &&
      rows.length === 6 &&
      conditions.length === 1 &&
      "weather" in conditions[0],
    show({ r, calls: first.fetcher.calls, rows: rows.length }),
  );
  const order = db.state.upserts.map((u) => u.table);
  check(
    "A2 live: 気象（race_conditions）を展示データより先に書く（展示タイムを見て動く展示後の段が、同じ取得回の気象を読む。BOA-271 T4-3）",
    order.indexOf("race_conditions") >= 0 &&
      order.indexOf("race_conditions") < order.indexOf("exhibition_data"),
    show(order),
  );
  const second = await runExhibition(realExhibitionRun, db, { mode: "live" });
  check(
    "A2 live: 展示タイムが取得済みのレースは、取得しない（skipped_have_data。取得0回・書き込み0件）",
    second.result.outcome === "skipped_have_data" &&
      second.fetcher.calls.length === 0 &&
      second.result.changed === false,
    show(second.result),
  );
  // Kファイルから展示タイムだけを入れた行（展示ST は NULL）は「取得済み」にしない（BOA-271 の前提の補完）。
  // 直前情報で展示ST・チルト・体重を後から補えるようにする
  const kOnlyDb = freshDb();
  kOnlyDb.state.tables.exhibition_data = [1, 2, 3, 4, 5, 6].map((boat) => ({
    race_id: RACE,
    boat_number: boat,
    exhibition_time: 6.7,
    start_timing: null,
  }));
  const kOnly = await runExhibition(realExhibitionRun, kOnlyDb, {
    mode: "live",
  });
  check(
    "A2 live: 展示タイムだけの行（Kファイルからの補完。展示ST なし）は取得済みにせず、直前情報を取得して書く",
    kOnly.result.outcome === "ok" &&
      kOnly.fetcher.calls.length === 1 &&
      upsertsOf(kOnlyDb, "exhibition_data")
        .flatMap((u) => u.rows)
        .some((row) => row.start_timing !== null),
    show(kOnly.result),
  );
  const shadowDb = freshDb();
  const shadow = await runExhibition(realExhibitionRun, shadowDb, {
    mode: "shadow",
  });
  check(
    "A2 shadow: 取得・解析のみで、DBへ一切書かない（気象も）。resultDigest を返し、rowsWritten=0・changed=false",
    (await exhibitionShadowWritesNothing(realExhibitionRun)) &&
      shadow.result.rowsParsed === 6,
    show(shadow.result),
  );
  const dbDigest = computeExhibitionDigest(
    db.state.tables.exhibition_data.filter((row) => row.race_id === RACE),
  );
  return { db, first, shadow, dbDigest };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function sprjb2Scene2({ db, first, shadow, dbDigest }) {
  check(
    "A2 ダイジェスト: shadow が記録するダイジェストは、live が書いた DB の行から同じ関数で計算したダイジェストと一致する",
    shadow.result.resultDigest === dbDigest &&
      first.result.resultDigest === dbDigest,
    `${shadow.result.resultDigest} / ${dbDigest}`,
  );
  // shadow は、既存の経路が書いた行があっても、取得・解析する（比べるため）
  const shadowWithData = await runExhibition(realExhibitionRun, db, {
    mode: "shadow",
  });
  check(
    "A2 shadow: 展示タイムが取得済みでも、取得・解析する（既存の経路が書いた行と比べるため。skipped_have_data にしない）",
    shadowWithData.result.outcome === "ok" &&
      shadowWithData.fetcher.calls.length === 1 &&
      shadowWithData.result.resultDigest === dbDigest,
    show(shadowWithData.result),
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function sprjb2Scene3() {
  // 展示が未公開・展示STのみ・エラー
  const dbUn = freshDb();
  const un = await runExhibition(
    realExhibitionRun,
    dbUn,
    { mode: "live" },
    createFetcher(pagesHandler({ before: BEFORE_UNPUBLISHED_HTML })),
  );
  const unRows = upsertsOf(dbUn, "exhibition_data").flatMap((u) => u.rows);
  check(
    // BOA-500: 展示航走前でも、当日体重・調整重量は公開されている。捨てずに書き、展示タイムが入るまで再試行する
    "A2 展示航走前（当日体重・調整重量だけ公開）: その行を書き、outcome=partial（再試行。展示タイムが入るまで完了にしない）",
    un.result.outcome === "partial" &&
      unRows.length === 6 &&
      unRows.every(
        (row) =>
          row.today_weight != null &&
          row.adjustment_weight != null &&
          row.exhibition_time === null &&
          row.start_timing === null,
      ),
    show({ outcome: un.result.outcome, rows: unRows.length, row0: unRows[0] }),
  );
  const dbNone = freshDb();
  const none = await runExhibition(
    realExhibitionRun,
    dbNone,
    { mode: "live" },
    createFetcher(pagesHandler({ before: "<html></html>" })),
  );
  check(
    "A2 直前情報の表が無い（中止・未公開）: outcome=no_values（再試行）。1行も書かない",
    none.result.outcome === "no_values" &&
      upsertsOf(dbNone, "exhibition_data").length === 0,
    show(none.result),
  );
  const dbSt = freshDb();
  const st = await runExhibition(
    realExhibitionRun,
    dbSt,
    { mode: "live" },
    createFetcher(pagesHandler({ before: BEFORE_ST_ONLY_HTML })),
  );
  const stRows = upsertsOf(dbSt, "exhibition_data").flatMap((u) => u.rows);
  check(
    "A2 展示STのみ公開（展示タイム未公開）: 書けた行は残し、outcome=partial（再試行。展示タイムが入るまで完了にしない）",
    st.result.outcome === "partial" &&
      stRows.length > 0 &&
      stRows.every((row) => row.exhibition_time === null) &&
      stRows.some((row) => row.start_timing !== null),
    show({ r: st.result, rows: stRows.length }),
  );
  const http = await runExhibition(
    realExhibitionRun,
    freshDb(),
    { mode: "live" },
    createFetcher(() => 503),
  );
  check(
    "A2 HTTP 503: outcome=error（再試行）",
    http.result.outcome === "error" && /HTTP 503/.test(http.result.error),
    show(http.result),
  );
  const until = NOW.getTime() + 60000;
  const brk = await runExhibition(
    realExhibitionRun,
    freshDb(),
    { mode: "live" },
    createFetcher(() => new BreakerOpenError("host:boatrace.jp", until)),
  );
  return { until, brk };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function sprjb2Scene4({ until, brk }) {
  check(
    "A2 ブレーカーが開いている: outcome=breaker_open（retryAt つき）",
    brk.result.outcome === "breaker_open" &&
      brk.result.retryAt.getTime() === until,
    show(brk.result),
  );
  const fail = await runExhibition(
    realExhibitionRun,
    freshDb({ failUpsert: { exhibition_data: true } }),
    { mode: "live" },
  );
  check(
    "A2 書き込みの失敗: outcome=error（完了にしない）",
    fail.result.outcome === "error" &&
      /exhibition_data/.test(fail.result.error),
    show(fail.result),
  );
  const checkFail = await runExhibition(
    realExhibitionRun,
    freshDb({
      failSelect: { exhibition_data: { message: "boom", code: "XX000" } },
    }),
    { mode: "live" },
  ).then(
    () => "",
    (error) => error.message,
  );
  check(
    "A2 取得済みの確認に失敗: 例外（メッセージ付き。「未取得」に化けさせて二重に取得しない）",
    /取得済みの確認に失敗/.test(checkFail),
    checkFail,
  );
}

async function sprjb2Scene5() {
  {
    const s1 = await sprjb2Scene1();
    await sprjb2Scene2(s1);
  }
  {
    const s1 = await sprjb2Scene3();
    await sprjb2Scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・NOW・freshDb・pagesHandler） */
export async function runScrapePreRaceJobScenesB6(env) {
  ({ check, show, NOW, freshDb, pagesHandler } = env);
  await sprjb2Scene5();
}
