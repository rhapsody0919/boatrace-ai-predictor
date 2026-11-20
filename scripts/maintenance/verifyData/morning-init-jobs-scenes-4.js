/**
 * verify-morning-init-jobs.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { defaultCheckNoProgram } from "../../lib/racesInit/job.js";
import { parsePcexpectRaceId, createPcexpectSlotHandler } from "../../lib/scrapeJobs/pcexpectHandlers.js";
import { makeFetchHtml } from "../../lib/scrapeJobs/htmlFetch.js";
import { comparePcexpectDigests } from "../check-morning-init-shadow.js";
import { parsePcexpect } from "../../daily/scrape-pcexpect.js";

let out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at;

/** 元の verify の1つの塊 { } を割った 1/7 */
async function scene1() {
  const RACE_ID = "2026-09-21-12-12";
  const slot = {
    job: "pcexpect",
    race_id: RACE_ID,
    offset_min: -720,
    attempts: 1,
    last_attempt_at: T0.toISOString(),
  };
  const politeFetch = async (url) => {
    politeFetch.urls.push(url);
    return new Response(politeFetch.body, {
      status: politeFetch.status ?? 200,
    });
  };
  politeFetch.urls = [];
  politeFetch.body = PCEXPECT_HTML;
  async function runSlot(
    mode,
    {
      client,
      loadStartTime,
      fetchImpl = politeFetch,
      useDefaultLoader = false,
    } = {},
  ) {
    const store = createMemoryStore({
      rows: { pcexpect: { job: "pcexpect", mode, consecutive_failures: 0 } },
      slots: [slot],
    });
    const c = client ?? createFakeSupabaseClient();
    const res = await runScrapeJob({
      job: "pcexpect",
      store,
      client: c,
      handleSlot: createPcexpectSlotHandler(
        useDefaultLoader
          ? {}
          : {
              loadStartTime:
                loadStartTime ??
                (async () => new Date("2026-09-21T20:30:00+09:00")),
            },
      ),
      politeFetch: fetchImpl,
      now: () => T0,
      worker: "verify",
    });
    return { res, store, client: c };
  }
  check(
    "(i) race_id の解析: 日付・会場・レース番号",
    same(parsePcexpectRaceId(RACE_ID), {
      date: DATE,
      venue_code: 12,
      race_number: 12,
    }),
  );
  const badId = (() => {
    try {
      parsePcexpectRaceId("bad");
      return false;
    } catch {
      return true;
    }
  })();
  check("(i) 不正な race_id は例外", badId);
  const shadow = await runSlot("shadow");
  return { RACE_ID, politeFetch, runSlot, shadow };
}

/** 元の verify の1つの塊 { } を割った 2/7 */
async function scene2({ RACE_ID, politeFetch, runSlot, shadow }) {
  check(
    "(i) shadow: 取得・解析のみ。DBには一切触れず、payload のダイジェストを予定表の result_digest に記録して完了",
    shadow.res.status === 200 &&
      shadow.store.completed.length === 1 &&
      shadow.store.completed[0].outcome === "ok" &&
      shadow.store.completed[0].resultDigest === PCEXPECT_DIGEST &&
      shadow.client.calls.length === 0 &&
      politeFetch.urls.at(-1) ===
        "https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=20260921&jcd=12&rno=12",
    show(shadow.store.completed),
  );
  const live = await runSlot("live");
  const row = live.client.data.external_predictions?.[0];
  return { RACE_ID, politeFetch, runSlot, live, row };
}

/** 元の verify の1つの塊 { } を割った 3/7 */
async function scene3({ RACE_ID, politeFetch, runSlot, live, row }) {
  check(
    "(i) live: external_predictions へ upsert（race_start_at は races.start_time の発走時刻）して完了。書き込み1行",
    live.store.completed.length === 1 &&
      live.store.completed[0].rowsWritten === 1 &&
      row?.race_start_at === "2026-09-21T11:30:00.000Z" &&
      row?.race_date === DATE &&
      row?.venue_code === 12 &&
      row?.race_no === 12,
    show(row),
  );
  politeFetch.body = "<html><body>まだ公開されていません</body></html>";
  const empty = await runSlot("live");
  check(
    "(i) 予想が未公開: 完了にせず再試行（no_values）。書き込まない",
    empty.store.completed.length === 0 &&
      empty.store.retried.length === 1 &&
      empty.store.retried[0].outcome === "no_values" &&
      !empty.client.data.external_predictions,
    show(empty.store.retried),
  );
  politeFetch.body = PCEXPECT_HTML;
  const http500 = await runSlot("shadow", {
    fetchImpl: async () => new Response("err", { status: 500 }),
  });
  return { RACE_ID, runSlot, http500 };
}

