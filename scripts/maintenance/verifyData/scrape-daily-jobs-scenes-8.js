/**
 * verify-scrape-daily-jobs.js の後半の場面（8/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { runRacerProfilesJob } from "../../lib/racerProfilesJob.js";
import {
  buildPopulation,
  parseArgs as parseProfileArgs,
  runRacerProfileSync,
} from "../../lib/racerProfileSync.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let check, show, same, jst, sleep, liveRow, runJob;

/** 元の verify の1つの塊 { } を割った 1/6 */
function scene1() {
  // ---- 実際の runRacerProfileSync（偽のSupabase・偽の公式サイト）での、チャンク・同時取得の挙動 ----
  const seasonHtml = (ability) => {
    const rows = [
      ["勝率", "6.87"],
      ["2連対率", "54.30%"],
      ["3連対率", "70.10%"],
      ["出走回数", "116回"],
      ["優出回数", "2回"],
      ["優勝回数", "1回"],
      ["平均スタートタイミング", "0.16"],
      ["フライング回数", "0回"],
      ["出遅れ回数（選手責任）", "0回"],
      ["能力指数", String(ability)],
    ];
    const tbody = rows
      .map(([k, v]) => `<tbody><tr><th>${k}</th><td>${v}</td></tr></tbody>`)
      .join("");
    return `<div class="text"><p class="h-alignR">集計期間：2025/11/01-2026/04/30</p></div><div class="table1"><table>${tbody}</table></div>`;
  };
  const ids = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010];
  const profileTables = () => ({
    racer_profiles: ids.map((id) => ({
      racer_id: id,
      ability_index: 40,
      flying_count_period: 0,
      false_start_count_period: 0,
      period_label: "old",
      official_win_rate_period: 1,
    })),
    race_entries: [],
  });
  const noSleep = () => Promise.resolve();
  const baseOptions = (extra) => ({
    ...parseProfileArgs([]),
    delayMs: 0,
    ...extra,
  });
  const seasonFetch = (latency = () => 0, hook = () => {}) => {
    const log = [];
    let active = 0;
    let maxActive = 0;
    const fn = async (url) => {
      const id = Number(new URL(String(url)).searchParams.get("toban"));
      log.push(id);
      active++;
      maxActive = Math.max(maxActive, active);
      hook(id, log.length);
      try {
        await sleep(latency(id));
        return new Response(seasonHtml(50 + (id % 10)), { status: 200 });
      } finally {
        active--;
      }
    };
    fn.log = log;
    Object.defineProperty(fn, "maxActive", { get: () => maxActive });
    return fn;
  };
  const deps = (fetchImpl, extra = {}) => ({
    fetchImpl,
    sleep: noSleep,
    log: () => {},
    logError: () => {},
    ...extra,
  });
  return { seasonHtml, ids, profileTables, noSleep, baseOptions, seasonFetch, deps };
}

