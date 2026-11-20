/**
 * verify-motor-pretest.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-motor-pretest.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import * as backfill from "../motor-pretest-backfill.js";
import { jobTables, JOB, liveRow, runJob, createFakeFetch, at, pageByVenue, jcdOf } from "./motor-pretest-scenes-2.js";

let out, check, show, same;

async function scene1() {
  {
    // マイグレーション090が未適用のDBで live: 成功にせず、失敗（500）。対象日を処理済みにしない
    const client = createFakeSupabaseClient({
      tables: jobTables(),
      failOn: {
        "motor_pretest_stats:select":
          "Could not find the table 'public.motor_pretest_stats' in the schema cache",
        "motor_pretest_stats:upsert":
          "Could not find the table 'public.motor_pretest_stats' in the schema cache",
      },
    });
    const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
    const res = await runJob({
      store,
      client,
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: at("05:30:00"),
    });
    const row = store.state.get(JOB);
    check(
      "日次ジョブ マイグレーション090が未適用: live は成功にせず失敗（500）にし、理由（090）を残す。対象日を処理済みにしない",
      res.status === 500 &&
        /090/.test(row.last_error ?? "") &&
        row.last_target_date === undefined,
      show({ status: res.status, err: row.last_error }),
    );
    const shadowStore = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
    const shadowRes = await runJob({
      store: shadowStore,
      client,
      politeFetch: createFakeFetch((url) => pageByVenue(jcdOf(url))),
      when: at("05:30:00"),
    });
    check(
      "日次ジョブ マイグレーション090が未適用: shadow は書かないため影響しない（先に shadow で確認できる）",
      shadowRes.status === 200,
      show(shadowRes.body),
    );
  }
  // ===========================================================================
  // (d) 過去分CLI
  // ===========================================================================
  {
    const args = backfill.parseArgs(
      ["plan"],
      new Date("2026-09-21T10:00:00+09:00"),
    );
    check(
      "CLI 既定: 期間は 2025-12-03 〜 前日、範囲は節の初日のみ、窓は JST 00-06（オッズの運用窓の外）、日次上限1,500、間隔3〜5秒",
      args.from === "2025-12-03" &&
        args.to === "2026-09-20" &&
        args.scope === "first-days" &&
        args.window === "00-06" &&
        args.dailyLimit === 1500 &&
        args.intervalMinMs === 3000 &&
        args.intervalMaxMs === 5000,
      show(args),
    );
    const throwsFor = (argv) => {
      try {
        backfill.validateOptions(backfill.parseArgs(argv));
        return false;
      } catch {
        return true;
      }
    };
    check(
      "CLI 検証: races の最古(2025-12-03)より前・逆転した期間・不正な範囲・不明なオプションは拒否",
      throwsFor(["plan", "--from=2025-11-30"]) &&
        throwsFor(["plan", "--from=2026-02-01", "--to=2026-01-01"]) &&
        throwsFor(["plan", "--scope=weekly"]) &&
        throwsFor(["plan", "--nonsense"]),
    );
    const floor = backfill.validateOptions(
      backfill.parseArgs([
        "download",
        "--interval-min-ms=500",
        "--interval-max-ms=1000",
      ]),
    );
    check(
      "CLI 間隔: 3秒未満は3秒に切り上げる（ADR-0067）",
      floor.intervalMinMs === 3000 && floor.intervalMaxMs >= 3000,
      show(floor),
    );
  }
}

function scene2() {
  {
    // 対象の会場×日: 節の初日（前日に同じ会場の開催が無い）と全日
    const days = (list) =>
      list.map(([v, d]) => ({ venue_code: v, race_date: d }));
    const venueDays = days([
      [2, "2025-12-03"],
      [2, "2025-12-04"],
      [2, "2025-12-05"],
      [2, "2025-12-10"], // 前日が無い → 初日
      [18, "2025-12-04"], // 前日（12-03）に開催が無い → 初日
      [18, "2025-12-05"],
      [5, "2025-12-03"], // races の最初の日: 全会場を初日とみなす
    ]);
    const range = { from: "2025-12-03", to: "2025-12-31" };
    const first = backfill.buildItems(venueDays, {
      ...range,
      scope: "first-days",
    });
    const all = backfill.buildItems(venueDays, { ...range, scope: "all-days" });
    check(
      "CLI 対象: first-days は前日に同じ会場の開催が無い会場×日と races の最初の日（日付・会場の順。キーは会場-日付）",
      same(
        first.map((i) => i.key),
        ["02-20251203", "05-20251203", "18-20251204", "02-20251210"],
      ) &&
        first[0].url ===
          "https://www.boatrace.jp/owpc/pc/race/rankingmotor?jcd=02&hd=20251203" &&
        all.length === 7,
      show(first.map((i) => i.key)),
    );
    // from が data の途中: from の前日も読んでいるため、from の日の判定が正しい（全会場を初日にしない）
    const mid = backfill.buildItems(venueDays, {
      from: "2025-12-05",
      to: "2025-12-31",
      scope: "first-days",
    });
    check(
      "CLI 対象: --from が途中の日でも、前日のデータで初日を判定する（12-05は、前日に開催がある会場を初日としない）",
      same(
        mid.map((i) => i.key),
        ["02-20251210"],
      ),
      show(mid.map((i) => i.key)),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same） */
export async function runMotorPretestScenes5(env) {
  ({ out, check, show, same } = env);
  await scene1();
  scene2();
}

function scene3() {
  out.log("\nverify-motor-pretest: すべて通りました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・same） */
export function runMotorPretestScenes6(env) {
  ({ out, check, show, same } = env);
  scene3();
}
