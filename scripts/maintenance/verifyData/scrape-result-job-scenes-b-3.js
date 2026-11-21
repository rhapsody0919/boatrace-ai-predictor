/**
 * verify-scrape-result-job.js の後半の場面（3/7）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-result-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  createResultOnTick,
  createResultSlotHandler,
  CANCELLATION_CONFIRM_AFTER_MIN,
  overdueWindows,
} from "../../lib/scrapeJobs/resultHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeDb } from "./scrape-result-job-fake-db.js";
import { NOW_TICK, politeFor, slotFor } from "./scrape-result-job-scenes-b-2.js";
import { baseDb, RACE_A, RACE_B, digestA, RACE_NONE } from "./scrape-result-job-scenes-b-1.js";

let check, show, same, HTML_NONE, HTML_PARTIAL;

export async function runResultJob({
  mode,
  slots = [],
  db = baseDb(),
  rows,
  polite = politeFor(),
  onTick,
  storeOverrides = {},
  available = true,
}) {
  const store = createMemoryStore({
    available,
    rows: rows ?? (mode ? { result: { job: "result", mode } } : {}),
    slots,
  });
  Object.assign(store, storeOverrides);
  const events = [];
  const origClaim = store.claimSlots.bind(store);
  store.claimSlots = async (a) => {
    events.push("claim");
    return origClaim(a);
  };
  const res = await runScrapeJob({
    job: "result",
    store,
    handleSlot: createResultSlotHandler(),
    onTick:
      onTick ??
      (async (ctx) => {
        events.push("tick");
        return createResultOnTick({
          confirm: async () => ({ checked: 0, confirmed: [] }),
        })(ctx);
      }),
    now: () => NOW_TICK,
    worker: "test-worker",
    client: db,
    politeFetch: polite,
  });
  return { res, store, db, polite, events };
}

async function srjb3Scene1() {
  {
    // off・行なし・075未適用: 何も取得せず何も書かない
    for (const [label, opts] of [
      ["mode=off", { mode: "off", slots: [slotFor(RACE_A)] }],
      ["scrape_job_state に行なし", { mode: null, slots: [slotFor(RACE_A)] }],
      [
        "予定表（075）が未適用",
        { mode: "live", slots: [slotFor(RACE_A)], available: false },
      ],
    ]) {
      const r = await runResultJob(opts);
      const names = r.store.calls.map((c) => c.name);
      check(
        `${label}: 取得0回・データテーブルへの書き込み0件・claimもしない・200（マージしても本番の挙動は変わらない）`,
        r.res.status === 200 &&
          r.polite.calls.length === 0 &&
          r.db.writes.length === 0 &&
          r.db.reads.length === 0 &&
          !names.includes("claimSlots") &&
          !names.includes("ensureSlots") &&
          !names.includes("completeSlot") &&
          !names.includes("touchTick") &&
          r.events.length === 0,
        show({
          body: r.res.body,
          names,
          writes: r.db.writes,
          fetched: r.polite.calls,
        }),
      );
      if (label === "scrape_job_state に行なし") {
        check(
          `${label}: 書くのは、mode=off の行を1つ作る（ensureRow）ことだけ。modeは変更しない`,
          names.filter((n) => n !== "readState").join() === "ensureRow" &&
            r.store.state.get("result").mode === "off",
          show(names),
        );
      }
    }
  }
}

async function srjb3Scene2() {
  {
    // shadow: 取得・解析のみ。予定表に digest を記録。データテーブルへは書かない。onTick も呼ばない
    const r = await runResultJob({
      mode: "shadow",
      slots: [slotFor(RACE_A), slotFor(RACE_B)],
    });
    check(
      "shadow: 2スロットが ok で完了し、result_digest が記録される（既存基盤の行から計算した値と比べられる形）",
      r.res.status === 200 &&
        r.store.completed.length === 2 &&
        r.store.completed.every(
          (c) => c.outcome === "ok" && /^[0-9a-f]{16}$/.test(c.resultDigest),
        ) &&
        r.store.completed.find((c) => c.slot.race_id === RACE_A).resultDigest ===
          digestA,
      show(r.res.body),
    );
    check(
      "shadow: データテーブルへの書き込み0件（DBを読みもしない）・onTick（races への書き込み）は呼ばない",
      r.db.writes.length === 0 &&
        r.db.reads.length === 0 &&
        !r.events.includes("tick"),
      show({ writes: r.db.writes, events: r.events }),
    );
    check(
      "shadow: 取得は politeFetch 経由（2件）。run_mode は shadow で claim される",
      r.polite.calls.length === 2 &&
        r.store.calls.find((c) => c.name === "claimSlots").mode === "shadow",
    );
  }
  {
    // live: 書き込む。onTick は claim の前
    const r = await runResultJob({ mode: "live", slots: [slotFor(RACE_A)] });
    check(
      "live: ok で完了・データテーブルへ書き込む。書き込み行数が予定表に記録される",
      r.res.status === 200 &&
        r.store.completed.length === 1 &&
        r.store.completed[0].outcome === "ok" &&
        r.store.completed[0].rowsWritten === 7 &&
        r.db.tables.race_results.length === 1,
      show(r.res.body),
    );
    check(
      "live: onTick（中止・順延の確定）は claim（スロットの取得）より前に呼ばれる（確定が先＝中止のレースが expired にならない）",
      r.events.join() === "tick,claim",
      r.events.join(),
    );
  }
}

async function srjb3Scene3() {
  {
    // partial / no_values → 完了にせず再試行（retrySlot）。error だけなら500
    const partial = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      polite: politeFor(() => HTML_PARTIAL),
    });
    check(
      "live・決まり手が未公開: 完了にせず、再試行（pending に戻す）。理由が last_error に入る",
      partial.store.completed.length === 0 &&
        partial.store.retried.length === 1 &&
        /決まり手/.test(partial.store.retried[0].error) &&
        partial.store.retried[0].outcome === "partial",
      show(partial.store.retried),
    );
    const none = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_NONE)],
      polite: politeFor(() => HTML_NONE),
    });
    check(
      "live・未公開（no_values）: 再試行。書き込みなし。0件を成功にしない（完了にしない）",
      none.store.completed.length === 0 &&
        none.store.retried[0].outcome === "no_values" &&
        none.db.writes.length === 0 &&
        none.res.status === 200,
      show(none.res.body),
    );
    const allErr = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      polite: async () => new Response("x", { status: 503 }),
    });
    check(
      "live・全スロットが取得失敗（HTTP 503）: 500・連続失敗を記録・スロットは再試行",
      allErr.res.status === 500 &&
        allErr.store.retried.length === 1 &&
        allErr.store.calls.some((c) => c.name === "recordFailure"),
      show(allErr.res.body),
    );
    const lost = await runResultJob({
      mode: "live",
      slots: [slotFor(RACE_A)],
      storeOverrides: { completeSlot: async () => false },
    });
    check(
      "リースを奪われていた（completeSlot が false）: 例外にも失敗にもせず、200（データ側は冪等な書き込み済みで無害。二重完了しない）",
      lost.res.status === 200 &&
        !lost.store.calls.some((c) => c.name === "recordFailure"),
      show(lost.res.body),
    );
  }
  check(
    "result の最初の窓は発走 +10分",
    same(SCRAPE_JOBS.result.offsets, [10]),
    show(SCRAPE_JOBS.result.offsets),
  );
  // 中止・順延の確定
  check(
    "確定の基準: 結果のスロットの期限+許容幅（発走+10分+80分）が、中止・順延の確定の基準（発走+90分）と一致する",
    SCRAPE_JOBS.result.offsets[0] + SCRAPE_JOBS.result.graceMin ===
      CANCELLATION_CONFIRM_AFTER_MIN,
  );
}

async function srjb3Scene4() {
  {
    // overdueWindows: 発走 < now-90分（排他）、15分の範囲
    const w = overdueWindows(new Date("2026-09-19T05:40:00Z")); // 14:40 JST → 発走13:10未満・12:55以上
    check(
      "overdueWindows: 14:40 JST → 発走 12:55:00〜13:10:00（未満）の1範囲",
      same(w, [{ date: "2026-09-19", from: "12:55:00", to: "13:10:00" }]),
      show(w),
    );
    const w2 = overdueWindows(new Date("2026-09-19T15:16:00Z")); // 00:16 JST（翌日）→ 前日22:31〜22:46
    check(
      "overdueWindows: 翌 00:16 JST → 前日（2026-09-19）の発走 22:31:00〜22:46:00（未満）。最終レース22:45発走が入る（日付をまたいでも拾う）",
      same(w2, [{ date: "2026-09-19", from: "22:31:00", to: "22:46:00" }]) &&
        "22:45:00" >= w2[0].from &&
        "22:45:00" < w2[0].to,
      show(w2),
    );
    const wExact = overdueWindows(new Date("2026-09-19T15:15:00Z")); // 00:15:00 ちょうど: 22:45発走は「90分ちょうど」で、まだ超えていない
    check(
      "overdueWindows: 22:45発走のレースは、翌 00:15:00 ちょうどでは対象外（発走+90分を「超えた」後＝排他）",
      !("22:45:00" < wExact[0].to),
      show(wExact),
    );
    const wCross = overdueWindows(new Date("2026-09-19T16:40:00Z")); // 01:40 JST → 前日23:55〜（終日）と当日 00:00〜00:10
    check(
      "overdueWindows: 日付をまたぐ範囲は、前日の終わりまでと当日の 00:00 からの2つに分ける",
      same(wCross, [
        { date: "2026-09-19", from: "23:55:00", to: null },
        { date: "2026-09-20", from: "00:00:00", to: "00:10:00" },
      ]),
      show(wCross),
    );
  }
  {
    // onTick: 発走時刻の範囲のレースを問い合わせ、確定の処理へ渡す
    const db = createFakeDb({
      races: [
        {
          race_id: "A",
          race_date: "2026-09-19",
          start_time: "12:56:00",
          cancellation_status: null,
        },
        {
          race_id: "B",
          race_date: "2026-09-19",
          start_time: "13:09:00",
          cancellation_status: null,
        },
        {
          race_id: "C",
          race_date: "2026-09-19",
          start_time: "13:10:00",
          cancellation_status: null,
        }, // 上限（排他）
        {
          race_id: "D",
          race_date: "2026-09-19",
          start_time: "12:50:00",
          cancellation_status: null,
        }, // 範囲外（古い）
        {
          race_id: "E",
          race_date: "2026-09-19",
          start_time: "13:00:00",
          cancellation_status: "confirmed",
        }, // 確定済み
        {
          race_id: "F",
          race_date: "2026-09-18",
          start_time: "13:00:00",
          cancellation_status: null,
        }, // 別の日
      ],
    });
    const seen = [];
    const tick = await createResultOnTick({
      confirm: async (client, ids) => {
        seen.push(ids);
        return { checked: ids.length, confirmed: ["A"] };
      },
    })({ client: db, now: () => NOW_TICK });
    check(
      "onTick: 発走 12:55〜13:10（未満）・未確定・当日のレースだけを、確定の処理に渡す",
      same(seen, [["A", "B"]]) && same(tick, { overdue: 2, confirmed: 1 }),
      show({ seen, tick }),
    );
    check(
      "onTick: 書き込みは自分ではしない（確定は confirm 経由）",
      db.writes.length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_NONE・HTML_PARTIAL） */
export async function runScrapeResultJobScenesB4(env) {
  ({ check, show, same, HTML_NONE, HTML_PARTIAL } = env);
  await srjb3Scene1();
  await srjb3Scene2();
  await srjb3Scene3();
  await srjb3Scene4();
}