/** 元の verify の1つの塊 { } を割った 4/7 */
async function scene4({ RACE_ID, runSlot, http500 }) {
  check(
    "(i) HTTP 500: 完了にせず再試行（error）。連続の失敗にはしない（1スロットの失敗）",
    http500.store.completed.length === 0 &&
      http500.store.retried[0]?.outcome === "error" &&
      /HTTP 500/.test(http500.store.retried[0]?.error ?? ""),
    show(http500.store.retried),
  );
  // 既定の発走時刻の読み取り（races.start_time → race_start_at）
  const withRaces = await runSlot("live", {
    useDefaultLoader: true,
    client: createFakeSupabaseClient({
      tables: { races: [{ race_id: RACE_ID, start_time: "20:30:00" }] },
    }),
  });
  const noRaceRow = await runSlot("live", { useDefaultLoader: true });
  const racesReadFails = await runSlot("live", {
    useDefaultLoader: true,
    client: createFakeSupabaseClient({
      failOn: { "races:select": "races-down" },
    }),
  });
  return { runSlot, withRaces, noRaceRow, racesReadFails };
}

/** 元の verify の1つの塊 { } を割った 5/7 */
async function scene5({ runSlot, withRaces, noRaceRow, racesReadFails }) {
  check(
    "(i) 既定の発走時刻の読み取り: races.start_time（20:30:00）が race_start_at（JST→UTC）になる。races に行が無ければ null。読み取りの失敗は再試行",
    withRaces.client.data.external_predictions?.[0]?.race_start_at ===
      "2026-09-21T11:30:00.000Z" &&
      noRaceRow.client.data.external_predictions?.[0]?.race_start_at === null &&
      racesReadFails.store.completed.length === 0 &&
      racesReadFails.store.retried[0]?.outcome === "error" &&
      /races-down/.test(racesReadFails.store.retried[0]?.error ?? ""),
    show(withRaces.client.data.external_predictions?.[0]),
  );
  const startFail = await runSlot("live", {
    loadStartTime: async () => {
      throw new Error("発走時刻の読み取りに失敗しました");
    },
  });
  return { runSlot, startFail };
}

