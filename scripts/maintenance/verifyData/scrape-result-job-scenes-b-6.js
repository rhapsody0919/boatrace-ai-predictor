/**
 * verify-scrape-result-job.js の後半の場面（6/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { clearCancellationsWithResults } from "../../daily/scrape-results.js";
import { createResultCatchupRun } from "../../lib/scrapeJobs/resultHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { catchupDb, catchupCtx } from "./scrape-result-job-scenes-b-5.js";
import { politeFor, slotFor, NOW_TICK } from "./scrape-result-job-scenes-b-2.js";
import { RACE_B, RACE_A, DATE, KNOWN_GAPS } from "./scrape-result-job-scenes-b-1.js";

let printOut, check, show, same, HTML_NONE, HTML_CANCELLED, URL_TO_HTML;

/** 元の verify の1つの塊 { } を割った 1/5 */
async function srjb6Scene1() {
  const spyConfirm = [];
  const spyHits = [];
  const spyClear = [];
  const runner = createResultCatchupRun({
    confirm: async (client, ids) => {
      spyConfirm.push(ids);
      return { checked: ids.length, confirmed: ids.slice(0, 1) };
    },
    clearWithResults: async (client, range) => {
      spyClear.push(range);
      return { checked: 0, cleared: ["2026-09-12-10-01"] };
    },
    fixHitFlags: async (from, to) => {
      spyHits.push([from, to]);
      return { missing: 0, fixed: 0 };
    },
  });
  const db = catchupDb();
  const polite = politeFor();
  const r = await runner(catchupCtx(db, { polite }));
  check(
    "catch-up: 対象日の expired を、確定中止（宮島12R）も含めて再取得する（BOA-526）。他の日は除く。live なので書き込む。期待件数・取得件数は確定中止でない1件（桐生1R）だけで数える",
    polite.calls.length === 2 &&
      polite.calls.some((u) => u.includes("jcd=05")) &&
      polite.calls.some((u) => u.includes("jcd=17")) &&
      r.rowsExpected === 1 &&
      r.rowsParsed === 1 &&
      db.tables.race_results.length === 2 &&
      r.report.retriedConfirmedCancellations === 1,
    show(r.report),
  );
  check(
    "catch-up（BOA-526）: 確定中止のレースを取り直して結果が取れたら（取り逃しだった）、書き込み、recoveredFromCancellation に出す",
    same(r.report.recoveredFromCancellation, [RACE_B]) &&
      db.tables.race_results.some((x) => x.race_id === RACE_B) &&
      r.body.recoveredFromCancellation === 1,
    show(r.report),
  );
  return { spyConfirm, spyHits, spyClear, runner, r };
}