/** 元の verify の1つの塊 { } を割った 2/6 */
async function scene2({ seasonHtml, ids, profileTables, noSleep, baseOptions, seasonFetch, deps }) {
  // BOA-1151: 実ジョブから同期本体まで、対象月・保存・完了を確認する。
  const monthlyRun = async (date, { newborn = true, chunkSize = 300, failOn = {}, registered = 3, newcomers = [2001] } = {}) => {
    const tables = profileTables();
    tables.racer_profiles = tables.racer_profiles.slice(0, registered);
    tables.race_entries = newborn
      ? newcomers.map((racer_id, i) => ({ race_id: "2099-01-01-01-01", boat_number: i + 1, racer_id }))
      : [];
    const client = createFakeClient({ tables, failOn });
    // この fake は onConflict 未指定の既定PKを持たないため、実DBのPKを補う。
    const from = client.from;
    client.from = (table) => {
      const query = from(table);
      const upsert = query.upsert;
      query.upsert = (rows, opts) => upsert(rows, opts ?? { onConflict: "racer_id" });
      return query;
    };
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      return new Response(String(url).includes("/profile?")
        ? '<div class="racer1_bodyName">新人</div><dl class="list3"><dt>生年月日</dt><dd>2005/01/01</dd></dl>'
        : seasonHtml(50));
    };
    const store = createMemoryStore({ rows: { racer_profiles: liveRow("racer_profiles") } });
    const execute = (minute) => runJob({
      job: "racer_profiles", store, client, politeFetch: fetchImpl,
      at: jst(`${date}T03:${minute}:00`),
      run: (ctx) => runRacerProfilesJob(ctx, {
        chunkSize, log: () => {}, logError: () => {},
        sync: (args) => runRacerProfileSync({
          ...args, deps: { ...args.deps, sleep: noSleep },
        }),
      }),
    });
    const result = await execute("00");
    return { result, row: store.state.get("racer_profiles"), client, urls, execute };
  };
  for (const date of ["2026-12-02", "2026-11-02", "2026-05-09", "2026-11-16"]) {
    const { result, row, client, urls } = await monthlyRun(date);
    const full = date.slice(5, 7) !== "12";
    check(`BOA-1151 ${date}: 新人を保存し、全員取得月だけ既存3人も取得して完了`,
      result.status === 200 && row.last_target_date === date && row.cursor.done === true &&
      row.last_report.alerts.length === 0 && row.last_report.chunk.targetCount === (full ? 4 : 1) &&
      urls.filter((url) => url.includes("/profile?")).length === 1 &&
      urls.filter((url) => url.includes("/season?")).length === (full ? 4 : 1) &&
      client.data.racer_profiles.some((r) => r.racer_id === 2001 && r.birth_date === "2005-01-01"),
      show({ result, urls }));
  }
  return { ids, profileTables, baseOptions, seasonFetch, deps, monthlyRun };
}

/** 元の verify の1つの塊 { } を割った 3/6 */
async function scene3({ ids, profileTables, baseOptions, seasonFetch, deps, monthlyRun }) {
  {
    const { result, row, urls } = await monthlyRun("2026-12-02", { newborn: false });
    check("BOA-1151 新人0人: 取得も0件エラーも失敗率通知もなく対象日を完了",
      result.status === 200 && row.last_target_date === "2026-12-02" &&
      row.cursor.done === true && row.last_report.alerts.length === 0 &&
      row.last_report.cycle.seasonTargets === 0 && urls.length === 0,
      show({ result, urls }));
  }
  {
    const { result, row, urls, execute } = await monthlyRun("2026-12-02", { chunkSize: 1 });
    const count = urls.length;
    await execute("10");
    check("BOA-1151 新人だけのチャンク: 既存選手を残件に含めず、完了後は再取得しない",
      result.status === 200 && row.cursor.afterRacerId === 2001 && row.cursor.done && urls.length === count);
  }
  {
    const { result, row } = await monthlyRun("2026-12-02", {
      failOn: { "racer_profiles:upsert": "disk full" },
    });
    check("BOA-1151 新人だけでもプロフィール保存エラーは未完了の失敗",
      result.status === 500 && row.last_target_date === undefined);
  }
  return { ids, profileTables, baseOptions, seasonFetch, deps, monthlyRun };
}

