/**
 * verify-daily-reconcile.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-daily-reconcile.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { runDailyReconcileJob, FINAL_ATTEMPT_MINUTES_OF_DAY } from "../../lib/dailyReconcileJob.js";

let check, show, same, jst, K_DAY, DATE, facts, perfect;

// ===========================================================================
// (c) 日次ジョブ
// ===========================================================================
export const JOB = "daily_reconcile";

export const liveRow = (mode = "live", extra = {}) => ({
  job: JOB,
  mode,
  consecutive_failures: 0,
  ...extra,
});

export const okInputs = () => ({ ...perfect(), payoutsAvailable: true });

export const runJob = ({
  store,
  deps,
  when,
  client = createFakeSupabaseClient({}),
  politeFetch = async () => {
    throw new Error("取得してはいけません");
  },
}) =>
  runScrapeJob({
    job: JOB,
    run: (ctx) => runDailyReconcileJob(ctx, deps),
    store,
    client,
    politeFetch,
    now: () => when,
    worker: "verify",
  });

export const depsFor = ({
  text = K_DAY,
  inputs = okInputs,
  fetched = [],
  loaded = [],
} = {}) => ({
  fetchText: async (date) => {
    fetched.push(date);
    return text;
  },
  load: async (_client, date) => {
    loaded.push(date);
    return inputs();
  },
});

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  // 未公開・未展開・同期待ち: 最後の照合(17:30)まで incomplete、最後の照合で決着
  const pending = () => {
    const inputs = okInputs();
    const id = facts.find((f) => f.finisherBoats.length >= 4).race_id;
    Object.assign(
      inputs.results.find((r) => r.race_id === id),
      { rank4: null, rank5: null, rank6: null },
    );
    return inputs;
  };
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const r1 = await runJob({
    store,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ inputs: pending }),
  });
  const rep1 = store.state.get(JOB).last_report;
  check(
    "日次ジョブ 同期待ち(08:00): 対象日を処理済みにせず(incomplete)、通知も出さない。履歴にも入れない",
    r1.body.incomplete === true &&
      store.state.get(JOB).last_target_date === undefined &&
      rep1.alerts.length === 0 &&
      rep1.summary.syncPending.races === 1 &&
      rep1.history.length === 0,
    show({ b: r1.body, alerts: rep1.alerts }),
  );
  const r2 = await runJob({
    store,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ inputs: pending }),
  });
  const rep2 = store.state.get(JOB).last_report;
  check(
    "日次ジョブ 同期待ち(17:30 最後の照合): 不一致に数えて通知し、対象日を処理済みにし、履歴に入れる",
    r2.body.incomplete === false &&
      store.state.get(JOB).last_target_date === "2026-09-12" &&
      rep2.alerts.some((a) => a.key === `reconcile:${DATE}`) &&
      rep2.history.length === 1 &&
      rep2.history[0].mismatchRaces === 1 &&
      FINAL_ATTEMPT_MINUTES_OF_DAY === 17 * 60,
    show({ b: r2.body, alerts: rep2.alerts }),
  );
  // Kが未公開（404）
  const unpublished = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const u1 = await runJob({
    store: unpublished,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ text: null }),
  });
  const urep1 = unpublished.state.get(JOB).last_report;
  return { unpublished, u1, urep1 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ unpublished, u1, urep1 }) {
  check(
    "日次ジョブ Kが未公開(404) 08:00: 対象日を処理済みにせず(incomplete)、通知しない。不一致に混ぜない（unpublished）",
    u1.status === 200 &&
      u1.body.kStatus === "unpublished" &&
      u1.body.incomplete === true &&
      unpublished.state.get(JOB).last_target_date === undefined &&
      urep1.alerts.length === 0 &&
      urep1.summary.mismatchRaces === 0,
    show({ b: u1.body, s: urep1?.summary }),
  );
  const u2 = await runJob({
    store: unpublished,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ text: null }),
  });
  const urep2 = unpublished.state.get(JOB).last_report;
  check(
    "日次ジョブ Kが未公開(404) 17:30 最後の照合: 照合不能として通知(reconcile_unverifiable)し、対象日を処理済みにする。履歴に unverifiable を残す",
    u2.body.incomplete === false &&
      unpublished.state.get(JOB).last_target_date === "2026-09-12" &&
      urep2.alerts.some((a) => a.key === `reconcile_unverifiable:${DATE}`) &&
      urep2.history[0].unverifiable === 144 &&
      urep2.history[0].mismatchRaces === 0,
    show({ alerts: urep2.alerts, h: urep2.history }),
  );
  // shadow: Kが未公開のまま最後の照合になっても、通知は出さず（would_alert に記録）、対象日を処理済みにしない
  const shadowUnpublished = createMemoryStore({
    rows: { [JOB]: liveRow("shadow") },
  });
  await runJob({
    store: shadowUnpublished,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ text: null }),
  });
  const srep = shadowUnpublished.state.get(JOB).last_report;
  check(
    "日次ジョブ shadow・Kが未公開の最後の照合: 通知は出さず（would_alert に記録）、対象日を処理済みにしない",
    srep.alerts.length === 0 &&
      srep.wouldAlert?.some(
        (a) => a.key === `reconcile_unverifiable:${DATE}`,
      ) &&
      shadowUnpublished.state.get(JOB).last_target_date === undefined,
    show({ alerts: srep.alerts, would: srep.wouldAlert }),
  );
  // 一部の会場が未展開のK
  const partial = K_DAY.replace(
    /(05KBGN[\s\S]*?)(?=\n05KEND)/,
    "05KBGN\n多摩川［成績］      9/11      にっぽん未来プロジェ  第 3日\n\nデータは、この場の全レース終了後に登録されます。",
  );
  const ps = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const p1 = await runJob({
    store: ps,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ text: partial }),
  });
  return { p1 };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ p1 }) {
  check(
    "日次ジョブ 一部の会場が未展開: 展開済みの会場だけ照合し、未展開は照合不能。対象日は処理済みにしない（次の起動で再照合）",
    p1.body.incomplete === true &&
      p1.body.unverifiable === 12 &&
      p1.body.mismatchRaces === 0 &&
      p1.body.compared === 132,
    show(p1.body),
  );
}

async function scene4() {
  {
    for (const [label, storeOptions] of [
      ["mode=off", { rows: { [JOB]: { job: JOB, mode: "off" } } }],
      ["行なし", {}],
      ["075未適用", { available: false }],
    ]) {
      const store = createMemoryStore(storeOptions);
      const fetched = [];
      const res = await runJob({
        store,
        when: jst("2026-09-12T08:00:00"),
        deps: depsFor({ fetched }),
        client: {
          from() {
            throw new Error("DBへアクセスしてはいけません");
          },
        },
      });
      check(
        `日次ジョブ ${label}: 何もダウンロードせず、DBにもアクセスせず、200で終わる（既定は off）`,
        res.status === 200 &&
          fetched.length === 0 &&
          !store.calls.some((c) => c.name === "acquireLease"),
        show(res),
      );
    }
  }
  {
    // 対象日: 08:00 JST（2026-09-12）の起動が照合するのは前日（2026-09-11）
    const fetched = [];
    const loaded = [];
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      when: jst("2026-09-12T08:00:00"),
      deps: depsFor({ fetched, loaded }),
    });
    const row = store.state.get(JOB);
    check(
      "日次ジョブ live 08:00: 前日(2026-09-11)のKファイルをダウンロードし、DBの前日分を読む。一致すれば通知なしで、対象日(2026-09-12)を処理済みにする",
      res.status === 200 &&
        same(fetched, [DATE]) &&
        same(loaded, [DATE]) &&
        row.last_target_date === "2026-09-12" &&
        row.last_report.summary.matched === 144 &&
        row.last_report.alerts.length === 0 &&
        row.last_report.date === DATE &&
        row.last_report.kStatus === "ok" &&
        row.last_report.payoutTable === "checked",
      show({ status: res.status, report: row.last_report?.summary }),
    );
    const second = await runJob({
      store,
      when: jst("2026-09-12T12:30:00"),
      deps: depsFor({ fetched, loaded }),
    });
    check(
      "日次ジョブ live: 12:30 の補足の起動は、処理済みの対象日を再照合しない（冪等。ダウンロードもしない）",
      second.body.skipped === "already_done" && fetched.length === 1,
      show(second.body),
    );
    // 指定時刻(07:50)の前は前日: 07:40 JST の起動の対象日は前日 → 照合するのは前々日
    const early = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const loadedEarly = [];
    await runJob({
      store: early,
      when: jst("2026-09-12T07:40:00"),
      deps: depsFor({ loaded: loadedEarly }),
    });
    check(
      "日次ジョブ: 指定時刻(07:50)より前の起動は、前日を対象日とし、その前日（前々日）を照合する",
      same(loadedEarly, ["2026-09-10"]),
      show(loadedEarly),
    );
  }
}

async function scene5() {
  {
    // 不一致: live は通知（1回きり）・shadow は通知を出さず処理済みにしない
    const broken = () => {
      const inputs = okInputs();
      const id = facts.find((f) => f.finisherBoats.length >= 3).race_id;
      inputs.results.find((r) => r.race_id === id).payout_trio += 10;
      return inputs;
    };
    const live = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const when = jst("2026-09-12T08:00:00");
    const res = await runJob({
      store: live,
      when,
      deps: depsFor({ inputs: broken }),
    });
    const rep = live.state.get(JOB).last_report;
    check(
      "日次ジョブ live: 不一致1レースで通知(reconcile:日付)を出す。1回きり（until=30分後）。明細にレースID・項目・DB値・K値。照合不能・同期待ちが無ければ incomplete でない",
      res.status === 200 &&
        rep.alerts.length === 1 &&
        rep.alerts[0].key === `reconcile:${DATE}` &&
        rep.alerts[0].until ===
          new Date(when.getTime() + 30 * 60 * 1000).toISOString() &&
        /不一致 1レース/.test(rep.alerts[0].text) &&
        /payout\(3tan\)/.test(rep.alerts[0].text) &&
        rep.mismatches.length === 1 &&
        res.body.incomplete === false &&
        live.state.get(JOB).last_target_date === "2026-09-12",
      show({ alerts: rep.alerts, mm: rep.mismatches }),
    );
    const shadow = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
    const sres = await runJob({
      store: shadow,
      when,
      deps: depsFor({ inputs: broken }),
    });
    const srep = shadow.state.get(JOB).last_report;
    check(
      "日次ジョブ shadow: 照合して記録するが、通知は出さない（would_alert に記録）。対象日を処理済みにしない",
      sres.status === 200 &&
        srep.alerts.length === 0 &&
        srep.wouldAlert?.length === 1 &&
        shadow.state.get(JOB).last_target_date === undefined &&
        srep.summary.mismatchRaces === 1,
      show({ alerts: srep.alerts, would: srep.wouldAlert }),
    );
  }
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・K_DAY・DATE・facts・perfect） */
export async function runDailyReconcileScenes2(env) {
  ({ check, show, same, jst, K_DAY, DATE, facts, perfect } = env);
  await scene4();
  await scene5();
}
