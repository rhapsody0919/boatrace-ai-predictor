/**
 * verify-scrape-daily-jobs.js の後半の場面（4/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";
import { isTransientReason } from "../../lib/scrapeJobs/venueJobSupport.js";
import { runVenueEntryCourseStatsJob } from "../../lib/venueEntryCourseStatsJob.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { ecTables, ecFetch } from "./scrape-daily-jobs-scenes-3.js";

let check, show, same, jst, liveRow, runJob;

/** 元の verify の1つの塊 { } を割った 1/5 */
async function entryStep1() {
  const at = jst("2026-09-19T20:00:00");
  const runIt = (store, client, fetchImpl, when = at, deps = {}) =>
    runJob({
      job: "entry_course_stats",
      run: (ctx) => runVenueEntryCourseStatsJob(ctx, { delayMs: 0, ...deps }),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });
  // live: 開催のある会場だけ取得・書き込み。racer_id は出走表から引く。成否履歴は last_report
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const fetchImpl = ecFetch();
    const res = await runIt(store, client, fetchImpl);
    const rows = client.data.venue_entry_course_stats ?? [];
    const row = store.state.get("entry_course_stats");
    check(
      "進入コース: 開催のある3会場(常滑2R・徳山1R・唐津1R)の4ページだけを取得する（三国・その他の対象会場は取得しない）",
      fetchImpl.log.length === 4 && res.status === 200,
      show({ log: fetchImpl.log, body: res.body }),
    );
    check(
      "進入コース: 4レース×36行=144行を書く。racer_id は自社の出走表から引く(常滑1R)。対象日を処理済みにする",
      rows.length === 144 &&
        rows.filter(
          (r) => r.race_id === "2026-09-19-08-01" && r.racer_id === 4001,
        ).length > 0 &&
        row.last_target_date === "2026-09-19",
      show({ n: rows.length, target: row.last_target_date }),
    );
    check(
      "進入コース: 成否履歴は last_report.health（git push・fs なし）。書き込み済みの会場は settledVenues",
      same(Object.keys(row.last_report.health).sort(), ["18", "23", "8"]) &&
        row.last_report.health["8"].consecutiveFailDays === 0 &&
        same(row.last_report.settledVenues, [8, 18, 23]),
      show(row.last_report),
    );
    check(
      "進入コース: 同時取得は会場間のみ(上限3)。1会場内は逐次",
      fetchImpl.maxActive <= 3,
      String(fetchImpl.maxActive),
    );
  }
  // shadow は書かない・処理済みにしない。shadow で取得済みの会場を、live が飛ばさない
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: {
        entry_course_stats: {
          ...liveRow("entry_course_stats"),
          mode: "shadow",
        },
      },
    });
    const fetchImpl = ecFetch();
    await runIt(store, client, fetchImpl);
    const afterShadow = store.state.get("entry_course_stats");
    check(
      "進入コース shadow: 書き込まない・処理済みにしない・settledVenues は空",
      client.writesTo("venue_entry_course_stats").length === 0 &&
        afterShadow.last_target_date === undefined &&
        same(afterShadow.last_report.settledVenues, []),
      show(afterShadow.last_report),
    );
    afterShadow.mode = "live";
    const before = fetchImpl.log.length;
    await runIt(store, client, fetchImpl, jst("2026-09-19T22:30:00"));
    check(
      "進入コース: shadow で取得した会場を、live へ切り替えた同じ日の起動が飛ばさず、全て取得して書く",
      fetchImpl.log.length - before === 4 &&
        (client.data.venue_entry_course_stats ?? []).length === 144,
      show({ fetched: fetchImpl.log.length - before }),
    );
  }
  return { runIt };
}

