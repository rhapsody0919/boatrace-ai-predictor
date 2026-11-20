/**
 * verify-race-status-job.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-race-status-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { runRaceStatusJob } from "../../lib/raceStatusJob.js";

let out, check, show, INDEX, stubFetchHtml, ctxOf;

// ---------------------------------------------------------------------------
// 偽クライアント（races・race_results の読み取りと、races の cancellation_status 更新）
// ---------------------------------------------------------------------------
export function createFakeClient({ tables = {}, fail = {} } = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  );
  const calls = [];
  const matches = (row, filters) =>
    filters.every(([kind, column, value]) =>
      kind === "eq" ? row[column] === value : value.includes(row[column]),
    );
  const from = (table) => {
    const q = { table, op: "select", filters: [], payload: null };
    const b = {
      select: () => b,
      update: (payload) => ((q.op = "update"), (q.payload = payload), b),
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      then: (resolve, reject) => {
        calls.push({ table, op: q.op, payload: q.payload, filters: q.filters });
        const failure = fail[`${table}:${q.op}`];
        const result = failure
          ? { data: null, error: { message: failure } }
          : (() => {
              const rows = (state[table] ??= []).filter((r) =>
                matches(r, q.filters),
              );
              if (q.op === "update") {
                for (const r of rows) Object.assign(r, q.payload);
                return { data: null, error: null };
              }
              return { data: rows.map((r) => ({ ...r })), error: null };
            })();
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  };
  return { from, state, calls };
}

export const DATE = "2026-09-21";

 // 14:00 JST
export const raceId = (venue, no) =>
  `${DATE}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;

const racesOf = (venue, from, to, status = null) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    race_id: raceId(venue, from + i),
    race_date: DATE,
    venue_code: venue,
    race_number: from + i,
    cancellation_status: status,
  }));

/** 2026-09-21 の状況を再現する races（戸田1〜6Rは既に確定、津1〜4Rは実施済み・5Rは確定、桐生は告知なし） */
export function scenarioTables() {
  return {
    races: [
      ...racesOf(2, 1, 6, "confirmed"),
      ...racesOf(2, 7, 12),
      ...racesOf(3, 1, 12),
      ...racesOf(9, 1, 4),
      ...racesOf(9, 5, 5, "confirmed"),
      ...racesOf(9, 6, 12),
      ...racesOf(10, 9, 12),
      ...racesOf(1, 1, 12),
    ],
    race_results: [1, 2, 3, 4].map((n) => ({ race_id: raceId(9, n) })),
  };
}