/** 元の verify の1つの塊 { } を割った 2/5 */
async function srjb6Scene2({ spyConfirm, spyHits, spyClear, runner, r }) {
  {
    // 本当の中止（確定中止のレースの結果ページが無い）: 取れないだけで、失敗にも未解決にもしない
    // （上の検証が数える spy を増やさないよう、別のランナーを使う）
    const quietRunner = createResultCatchupRun({
      confirm: async () => ({ checked: 0, confirmed: [] }),
      clearWithResults: async () => ({ checked: 0, cleared: [] }),
      fixHitFlags: async () => ({ missing: 0, fixed: 0 }),
    });
    const dbT = catchupDb();
    const rt = await quietRunner(
      catchupCtx(dbT, {
        polite: politeFor((url) =>
          url.includes("jcd=17") ? HTML_CANCELLED : URL_TO_HTML(url),
        ),
      }),
    );
    check(
      "catch-up（BOA-526）: 確定中止のレースの結果ページが無い（本当の中止）なら、書き込まず、未解決の一覧にも入れず、期待件数にも数えない",
      rt.rowsExpected === 1 &&
        rt.rowsParsed === 1 &&
        rt.report.unresolved.length === 0 &&
        rt.report.recoveredFromCancellation.length === 0 &&
        !dbT.tables.race_results.some((x) => x.race_id === RACE_B),
      show(rt.report),
    );
    // 本当の中止だけの日（確定中止でない再取得の対象が0件）は、0件エラーにしない
    const dbO = catchupDb();
    dbO.tables.scrape_slots = dbO.tables.scrape_slots.filter(
      (x) => x.race_id !== RACE_A,
    );
    const ro = await quietRunner(
      catchupCtx(dbO, { polite: politeFor(() => HTML_CANCELLED) }),
    );
    const storeO = createMemoryStore({
      rows: { result_catchup: { job: "result_catchup", mode: "live" } },
    });
    const wrappedO = await runScrapeJob({
      job: "result_catchup",
      store: storeO,
      run: async () => ro,
      now: () => new Date("2026-09-19T14:50:00Z"),
      client: dbO,
      politeFetch: () => {},
      worker: "w",
    });
    check(
      "catch-up（BOA-526）: 取り直しの対象が確定中止だけで、全て取れない日（本当の中止の日）は、0件エラーにしない（期待件数0）",
      ro.rowsExpected === 0 && wrappedO.status === 200,
      show({ report: ro.report, body: wrappedO.body }),
    );
  }
  check(
    "catch-up: live は、発走+90分を超えた未確定のレース（23:50時点で 14:30・20:00 発走。22:45 は対象外）を確定の処理に渡し、的中フラグを直近10日（9/10〜9/19）で補完する",
    same(spyConfirm, [[RACE_A, "2026-09-19-01-12"]]) &&
      same(spyHits, [["2026-09-10", "2026-09-19"]]),
    show({ spyConfirm, spyHits }),
  );
  check(
    "catch-up（BOA-524）: live は、結果があるのに中止・順延のレースの解除を、対象日から14日遡って（9/6〜9/19）呼び、件数を report・body に出す",
    same(spyClear, [{ from: "2026-09-06", to: "2026-09-19" }]) &&
      same(r.report.clearedCancellations, ["2026-09-12-10-01"]) &&
      r.body.clearedCancellations === 1,
    show({ spyClear, report: r.report.clearedCancellations }),
  );
  check(
    "catch-up: 対象日の結果のスロットに未完了（pending・running）が無ければ、incomplete でない",
    r.incomplete === false,
  );
  const db2 = catchupDb({
    openSlots: [
      {
        job: "result",
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        status: "pending",
        races: { cancellation_status: null },
      },
    ],
  });
  const r2 = await runner(catchupCtx(db2));
  return { spyConfirm, spyHits, spyClear, runner, r2 };
}

/** 元の verify の1つの塊 { } を割った 3/5 */
async function srjb6Scene3({ spyConfirm, spyHits, spyClear, runner, r2 }) {
  check(
    "catch-up: 未完了のスロット（最終レース。期限は翌00:15）があれば incomplete（対象日を処理済みにしない）",
    r2.incomplete === true && r2.report.openSlots === 1,
  );
  // 通し（BOA-524）: 実際の解除の関数で、2026-09-12 型（結果が先・確定が後）のレースが直る。期間の外は触らない
  {
    const realRunner = createResultCatchupRun({
      confirm: async () => ({ checked: 0, confirmed: [] }),
      fixHitFlags: async () => ({ missing: 0, fixed: 0 }),
    });
    const dbC = catchupDb();
    // 確定中止の宮島12R は、ここでは本当の中止（結果ページが無い）とする
    const pNoB = politeFor((url) =>
      url.includes("jcd=17") ? HTML_CANCELLED : URL_TO_HTML(url),
    );
    dbC.tables.races.push(
      {
        race_id: "2026-09-12-10-01",
        race_date: "2026-09-12",
        cancellation_status: "confirmed",
        cancellation_check_streak: 0,
      },
      {
        race_id: "2026-09-05-10-01",
        race_date: "2026-09-05",
        cancellation_status: "confirmed",
        cancellation_check_streak: 0,
      },
    );
    dbC.tables.race_results.push(
      { race_id: "2026-09-12-10-01" },
      { race_id: "2026-09-05-10-01" },
    );
    const rc = await realRunner(catchupCtx(dbC, { polite: pNoB }));
    const st = (id) =>
      dbC.tables.races.find((x) => x.race_id === id).cancellation_status;
    check(
      "catch-up 通し（BOA-524）: 14日以内（9/12）の「結果があるのに確定中止」を解除し、期間の外（9/5）と結果の無い確定中止は触らない",
      st("2026-09-12-10-01") === null &&
        st("2026-09-05-10-01") === "confirmed" &&
        st(RACE_B) === "confirmed" &&
        same(rc.report.clearedCancellations, ["2026-09-12-10-01"]),
      show(rc.report),
    );
    // 解除の読み取りが失敗しても、的中フラグの補完は済んでから例外になる
    const hitCalls = [];
    const failRunner = createResultCatchupRun({
      confirm: async () => ({ checked: 0, confirmed: [] }),
      clearWithResults: async () => {
        throw new Error("解除の読み取りに失敗（テスト）");
      },
      fixHitFlags: async (from, to) => {
        hitCalls.push([from, to]);
        return { missing: 0, fixed: 0 };
      },
    });
    let failErr = null;
    try {
      await failRunner(catchupCtx(catchupDb()));
    } catch (e) {
      failErr = e;
    }
    check(
      "catch-up: 解除が失敗したら例外（握りつぶさない）。ただし的中フラグの補完は先に済んでいる",
      /解除の読み取り/.test(failErr?.message ?? "") && hitCalls.length === 1,
    );
  }
  return { spyConfirm, spyHits, spyClear, runner };
}