/** 元の verify の1つの塊 { } を割った 2/5 */
async function entryStep2({ runIt }) {
  // 一時的な失敗の会場だけを、補足の起動が再取得する
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const flaky = new FetchError("https://x", 3, new Error("ECONNRESET"));
    const first = ecFetch({ "www.boatrace-tokuyama.jp": flaky });
    const res1 = await runIt(store, client, first);
    const row = store.state.get("entry_course_stats");
    check(
      "進入コース: 徳山だけ取得失敗(network_error)。他の会場は書く。対象日を処理済みにしない(incomplete)。徳山は settled でない",
      res1.status === 200 &&
        res1.body.incomplete === true &&
        row.last_target_date === undefined &&
        same(row.last_report.settledVenues, [8, 23]) &&
        row.last_report.health["18"].lastReason === "network_error" &&
        isTransientReason(row.last_report.health["18"].lastReason),
      show({ body: res1.body, report: row.last_report }),
    );
    const second = ecFetch();
    const res2 = await runIt(store, client, second, jst("2026-09-19T22:30:00"));
    check(
      "進入コース: 補足の起動(22:30)は、書き込み済みでない徳山だけを再取得し、成功したら対象日を処理済みにする",
      res2.status === 200 &&
        second.log.length === 1 &&
        second.log[0].includes("tokuyama") &&
        row.last_target_date === "2026-09-19" &&
        row.last_report.health["18"].consecutiveFailDays === 0 &&
        same(row.last_report.settledVenues, [8, 18, 23]),
      show({ log: second.log, report: row.last_report }),
    );
    const third = ecFetch();
    const res3 = await runIt(store, client, third, jst("2026-09-20T00:30:00"));
    check(
      "進入コース: 00:30 の補足の起動は、処理済みの対象日(09-19)なので、何も取得しない",
      res3.body.skipped === "already_done" && third.log.length === 0,
      show(res3.body),
    );
  }
  // 全会場が解析0行（期待あり）はエラー。構造変化の会場は、履歴に積み、14日連続で通知
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const allBroken = ecFetch({
      "www.boatrace-tokoname.jp": "<html><body>x</body></html>",
      "www.boatrace-tokuyama.jp": "<html><body>x</body></html>",
      "www.boatrace-karatsu.jp": "<html><body>x</body></html>",
    });
    const res = await runIt(store, client, allBroken);
    check(
      "進入コース: 取得した3会場の全てで解析0行は、0件エラー(500)。対象日を処理済みにしない",
      res.status === 500 &&
        /0件/.test(res.body.error ?? "") &&
        store.state.get("entry_course_stats").last_target_date === undefined,
      show(res.body),
    );
  }
  return { runIt };
}

/** 元の verify の1つの塊 { } を割った 3/5 */
async function entryStep3({ runIt }) {
  {
    // 徳山だけ構造変化(13日連続の履歴あり)。他は正常 → 14日目に通知が last_report.alerts に入る
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: {
        entry_course_stats: {
          ...liveRow("entry_course_stats"),
          last_report: {
            date: "2026-09-18",
            mode: "live",
            health: {
              18: {
                consecutiveFailDays: 13,
                lastReason: "entry_course_table_not_found",
                lastCheckedDate: "2026-09-18",
              },
            },
          },
        },
      },
    });
    const broken = ecFetch({
      "www.boatrace-tokuyama.jp": "<html><body>x</body></html>",
    });
    const res = await runIt(store, client, broken);
    const report = store.state.get("entry_course_stats").last_report;
    check(
      "進入コース: 構造変化の疑いが14日連続になった会場は、last_report.alerts に入る(monitor がSlackへ通知)。他会場の分は書く",
      res.status === 200 &&
        report.health["18"].consecutiveFailDays === 14 &&
        report.alerts.length === 1 &&
        report.alerts[0].key === "drift:18" &&
        /徳山/.test(report.alerts[0].text) &&
        (client.data.venue_entry_course_stats ?? []).length > 0,
      show(report.alerts),
    );
  }
  // 書き込みエラーは、実行の失敗（従来はログのみ）
  {
    const client = createFakeClient({
      tables: ecTables(),
      failOn: { "venue_entry_course_stats:upsert": "disk full" },
    });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const res = await runIt(store, client, ecFetch());
    check(
      "進入コース: 書き込みエラーは、エラー(500)。処理済みにしない・書き込み済みの会場も記録しない",
      res.status === 500 &&
        store.state.get("entry_course_stats").last_target_date === undefined,
      show(res.body),
    );
  }
  return { runIt };
}

