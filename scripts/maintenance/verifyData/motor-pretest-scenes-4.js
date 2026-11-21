/**
 * verify-motor-pretest.js の後半の場面（4/5）。verify ではない。
 * 判定と期待値は分ける前の verify-motor-pretest.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  buildCoverageAlerts,
  MOTOR_PRETEST_DRIFT_ALERT_DAYS,
  findMotorPretestDriftAlerts,
} from "../../lib/motorPretestJob.js";
import { jobTables, JOB, liveRow, throwingFetch, runJob, at, DATE, createFakeFetch, pageByVenue, jcdOf } from "./motor-pretest-scenes-2.js";

let check, show, same, TODA, TOKUYAMA, asPage;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 一時的な失敗（503）の会場: incomplete。補足の起動は、書き込み済みでない会場だけを再取得する
  const client = createFakeSupabaseClient({ tables: jobTables() });
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const f1 = createFakeFetch((url) => {
    if (jcdOf(url) === "18") return new Response("busy", { status: 503 });
    return pageByVenue(jcdOf(url));
  });
  const r1 = await runJob({
    store,
    client,
    politeFetch: f1,
    when: at("05:30:00"),
  });
  const row1 = store.state.get(JOB);
  check(
    "日次ジョブ 一時的な失敗: 徳山が503でも、戸田は書く。対象日は処理済みにならず(incomplete)、履歴に失敗の理由が残る",
    r1.status === 200 &&
      r1.body.incomplete === true &&
      client.data.motor_pretest_stats.length === 46 &&
      row1.last_target_date === undefined &&
      row1.last_report?.health?.["18"]?.lastReason === "http_503" &&
      same(row1.last_report?.settledVenues, [2]),
    show({
      body: r1.body,
      health: row1.last_report?.health,
      settled: row1.last_report?.settledVenues,
    }),
  );
  const f2 = createFakeFetch((url) => pageByVenue(jcdOf(url)));
  await runJob({
    store,
    client,
    politeFetch: f2,
    when: at("06:00:00"),
  });
  const row2 = store.state.get(JOB);
  return { client, f2, row2 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ client, f2, row2 }) {
  check(
    "日次ジョブ 補足の起動: 書き込み済みの戸田を再取得せず、徳山だけ取得して完了する。集計は前回から引き継ぐ",
    f2.log.length === 1 &&
      jcdOf(f2.log[0]) === "18" &&
      client.data.motor_pretest_stats.length === 91 &&
      row2.last_target_date === DATE &&
      row2.last_report?.summary?.pageRows === 91 &&
      row2.last_report?.coverage?.length === 2,
    show({ log: f2.log, summary: row2.last_report?.summary }),
  );
}

async function scene3() {
  {
    // races が無い・races_init が live で未完了 → 取得せず incomplete（last_target_date を進めない）
    for (const [label, tables, expectedWaiting] of [
      ["races が無い", { ...jobTables(), races: [] }, "races"],
      [
        "races_init が live で、その日の分が未完了",
        jobTables({
          initState: {
            job: "races_init",
            mode: "live",
            last_target_date: "2026-09-20",
          },
        }),
        "races_init",
      ],
    ]) {
      const client = createFakeSupabaseClient({ tables });
      const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
      const f = throwingFetch();
      const res = await runJob({
        store,
        client,
        politeFetch: f,
        when: at("05:30:00"),
      });
      const row = store.state.get(JOB);
      check(
        `日次ジョブ ${label}: 取得せず、対象日を処理済みにしない（次の起動が続きを処理する）`,
        res.status === 200 &&
          res.body.waiting === expectedWaiting &&
          res.body.incomplete === true &&
          f.count === 0 &&
          row.last_target_date === undefined,
        show({ status: res.status, body: res.body }),
      );
    }
    const client = createFakeSupabaseClient({
      tables: jobTables({
        initState: { job: "races_init", mode: "live", last_target_date: DATE },
      }),
    });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      client,
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: at("05:30:00"),
    });
    check(
      "日次ジョブ: races_init が live で、その日の分が完了していれば、取得する",
      res.status === 200 && store.state.get(JOB).last_target_date === DATE,
      show(res.body),
    );
    const shadowInit = createFakeSupabaseClient({
      tables: jobTables({
        initState: { job: "races_init", mode: "shadow", last_target_date: null },
      }),
    });
    const store2 = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res2 = await runJob({
      store: store2,
      client: shadowInit,
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: at("05:30:00"),
    });
    check(
      "日次ジョブ: races_init が shadow・off（朝の初期化が旧基盤）なら、races があれば取得する",
      res2.status === 200 && store2.state.get(JOB).last_target_date === DATE,
      show(res2.body),
    );
  }
}

async function scene4() {
  {
    // 0件エラー: 全会場のページが解析できない（構造の変化）→ 失敗（500）・対象日を処理済みにしない
    const client = createFakeSupabaseClient({ tables: jobTables() });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const f = createFakeFetch(
      () => "<html><body><main><p>変更後のページ</p></main></body></html>",
    );
    const res = await runJob({
      store,
      client,
      politeFetch: f,
      when: at("05:30:00"),
    });
    const row = store.state.get(JOB);
    check(
      "日次ジョブ 0件: 全会場のページを解析できなければ、成功にせず失敗（500）にし、対象日を処理済みにしない",
      res.status === 500 &&
        row.last_target_date === undefined &&
        client.writesTo("motor_pretest_stats").length === 0 &&
        /0件/.test(row.last_error ?? ""),
      show({ status: res.status, err: row.last_error }),
    );
  }
  {
    const s1 = await scene1();
    scene2(s1);
  }
  {
    // 期待した選手がページに載っていない → 通知（1回きり: until 付き）。載っていれば通知なし
    const client = createFakeSupabaseClient({
      tables: jobTables({
        extraEntries: [{ race_id: `${DATE}-02-01`, racer_id: 99999 }],
      }),
    });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      client,
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: at("05:30:00"),
    });
    const alerts = store.state.get(JOB).last_report?.alerts ?? [];
    check(
      "日次ジョブ 期待した選手(99999)がページに無い会場: 通知(coverage:日付)を出す。1回きり（until = 30分後）・書き込みは続ける",
      res.status === 200 &&
        alerts.length === 1 &&
        alerts[0].key === `coverage:${DATE}` &&
        /戸田1人/.test(alerts[0].text) &&
        alerts[0].until ===
          new Date(at("05:30:00").getTime() + 30 * 60 * 1000).toISOString() &&
        client.data.motor_pretest_stats.length === 91,
      show(alerts),
    );
  }
}

async function scene5() {
  {
    // 前検タイムの欠落（構造は正常だが、前検タイムが空のページ）→ 通知
    const blank = TODA.replaceAll(/<td>6\.\d\d\s*<\/td>/g, "<td>-</td>");
    const client = createFakeSupabaseClient({ tables: jobTables() });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      client,
      politeFetch: createFakeFetch((url) =>
        jcdOf(url) === "02" ? blank : pageByVenue(jcdOf(url)),
      ),
      when: at("05:30:00"),
    });
    const alerts = store.state.get(JOB).last_report?.alerts ?? [];
    check(
      "日次ジョブ 前検タイムの非NULL率が95%未満（戸田46人が全員空）: 通知(pretest_fill)を出す",
      res.status === 200 && alerts.some((a) => a.key === `pretest_fill:${DATE}`),
      show(alerts),
    );
    const ok = buildCoverageAlerts(
      DATE,
      [
        {
          venueCode: 2,
          pageRows: 46,
          expected: 3,
          missing: [],
          pretestFilled: 46,
        },
      ],
      new Date(),
    );
    check(
      "通知の判定: 全員載っていて前検タイムも入っていれば通知なし",
      ok.length === 0,
    );
    const few = buildCoverageAlerts(
      DATE,
      [{ venueCode: 2, pageRows: 5, expected: 3, missing: [], pretestFilled: 0 }],
      new Date(),
    );
    check(
      "通知の判定: 母数が20行未満の前検タイム欠落は通知しない（少数での誤報を避ける）",
      few.length === 0,
    );
  }
}

async function scene6() {
  {
    // 別のページ（日付・会場が違う）は保存しない。構造の変化は、2日連続で通知する
    const client = createFakeSupabaseClient({ tables: jobTables() });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const f = createFakeFetch((url) =>
      jcdOf(url) === "18"
        ? asPage(TOKUYAMA, 18, "2026-09-20")
        : pageByVenue(jcdOf(url)),
    );
    const res = await runJob({
      store,
      client,
      politeFetch: f,
      when: at("05:30:00"),
    });
    const row = store.state.get(JOB);
    check(
      "日次ジョブ 別のページ: 徳山のページの日付が要求と違えば page_mismatch で保存しない（戸田は保存する）",
      res.status === 200 &&
        client.data.motor_pretest_stats.every((r) => r.venue_code === 2) &&
        row.last_report?.health?.["18"]?.lastReason === "page_mismatch",
      show({ health: row.last_report?.health }),
    );
    // 会場が違うページ（徳山のURLへの応答が戸田のページ）も保存しない
    const client2 = createFakeSupabaseClient({ tables: jobTables() });
    const store2 = createMemoryStore({ rows: { [JOB]: liveRow() } });
    await runJob({
      store: store2,
      client: client2,
      politeFetch: createFakeFetch((url) =>
        jcdOf(url) === "18" ? TODA : pageByVenue(jcdOf(url)),
      ),
      when: at("05:30:00"),
    });
    check(
      "日次ジョブ 別のページ: 徳山のURLへの応答が戸田のページ（会場が違う）でも、page_mismatch で保存しない",
      client2.data.motor_pretest_stats.every((r) => r.venue_code === 2) &&
        store2.state.get(JOB).last_report?.health?.["18"]?.lastReason ===
          "page_mismatch",
      show(store2.state.get(JOB).last_report?.health),
    );
    check(
      "構造変化の通知: 構造起因の理由（parse_anomaly・no_data_page・page_mismatch）が2日連続で通知。1日目・一時的な失敗(http_503)は通知しない",
      MOTOR_PRETEST_DRIFT_ALERT_DAYS === 2 &&
        findMotorPretestDriftAlerts({
          18: { consecutiveFailDays: 2, lastReason: "page_mismatch" },
          2: { consecutiveFailDays: 5, lastReason: "http_503" },
          3: {
            consecutiveFailDays: 1,
            lastReason: "parse_anomaly:table_not_found",
          },
          5: {
            consecutiveFailDays: 3,
            lastReason: "parse_anomaly:unknown_header:x",
          },
        })
          .map((a) => a.key)
          .join() === "drift:5,drift:18",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・TODA・TOKUYAMA・asPage） */
export async function runMotorPretestScenes4(env) {
  ({ check, show, same, TODA, TOKUYAMA, asPage } = env);
  await scene3();
  await scene4();
  await scene5();
  await scene6();
}
