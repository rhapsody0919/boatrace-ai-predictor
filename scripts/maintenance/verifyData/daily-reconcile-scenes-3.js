/**
 * verify-daily-reconcile.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-daily-reconcile.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  updateHistory,
  HISTORY_DAYS,
  buildReconcileAlerts,
  loadReconcileInputs,
} from "../../lib/dailyReconcileJob.js";
import { JOB, liveRow, runJob, depsFor, okInputs } from "./daily-reconcile-scenes-2.js";

let out, check, show, jst, perfect, reconcile;

async function scene1() {
  {
    // 0件エラー: 照合するレースがあるのに、Kファイルからレースを1件も抽出できない
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      when: jst("2026-09-12T08:00:00"),
      deps: depsFor({ text: "STARTK\nENDK\n" }),
    });
    check(
      "日次ジョブ 0件: 照合するレースがあるのにKファイルから1レースも解析できなければ、成功にせず失敗（500）にし、対象日を処理済みにしない",
      res.status === 500 &&
        store.state.get(JOB).last_target_date === undefined &&
        /0件/.test(store.state.get(JOB).last_error ?? ""),
      show({ status: res.status, err: store.state.get(JOB).last_error }),
    );
    // その日にレースが無い（全会場の休催）: 照合するものが無い
    const none = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const fetched = [];
    const nres = await runJob({
      store: none,
      when: jst("2026-09-12T08:00:00"),
      deps: depsFor({
        inputs: () => ({
          races: [],
          results: [],
          payouts: [],
          payoutsAvailable: true,
        }),
        fetched,
      }),
    });
    check(
      "日次ジョブ その日にレースが無い: 照合不要（ダウンロードしない・成功・処理済み）",
      nres.status === 200 &&
        fetched.length === 0 &&
        none.state.get(JOB).last_report.kStatus === "not_needed" &&
        none.state.get(JOB).last_target_date === "2026-09-12",
      show(nres.body),
    );
    // 払戻明細のテーブルが無いDB（079未適用）: 明細の突合を省く
    const noTable = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const inputs = () => {
      const i = okInputs();
      i.payouts = i.payouts.map((x) => ({ ...x, payout: x.payout + 999 })); // 明細があれば不一致になる値
      return { ...i, payoutsAvailable: false };
    };
    const tres = await runJob({
      store: noTable,
      when: jst("2026-09-12T08:00:00"),
      deps: depsFor({ inputs }),
    });
    check(
      "日次ジョブ race_payouts が無いDB: 払戻明細の突合を省き（payoutTable=unavailable）、旧列の突合は行う",
      tres.status === 200 &&
        noTable.state.get(JOB).last_report.payoutTable === "unavailable" &&
        noTable.state.get(JOB).last_report.summary.mismatchRaces === 0,
      show(noTable.state.get(JOB).last_report?.payoutTable),
    );
  }
  {
    // 履歴: 直近14日・同じ日は置き換え。通知の判定
    let h = [];
    for (let d = 1; d <= 20; d++)
      h = updateHistory(h, {
        date: `2026-09-${String(d).padStart(2, "0")}`,
        compared: 100,
      });
    h = updateHistory(h, { date: "2026-09-20", compared: 1 });
    check(
      "履歴: 直近14日だけ残し、同じ日は置き換える（日付の昇順）",
      HISTORY_DAYS === 14 &&
        h.length === 14 &&
        h[0].date === "2026-09-07" &&
        h.at(-1).compared === 1 &&
        h.filter((x) => x.date === "2026-09-20").length === 1,
      show(h.map((x) => x.date)),
    );
    const clean = reconcile(perfect());
    check(
      "通知の判定: 不一致0・照合不能0なら通知なし",
      buildReconcileAlerts(clean, { final: true, now: new Date() }).length === 0,
    );
    const bad = perfect();
    bad.results[0].rank1 = 6;
    bad.results[0].rank2 = 5;
    check(
      "通知の判定: 不一致1レースで通知する（閾値=1レース）。照合不能は最後の照合のみ通知",
      buildReconcileAlerts(reconcile(bad), { final: false, now: new Date() })
        .length === 1,
    );
  }
}

async function scene2() {
  {
    // DBの読み取り（loadReconcileInputs）
    const client = createFakeSupabaseClient({
      tables: {
        races: [
          {
            race_id: "2026-09-11-05-01",
            race_date: "2026-09-11",
            venue_code: 5,
            cancellation_status: null,
          },
          {
            race_id: "2026-09-12-05-01",
            race_date: "2026-09-12",
            venue_code: 5,
            cancellation_status: null,
          },
        ],
        race_results: [
          { race_id: "2026-09-11-05-01", rank1: 1 },
          { race_id: "2026-09-12-05-01", rank1: 2 },
        ],
        race_payouts: [
          {
            race_id: "2026-09-11-05-01",
            bet_type: "win",
            seq: 1,
            combination: "1",
            payout: 100,
            payout_status: "paid",
          },
          {
            race_id: "2026-09-12-05-01",
            bet_type: "win",
            seq: 1,
            combination: "2",
            payout: 200,
            payout_status: "paid",
          },
        ],
      },
    });
    const inputs = await loadReconcileInputs(client, "2026-09-11");
    check(
      "DB読み取り: 対象日のracesと結果・払戻明細だけを読む（他の日は読まない）",
      inputs.races.length === 1 &&
        inputs.results.length === 1 &&
        inputs.payouts.length === 1 &&
        inputs.payoutsAvailable === true,
      show(inputs),
    );
    const noPayouts = createFakeSupabaseClient({
      tables: { races: [], race_results: [] },
      failOn: {
        "race_payouts:select":
          "Could not find the table 'public.race_payouts' in the schema cache",
      },
    });
    const np = await loadReconcileInputs(noPayouts, "2026-09-11");
    check(
      "DB読み取り: race_payouts が無いDB（079未適用）は payoutsAvailable=false",
      np.payoutsAvailable === false,
    );
    let thrown = null;
    try {
      await loadReconcileInputs(
        createFakeSupabaseClient({ failOn: { "races:select": "接続エラー" } }),
        "2026-09-11",
      );
    } catch (error) {
      thrown = error;
    }
    check(
      "DB読み取り: 失敗は例外（空＝正常と誤判定しない）",
      thrown !== null && /接続エラー/.test(thrown.message),
    );
    let other = null;
    try {
      await loadReconcileInputs(
        createFakeSupabaseClient({
          tables: { races: [], race_results: [] },
          failOn: { "race_payouts:select": "タイムアウト" },
        }),
        "2026-09-11",
      );
    } catch (error) {
      other = error;
    }
    check(
      "DB読み取り: race_payouts の読み取りの別の失敗（テーブル不在以外）は例外（不在と取り違えない）",
      other !== null && /タイムアウト/.test(other.message),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・jst・perfect・reconcile） */
export async function runDailyReconcileScenes3(env) {
  ({ out, check, show, jst, perfect, reconcile } = env);
  await scene1();
  await scene2();
}

function scene3() {
  out.log("\nverify-daily-reconcile: すべて通りました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・jst・perfect・reconcile） */
export function runDailyReconcileScenes4(env) {
  ({ out, check, show, jst, perfect, reconcile } = env);
  scene3();
}