/** 元の verify の1つの塊 { } を割った 4/5 */
async function entryStep4({ runIt }) {
  // races が0件は、エラー（朝の初期化の失敗を成功にしない）
  {
    const client = createFakeClient({ tables: { races: [] } });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const res = await runIt(store, client, ecFetch());
    check(
      "進入コース: 対象日の races が0件は、エラー。対象会場に開催が無いだけ(他の会場はある)なら、期待0件で正常",
      res.status === 500 && /races が0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const client2 = createFakeClient({
      tables: {
        races: [{ race_id: "2026-09-19-04-01", start_time: "10:30:00" }],
      },
    });
    const store2 = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const fetchImpl = ecFetch();
    const res2 = await runIt(store2, client2, fetchImpl);
    check(
      "進入コース: 対象10会場に開催が無い日(戸田のみ開催)は、取得せず正常・処理済み",
      res2.status === 200 &&
        fetchImpl.log.length === 0 &&
        store2.state.get("entry_course_stats").last_target_date ===
          "2026-09-19",
      show(res2.body),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 5/5 */
async function entryStep5() {
  // BOA-364: GitHub Actions（CLI）の対象日と0件の扱い
  {
    const { resolveCliTargetDate, main } =
      await import("../../daily/scrape-venue-entry-course-stats.js");
    const jst = (s) => new Date(`${s}+09:00`);
    check(
      "進入コース CLI: 20:00 指定が日付をまたいで遅れて起動（翌 01:30・06:59）しても前日。07:00 以降（日中の手動実行）は当日。--date 指定はそのまま（BOA-364）",
      resolveCliTargetDate([], jst("2026-09-20T01:30:00")) === "2026-09-19" &&
        resolveCliTargetDate([], jst("2026-09-19T20:05:00")) === "2026-09-19" &&
        // 日中の手動実行は当日（取得先のページは日付を持たず当日を返すため、前日の race_id に書かない）
        resolveCliTargetDate([], jst("2026-09-20T10:00:00")) === "2026-09-20" &&
        resolveCliTargetDate([], jst("2026-09-20T06:59:00")) === "2026-09-19" &&
        resolveCliTargetDate(
          ["--date=2026-09-01"],
          jst("2026-09-20T01:30:00"),
        ) === "2026-09-01",
    );
    const seen = [];
    let emptyError = null;
    try {
      await main({
        args: [],
        now: jst("2026-09-20T01:30:00"),
        getSchedule: async (date, opts) => {
          seen.push({ date, opts });
          return [];
        },
        runImpl: async () => {
          throw new Error("呼ばれない");
        },
      });
    } catch (error) {
      emptyError = error.message;
    }
    check(
      "進入コース CLI: 対象日の races が0件なら、0件保存の成功にせず例外（exit 1）。スケジュールは throwOnError で読む（BOA-364）",
      /races が0件/.test(emptyError ?? "") &&
        seen[0]?.date === "2026-09-19" &&
        seen[0]?.opts?.throwOnError === true,
      show({ emptyError, seen }),
    );
    const ran = [];
    await main({
      args: [],
      now: jst("2026-09-20T01:30:00"),
      getSchedule: async () => [{ race_id: "2026-09-19-01-01", venue_code: 1 }],
      runImpl: async (schedule, date) => ran.push({ n: schedule.length, date }),
    });
    check(
      "進入コース CLI: races があれば、解決した対象日で取得する",
      ran.length === 1 && ran[0].date === "2026-09-19" && ran[0].n === 1,
      show(ran),
    );
  }
}

async function entryStep6() {
  {
    const s1 = await entryStep1();
    const s2 = await entryStep2(s1);
    const s3 = await entryStep3(s2);
    await entryStep4(s3);
    await entryStep5();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・liveRow・runJob） */
export async function runScrapeDailyJobsScenes4(env) {
  ({ check, show, same, jst, liveRow, runJob } = env);
  await entryStep6();
}