/** 元の verify の1つの塊 { } を割った 6/7 */
async function scene6({ runSlot, startFail }) {
  check(
    "(i) 発走時刻の読み取りに失敗: 書き込まずに再試行",
    startFail.store.completed.length === 0 &&
      startFail.store.retried[0]?.outcome === "error" &&
      !startFail.client.data.external_predictions,
  );
  const writeFail = await runSlot("live", {
    client: createFakeSupabaseClient({
      failOn: { "external_predictions:upsert": "boom-ep" },
    }),
  });
  check(
    "(i) 書き込みの失敗: 完了にせず再試行",
    writeFail.store.completed.length === 0 &&
      writeFail.store.retried[0]?.outcome === "error",
  );
  const breaker = await runSlot("shadow", {
    fetchImpl: async () => {
      throw new BreakerOpenError("host:boatrace.jp", at(5).getTime());
    },
  });
  check(
    "(i) ブレーカーが開いている: breaker_open で、ブレーカーが閉じる時刻まで再試行を遅らせる",
    breaker.store.retried[0]?.outcome === "breaker_open" &&
      breaker.store.retried[0]?.retryAt?.getTime() === at(5).getTime(),
  );
  // shadow のダイジェストと DB の payload の比較（scripts/maintenance/check-morning-init-shadow.js）
  const dbRow = (raceNo, payload) => ({
    race_date: DATE,
    venue_code: 12,
    race_no: raceNo,
    payload,
  });
  const payload = parsePcexpect(PCEXPECT_HTML);
  const cmp = comparePcexpectDigests(
    [
      { race_id: "2026-09-21-12-12", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-11", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-10", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-09", result_digest: null },
    ],
    [
      dbRow(12, payload),
      dbRow(11, { ...payload, confidence: payload.confidence + 1 }),
    ],
  );
  check(
    "(i) 公式予想のダイジェスト比較: 一致・不一致（payload の違い）・DBに行なし・digest未記録を区別する",
    cmp.matched === 1 &&
      same(
        cmp.mismatched.map((m) => m.race_id),
        ["2026-09-21-12-11"],
      ) &&
      same(cmp.missing, ["2026-09-21-12-10"]) &&
      same(cmp.noDigest, ["2026-09-21-12-09"]),
    show(cmp),
  );
  const fetched = await makeFetchHtml(
    async () => new Response("<p>x</p>", { status: 200 }),
  )("u");
  const fetchErr = await makeFetchHtml(
    async () => new Response("no", { status: 503 }),
  )("u").catch((e) => e);
  return { fetched, fetchErr };
}

/** 元の verify の1つの塊 { } を割った 7/7 */
function scene7({ fetched, fetchErr }) {
  check(
    "(i) makeFetchHtml: 本文を返す・HTTP エラーは例外",
    fetched === "<p>x</p>" &&
      fetchErr instanceof Error &&
      /HTTP 503/.test(fetchErr.message),
  );
}

async function scene8() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    const s4 = await scene4(s3);
    const s5 = await scene5(s4);
    const s6 = await scene6(s5);
    scene7(s6);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・newEnv・newDeps・T0・at） */
export async function runMorningInitJobsScenes4(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at } = env);
  await scene8();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene9() {
  const env = newEnv({ mode: "live" });
  const { deps, calls } = newDeps({
    venues: [1, 2],
    failVenues: new Map([[2, "発走時刻を1件も取得できません（会場2）"]]),
    noProgramVenues: [2],
  });
  const res = await env.invoke(T0, { deps });
  const report = env.row().last_report;
  check(
    "(z) 番組の無い中止の会場（会場2）: 失敗にせず済み（noProgram）。races は書かない。全会場が済み、後始末（予定表・unified）に進み、対象日を処理済みにする",
    res.status === 200 &&
      calls.write.join() === "1" &&
      calls.noProgramChecks.join() === "2" &&
      report.noProgram?.join() === "2" &&
      report.done === true &&
      calls.slots === 1 &&
      calls.unified === 1 &&
      env.row().last_target_date === DATE,
    show({ body: res.body, report }),
  );
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({
    venues: [1, 2],
    failVenues: new Map([[2, "発走時刻を1件も取得できません（会場2）"]]),
    noProgramVenues: [],
  });
  await env2.invoke(T0, { deps: d2.deps });
  const r2 = env2.row().last_report;
  return { d2, r2 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene10({ d2, r2 }) {
  check(
    "(z) 番組なしと確かめられない会場（中止でない・出走表が未公開等）: 従来どおり失敗のまま（済みにせず、後始末に進まない）",
    r2.pending?.join() === "2" &&
      (r2.noProgram ?? []).length === 0 &&
      r2.done === false &&
      d2.calls.slots === 0,
    show(r2),
  );
}

async function scene11() {
  {
    const s1 = await scene9();
    scene10(s1);
  }
  {
    // defaultCheckNoProgram: 一覧の状態欄が日全体の中止 かつ 1R の出走表が「データがありません」のときだけ true
    const index = (status) =>
      `<table><tbody><tr><td class="is-arrow1"><a href="/owpc/pc/race/raceindex?jcd=13&hd=20260517">x</a></td><td colspan="3">${status}</td></tr></tbody></table>`;
    const racelistNoData = "<div>※ データがありません。</div>";
    const racelistData =
      '<table><tbody class="is-fs12"><tr><td>1</td></tr></tbody></table>';
    const make = (indexHtml, racelistHtml) => async (url) =>
      /race\/index/.test(url) ? indexHtml : racelistHtml;
    const results = [];
    for (const [label, idx, rl, want] of [
      ["中止＋データがありません", index("中止"), racelistNoData, true],
      ["中止順延＋データがありません", index("中止順延"), racelistNoData, true],
      [
        "中止＋出走表あり（全日中止だが番組はある）",
        index("中止"),
        racelistData,
        false,
      ],
      [
        "状態欄が空（中止でない）＋データがありません（未公開）",
        index(""),
        racelistNoData,
        false,
      ],
      [
        "7R以降中止＋データがありません",
        index("7R以降中止"),
        racelistNoData,
        false,
      ],
    ]) {
      const got = await defaultCheckNoProgram("2026-05-17", 13, {
        fetchHtml: make(idx, rl),
      });
      results.push([label, got, want]);
    }
    check(
      "(z) defaultCheckNoProgram: 一覧で日全体の中止 かつ 出走表が「データがありません」のときだけ true（片方だけなら false）",
      results.every(([, got, want]) => got === want),
      show(results),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・newEnv・newDeps・T0・at） */
export async function runMorningInitJobsScenes5(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at } = env);
  await scene11();
}

function scene12() {
  out.log("\n✅ 全ての検証に合格しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same・PCEXPECT_HTML・PCEXPECT_DIGEST・DATE・newEnv・newDeps・T0・at） */
export function runMorningInitJobsScenes6(env) {
  ({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at } = env);
  scene12();
}