/** 元の verify の1つの塊 { } を割った 4/6 */
async function scene4({ ids, profileTables, baseOptions, seasonFetch, deps, monthlyRun }) {
  {
    const { result, row, urls, execute } = await monthlyRun("2026-12-02", {
      chunkSize: 1, newcomers: [999, 2001],
    });
    const firstIncomplete = result.body.incomplete === true && row.cursor.afterRacerId === 999;
    const next = await execute("10");
    check("BOA-1151 新人2人: 保存後に対象集合が減っても登録番号で再開し、全員取得せず完了",
      firstIncomplete && next.status === 200 && row.last_target_date === "2026-12-02" &&
      row.cursor.afterRacerId === 2001 && row.last_report.cycle.profileSuccess === 2 &&
      urls.length === 4);
  }
  for (const failOn of [{}, { "racer_profiles:select": "read error" }, { "race_entries:select": "read error" }]) {
    const { result, row } = await monthlyRun("2026-12-02", {
      newborn: false, registered: 0, failOn,
    });
    check(`BOA-1151 全体が空または読取失敗は成功扱いにしない: ${show(failOn)}`,
      result.status === 500 && row.last_target_date === undefined);
  }
  check("BOA-1151 CLI既定: 登録済み3人と未登録1人を引き続き全員対象にする",
    same(buildPopulation({ registered: new Map([[1001, {}], [1002, {}], [1003, {}]]),
      recentIds: new Set([2001]), ...parseProfileArgs([]) }), [1001, 1002, 1003, 2001]));
  // afterRacerId: その番号より大きい選手だけ（件数の増減があっても位置がずれない）
  {
    const registered = new Map(ids.map((id) => [id, {}]));
    check(
      "選手プロフィール: buildPopulation は afterRacerId より大きい登録番号だけを、昇順・limit つきで返す。指定なしは従来どおり",
      same(
        buildPopulation({
          registered,
          recentIds: new Set([1500]),
          racerIds: null,
          limit: 3,
          offset: 0,
          afterRacerId: 1004,
        }),
        [1005, 1006, 1007],
      ) &&
        same(
          buildPopulation({
            registered,
            recentIds: new Set(),
            racerIds: null,
            limit: 3,
            offset: 0,
          }),
          [1001, 1002, 1003],
        ) &&
        same(
          buildPopulation({
            registered,
            recentIds: new Set(),
            racerIds: null,
            limit: null,
            offset: 0,
            afterRacerId: 1010,
          }),
          [],
        ),
    );
  }
  return { ids, profileTables, baseOptions, seasonFetch, deps };
}

/** 元の verify の1つの塊 { } を割った 5/6 */
async function scene5({ ids, profileTables, baseOptions, seasonFetch, deps }) {
  // チャンク（逐次）: 1005〜1007 を処理し、残り3人。書き込みは対象の3人だけ
  {
    const client = createFakeClient({ tables: profileTables() });
    const fetchImpl = seasonFetch();
    const { summary } = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1004, limit: 3 }),
      deps: deps(fetchImpl),
    });
    const updated = client.data.racer_profiles
      .filter((r) => r.period_label !== "old")
      .map((r) => r.racer_id);
    check(
      "選手プロフィール(実処理): afterRacerId=1004・limit=3 で 1005〜1007 だけを処理・書き込み。再開位置=1007・残り3人",
      same(fetchImpl.log, [1005, 1006, 1007]) &&
        same(updated, [1005, 1006, 1007]) &&
        summary.processedPrefix === 3 &&
        summary.lastProcessedRacerId === 1007 &&
        summary.remaining === 3 &&
        summary.resumed === true,
      show({
        log: fetchImpl.log,
        updated,
        prefix: summary.processedPrefix,
        last: summary.lastProcessedRacerId,
        remaining: summary.remaining,
      }),
    );
    const next = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1007, limit: 300 }),
      deps: deps(seasonFetch()),
    });
    check(
      "選手プロフィール(実処理): 次のチャンク(1007より後・limit=300)で残りを全て処理し、残り0(完了)。既に処理した選手は再取得しない",
      next.summary.remaining === 0 &&
        next.summary.lastProcessedRacerId === 1010 &&
        next.summary.targetCount === 3,
      show({
        remaining: next.summary.remaining,
        last: next.summary.lastProcessedRacerId,
      }),
    );
    const done = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1010, limit: 300 }),
      deps: deps(seasonFetch()),
    });
    check(
      "選手プロフィール(実処理): 再開位置が最後の選手なら対象0人・残り0で、失敗判定にしない(verdict ok)",
      done.summary.targetCount === 0 &&
        done.summary.remaining === 0 &&
        done.verdict.ok === true,
      show(done.verdict),
    );
  }
  return { ids, profileTables, baseOptions, seasonFetch, deps };
}