/** 元の verify の1つの塊 { } を割った 4/5 */
async function srjb6Scene4({ spyConfirm, spyHits, spyClear, runner }) {
  {
    // 解除: 対象が多いときは分けて読み書きする（URL長の上限対策）。450件 → 200・200・50
    const ids = Array.from({ length: 450 }, (_, i) => `X${i}`);
    const dbL = createFakeDb({
      races: ids.map((race_id) => ({
        race_id,
        cancellation_status: "confirmed",
        cancellation_check_streak: 0,
      })),
      race_results: ids.map((race_id) => ({ race_id })),
    });
    const rl = await clearCancellationsWithResults(dbL, ids);
    check(
      "解除: 450件を200件ずつ3回に分けて読み（race_results・races で6回）、3回に分けて更新し、全件を解除する",
      rl.cleared.length === 450 &&
        dbL.reads.length === 6 &&
        dbL.writes.filter((w) => w.table === "races").length === 3 &&
        dbL.tables.races.every((r) => r.cancellation_status === null),
      show({ reads: dbL.reads.length, writes: dbL.writes.length }),
    );
  }
  // shadow: 取得・解析のみ。確定・的中フラグの補完・書き込みをしない
  spyConfirm.length = 0;
  spyHits.length = 0;
  spyClear.length = 0;
  const dbS = catchupDb();
  const rs = await runner(catchupCtx(dbS, { mode: "shadow" }));
  check(
    "catch-up shadow: 再取得は取得・解析のみ。データテーブルへ書かず、確定・中止の解除・的中フラグの補完も呼ばない",
    dbS.writes.length === 0 &&
      spyConfirm.length === 0 &&
      spyClear.length === 0 &&
      spyHits.length === 0 &&
      rs.rowsWritten === 0 &&
      rs.rowsParsed === 1,
    show({ writes: dbS.writes, confirm: spyConfirm }),
  );
  // 0件エラー: 再取得の対象があるのに、1件も取得・解析できない
  const dbZ = catchupDb();
  const rz = await runner(
    catchupCtx(dbZ, { polite: politeFor(() => HTML_NONE) }),
  );
  const store = createMemoryStore({
    rows: { result_catchup: { job: "result_catchup", mode: "live" } },
  });
  const wrapped = await runScrapeJob({
    job: "result_catchup",
    store,
    run: async () => rz,
    now: () => new Date("2026-09-19T14:50:00Z"),
    client: dbZ,
    politeFetch: () => {},
    worker: "w",
  });
  check(
    "catch-up: 再取得の対象があるのに1件も取得・解析できない → 0件エラー（500・連続失敗・対象日を処理済みにしない）",
    wrapped.status === 500 &&
      /0件/.test(wrapped.body.error) &&
      store.state.get("result_catchup").last_target_date === undefined &&
      store.state.get("result_catchup").consecutive_failures === 1,
    show(wrapped.body),
  );
  // 対象が0件なら、0件エラーにしない
  const dbE = createFakeDb({ scrape_slots: [], races: [], race_results: [] });
  const re = await runner(catchupCtx(dbE));
  check(
    "catch-up: 再取得の対象が0件でも、エラーにしない（正常な日）",
    re.rowsExpected === 0 && !re.outcome,
  );
  return { runner };
}

