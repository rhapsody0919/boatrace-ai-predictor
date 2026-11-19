/**
 * verify-morning-init-jobs.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../../lib/scrapeJobs/dailyJob.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import {
  runRacesInitJob,
  RACES_INIT_VENUES_PER_INVOCATION,
  backoffMinutes,
} from "../../lib/racesInit/job.js";
import { raceIdOf } from "../../lib/racesInit/digest.js";

let check, show, same, jst, DATE, JOB, newEnv, newDeps, range, T0, at;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const env = newEnv({ mode: "shadow" });
  const { deps, calls } = newDeps({ venues: range(13) });
  const r1 = await env.invoke(T0, { deps });
  const c1 = env.row().cursor;
  check(
    "(c) shadow 1回目: 8会場を処理し、残りは次の起動へ（incomplete）",
    r1.status === 200 &&
      calls.scrape.length === 8 &&
      c1.settled.length === 8 &&
      c1.done === false &&
      env.row().last_target_date === undefined,
    show(r1.body),
  );
  const r2 = await env.invoke(at(2), { deps });
  const c2 = env.row().cursor;
  check(
    "(c) shadow 2回目: 残り5会場を処理し、done（対象日は処理済みにしない＝shadowは書かない）",
    r2.status === 200 &&
      calls.scrape.length === 13 &&
      c2.done === true &&
      c2.settled.length === 13 &&
      env.row().last_target_date === undefined,
    show(r2.body),
  );
  check(
    "(c) shadow: データテーブルへは一切書かない・書き込み関数も呼ばない・後始末（予定表・unified・Deploy Hook）もしない",
    env.dataWrites().length === 0 &&
      calls.write.length === 0 &&
      calls.slots === 0 &&
      calls.unified === 0 &&
      calls.hook === 0,
  );
  return { env, deps, calls, c2 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ env, deps, calls, c2 }) {
  check(
    "(c) shadow: レースごとのダイジェスト（13会場×12レース=156）と件数を cursor に記録する",
    Object.keys(c2.digests).length === 156 &&
      c2.races === 156 &&
      c2.entries === 936 &&
      c2.digests[raceIdOf(DATE, 1, 1)]?.length === 12,
    `${Object.keys(c2.digests).length}`,
  );
  check(
    "(c) 1会場の取得は、strict（失敗を例外にする）・politeFetch 由来の fetchHtml・並列度6（会場内で同時12リクエスト）で呼ぶ",
    calls.opts.length > 0 &&
      calls.opts.every(
        (o) =>
          o.strict === true &&
          o.raceConcurrency === 6 &&
          typeof o.fetchHtml === "function",
      ),
    show(calls.opts[0]),
  );
  check(
    "(c) shadow: DBを読まない（races の存在確認をしない）",
    !env.client.calls.some((c) => c.table === "races"),
  );
  const before = calls.scrape.length;
  const r3 = await env.invoke(at(4), { deps });
  check(
    "(c) shadow 完了後の起動: 何も取得しない（cycle_done）",
    r3.body.skipped === "cycle_done" &&
      calls.scrape.length === before &&
      calls.getVenues === 2,
    show(r3.body),
  );
  check(
    "(c) 会場一覧の取得は、計画と再確認（取りこぼし会場）の2回",
    calls.getVenues === 2,
  );
}

async function scene3() {
  // ---------------------------------------------------------------------------
  // (a) 対象日
  // ---------------------------------------------------------------------------
  {
    const cases = [
      ["2026-09-21 04:59", "2026-09-20"],
      ["2026-09-21 05:00", "2026-09-21"],
      ["2026-09-21 05:02", "2026-09-21"],
      ["2026-09-21 09:58", "2026-09-21"],
      ["2026-09-22 00:30", "2026-09-21"],
    ];
    for (const [now, expected] of cases) {
      check(
        `(a) 指定 05:00 のジョブ: ${now} JST の起動の対象日は ${expected}`,
        resolveTargetDate(jst(now), SCRAPE_JOBS[JOB].targetTimeJst) === expected,
      );
    }
    const env = newEnv({ mode: "live" });
    const { deps, calls } = newDeps({ venues: [1] });
    await env.invoke(jst("2026-09-21 05:00"), { deps });
    check(
      "(a) 05:00 の起動: 会場一覧は、その日の日付（hd=）で取得し、その日を処理済みにする",
      calls.dates.length >= 1 &&
        calls.dates.every((d) => d === DATE) &&
        env.row().last_target_date === DATE,
      show(calls.dates),
    );
    // 翌日 00:30 に遅れて起動しても、対象日は前日のまま（前日の cursor を続きから処理し、翌日の分を取り違えない）
    const env2 = newEnv({ mode: "live" });
    const d2 = newDeps({ venues: [1] });
    await env2.invoke(jst("2026-09-22 00:30"), { deps: d2.deps });
    check(
      "(a) 翌日 00:30 の遅れた起動: 対象日は前日（2026-09-21）のまま",
      d2.calls.dates.every((d) => d === "2026-09-21") &&
        env2.row().last_target_date === "2026-09-21",
      show(d2.calls.dates),
    );
  }
  // ---------------------------------------------------------------------------
  // (b) off・行なし・075未適用
  // ---------------------------------------------------------------------------
  {
    for (const [label, opts] of [
      ["行なし", { mode: null }],
      ["off", { mode: "off" }],
    ]) {
      const env = newEnv(opts);
      const { deps, calls } = newDeps();
      const res = await env.invoke(T0, { deps });
      check(
        `(b) ${label}: 何も取得せず・何も書かない（200・skipped）`,
        res.status === 200 &&
          res.body.skipped === "mode_off" &&
          calls.getVenues === 0 &&
          calls.scrape.length === 0 &&
          calls.write.length === 0 &&
          env.dataWrites().length === 0,
        show(res.body),
      );
    }
    const memory = createMemoryStore({ available: false });
    const { deps, calls } = newDeps();
    const res = await runScrapeJob({
      job: JOB,
      store: memory,
      run: (ctx) => runRacesInitJob(ctx, deps),
      now: () => T0,
      worker: "verify",
    });
    check(
      "(b) 075未適用: 何もせず 200（skipped）",
      res.status === 200 &&
        res.body.skipped === "scrape_schema_not_applied" &&
        calls.getVenues === 0,
    );
  }
  {
    const s1 = await scene1();
    await scene2(s1);
  }
}

async function scene4() {
  // ---------------------------------------------------------------------------
  // (d) live: チャンク・再開・冪等・初期化済みの会場
  // ---------------------------------------------------------------------------
  {
    const env = newEnv({ mode: "live" });
    const { deps, calls } = newDeps({ venues: range(24) });
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await env.invoke(at(2 * i), { deps }));
    }
    check(
      "(d) 24会場: 8・8・8会場の3回の起動で、全会場を処理する（会場の重複なし）",
      same(calls.write, range(24)) &&
        results[0].body.settledThisRun === 8 &&
        results[1].body.settledThisRun === 8 &&
        results[2].body.settledThisRun === 8,
      show(results.map((r) => r.body)),
    );
    check(
      "(d) 全会場が済んだ起動で、後始末（予定表・unified・Deploy Hook）を1回ずつ行い、対象日を処理済みにする",
      results[2].body.done === true &&
        calls.slots === 1 &&
        calls.unified === 1 &&
        calls.hook === 1 &&
        env.row().last_target_date === DATE &&
        env.row().cursor.finalize.slots.created === 5,
      show(results[2].body),
    );
    check(
      "(d) 途中の起動（1・2回目）は、対象日を処理済みにしない",
      results[0].body.done === false && results[1].body.done === false,
    );
    const scrapedBefore = calls.scrape.length;
    const r4 = await env.invoke(at(6), { deps });
    check(
      "(d) 処理済みの日の起動: 何も取得せず何も書かない（already_done。冪等）",
      r4.body.skipped === "already_done" &&
        calls.scrape.length === scrapedBefore &&
        calls.slots === 1 &&
        calls.hook === 1,
      show(r4.body),
    );
    check(
      "(d) 会場は順次（同時に1会場）・1会場の並列度は scrapeVenue に渡す",
      RACES_INIT_VENUES_PER_INVOCATION === 8,
    );
  }
}

async function scene5() {
  {
    // 既に races に行のある会場は、書き込まない（GitHub Actions が初期化済み）
    const env = newEnv({ mode: "live" });
    const { deps, calls } = newDeps({
      venues: [1, 2, 3, 5],
      existing: [1, 2, 3],
    });
    const res = await env.invoke(T0, { deps });
    check(
      "(d) 初期化済みの会場（1・2・3）は処理せず、無い会場（5）だけを書く。Deploy Hook は、書いたので1回",
      res.body.done === true &&
        same(calls.write, [5]) &&
        same(calls.scrape, [5]) &&
        calls.hook === 1 &&
        same(env.row().cursor.existing, [1, 2, 3]),
      show({ res: res.body, write: calls.write }),
    );
    const env2 = newEnv({ mode: "live" });
    const d2 = newDeps({ venues: [1, 2, 3], existing: [1, 2, 3] });
    const res2 = await env2.invoke(T0, { deps: d2.deps });
    check(
      "(d) 全会場が初期化済み: 取得も書き込みもせず、後始末（予定表・unified）だけ行う。何も書いていないので Deploy Hook は叩かない",
      res2.body.done === true &&
        d2.calls.scrape.length === 0 &&
        d2.calls.write.length === 0 &&
        d2.calls.slots === 1 &&
        d2.calls.unified === 1 &&
        d2.calls.hook === 0 &&
        env2.row().last_target_date === DATE,
      show(res2.body),
    );
    // shadow → live（同じ日）: shadow の進捗を引き継がない
    const env3 = newEnv({
      mode: "live",
      cursor: {
        targetDate: DATE,
        mode: "shadow",
        done: true,
        settled: [1, 2, 3],
        targets: [1, 2, 3],
      },
    });
    const d3 = newDeps({ venues: [1, 2] });
    await env3.invoke(T0, { deps: d3.deps });
    check(
      "(d) shadow で済んだ日でも、live は最初からやり直して書き込む（shadow の cursor を引き継がない）",
      same(d3.calls.write, [1, 2]) && env3.row().last_target_date === DATE,
    );
    const env4 = newEnv({
      mode: "live",
      cursor: {
        targetDate: "2026-09-20",
        mode: "live",
        done: true,
        settled: [1],
        targets: [1],
      },
    });
    const d4 = newDeps({ venues: [1, 2] });
    await env4.invoke(T0, { deps: d4.deps });
    check(
      "(d) 前日の cursor は引き継がない（対象日が違う）",
      same(d4.calls.write, [1, 2]),
    );
  }
}

async function scene6() {
  // ---------------------------------------------------------------------------
  // (e) 失敗
  // ---------------------------------------------------------------------------
  {
    // 1会場の失敗は、他の会場を止めない。指数バックオフで再試行する
    const env = newEnv({ mode: "live" });
    const d = newDeps({
      venues: [1, 2, 3],
      failVenues: new Map([[2, "HTTP 503"]]),
    });
    const r1 = await env.invoke(T0, { deps: d.deps });
    const c1 = env.row().cursor;
    check(
      "(e) 会場2が失敗: 1・3は書き込み、2は済みにしない。実行は成功（一部の失敗）で、対象日は済みにしない",
      r1.status === 200 &&
        same(d.calls.write, [1, 3]) &&
        same(c1.settled, [1, 3]) &&
        c1.attempts["2"] === 1 &&
        c1.done === false &&
        env.row().last_target_date === undefined &&
        r1.body.failures === 1,
      show(r1.body),
    );
    check(
      "(e) 失敗した会場は、2分後まで再試行しない（バックオフ）",
      new Date(c1.retryAfter["2"]).getTime() === at(2).getTime(),
      c1.retryAfter["2"],
    );
    const r2 = await env.invoke(at(1), { deps: d.deps });
    check(
      "(e) バックオフの間の起動は、会場2を取得しない",
      d.calls.scrape.filter((c) => c === 2).length === 1 && r2.status === 200,
    );
    d.state.failVenues.clear();
    const r3 = await env.invoke(at(3), { deps: d.deps });
    check(
      "(e) バックオフが明けたら、会場2を再取得して書き込み、全会場が済み done。失敗の記録は消える",
      r3.body.done === true &&
        same(d.calls.write, [1, 3, 2]) &&
        env.row().last_target_date === DATE &&
        env.row().cursor.lastErrors["2"] === undefined,
      show(r3.body),
    );
    check(
      "(e) バックオフは 2・4・8・16・20分（上限）",
      same([1, 2, 3, 4, 5, 9].map(backoffMinutes), [2, 4, 8, 16, 20, 20]),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・DATE・JOB・newEnv・newDeps・range・T0・at） */
export async function runMorningInitJobsScenes1(env) {
  ({ check, show, same, jst, DATE, JOB, newEnv, newDeps, range, T0, at } = env);
  await scene3();
  await scene4();
  await scene5();
  await scene6();
}