/** 元の verify の1つの塊 { } を割った 6/6 */
async function scene6({ ids, profileTables, baseOptions, seasonFetch, deps }) {
  // 同時取得: 上限を守る・遅い選手がいても、先頭からの連続した範囲だけを処理済みとする
  {
    const client = createFakeClient({ tables: profileTables() });
    // 番号が小さい選手ほど遅い（完了の順序が、着手の順序と逆になる）
    const fetchImpl = seasonFetch(
      (id) => (1011 - id) * 4,
      () => {},
    );
    let started = 0;
    const { summary } = await runRacerProfileSync({
      client,
      options: baseOptions({ concurrency: 3 }),
      deps: deps(fetchImpl, {
        shouldStop: () => started++ >= 5, // 6人目の着手前に、ソフトデッドラインを過ぎる
      }),
    });
    const processed = client.data.racer_profiles
      .filter((r) => r.period_label !== "old")
      .map((r) => r.racer_id)
      .sort((a, b) => a - b);
    const last = summary.lastProcessedRacerId;
    const contiguous = ids
      .filter((id) => id <= last)
      .every((id) => processed.includes(id));
    check(
      "選手プロフィール(同時3): 同時取得は3人まで。ソフトデッドラインで中断しても、再開位置(最後の登録番号)までの選手は全て処理済み(欠けがない)",
      fetchImpl.maxActive <= 3 &&
        summary.deadlineStopped === true &&
        summary.processedPrefix >= 3 &&
        contiguous &&
        summary.remaining === ids.length - summary.processedPrefix &&
        summary.stoppedEarly === false,
      show({
        max: fetchImpl.maxActive,
        processed,
        last,
        prefix: summary.processedPrefix,
        remaining: summary.remaining,
      }),
    );
  }
  // 従来（CLI）: 同時1・オプション無しは、昇順の逐次。再試行は従来どおり（fetchRetries 既定）
  {
    const client = createFakeClient({ tables: profileTables() });
    const fetchImpl = seasonFetch();
    const { summary, verdict } = await runRacerProfileSync({
      client,
      options: baseOptions({}),
      deps: deps(fetchImpl),
    });
    check(
      "選手プロフィール(従来のCLI): 同時1・昇順の逐次で全10人を処理する。同時に走るのは1人。verdict ok",
      same(fetchImpl.log, ids) &&
        fetchImpl.maxActive === 1 &&
        summary.season.successCount === 10 &&
        verdict.ok === true &&
        summary.remaining === 0,
      show({ log: fetchImpl.log, max: fetchImpl.maxActive, verdict }),
    );
    const failing = { count: 0 };
    const failFetch = async () => {
      failing.count++;
      return new Response("", { status: 500 });
    };
    await runRacerProfileSync({
      client: createFakeClient({ tables: profileTables() }),
      options: baseOptions({ racerIds: [1001] }),
      deps: deps(failFetch),
    });
    const withRetries = failing.count;
    failing.count = 0;
    await runRacerProfileSync({
      client: createFakeClient({ tables: profileTables() }),
      options: baseOptions({ racerIds: [1001] }),
      deps: deps(failFetch, { fetchRetries: 0 }),
    });
    check(
      "選手プロフィール: 再試行は、既定では従来どおり3回試行。fetchRetries=0(politeFetch を使う Vercel)なら1回だけ(二重に再試行しない)",
      withRetries === 3 && failing.count === 1,
      show({ withRetries, without: failing.count }),
    );
  }
}

async function scene7() {
  {
    const s1 = scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    const s4 = await scene4(s3);
    const s5 = await scene5(s4);
    await scene6(s5);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・sleep・liveRow・runJob） */
export async function runScrapeDailyJobsScenes10(env) {
  ({ check, show, same, jst, sleep, liveRow, runJob } = env);
  await scene7();
}