/** 元の verify の1つの塊 { } を割った 5/5 */
async function srjb6Scene5({ runner }) {
  // ラッパ経由の対象日の冪等: 23:50（未完了）→ 00:30（完了）→ 以降は already_done
  const dbW = catchupDb({
    openSlots: [
      {
        job: "result",
        race_id: "2026-09-19-01-11",
        race_date: DATE,
        status: "pending",
        races: { cancellation_status: null },
      },
    ],
  });
  const storeW = createMemoryStore({
    rows: { result_catchup: { job: "result_catchup", mode: "live" } },
  });
  const runW = (iso) =>
    runScrapeJob({
      job: "result_catchup",
      store: storeW,
      run: runner,
      now: () => new Date(iso),
      client: dbW,
      politeFetch: politeFor(),
      worker: "w",
    });
  const w1 = await runW("2026-09-19T14:50:00Z");
   // 23:50 JST
  const t1 = storeW.state.get("result_catchup").last_target_date;
  // 最終レースの期限が過ぎた（スロットが expired になった）状態にして、00:30 JST に再実行
  dbW.tables.scrape_slots.find((s) => s.race_id === "2026-09-19-01-11").status =
    "expired";
  const w2 = await runW("2026-09-19T15:30:00Z");
   // 00:30 JST（翌日）。対象日は前日のまま
  const t2 = storeW.state.get("result_catchup").last_target_date;
  const w3 = await runW("2026-09-19T15:50:00Z");
  check(
    "catch-up（ラッパ経由）: 23:50 は未完了のため対象日を処理済みにせず、00:30（対象日は前日のまま）に完了し、その後は already_done",
    w1.status === 200 &&
      w1.body.incomplete === true &&
      t1 === undefined &&
      w2.body.targetDate === DATE &&
      t2 === DATE &&
      w3.body.skipped === "already_done",
    show({ w1: w1.body, t1, w2: w2.body, t2, w3: w3.body }),
  );
}

async function srjb6Scene6() {
  {
    const s1 = await srjb6Scene1();
    const s2 = await srjb6Scene2(s1);
    const s3 = await srjb6Scene3(s2);
    const s4 = await srjb6Scene4(s3);
    await srjb6Scene5(s4);
  }
  // ---------------------------------------------------------------------------
  // 共通ラッパの追加機能（onTick・incomplete）が、既存の動作を変えない
  // ---------------------------------------------------------------------------
  {
    // onTick を渡さないジョブ（pseudo）は、従来どおり
    const store = createMemoryStore({
      rows: { pseudo: { job: "pseudo", mode: "live" } },
      slots: [slotFor("2026-09-19-05-01", { job: "pseudo", offset_min: -60 })],
    });
    const res = await runScrapeJob({
      job: "pseudo",
      store,
      handleSlot: async () => ({ outcome: "ok", rowsWritten: 0 }),
      now: () => NOW_TICK,
      worker: "w",
    });
    check(
      "onTick なしのジョブは従来どおり（tick の情報が応答に出ない・200・完了）",
      res.status === 200 && !("tick" in res.body) && store.completed.length === 1,
      show(res.body),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・HTML_NONE・HTML_CANCELLED・URL_TO_HTML） */
export async function runScrapeResultJobScenesB8(env) {
  ({ printOut, check, show, same, HTML_NONE, HTML_CANCELLED, URL_TO_HTML } = env);
  await srjb6Scene6();
}

function srjb6Scene7() {
  printOut(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（合否に含めない）`);
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・HTML_NONE・HTML_CANCELLED・URL_TO_HTML） */
export function runScrapeResultJobScenesB9(env) {
  ({ printOut, check, show, same, HTML_NONE, HTML_CANCELLED, URL_TO_HTML } = env);
  srjb6Scene7();
}
