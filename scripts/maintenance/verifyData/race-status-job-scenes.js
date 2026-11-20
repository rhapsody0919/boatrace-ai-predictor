/**
 * verify-race-status-job.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-race-status-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { runRaceStatusJob } from "../../lib/raceStatusJob.js";

let out, check, show, INDEX, createFakeClient, DATE, NOW, raceId, scenarioTables, stubFetchHtml, ctxOf, statusOf;

// ---------------------------------------------------------------------------
// (e) mode（共通ラッパ経由）
// ---------------------------------------------------------------------------
const runWrapped = ({ mode, client, fetchHtml, extra = {} }) => {
  const store = createMemoryStore({
    rows: mode ? { race_status: { job: "race_status", mode } } : {},
  });
  return {
    store,
    promise: runScrapeJob({
      job: "race_status",
      store,
      run: (ctx) => runRaceStatusJob(ctx, { fetchHtml }),
      now: () => NOW,
      worker: "w-test",
      modeGated: true,
      client,
      politeFetch: async () => {
        throw new Error("使わない");
      },
      ...extra,
    }),
  };
};

async function scene1() {
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

async function scene2() {
  {
    const offClient = createFakeClient({ tables: scenarioTables() });
    const offFetch = stubFetchHtml();
    const off = runWrapped({
      mode: "off",
      client: offClient,
      fetchHtml: offFetch,
    });
    const offRes = await off.promise;
    check(
      "off: 何もしない（取得もDBの読み書きもしない）",
      offRes.status === 200 &&
        offRes.body.skipped === "mode_off" &&
        offFetch.calls.length === 0 &&
        offClient.calls.length === 0,
      show(offRes.body),
    );
    const none = runWrapped({
      mode: null,
      client: offClient,
      fetchHtml: offFetch,
    });
    const noneRes = await none.promise;
    check(
      "ジョブ状態の行が無い（デプロイ直後）: off として何もしない。誤報にならない",
      noneRes.body.skipped === "mode_off" &&
        offFetch.calls.length === 0 &&
        none.store.state.get("race_status")?.mode === "off",
    );

    const shadowClient = createFakeClient({ tables: scenarioTables() });
    const shadowFetch = stubFetchHtml();
    const shadow = runWrapped({
      mode: "shadow",
      client: shadowClient,
      fetchHtml: shadowFetch,
    });
    const shadowRes = await shadow.promise;
    const report = shadow.store.state.get("race_status").last_report;
    check(
      "shadow: 取得・解析はするが races へ書かない。確定するはずのレース（28件全て。打ち切らない）を wouldConfirm に残す",
      shadowRes.status === 200 &&
        !shadowClient.calls.some((c) => c.op === "update") &&
        shadowClient.state.races.filter(
          (r) => r.cancellation_status === "confirmed",
        ).length === 7 &&
        report.confirmed === 0 &&
        report.wouldConfirm.length === 28 &&
        report.wouldConfirm.every((id) => id.startsWith(DATE)),
      show({ status: shadowRes.status, confirmed: report?.confirmed }),
    );

    const liveClient = createFakeClient({ tables: scenarioTables() });
    const live = runWrapped({
      mode: "live",
      client: liveClient,
      fetchHtml: stubFetchHtml(),
    });
    const liveRes = await live.promise;
    check(
      "live: 確定を書く。件数を rowsWritten に記録する（0件でも成功。告知の無い日は正常）",
      liveRes.status === 200 &&
        liveRes.body.rowsWritten === 28 &&
        live.store.state.get("race_status").last_rows_written === 28,
      show(liveRes.body),
    );
  }
}

async function scene3() {
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

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・createFakeClient・DATE・NOW・raceId・scenarioTables・stubFetchHtml・ctxOf・statusOf） */
export async function runRaceStatusJobScenes1(env) {
  ({ out, check, show, INDEX, createFakeClient, DATE, NOW, raceId, scenarioTables, stubFetchHtml, ctxOf, statusOf } = env);
  await scene1();
  await scene2();
  await scene3();
}

function scene4() {
  out.log("\n全ての検証が成功しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・INDEX・createFakeClient・DATE・NOW・raceId・scenarioTables・stubFetchHtml・ctxOf・statusOf） */
export function runRaceStatusJobScenes2(env) {
  ({ out, check, show, INDEX, createFakeClient, DATE, NOW, raceId, scenarioTables, stubFetchHtml, ctxOf, statusOf } = env);
  scene4();
}