// ---------------------------------------------------------------------------
// (d) ジョブ: 確定の範囲
// ---------------------------------------------------------------------------
export const statusOf = (client, id) =>
  client.state.races.find((r) => r.race_id === id).cancellation_status;

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml） */
export function runRaceStatusJobScenes1(env) {
  ({ out, check, show, INDEX, stubFetchHtml } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml） */
export function runRaceStatusJobScenes2(env) {
  ({ out, check, show, INDEX, stubFetchHtml } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml・ctxOf） */
export function runRaceStatusJobScenes3(env) {
  ({ out, check, show, INDEX, stubFetchHtml, ctxOf } = env);

}

async function scene1() {
  // 結果のあるレースは、告知があっても確定にしない（矛盾として報告）
  {
    const tables = scenarioTables();
    tables.race_results.push({ race_id: raceId(9, 8) }); // 津8Rに結果がある
    const client = createFakeClient({ tables });
    const fetchHtml = stubFetchHtml();
    const res = await runRaceStatusJob(ctxOf(client, "live"), { fetchHtml });
    check(
      "結果のあるレース（津8R）は、告知があっても確定にせず・結果ページも取得せず、contradictions に残す",
      statusOf(client, raceId(9, 8)) === null &&
        show(res.report.contradictions) === show([raceId(9, 8)]) &&
        !fetchHtml.resultCalls().some((u) => u.includes("rno=8&jcd=09")),
      show(res.report.contradictions),
    );
  }
  // 暫定（tentative）は確定に上げられる。確定済みは上書き・再取得しない
  {
    const tables = {
      races: [...racesOf(2, 7, 8, "tentative"), ...racesOf(2, 9, 9, "confirmed")],
      race_results: [],
    };
    const client = createFakeClient({ tables });
    const fetchHtml = stubFetchHtml();
    await runRaceStatusJob(ctxOf(client, "live"), { fetchHtml });
    check(
      "暫定（tentative）のレースは確定に上がる。確定済み（9R）は取得もしない",
      statusOf(client, raceId(2, 7)) === "confirmed" &&
        statusOf(client, raceId(2, 8)) === "confirmed" &&
        fetchHtml.resultCalls().length === 2,
    );
  }
  // 告知が無い日: 開催場一覧の1リクエストだけで終わる
  {
    const quiet = INDEX.replaceAll(">中止順延<", ">1R以降発売中<")
      .replaceAll(">5R以降中止順延<", ">1R以降発売中<")
      .replaceAll(">10R以降中止<", ">1R以降発売中<");
    const client = createFakeClient({ tables: scenarioTables() });
    const fetchHtml = stubFetchHtml({ index: quiet });
    const res = await runRaceStatusJob(ctxOf(client, "live"), { fetchHtml });
    check(
      "告知の無い日: 開催場一覧の1リクエストのみ。races・結果ページへは何もしない",
      fetchHtml.calls.length === 1 &&
        client.calls.length === 0 &&
        res.rowsWritten === 0 &&
        res.report.announced.length === 0,
      show({ calls: fetchHtml.calls.length, db: client.calls.length }),
    );
  }
  // 未知の文言（「中止」「順延」を含む既知でない形）は、確定せず報告する
  {
    const odd = INDEX.replace(">中止順延<", ">本日の開催中止のお知らせ<");
    const client = createFakeClient({ tables: scenarioTables() });
    const res = await runRaceStatusJob(ctxOf(client, "live"), {
      fetchHtml: stubFetchHtml({ index: odd }),
    });
    check(
      "未知の文言（戸田）は何も確定せず、unrecognized に残る（他の既知の告知は処理される）",
      res.report.unrecognized.length === 1 &&
        res.report.unrecognized[0].venueCode === 2 &&
        statusOf(client, raceId(2, 7)) === null &&
        statusOf(client, raceId(3, 1)) === "confirmed",
      show(res.report.unrecognized),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml・ctxOf） */
export async function runRaceStatusJobScenes4(env) {
  ({ out, check, show, INDEX, stubFetchHtml, ctxOf } = env);
  await scene1();
}

async function scene2() {
  // ---------------------------------------------------------------------------
  // (f) 失敗
  // ---------------------------------------------------------------------------
  {
    const rejects = async (promise) => {
      try {
        await promise;
        return null;
      } catch (error) {
        return error.message;
      }
    };
    const client = () => createFakeClient({ tables: scenarioTables() });
    const idxFail = await rejects(
      runRaceStatusJob(ctxOf(client(), "live"), {
        fetchHtml: stubFetchHtml({ index: new Error("HTTP 503") }),
      }),
    );
    check(
      "開催場一覧の取得失敗は失敗（成功にしない）",
      idxFail === "開催場一覧の取得に失敗しました: HTTP 503",
      String(idxFail),
    );
    const zero = await rejects(
      runRaceStatusJob(ctxOf(client(), "live"), {
        fetchHtml: stubFetchHtml({ index: "<html><body>変更後</body></html>" }),
      }),
    );
    check(
      "開催場一覧から会場を1つも読めなければ失敗（構造の変化を、告知なしの成功にしない）",
      zero?.includes("0件を成功にしません") === true,
      String(zero),
    );
    const allFail = await rejects(
      runRaceStatusJob(ctxOf(client(), "live"), {
        fetchHtml: stubFetchHtml({ results: () => new Error("HTTP 503") }),
      }),
    );
    check(
      "結果ページの取得が、試みた全件で失敗したら失敗（障害を「確定なし」の成功にしない）",
      allFail?.includes("全て失敗") === true,
      String(allFail),
    );
    const dbFail = await rejects(
      runRaceStatusJob(
        ctxOf(
          createFakeClient({
            tables: scenarioTables(),
            fail: { "races:select": "connection refused" },
          }),
          "live",
        ),
        { fetchHtml: stubFetchHtml() },
      ),
    );
    check(
      "races の取得失敗は失敗（「候補なし」の成功にしない）",
      dbFail?.includes("races の取得に失敗") === true,
      String(dbFail),
    );
    const breaker = await runRaceStatusJob(ctxOf(client(), "live"), {
      fetchHtml: stubFetchHtml({
        index: new BreakerOpenError("boatrace.jp", Date.now() + 60000),
      }),
    });
    check(
      "ブレーカーが開いていれば、何もせず skipped（失敗にしない）",
      breaker.body.skipped === "breaker_open" && breaker.rowsWritten === 0,
      show(breaker.body),
    );
    // ソフトデッドライン: 以降のレースは取得せず、次の起動に回す
    const stopClient = client();
    let n = 0;
    const stopFetch = stubFetchHtml();
    const stopped = await runRaceStatusJob(
      ctxOf(stopClient, "live", { shouldStop: () => ++n > 5 }),
      { fetchHtml: stopFetch, concurrency: 1 },
    );
    check(
      "ソフトデッドライン: 打ち切った分は取得せず（notAttempted）、取得できた分だけ確定にする。次の起動が続きを処理する",
      stopped.report.notAttempted > 0 &&
        stopped.rowsWritten > 0 &&
        stopped.rowsWritten + stopped.report.notAttempted === 28,
      show({
        notAttempted: stopped.report.notAttempted,
        rowsWritten: stopped.rowsWritten,
      }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml・ctxOf） */
export async function runRaceStatusJobScenes5(env) {
  ({ out, check, show, INDEX, stubFetchHtml, ctxOf } = env);
  await scene2();
}

function scene3() {
  out.log("\n全ての検証が成功しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・stubFetchHtml・ctxOf） */
export function runRaceStatusJobScenes6(env) {
  ({ out, check, show, INDEX, stubFetchHtml, ctxOf } = env);
  scene3();
}
